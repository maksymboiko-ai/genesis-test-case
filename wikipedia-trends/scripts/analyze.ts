import type { MonthlyPoint } from "./pageviews.js";

export interface ConfidenceFlags {
  /** Fewer months of data than requested (article likely younger than the lookback window). */
  shortHistory: boolean;
  /** Average monthly views below a threshold where month-to-month noise dominates the signal. */
  lowVolume: boolean;
  /** At least one month is a statistical outlier (|z-score| > 2.5) vs the rest of the series. */
  hasSpike: boolean;
  /** One or more months in the requested range have no data (zero-filled or missing). */
  hasGaps: boolean;
  /**
   * The most recent month's views are implausibly low vs the trailing average —
   * a sign Wikimedia hasn't finished processing that month yet, even though it's
   * calendar-complete. Excluded from momGrowthPct/yoyGrowthPct/regression.
   */
  trailingMonthLikelyIncomplete: boolean;
}

export interface TrendStats {
  months: MonthlyPoint[];
  totalViews: number;
  meanMonthlyViews: number;
  /** % change, most recent month vs the month before it. Null if <2 months of data. */
  momGrowthPct: number | null;
  /** % change, most recent month vs the same month one year earlier. Null if <13 months of data. */
  yoyGrowthPct: number | null;
  /** Slope of a linear regression over the whole series (views/month), and its R². */
  regression: { slopePerMonth: number; r2: number } | null;
  flags: ConfidenceFlags;
  spikeMonths: string[];
}

const LOW_VOLUME_THRESHOLD = 500; // avg monthly views below this: too noisy to trust a trend
const SPIKE_Z_THRESHOLD = 2.5;
const MIN_MONTHS_FOR_SHORT_HISTORY_FLAG_MARGIN = 1; // tolerate off-by-one at range edges
const TRAILING_INCOMPLETE_RATIO = 0.25; // last month < 25% of the prior 3-month average -> likely unprocessed yet

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], avg = mean(xs)): number {
  return Math.sqrt(mean(xs.map((x) => (x - avg) ** 2)));
}

function linearRegression(points: MonthlyPoint[]): { slopePerMonth: number; r2: number } | null {
  if (points.length < 2) return null;
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.views);
  const xMean = mean(xs);
  const yMean = mean(ys);

  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  if (den === 0) return { slopePerMonth: 0, r2: 0 };
  const slope = num / den;
  const intercept = yMean - slope * xMean;

  const ssTot = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slopePerMonth: slope, r2 };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function trailingMonthIncomplete(sorted: MonthlyPoint[]): boolean {
  if (sorted.length < 4) return false;
  const last = sorted[sorted.length - 1].views;
  // Median (not mean) of the prior 3 months so a single spike month doesn't
  // distort the baseline this trailing check compares against.
  const priorMedian = median(sorted.slice(-4, -1).map((p) => p.views));
  if (priorMedian <= 0) return false;
  return last / priorMedian < TRAILING_INCOMPLETE_RATIO;
}

function detectSpikes(points: MonthlyPoint[]): string[] {
  if (points.length < 4) return []; // too few points for a meaningful z-score
  const views = points.map((p) => p.views);
  const avg = mean(views);
  const sd = stddev(views, avg);
  if (sd === 0) return [];
  return points.filter((p) => Math.abs((p.views - avg) / sd) > SPIKE_Z_THRESHOLD).map((p) => p.month);
}

/** expectedMonths: the full requested lookback, e.g. from lastNMonths(24). Used to detect gaps. */
export function analyzeTrend(points: MonthlyPoint[], expectedMonths: number): TrendStats {
  const sorted = [...points].sort((a, b) => (a.month < b.month ? -1 : 1));
  const totalViews = sorted.reduce((s, p) => s + p.views, 0);
  const meanMonthlyViews = sorted.length > 0 ? totalViews / sorted.length : 0;

  const trailingIncomplete = trailingMonthIncomplete(sorted);
  // Growth/regression are computed on the "effective" series with a likely-unprocessed
  // trailing month dropped; `months` (used for charting) still includes it as-is.
  const effective = trailingIncomplete ? sorted.slice(0, -1) : sorted;

  const momGrowthPct =
    effective.length >= 2 && effective[effective.length - 2].views > 0
      ? ((effective[effective.length - 1].views - effective[effective.length - 2].views) /
          effective[effective.length - 2].views) *
        100
      : null;

  const yoyGrowthPct =
    effective.length >= 13 && effective[effective.length - 13].views > 0
      ? ((effective[effective.length - 1].views - effective[effective.length - 13].views) /
          effective[effective.length - 13].views) *
        100
      : null;

  const regression = linearRegression(effective);
  const spikeMonths = detectSpikes(effective);

  const flags: ConfidenceFlags = {
    shortHistory: sorted.length < expectedMonths - MIN_MONTHS_FOR_SHORT_HISTORY_FLAG_MARGIN,
    lowVolume: meanMonthlyViews < LOW_VOLUME_THRESHOLD,
    hasSpike: spikeMonths.length > 0,
    hasGaps: effective.some((p) => p.views === 0),
    trailingMonthLikelyIncomplete: trailingIncomplete,
  };

  return {
    months: sorted,
    totalViews,
    meanMonthlyViews,
    momGrowthPct,
    yoyGrowthPct,
    regression,
    flags,
    spikeMonths,
  };
}

export interface NormalizedTrend {
  raw: TrendStats;
  /** raw views as a share of the project's total traffic that month, ×1e6 (parts per million). */
  sharePpm: MonthlyPoint[];
  normalized: TrendStats;
}

/** Divides the topic's series by the project-wide aggregate to control for the whole edition growing/shrinking. */
export function normalizeAgainstBaseline(
  topicSeries: MonthlyPoint[],
  baselineSeries: MonthlyPoint[],
  expectedMonths: number,
): NormalizedTrend {
  const baselineByMonth = new Map(baselineSeries.map((p) => [p.month, p.views]));
  const sharePpm: MonthlyPoint[] = topicSeries
    .filter((p) => baselineByMonth.get(p.month))
    .map((p) => ({
      month: p.month,
      views: (p.views / (baselineByMonth.get(p.month) as number)) * 1_000_000,
    }));

  return {
    raw: analyzeTrend(topicSeries, expectedMonths),
    sharePpm,
    normalized: analyzeTrend(sharePpm, expectedMonths),
  };
}

export interface ComparisonEntry {
  label: string; // e.g. "astronomy / uk" or just "uk"
  trend: NormalizedTrend;
}

/** Cross-language or cross-topic comparison: just bundles per-series results side by side for the report layer. */
export function compareSeries(entries: ComparisonEntry[]): ComparisonEntry[] {
  return entries;
}
