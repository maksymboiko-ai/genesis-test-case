#!/usr/bin/env node
import { resolveTopic } from "./wikidata.js";
import {
  fetchPerArticleMonthlyCached,
  fetchProjectAggregateMonthlyCached,
  lastNMonths,
} from "./pageviews.js";
import { normalizeAgainstBaseline, type ComparisonEntry } from "./analyze.js";
import { generateReport } from "./report.js";

interface ParsedArgs {
  [key: string]: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function requireArg(args: ParsedArgs, name: string): string {
  const value = args[name];
  if (!value) {
    throw new CliError(`Missing required --${name}`);
  }
  return value;
}

class CliError extends Error {}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const HELP: Record<string, string> = {
  "resolve-topic": `wikipedia-trends resolve-topic --topic "<name>" --langs <lang,lang,...>
  Resolves a topic name to Wikidata candidates and the equivalent article
  title in each requested language edition. If multiple plausible
  candidates exist, they're returned for disambiguation instead of guessed.`,
  analyze: `wikipedia-trends analyze --topic "<name>" --langs <lang,lang,...> [--months 24]
  Fetches pageviews for the topic's article in each language and returns
  structured trend stats + confidence flags as JSON.`,
  compare: `wikipedia-trends compare --topics "<a>,<b>" --langs <lang,lang,...> [--months 24]
  Same as analyze, but for multiple topics across the same language set —
  useful for "which topic/language should we prioritize" questions.`,
  report: `wikipedia-trends report --from <analyze-output.json> --out <report.pdf> [--title "..."]
  Renders a one-page PDF report from a previously produced analyze/compare
  JSON result (read from a file, or pipe JSON via --from -).`,
  "analyze-and-report": `wikipedia-trends analyze-and-report --topic "<name>" --langs <lang,lang,...> --out <report.pdf> [--months 24] [--title "..."]
  One-shot convenience: resolve + analyze + report in a single call, for
  the common unambiguous case.`,
};

async function buildEntriesForTopic(
  topic: string,
  langs: string[],
  months: number,
): Promise<{ entries: ComparisonEntry[]; unresolvedLangs: string[]; ambiguous: boolean }> {
  const resolved = await resolveTopic(topic, langs);
  if (!resolved.resolved) {
    throw new CliError(
      `No Wikidata entity found for topic "${topic}". Try a different phrasing, or use resolve-topic to inspect candidates.`,
    );
  }
  const range = lastNMonths(months);
  const entries: ComparisonEntry[] = [];
  const unresolvedLangs: string[] = [];

  for (const lang of langs) {
    const title = resolved.resolved.titles[lang];
    if (!title) {
      unresolvedLangs.push(lang);
      continue;
    }
    const [topicSeries, baselineSeries] = await Promise.all([
      fetchPerArticleMonthlyCached(lang, title, range),
      fetchProjectAggregateMonthlyCached(lang, range),
    ]);
    entries.push({
      label: `${topic} / ${lang}`,
      trend: normalizeAgainstBaseline(topicSeries, baselineSeries, months),
    });
  }

  return { entries, unresolvedLangs, ambiguous: resolved.ambiguous };
}

async function cmdResolveTopic(args: ParsedArgs): Promise<void> {
  const topic = requireArg(args, "topic");
  const langs = requireArg(args, "langs").split(",").map((s) => s.trim());
  printJson(await resolveTopic(topic, langs));
}

async function cmdAnalyze(args: ParsedArgs): Promise<void> {
  const topic = requireArg(args, "topic");
  const langs = requireArg(args, "langs").split(",").map((s) => s.trim());
  const months = Number(args.months ?? "24");
  const result = await buildEntriesForTopic(topic, langs, months);
  printJson(result);
}

async function cmdCompare(args: ParsedArgs): Promise<void> {
  const topics = requireArg(args, "topics").split(",").map((s) => s.trim());
  const langs = requireArg(args, "langs").split(",").map((s) => s.trim());
  const months = Number(args.months ?? "24");
  const results = await Promise.all(topics.map((topic) => buildEntriesForTopic(topic, langs, months)));
  printJson({
    entries: results.flatMap((r) => r.entries),
    unresolvedLangs: Array.from(new Set(results.flatMap((r) => r.unresolvedLangs))),
    ambiguous: results.some((r) => r.ambiguous),
  });
}

async function readAnalyzeJson(fromArg: string): Promise<{ entries: ComparisonEntry[] }> {
  const raw =
    fromArg === "-"
      ? await new Promise<string>((resolve) => {
          let data = "";
          process.stdin.on("data", (chunk) => (data += chunk));
          process.stdin.on("end", () => resolve(data));
        })
      : await (await import("node:fs/promises")).readFile(fromArg, "utf-8");
  return JSON.parse(raw);
}

async function cmdReport(args: ParsedArgs): Promise<void> {
  const from = requireArg(args, "from");
  const out = requireArg(args, "out");
  const title = args.title ?? "Wikipedia pageview trends";
  const months = Number(args.months ?? "24");
  const data = await readAnalyzeJson(from);
  await generateReport({ title, lookbackMonths: months, entries: data.entries }, out);
  printJson({ ok: true, out });
}

async function cmdAnalyzeAndReport(args: ParsedArgs): Promise<void> {
  const topic = requireArg(args, "topic");
  const langs = requireArg(args, "langs").split(",").map((s) => s.trim());
  const out = requireArg(args, "out");
  const months = Number(args.months ?? "24");
  const title = args.title ?? `${topic}: interest over the last ${months} months`;

  const result = await buildEntriesForTopic(topic, langs, months);
  if (result.entries.length === 0) {
    throw new CliError(
      `No language editions resolved an article for "${topic}" among [${langs.join(", ")}]. Run resolve-topic to investigate.`,
    );
  }
  await generateReport({ title, lookbackMonths: months, entries: result.entries }, out);
  printJson({
    ok: true,
    out,
    unresolvedLangs: result.unresolvedLangs,
    ambiguous: result.ambiguous,
    entries: result.entries.map((e) => ({
      label: e.label,
      flags: e.trend.raw.flags,
      momGrowthPct: e.trend.raw.momGrowthPct,
      yoyGrowthPct: e.trend.raw.yoyGrowthPct,
    })),
  });
}

async function main(argv: string[]): Promise<void> {
  const [subcommand, ...rest] = argv;
  const args = parseArgs(rest);

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log("wikipedia-trends <subcommand> [--flags]\n\nSubcommands:");
    for (const [name, help] of Object.entries(HELP)) {
      console.log(`\n${help}`);
    }
    return;
  }

  if (args.help === "true") {
    const help = HELP[subcommand];
    console.log(help ?? `Unknown subcommand: ${subcommand}`);
    return;
  }

  try {
    switch (subcommand) {
      case "resolve-topic":
        return await cmdResolveTopic(args);
      case "analyze":
        return await cmdAnalyze(args);
      case "compare":
        return await cmdCompare(args);
      case "report":
        return await cmdReport(args);
      case "analyze-and-report":
        return await cmdAnalyzeAndReport(args);
      default:
        console.error(`Unknown subcommand: ${subcommand}. Run with --help for usage.`);
        process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main(process.argv.slice(2));
