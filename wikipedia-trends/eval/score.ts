import type { ChatMessage } from "./openrouter.js";
import type { GroundTruth } from "./groundtruth.js";
import type { JudgeScore } from "./judge.js";

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

export type DirectionVerdict = "match" | "mismatch" | "n/a";
export type BoolVerdict = "yes" | "no" | "n/a";

export interface ScoreResult {
  caseId: string;
  model: string;
  condition: "skill" | "no-skill";
  toolCallCount: number;
  totalTokens: number;
  // Tier 1 -- deterministic, no AI
  usedRealData: boolean;
  hadToolErrors: boolean;
  errored: boolean;
  directionMatch: DirectionVerdict;
  // Tier 2 -- rubric, no AI (but needs to know what the case expects)
  ambiguityHandled: BoolVerdict;
  flagsSurfaced: BoolVerdict;
  // Tier 3 -- LLM-judge (null if judging was skipped or the judge call failed)
  judge: JudgeScore | null;
}

// Deliberately exclude the bare noun "growth" -- it's used as neutral
// terminology ("MoM growth was -12%") regardless of sign, so testing for it
// alone produces false positives on negative-growth answers. Only verb/adjective
// forms that assert a direction count.
const GROWING_WORDS = /\b(grow(?:ing)?|increas(?:ing|e|ed)|ris(?:ing|e|en)|upward|uptick|positive trend)\b/i;
const DECLINING_WORDS = /\b(declin(?:ing|e|ed)|decreas(?:ing|e|ed)|drop(?:ping|ped)?|falling|fell|downward|negative trend)\b/i;
const FLAT_WORDS = /\b(flat|stable|no (?:significant |real )?change|plateau(?:ed|ing)?)\b/i;

/** Check decline before growth: a declining answer often still uses "growth" as neutral terminology. */

function toolOutputs(transcript: ChatMessage[]): string[] {
  return transcript.filter((m) => m.role === "tool").map((m) => (typeof m.content === "string" ? m.content : ""));
}

/** Heuristic: does the free-text answer claim a direction, and does any ground-truth entry share it? */
function scoreDirectionMatch(finalText: string, groundTruth: GroundTruth | null): DirectionVerdict {
  if (!groundTruth || groundTruth.entries.length === 0) return "n/a";
  const stated = DECLINING_WORDS.test(finalText)
    ? "declining"
    : GROWING_WORDS.test(finalText)
      ? "growing"
      : FLAT_WORDS.test(finalText)
        ? "flat"
        : null;
  if (!stated) return "n/a";
  return groundTruth.entries.some((e) => e.direction === stated) ? "match" : "mismatch";
}

const AMBIGUITY_DISCLOSURE_WORDS =
  /\b(ambiguous|ambiguity|could (?:also )?(?:refer|mean)|multiple meanings|multiple interpretations|which (?:meaning|sense|version)|not sure (?:which|what) you mean|clarify which|different meanings|other meanings)\b/i;

/**
 * The tool telling the model "ambiguous": true isn't enough -- SKILL.md
 * requires that be surfaced to the user, not silently resolved. So this
 * checks the final answer itself discloses the ambiguity, not just that the
 * model saw the signal.
 */
function scoreAmbiguityHandled(expectAmbiguityHandling: boolean | undefined, finalText: string): BoolVerdict {
  if (!expectAmbiguityHandling) return "n/a";
  return AMBIGUITY_DISCLOSURE_WORDS.test(finalText) ? "yes" : "no";
}

function scoreFlagsSurfaced(groundTruth: GroundTruth | null, transcript: ChatMessage[]): BoolVerdict {
  if (!groundTruth) return "n/a";
  const expectedFlags = groundTruth.entries.filter((e) =>
    Object.values(e.flags).some((v) => v === true),
  );
  if (expectedFlags.length === 0) return "n/a"; // nothing notable to surface
  const outputs = toolOutputs(transcript);
  const anyFlagTrueInOutput = outputs.some((o) => /"(shortHistory|lowVolume|hasSpike|hasGaps|trailingMonthLikelyIncomplete)":\s*true/.test(o));
  return anyFlagTrueInOutput ? "yes" : "no";
}

export function scoreRun(run: RunOutcome, groundTruth: GroundTruth | null, expectAmbiguityHandling?: boolean): ScoreResult {
  const outputs = toolOutputs(run.transcript);
  const usedRealData =
    run.condition === "skill" && outputs.some((o) => /"momGrowthPct"|"yoyGrowthPct"|"totalViews"/.test(o));
  const hadToolErrors = outputs.some((o) => o.startsWith("Error") || o.startsWith("Command failed"));

  return {
    caseId: run.caseId,
    model: run.model,
    condition: run.condition,
    toolCallCount: run.toolCallCount,
    totalTokens: run.totalTokens,
    usedRealData,
    hadToolErrors,
    errored: run.errored,
    directionMatch: scoreDirectionMatch(run.finalText, groundTruth),
    ambiguityHandled: scoreAmbiguityHandled(expectAmbiguityHandling, run.finalText),
    flagsSurfaced: scoreFlagsSurfaced(groundTruth, run.transcript),
    judge: null,
  };
}

export function renderMarkdownTable(scores: ScoreResult[]): string {
  const header =
    "| case | model | condition | tool calls | tokens | real data | direction | ambiguity | flags | tool err | errored | judge (fact/caveat/action) |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|";
  const verdictIcon = (v: string) => (v === "match" || v === "yes" ? "✅" : v === "mismatch" || v === "no" ? "❌" : "—");
  const rows = scores.map((s) => {
    const judgeStr = s.judge
      ? `${s.judge.factualAccuracy}/${s.judge.caveatAppropriateness}/${s.judge.actionability}`
      : "—";
    return `| ${s.caseId} | ${s.model} | ${s.condition} | ${s.toolCallCount} | ${s.totalTokens} | ${s.usedRealData ? "✅" : "—"} | ${verdictIcon(s.directionMatch)} | ${verdictIcon(s.ambiguityHandled)} | ${verdictIcon(s.flagsSurfaced)} | ${s.hadToolErrors ? "⚠️" : "—"} | ${s.errored ? "❌" : "—"} | ${judgeStr} |`;
  });
  return [header, sep, ...rows].join("\n");
}
