import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateReport } from "./report.js";
import { normalizeAgainstBaseline, type ComparisonEntry } from "./analyze.js";
import type { MonthlyPoint } from "./pageviews.js";

function monthsFrom(start: string, n: number): string[] {
  const [y, m] = start.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function series(months: string[], views: number[]): MonthlyPoint[] {
  return months.map((month, i) => ({ month, views: views[i] }));
}

test("generateReport writes a non-trivial, valid-looking PDF for fixture data", async () => {
  const months = monthsFrom("2024-01", 24);
  const topicPl = series(months, Array.from({ length: 24 }, (_, i) => 800 + i * 40));
  const baselinePl = series(months, Array.from({ length: 24 }, () => 2_000_000));
  const topicCs = series(months, Array.from({ length: 24 }, (_, i) => 300 + i * 5));
  const baselineCs = series(months, Array.from({ length: 24 }, () => 400_000));

  const entries: ComparisonEntry[] = [
    { label: "intermittent fasting / pl", trend: normalizeAgainstBaseline(topicPl, baselinePl, 24) },
    { label: "intermittent fasting / cs", trend: normalizeAgainstBaseline(topicCs, baselineCs, 24) },
  ];

  const dir = mkdtempSync(join(tmpdir(), "wt-report-"));
  const outPath = join(dir, "report.pdf");
  try {
    await generateReport(
      { title: "Intermittent fasting: PL vs CS", lookbackMonths: 24, entries },
      outPath,
    );
    const stat = statSync(outPath);
    assert.ok(stat.size > 1000, `expected a non-trivial PDF, got ${stat.size} bytes`);
    const header = readFileSync(outPath).subarray(0, 5).toString("ascii");
    assert.equal(header, "%PDF-");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
