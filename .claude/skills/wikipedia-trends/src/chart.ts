import type PDFDocument from "pdfkit";
import type { MonthlyPoint } from "./pageviews.js";

export interface ChartSeries {
  label: string;
  color: string;
  points: MonthlyPoint[];
}

export interface ChartBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const AXIS_COLOR = "#888888";
const LABEL_FONT_SIZE = 7;
const PADDING_FOR_LABELS = { top: 10, right: 10, bottom: 22, left: 45 };

/**
 * Draws a multi-series line chart directly onto a pdfkit document using
 * vector primitives (lines, small circles, text) — no rasterization, no
 * native deps, no headless browser.
 */
export function drawLineChart(doc: typeof PDFDocument.prototype, box: ChartBox, series: ChartSeries[]): void {
  const plot = {
    x: box.x + PADDING_FOR_LABELS.left,
    y: box.y + PADDING_FOR_LABELS.top,
    width: box.width - PADDING_FOR_LABELS.left - PADDING_FOR_LABELS.right,
    height: box.height - PADDING_FOR_LABELS.top - PADDING_FOR_LABELS.bottom,
  };

  const allMonths = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.month)))).sort();
  const allViews = series.flatMap((s) => s.points.map((p) => p.views));
  if (allMonths.length === 0 || allViews.length === 0) {
    doc.fontSize(LABEL_FONT_SIZE).fillColor(AXIS_COLOR).text("No data to chart", box.x, box.y);
    return;
  }
  const maxViews = Math.max(...allViews, 1);
  const minViews = 0; // always anchor at zero so growth isn't visually exaggerated

  const xFor = (month: string): number => {
    const idx = allMonths.indexOf(month);
    return plot.x + (idx / Math.max(allMonths.length - 1, 1)) * plot.width;
  };
  const yFor = (views: number): number => {
    const frac = (views - minViews) / (maxViews - minViews || 1);
    return plot.y + plot.height - frac * plot.height;
  };

  // Axes
  doc
    .strokeColor(AXIS_COLOR)
    .lineWidth(0.5)
    .moveTo(plot.x, plot.y)
    .lineTo(plot.x, plot.y + plot.height)
    .lineTo(plot.x + plot.width, plot.y + plot.height)
    .stroke();

  // Y-axis ticks (0, mid, max)
  doc.fontSize(LABEL_FONT_SIZE).fillColor(AXIS_COLOR);
  for (const frac of [0, 0.5, 1]) {
    const val = Math.round(maxViews * frac);
    const y = yFor(val);
    doc.text(String(val), box.x, y - 3, { width: PADDING_FOR_LABELS.left - 4, align: "right" });
  }

  // X-axis labels: first, middle, last month only (avoid overlap on a narrow report width)
  const tickIdxs = Array.from(
    new Set([0, Math.floor((allMonths.length - 1) / 2), allMonths.length - 1]),
  );
  for (const idx of tickIdxs) {
    const month = allMonths[idx];
    doc.text(month, xFor(month) - 15, plot.y + plot.height + 4, { width: 30, align: "center" });
  }

  // Series lines
  series.forEach((s) => {
    const pts = s.points.filter((p) => allMonths.includes(p.month));
    if (pts.length === 0) return;
    doc.strokeColor(s.color).lineWidth(1.5);
    pts.forEach((p, i) => {
      const x = xFor(p.month);
      const y = yFor(p.views);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.stroke();
  });

  // Legend
  let legendX = box.x + PADDING_FOR_LABELS.left;
  const legendY = box.y + box.height - 10;
  series.forEach((s) => {
    doc.rect(legendX, legendY, 6, 6).fill(s.color);
    doc.fillColor("#333333").fontSize(LABEL_FONT_SIZE).text(s.label, legendX + 9, legendY - 1);
    legendX += 9 + doc.widthOfString(s.label) + 12;
  });
}
