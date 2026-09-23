import type { ChatMessage } from "./openrouter.js";

export interface RunOutcome {
  caseId: string;
  model: string;
  condition: "skill" | "no-skill";
  transcript: ChatMessage[];
  toolCallCount: number;
  totalTokens: number;
  finalText: string;
  errored: boolean;
  errorMessage?: string;
}

export interface ScoreResult {
  caseId: string;
  model: string;
  condition: "skill" | "no-skill";
  toolCallCount: number;
  totalTokens: number;
  usedRealData: boolean;
  mentionsCaveats: boolean;
  mentionsQuantifiedTrend: boolean;
  hadToolErrors: boolean;
  errored: boolean;
}

const CAVEAT_WORDS =
  /\b(caveat|however|but note|low.confidence|low.volume|noisy|spike|limited data|small sample|not (?:fully )?reliable|take .* with|uncertain|hard to trust|should be cautious|grain of salt|incomplete|недостат|обереж)\b/i;

const QUANTIFIED_TREND = /-?\d+(\.\d+)?\s?%/;

function toolOutputs(transcript: ChatMessage[]): string[] {
  return transcript.filter((m) => m.role === "tool").map((m) => (typeof m.content === "string" ? m.content : ""));
}

export function scoreRun(run: RunOutcome): ScoreResult {
  const outputs = toolOutputs(run.transcript);
  const usedRealData =
    run.condition === "skill" &&
    outputs.some((o) => /"momGrowthPct"|"yoyGrowthPct"|"totalViews"/.test(o));
  const hadToolErrors = outputs.some((o) => o.startsWith("Error") || o.startsWith("Command failed"));

  return {
    caseId: run.caseId,
    model: run.model,
    condition: run.condition,
    toolCallCount: run.toolCallCount,
    totalTokens: run.totalTokens,
    usedRealData,
    mentionsCaveats: CAVEAT_WORDS.test(run.finalText),
    mentionsQuantifiedTrend: QUANTIFIED_TREND.test(run.finalText),
    hadToolErrors,
    errored: run.errored,
  };
}

export function renderMarkdownTable(scores: ScoreResult[]): string {
  const header =
    "| case | model | condition | tool calls | tokens | used real data | mentions caveats | quantified trend | tool errors | errored |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = scores.map(
    (s) =>
      `| ${s.caseId} | ${s.model} | ${s.condition} | ${s.toolCallCount} | ${s.totalTokens} | ${s.usedRealData ? "✅" : "—"} | ${s.mentionsCaveats ? "✅" : "—"} | ${s.mentionsQuantifiedTrend ? "✅" : "—"} | ${s.hadToolErrors ? "⚠️" : "—"} | ${s.errored ? "❌" : "—"} |`,
  );
  return [header, sep, ...rows].join("\n");
}
