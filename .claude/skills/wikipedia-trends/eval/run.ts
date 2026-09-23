import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "./env.js";
import { runAgentLoop, type ChatMessage } from "./openrouter.js";
import { bashTool, makeBashExecutor } from "./tools.js";
import { scoreRun, renderMarkdownTable, type RunOutcome, type ScoreResult } from "./score.js";

loadEnvFile();

const SKILL_DIR = join(import.meta.dirname, "..");
const CASES_DIR = join(import.meta.dirname, "cases");
const RESULTS_DIR = join(import.meta.dirname, "results");

interface Case {
  id: string;
  category: string;
  turns: string[];
  notes: string;
}

function loadCases(): Case[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf-8")) as Case);
}

const SKILL_MD = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");

const SKILL_SYSTEM_PROMPT = `You are an AI agent helping a B2C product team make decisions using Wikipedia pageview data. You have a "bash" tool whose working directory is already the wikipedia-trends skill directory (do NOT "cd .claude/skills/wikipedia-trends" -- you're already there; just run npm/node commands directly). Follow this SKILL.md exactly:\n\n${SKILL_MD}`;

const NO_SKILL_SYSTEM_PROMPT =
  "You are a helpful assistant for a B2C product team. Answer their question as best you can using your own knowledge. You have no tools and no access to live data.";

async function runCase(
  apiKey: string,
  model: string,
  testCase: Case,
  condition: "skill" | "no-skill",
): Promise<RunOutcome> {
  const runCwd = SKILL_DIR;
  let transcript: ChatMessage[] = [
    { role: "system", content: condition === "skill" ? SKILL_SYSTEM_PROMPT : NO_SKILL_SYSTEM_PROMPT },
  ];

  let toolCallCount = 0;
  let totalTokens = 0;
  let finalText = "";

  try {
    for (const turn of testCase.turns) {
      transcript.push({ role: "user", content: turn });
      const result = await runAgentLoop(
        apiKey,
        model,
        transcript,
        condition === "skill" ? [bashTool] : undefined,
        condition === "skill" ? (_name, args) => makeBashExecutor(runCwd)(String(args.command ?? "")) : async () => "",
      );
      transcript = result.transcript;
      toolCallCount += result.toolCallCount;
      totalTokens += result.totalTokens;
      finalText = result.finalText;
    }
    return { caseId: testCase.id, model, condition, transcript, toolCallCount, totalTokens, finalText, errored: false };
  } catch (err) {
    return {
      caseId: testCase.id,
      model,
      condition,
      transcript,
      toolCallCount,
      totalTokens,
      finalText,
      errored: true,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not set (checked .env and process.env). Aborting.");
    process.exitCode = 1;
    return;
  }

  const models = (process.env.EVAL_MODELS ?? "openai/gpt-4o-mini,google/gemini-3.8-flash")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cases = loadCases();
  const onlyCase = process.argv[2]; // optional: run a single case id for quick iteration

  mkdirSync(RESULTS_DIR, { recursive: true });

  const scores: ScoreResult[] = [];
  const rawRuns: RunOutcome[] = [];

  for (const model of models) {
    for (const testCase of cases) {
      if (onlyCase && testCase.id !== onlyCase) continue;
      for (const condition of ["skill", "no-skill"] as const) {
        console.error(`Running ${testCase.id} / ${model} / ${condition}...`);
        const outcome = await runCase(apiKey, model, testCase, condition);
        if (outcome.errored) {
          console.error(`  -> errored: ${outcome.errorMessage}`);
        }
        rawRuns.push(outcome);
        scores.push(scoreRun(outcome));
      }
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(RESULTS_DIR, `${timestamp}.json`);
  const mdPath = join(RESULTS_DIR, `${timestamp}.md`);

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: timestamp,
        models,
        scores,
        runs: rawRuns.map((r) => ({ ...r, transcript: r.transcript.map((m) => ({ role: m.role, content: m.content })) })),
      },
      null,
      2,
    ),
  );

  const summary = [
    `# Eval results — ${timestamp}`,
    "",
    `Models: ${models.join(", ")}`,
    "",
    renderMarkdownTable(scores),
    "",
    "## Skill vs no-skill, aggregated",
    "",
    ...(["skill", "no-skill"] as const).map((cond) => {
      const subset = scores.filter((s) => s.condition === cond);
      const pct = (fn: (s: ScoreResult) => boolean) =>
        subset.length ? Math.round((subset.filter(fn).length / subset.length) * 100) : 0;
      return `- **${cond}**: ${subset.length} runs · used real data: ${pct((s) => s.usedRealData)}% · mentions caveats: ${pct((s) => s.mentionsCaveats)}% · errored: ${pct((s) => s.errored)}%`;
    }),
  ].join("\n");
  writeFileSync(mdPath, summary);

  console.log(summary);
  console.error(`\nWrote ${jsonPath} and ${mdPath}`);
}

main();
