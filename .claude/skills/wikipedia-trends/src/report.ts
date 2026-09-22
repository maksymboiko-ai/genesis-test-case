import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { drawLineChart, type ChartSeries } from "./chart.js";
import type { ComparisonEntry, ConfidenceFlags } from "./analyze.js";

const PALETTE = ["#4C6EF5", "#F76707", "#2F9E44", "#E64980", "#7048E8"];

export interface ReportInput {
  title: string;
  subtitle?: string;
  lookbackMonths: number;
  entries: ComparisonEntry[];
}

function flagCaveats(flags: ConfidenceFlags): string[] {
  const out: string[] = [];
  if (flags.shortHistory) out.push("less history than the requested lookback window (young article/edition)");
  if (flags.lowVolume) out.push("low absolute traffic — month-to-month noise likely dominates the trend");
  if (flags.hasSpike) out.push("contains a statistical spike — may reflect a single news event, not sustained interest");
  if (flags.hasGaps) out.push("has months with zero recorded views (data gap)");
  return out;
}

function fmtPct(x: number | null): string {
  if (x === null) return "n/a";
  const sign = x >= 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

function trendDirection(entry: ComparisonEntry): string {
  const slope = entry.trend.normalized.regression?.slopePerMonth ?? 0;
  const r2 = entry.trend.normalized.regression?.r2 ?? 0;
  if (Math.abs(slope) < 1e-9) return "flat";
  const direction = slope > 0 ? "growing" : "declining";
  const confidence = r2 > 0.6 ? "consistent" : "noisy";
  return `${direction} (${confidence} trend, R²=${r2.toFixed(2)})`;
}

/** Generates a one-page PDF report and writes it to `outPath`. Resolves when the file is fully written. */
export function generateReport(input: ReportInput, outPath: string): Promise<void> {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(18).fillColor("#111111").text(input.title, { align: "left" });
  if (input.subtitle) {
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor("#555555").text(input.subtitle);
  }
  doc.moveDown(0.3);
  doc
    .fontSize(8)
    .fillColor("#888888")
    .text(
      `Generated ${new Date().toISOString().slice(0, 10)} · Wikimedia pageviews, last ${input.lookbackMonths} months · Source: wikimedia.org/api/rest_v1`,
    );
  doc.moveDown(0.6);

  // Headline numbers table
  doc.fontSize(10).fillColor("#111111");
  input.entries.forEach((entry) => {
    const t = entry.trend.raw;
    doc
      .fontSize(11)
      .fillColor("#111111")
      .text(`${entry.label}`, { continued: false });
    doc
      .fontSize(9)
      .fillColor("#333333")
      .text(
        `  total views: ${t.totalViews.toLocaleString()}  ·  MoM: ${fmtPct(t.momGrowthPct)}  ·  YoY: ${fmtPct(t.yoyGrowthPct)}  ·  ${trendDirection(entry)}`,
      );
  });
  doc.moveDown(0.5);

  // Raw views chart
  doc.fontSize(10).fillColor("#111111").text("Raw monthly pageviews");
  const rawSeries: ChartSeries[] = input.entries.map((e, i) => ({
    label: e.label,
    color: PALETTE[i % PALETTE.length],
    points: e.trend.raw.months,
  }));
  const chartTop1 = doc.y + 4;
  drawLineChart(doc, { x: doc.page.margins.left, y: chartTop1, width: 523, height: 140 }, rawSeries);
  doc.y = chartTop1 + 140 + 8;

  // Normalized (share of edition traffic) chart — controls for the whole edition growing/shrinking
  doc.fontSize(10).fillColor("#111111").text("Share of edition traffic (ppm) — normalized for edition growth");
  const normSeries: ChartSeries[] = input.entries.map((e, i) => ({
    label: e.label,
    color: PALETTE[i % PALETTE.length],
    points: e.trend.sharePpm,
  }));
  const chartTop2 = doc.y + 4;
  drawLineChart(doc, { x: doc.page.margins.left, y: chartTop2, width: 523, height: 140 }, normSeries);
  doc.y = chartTop2 + 140 + 10;

  // Assumptions & limitations
  doc.fontSize(11).fillColor("#111111").text("Assumptions & limitations");
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor("#333333");
  doc.text(
    "Pageviews measure article visits, not purchase intent or product demand — treat this as a signal for further validation, not a decision by itself.",
  );
  input.entries.forEach((entry) => {
    const caveats = flagCaveats(entry.trend.raw.flags);
    if (caveats.length > 0) {
      doc.moveDown(0.15);
      doc.text(`${entry.label}: ${caveats.join("; ")}.`);
    }
  });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}
