import { chatCompletion, type ChatMessage } from "./openrouter.js";
import type { GroundTruth } from "./groundtruth.js";

// Reused as-is across a whole benchmark run so scores stay comparable over
// time; deliberately not one of the models in EVAL_MODELS (avoids a model
// grading its own family favorably), and a different tier than the cheap
// models under test.
export const DEFAULT_JUDGE_MODEL = "anthropic/claude-sonnet-5";

export interface JudgeScore {
  factualAccuracy: number; // 1-5: does the answer's numbers/direction match ground truth, no fabrication
  caveatAppropriateness: number; // 1-5: hedges when flags warrant it, doesn't over-hedge when data is solid
  actionability: number; // 1-5: specific enough for a real product decision
  rationale: string;
}

const JUDGE_SYSTEM_PROMPT = `You are an evaluation judge for an AI assistant that helps B2C product teams read Wikipedia pageview trends. You will see the user's question, the assistant's final answer, and ground-truth data our own tool computed independently (the assistant did not necessarily see this exact ground-truth object, but it had access to the same underlying data via its own tool calls).

Score the answer 1-5 on each dimension:
- factualAccuracy: Do the numbers/direction the answer states match the ground truth? 5 = fully consistent, no fabricated numbers. 1 = contradicts the ground truth or states numbers that don't appear anywhere in real data.
- caveatAppropriateness: Given the ground truth's confidence flags (shortHistory, lowVolume, hasSpike, hasGaps, trailingMonthLikelyIncomplete), does the answer hedge appropriately? 5 = hedges exactly where warranted, doesn't over-hedge where data is solid. 1 = states a low-confidence trend as if certain, or vice versa.
- actionability: Is the recommendation specific enough for a real product decision (not generic "consider further research")? 5 = names specific next steps grounded in the data. 1 = vague/generic.

Respond with ONLY a JSON object, no markdown fences, no other text: {"factualAccuracy": <1-5>, "caveatAppropriateness": <1-5>, "actionability": <1-5>, "rationale": "<one sentence>"}`;

function parseJudgeJson(text: string): JudgeScore | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (
      typeof parsed.factualAccuracy === "number" &&
      typeof parsed.caveatAppropriateness === "number" &&
      typeof parsed.actionability === "number"
    ) {
      return {
        factualAccuracy: parsed.factualAccuracy,
        caveatAppropriateness: parsed.caveatAppropriateness,
        actionability: parsed.actionability,
        rationale: String(parsed.rationale ?? ""),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function judgeAnswer(
  apiKey: string,
  question: string,
  finalText: string,
  groundTruth: GroundTruth | null,
  judgeModel: string = DEFAULT_JUDGE_MODEL,
): Promise<JudgeScore | null> {
  if (!finalText.trim()) return null; // nothing to judge (e.g. an errored run)

  const messages: ChatMessage[] = [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `USER QUESTION:\n${question}\n\nASSISTANT'S FINAL ANSWER:\n${finalText}\n\nGROUND TRUTH (computed independently, may be null if the case has no single correct answer by design):\n${JSON.stringify(groundTruth, null, 2)}`,
    },
  ];

  try {
    const resp = await chatCompletion(apiKey, judgeModel, messages, undefined);
    const content = resp.choices[0]?.message?.content;
    return typeof content === "string" ? parseJudgeJson(content) : null;
  } catch {
    return null; // judge failures shouldn't crash the whole eval run
  }
}
