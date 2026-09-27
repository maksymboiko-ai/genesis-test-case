// Regenerates the charts and example report embedded in the repo README:
//   npm run docs:charts [-- <path/to/eval-results.json>]
// Eval charts come from an eval results file (default: the latest judged run);
// the example trend and PDF come from live Wikimedia data.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveTopic } from "../src/wikidata.js";
import { fetchPerArticleMonthly, fetchProjectAggregateMonthly, lastNMonths } from "../src/pageviews.js";
import { normalizeAgainstBaseline, type ComparisonEntry } from "../src/analyze.js";
import { generateReport } from "../src/report.js";

const SKILL_DIR = join(import.meta.dirname, "..");
const RESULTS_DIR = join(SKILL_DIR, "eval", "results");
const DOCS_DIR = join(SKILL_DIR, "docs");

// Reference palette (validated light + dark with the dataviz validator).
const STYLE = `<style>
text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.bg{fill:#fcfcfb}.t1{fill:#0b0b0b}.t2{fill:#52514e}.mut{fill:#898781}
.grid{stroke:#e1e0d9}.axis{stroke:#c3c2b7}
.s1{fill:#2a78d6}.s2{fill:#eb6834}.l1{stroke:#2a78d6}.l2{stroke:#eb6834}.ring{stroke:#fcfcfb}
@media (prefers-color-scheme:dark){
.bg{fill:#1a1a19}.t1{fill:#ffffff}.t2{fill:#c3c2b7}
.grid{stroke:#2c2c2a}.axis{stroke:#383835}
.s1{fill:#3987e5}.s2{fill:#d95926}.l1{stroke:#3987e5}.l2{stroke:#d95926}.ring{stroke:#1a1a19}}
</style>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const approxTextWidth = (s: string, size: number) => s.length * size * 0.56;

function svgDoc(width: number, height: number, title: string, desc: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
${STYLE}
<rect class="bg" width="${width}" height="${height}" rx="8"/>
${body}
</svg>
`;
}

/** Horizontal bar: square at the baseline, 4px rounded data-end. */
function hBar(x: number, y: number, w: number, h: number, cls: string): string {
  if (w <= 4) return `<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(w, 0)}" height="${h}"/>`;
  return `<path class="${cls}" d="M${x},${y}h${w - 4}a4,4 0 0 1 4,4v${h - 8}a4,4 0 0 1 -4,4h${-(w - 4)}z"/>`;
}

function legend(x: number, y: number, items: Array<{ label: string; cls: string }>): string {
  let cx = x;
  return items
    .map((it) => {
      const out = `<rect class="${it.cls}" x="${cx}" y="${y - 9}" width="10" height="10" rx="2"/><text class="t2" x="${cx + 15}" y="${y}" font-size="12">${esc(it.label)}</text>`;
      cx += 15 + approxTextWidth(it.label, 12) + 20;
      return out;
    })
    .join("\n");
}

interface GroupedDatum {
  category: string;
  a: number; // series 1
  b: number; // series 2
}

/** Grouped horizontal bars on a 0..max scale, value labeled at each bar tip. */
function groupedBarChart(opts: {
  title: string;
  subtitle: string;
  seriesLabels: [string, string];
  data: GroupedDatum[];
  max: number;
  tickStep: number;
  format: (v: number) => string;
  desc: string;
}): string {
  const width = 720;
  const labelCol = 190;
  const plotX = labelCol + 10;
  const plotW = width - plotX - 50;
  const barH = 20;
  const gap = 2; // surface gap between the two bars of a group
  const groupH = barH * 2 + gap;
  const groupSpacing = 22;
  const top = 92;
  const plotH = opts.data.length * groupH + (opts.data.length - 1) * groupSpacing;
  const height = top + plotH + 44;
  const xFor = (v: number) => plotX + (v / opts.max) * plotW;

  const parts: string[] = [];
  parts.push(`<text class="t1" x="24" y="34" font-size="17" font-weight="600">${esc(opts.title)}</text>`);
  parts.push(`<text class="t2" x="24" y="55" font-size="12.5">${esc(opts.subtitle)}</text>`);
  parts.push(
    legend(24, 78, [
      { label: opts.seriesLabels[0], cls: "s1" },
      { label: opts.seriesLabels[1], cls: "s2" },
    ]),
  );

  for (let v = 0; v <= opts.max + 1e-9; v += opts.tickStep) {
    const x = xFor(v);
    parts.push(`<line class="${v === 0 ? "axis" : "grid"}" x1="${x}" y1="${top - 6}" x2="${x}" y2="${top + plotH + 6}" stroke-width="1"/>`);
    parts.push(`<text class="mut" x="${x}" y="${top + plotH + 24}" font-size="11" text-anchor="middle">${opts.format(v)}</text>`);
  }

  opts.data.forEach((d, i) => {
    const y = top + i * (groupH + groupSpacing);
    parts.push(`<text class="t1" x="${labelCol}" y="${y + groupH / 2 + 4}" font-size="13" text-anchor="end">${esc(d.category)}</text>`);
    [
      { v: d.a, cls: "s1", yy: y },
      { v: d.b, cls: "s2", yy: y + barH + gap },
    ].forEach(({ v, cls, yy }) => {
      const w = xFor(v) - plotX;
      parts.push(hBar(plotX, yy, w, barH, cls));
      parts.push(`<text class="t2" x="${plotX + w + 6}" y="${yy + barH / 2 + 4}" font-size="12">${opts.format(v)}</text>`);
    });
  });

  return svgDoc(width, height, opts.title, opts.desc, parts.join("\n"));
}

