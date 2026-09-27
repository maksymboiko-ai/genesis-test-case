// Computes the authoritative reference answer for a case by calling this
// project's own data/analysis modules directly (not the CLI subprocess, and
// not cached alongside the CLI's own cache -- this always hits fresh data so
// it can't silently agree with a stale bug in the CLI's cache layer).
import { resolveTopic } from "../src/wikidata.js";
import { fetchPerArticleMonthly, fetchProjectAggregateMonthly, lastNMonths } from "../src/pageviews.js";
import { normalizeAgainstBaseline, type ComparisonEntry } from "../src/analyze.js";

export interface GroundTruthSpec {
  topic: string;
  langs: string[];
  months: number;
}

export interface GroundTruthEntry {
  lang: string;
  label: string;
  momGrowthPct: number | null;
  yoyGrowthPct: number | null;
  direction: "growing" | "declining" | "flat" | "unknown";
  flags: ComparisonEntry["trend"]["raw"]["flags"];
}

export interface GroundTruth {
  spec: GroundTruthSpec;
  ambiguous: boolean;
  unresolvedLangs: string[];
  entries: GroundTruthEntry[];
}

const FLAT_THRESHOLD_PCT = 3; // |growth| below this counts as "flat", not a direction claim

function classifyDirection(pct: number | null): GroundTruthEntry["direction"] {
  if (pct === null) return "unknown";
  if (Math.abs(pct) < FLAT_THRESHOLD_PCT) return "flat";
  return pct > 0 ? "growing" : "declining";
}

export async function computeGroundTruth(spec: GroundTruthSpec): Promise<GroundTruth> {
  const resolved = await resolveTopic(spec.topic, spec.langs);
  const range = lastNMonths(spec.months);
  const entries: GroundTruthEntry[] = [];
  const unresolvedLangs: string[] = [];

  if (!resolved.resolved) {
    return { spec, ambiguous: resolved.ambiguous, unresolvedLangs: spec.langs, entries: [] };
  }

  for (const lang of spec.langs) {
    const title = resolved.resolved.titles[lang];
    if (!title) {
      unresolvedLangs.push(lang);
      continue;
    }
    const [topicSeries, baselineSeries] = await Promise.all([
      fetchPerArticleMonthly(lang, title, range),
      fetchProjectAggregateMonthly(lang, range),
    ]);
    const trend = normalizeAgainstBaseline(topicSeries, baselineSeries, spec.months);
    // Prefer YoY (controls for seasonality) when available, else fall back to MoM.
    const pctForDirection = trend.raw.yoyGrowthPct ?? trend.raw.momGrowthPct;
    entries.push({
      lang,
      label: `${spec.topic} / ${lang}`,
      momGrowthPct: trend.raw.momGrowthPct,
      yoyGrowthPct: trend.raw.yoyGrowthPct,
      direction: classifyDirection(pctForDirection),
      flags: trend.raw.flags,
    });
  }

  return { spec, ambiguous: resolved.ambiguous, unresolvedLangs, entries };
}
