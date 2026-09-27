import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTrend, normalizeAgainstBaseline } from "../scripts/analyze.js";
import type { MonthlyPoint } from "../scripts/pageviews.js";

function series(months: string[], views: number[]): MonthlyPoint[] {
  return months.map((month, i) => ({ month, views: views[i] }));
}

function monthsFrom(start: string, n: number): string[] {
  const [y, m] = start.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

test("flags shortHistory when fewer months than requested lookback", () => {
  const pts = series(monthsFrom("2025-01", 3), [100, 110, 120]);
  const stats = analyzeTrend(pts, 24);
  assert.equal(stats.flags.shortHistory, true);
});

test("does not flag shortHistory when full lookback is present", () => {
  const pts = series(
    monthsFrom("2024-01", 24),
    Array.from({ length: 24 }, (_, i) => 1000 + i * 10),
  );
  const stats = analyzeTrend(pts, 24);
  assert.equal(stats.flags.shortHistory, false);
});

test("flags lowVolume for a small-audience series", () => {
  const pts = series(monthsFrom("2025-01", 6), [10, 12, 8, 15, 9, 11]);
  const stats = analyzeTrend(pts, 6);
  assert.equal(stats.flags.lowVolume, true);
});

test("does not flag lowVolume for a high-traffic series", () => {
  const pts = series(monthsFrom("2025-01", 6), [50000, 51000, 49000, 52000, 53000, 54000]);
  const stats = analyzeTrend(pts, 6);
  assert.equal(stats.flags.lowVolume, false);
});

test("detects a spike month via z-score", () => {
  const pts = series(
    monthsFrom("2025-01", 8),
    [1000, 1050, 980, 1020, 1010, 15000, 990, 1005], // month 6 is a huge outlier
  );
  const stats = analyzeTrend(pts, 8);
  assert.equal(stats.flags.hasSpike, true);
  assert.ok(stats.spikeMonths.length >= 1);
});

test("does not flag a spike for a smooth series", () => {
  const pts = series(monthsFrom("2025-01", 8), [1000, 1020, 1010, 1030, 1040, 1015, 1025, 1035]);
  const stats = analyzeTrend(pts, 8);
  assert.equal(stats.flags.hasSpike, false);
});

test("flags trailingMonthLikelyIncomplete and excludes it from MoM growth", () => {
  const pts = series(monthsFrom("2025-01", 8), [1000, 1050, 980, 1020, 1010, 990, 1005, 12]); // last month collapses
  const stats = analyzeTrend(pts, 8);
  assert.equal(stats.flags.trailingMonthLikelyIncomplete, true);
  // MoM should compare the two months before the dropped one, not 12 vs 1005.
  assert.ok(stats.momGrowthPct !== null && Math.abs(stats.momGrowthPct) < 5);
  // The raw series for charting still includes the low trailing month.
  assert.equal(stats.months[stats.months.length - 1].views, 12);
});

test("does not flag trailingMonthLikelyIncomplete for a normal decline", () => {
  const pts = series(monthsFrom("2025-01", 8), [1000, 950, 900, 850, 800, 750, 700, 650]);
  const stats = analyzeTrend(pts, 8);
  assert.equal(stats.flags.trailingMonthLikelyIncomplete, false);
});

test("flags gaps when a month has zero views", () => {
  const pts = series(monthsFrom("2025-01", 5), [100, 0, 120, 130, 140]);
  const stats = analyzeTrend(pts, 5);
  assert.equal(stats.flags.hasGaps, true);
});

test("computes positive regression slope for a rising series", () => {
  const pts = series(
    monthsFrom("2025-01", 12),
    Array.from({ length: 12 }, (_, i) => 1000 + i * 100),
  );
  const stats = analyzeTrend(pts, 12);
  assert.ok(stats.regression);
  assert.ok(stats.regression!.slopePerMonth > 0);
  assert.ok(stats.regression!.r2 > 0.9);
});

test("computes MoM and YoY growth correctly", () => {
  const views = Array.from({ length: 13 }, (_, i) => 1000 + i * 50);
  const pts = series(monthsFrom("2024-01", 13), views);
  const stats = analyzeTrend(pts, 13);
  // last two: index 12 (1600) vs index 11 (1550) -> ~3.226%
  assert.ok(stats.momGrowthPct !== null && Math.abs(stats.momGrowthPct - 3.226) < 0.01);
  // last vs 13 months earlier (same index): 1600 vs 1000 -> 60% (13 points => index 0 and 12)
  assert.ok(stats.yoyGrowthPct !== null);
});

test("normalizeAgainstBaseline divides topic series by project totals", () => {
  const months = monthsFrom("2025-01", 4);
  const topic = series(months, [100, 200, 150, 300]);
  const baseline = series(months, [1_000_000, 1_000_000, 1_000_000, 1_000_000]);
  const result = normalizeAgainstBaseline(topic, baseline, 4);
  assert.equal(result.sharePpm.length, 4);
  assert.equal(result.sharePpm[0].views, 100); // 100/1e6 * 1e6 = 100 ppm
});