function niceStep(max: number, targetTicks = 4): number {
  const raw = max / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Two-series line chart; a flagged-incomplete trailing month is drawn as a dashed final segment. */
function lineChart(opts: {
  title: string;
  subtitle: string;
  series: Array<{ label: string; cls: 1 | 2; points: Array<{ month: string; views: number }>; incompleteTail: boolean }>;
  yLabel: string;
  note: string;
  desc: string;
}): string {
  const width = 720;
  const height = 400;
  const plot = { x: 64, y: 118, w: width - 64 - 130, h: 210 };
  const months = Array.from(new Set(opts.series.flatMap((s) => s.points.map((p) => p.month)))).sort();
  const maxV = Math.max(...opts.series.flatMap((s) => s.points.map((p) => p.views)));
  const step = niceStep(maxV);
  const yMax = Math.ceil(maxV / step) * step;
  const xFor = (m: string) => plot.x + (months.indexOf(m) / Math.max(months.length - 1, 1)) * plot.w;
  const yFor = (v: number) => plot.y + plot.h - (v / yMax) * plot.h;
  const fmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 10 ? 1 : 0));
  const fmtTick = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(1));

  const parts: string[] = [];
  parts.push(`<text class="t1" x="24" y="34" font-size="17" font-weight="600">${esc(opts.title)}</text>`);
  parts.push(`<text class="t2" x="24" y="55" font-size="12.5">${esc(opts.subtitle)}</text>`);
  parts.push(legend(24, 78, opts.series.map((s) => ({ label: s.label, cls: `s${s.cls}` }))));

  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const y = yFor(v);
    parts.push(`<line class="${v === 0 ? "axis" : "grid"}" x1="${plot.x}" y1="${y}" x2="${plot.x + plot.w}" y2="${y}" stroke-width="1"/>`);
    parts.push(`<text class="mut" x="${plot.x - 8}" y="${y + 4}" font-size="11" text-anchor="end">${fmtTick(v)}</text>`);
  }
  parts.push(`<text class="mut" x="${plot.x - 8}" y="${plot.y - 14}" font-size="11">${esc(opts.yLabel)}</text>`);

  const tickIdx = Array.from(new Set([0, Math.floor((months.length - 1) / 2), months.length - 1]));
  for (const i of tickIdx) {
    parts.push(`<text class="mut" x="${xFor(months[i])}" y="${plot.y + plot.h + 20}" font-size="11" text-anchor="middle">${fmtMonth(months[i])}</text>`);
  }

  // Collect end labels first so colliding ones can fall back to the legend.
  const ends: Array<{ y: number; text: string }> = [];
  for (const s of opts.series) {
    const pts = s.points;
    const solid = s.incompleteTail ? pts.slice(0, -1) : pts;
    const d = solid.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.month).toFixed(1)},${yFor(p.views).toFixed(1)}`).join("");
    parts.push(`<path class="l${s.cls}" d="${d}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (s.incompleteTail && pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      parts.push(`<line class="l${s.cls}" x1="${xFor(a.month)}" y1="${yFor(a.views)}" x2="${xFor(b.month)}" y2="${yFor(b.views)}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`);
    }
    const last = solid[solid.length - 1];
    if (last) {
      parts.push(`<circle class="s${s.cls} ring" cx="${xFor(last.month)}" cy="${yFor(last.views)}" r="4.5" stroke-width="2"/>`);
      ends.push({ y: yFor(last.views), text: `${s.label} ${fmt(last.views)}` });
    }
  }
  const collide = ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 16;
  if (!collide) {
    for (const e of ends) {
      parts.push(`<text class="t2" x="${plot.x + plot.w + 10}" y="${e.y + 4}" font-size="12">${esc(e.text)}</text>`);
    }
  }
  const notes = [opts.note];
  if (opts.series.some((s) => s.incompleteTail)) notes.push("Dashed: latest month looks incomplete and is excluded from growth figures.");
  notes.forEach((n, i) => {
    parts.push(`<text class="mut" x="24" y="${plot.y + plot.h + 48 + i * 16}" font-size="11">${esc(n)}</text>`);
  });

  return svgDoc(width, height, opts.title, opts.desc, parts.join("\n"));
}

// ---------- eval charts ----------

interface JudgeScore {
  factualAccuracy: number;
  caveatAppropriateness: number;
  actionability: number;
}
interface Score {
  model: string;
  condition: "skill" | "no-skill";
  judge: JudgeScore | null;
  usedRealData: boolean;
  directionMatch: "match" | "mismatch" | "n/a";
}

function latestJudgedResults(): string {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(RESULTS_DIR, f), "utf-8"));
    if (data.judgeModel) return join(RESULTS_DIR, f);
  }
  throw new Error(`No judged eval results found in ${RESULTS_DIR}. Run npm run eval first.`);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function evalCharts(resultsPath: string): { judgeTable: string; modelTable: string } {
  const data = JSON.parse(readFileSync(resultsPath, "utf-8")) as { scores: Score[]; models: string[]; judgeModel: string };
  const judged = (cond: Score["condition"], model?: string) =>
    data.scores.filter((s) => s.condition === cond && s.judge && (!model || s.model === model)).map((s) => s.judge!);
  const runs = (cond: Score["condition"]) => data.scores.filter((s) => s.condition === cond);

  const dims: Array<[keyof JudgeScore, string]> = [
    ["factualAccuracy", "Factual accuracy"],
    ["caveatAppropriateness", "Caveat appropriateness"],
    ["actionability", "Actionability"],
  ];
  const dimData: GroupedDatum[] = dims.map(([k, label]) => ({
    category: label,
    a: mean(judged("skill").map((j) => j[k])),
    b: mean(judged("no-skill").map((j) => j[k])),
  }));
  const nSkill = runs("skill").length;
  const nNo = runs("no-skill").length;
  const fmt1 = (v: number) => v.toFixed(1);

  writeFileSync(
    join(DOCS_DIR, "eval-judge-scores.svg"),
    groupedBarChart({
      title: "Answers with the skill score far higher",
      subtitle: `LLM-judge scores (1–5), mean over ${data.models.length} models × 6 cases · judge: ${data.judgeModel}`,
      seriesLabels: ["With skill", "Without skill"],
      data: dimData,
      max: 5,
      tickStep: 1,
      format: fmt1,
      desc: dimData.map((d) => `${d.category}: with skill ${fmt1(d.a)}, without ${fmt1(d.b)}`).join("; "),
    }),
  );

  const shortModel = (m: string) => m.split("/")[1] ?? m;
  const modelData: GroupedDatum[] = data.models.map((m) => {
    const avgOf = (js: JudgeScore[]) => mean(js.map((j) => (j.factualAccuracy + j.caveatAppropriateness + j.actionability) / 3));
    return { category: shortModel(m), a: avgOf(judged("skill", m)), b: avgOf(judged("no-skill", m)) };
  });
  writeFileSync(
    join(DOCS_DIR, "eval-by-model.svg"),
    groupedBarChart({
      title: "The gain holds for every cheap model tested",
      subtitle: "Mean of the three judge dimensions (1–5) per model, 6 cases each",
      seriesLabels: ["With skill", "Without skill"],
      data: modelData,
      max: 5,
      tickStep: 1,
      format: fmt1,
      desc: modelData.map((d) => `${d.category}: with skill ${fmt1(d.a)}, without ${fmt1(d.b)}`).join("; "),
    }),
  );

  const pct = (xs: Score[], f: (s: Score) => boolean) => `${Math.round((xs.filter(f).length / xs.length) * 100)}%`;
  // Only runs that stated a direction on a case with ground truth count.
  const directionRate = (xs: Score[]) => {
    const judgedDir = xs.filter((s) => s.directionMatch !== "n/a");
    return `${judgedDir.filter((s) => s.directionMatch === "match").length} of ${judgedDir.length}`;
  };
  const judgeTable = [
    "| Metric | With skill | Without skill |",
    "|---|---|---|",
    ...dimData.map((d) => `| ${d.category} (judge, 1–5) | ${fmt1(d.a)} | ${fmt1(d.b)} |`),
    `| Answer grounded in fetched data | ${pct(runs("skill"), (s) => s.usedRealData)} | ${pct(runs("no-skill"), (s) => s.usedRealData)} |`,
    `| Stated trend direction matches real data | ${directionRate(runs("skill"))} | ${directionRate(runs("no-skill"))} |`,
    `| Runs | ${nSkill} | ${nNo} |`,
  ].join("\n");
  const modelTable = [
    "| Model | With skill | Without skill |",
    "|---|---|---|",
    ...modelData.map((d) => `| ${d.category} | ${fmt1(d.a)} | ${fmt1(d.b)} |`),
  ].join("\n");
  return { judgeTable, modelTable };
}

// ---------- example trend + report ----------

async function exampleTrend(): Promise<string> {
  const topic = "astronomy";
  const langs = ["pl", "uk"];
  const months = 24;
  const resolved = await resolveTopic(topic, langs);
  if (!resolved.resolved) throw new Error(`Could not resolve "${topic}"`);
  const range = lastNMonths(months);
  const entries: ComparisonEntry[] = [];
  for (const lang of langs) {
    const title = resolved.resolved.titles[lang];
    if (!title) throw new Error(`No ${lang} article for "${topic}"`);
    const [series, baseline] = await Promise.all([
      fetchPerArticleMonthly(lang, title, range),
      fetchProjectAggregateMonthly(lang, range),
    ]);
    entries.push({ label: `${topic} / ${lang}`, trend: normalizeAgainstBaseline(series, baseline, months) });
  }

  const langNames: Record<string, string> = { pl: "Polish", uk: "Ukrainian" };
  writeFileSync(
    join(DOCS_DIR, "example-trend.svg"),
    lineChart({
      title: "Example: interest in astronomy, Polish vs Ukrainian Wikipedia",
      subtitle: `Monthly views per million views of the whole edition, last ${months} months`,
      yLabel: "views per million",
      series: entries.map((e, i) => ({
        label: langNames[langs[i]],
        cls: (i + 1) as 1 | 2,
        points: e.trend.sharePpm,
        incompleteTail: e.trend.raw.flags.trailingMonthLikelyIncomplete,
      })),
      note: "Normalized, so an edition's overall traffic growth doesn't pass for interest in the topic.",
      desc: entries
        .map((e) => `${e.label}: YoY ${e.trend.raw.yoyGrowthPct?.toFixed(1) ?? "n/a"}%, flags ${JSON.stringify(e.trend.raw.flags)}`)
        .join("; "),
    }),
  );

  await generateReport(
    { title: "Astronomy: Polish vs Ukrainian Wikipedia", lookbackMonths: months, entries },
    join(DOCS_DIR, "example-report.pdf"),
  );

  return entries
    .map((e) => {
      const t = e.trend.raw;
      const flags = Object.entries(t.flags).filter(([, v]) => v).map(([k]) => k);
      const pct = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
      return `| ${e.label} | ${pct(t.yoyGrowthPct)} | ${pct(t.momGrowthPct)} | ${flags.join(", ") || "none"} |`;
    })
    .join("\n");
}

async function main(): Promise<void> {
  mkdirSync(DOCS_DIR, { recursive: true });
  const resultsPath = process.argv[2] ?? latestJudgedResults();
  const { judgeTable, modelTable } = evalCharts(resultsPath);
  const trendRows = await exampleTrend();
  console.log(`Eval results: ${resultsPath}\n\n${judgeTable}\n\n${modelTable}\n\n| Series | YoY | MoM | Flags |\n|---|---|---|---|\n${trendRows}`);
  console.error(`\nWrote charts and example-report.pdf to ${DOCS_DIR}`);
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
