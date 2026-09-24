# Wikipedia Trends skill

An Agent Skill that helps B2C product teams decide **which topic to build next
and which language to launch in**, using real Wikipedia pageview data. Ask a
question in plain language; the agent fetches data from Wikimedia, analyzes the
trend, tells you how far to trust it, and can produce a one-page PDF report you
can share.

> Pageviews measure interest in an article, not willingness to pay. Treat the
> output as a signal for what to validate next, not a decision by itself.

## What you can ask

- "Compare growth of interest in intermittent fasting in Polish and Czech
  Wikipedia over the last two years."
- "We're thinking about adding an astronomy course. Is interest growing in
  Ukrainian Wikipedia, and how much can we trust that?"
- "Compare interest in learning English across Polish, Czech, Ukrainian, German
  and Spanish Wikipedia and tell us which audiences to investigate next."
- Follow-ups work too: "now add Polish and extend to 3 years" reuses cached data.

## Requirements

- Node.js 20 or newer
- Internet access (Wikimedia and Wikidata public APIs, no API keys needed)

## Setup

```bash
cd .claude/skills/wikipedia-trends
npm install
npm run build
```

## Using it with an agent

The skill lives in `.claude/skills/wikipedia-trends/`. It is a plain CLI plus a
`SKILL.md` that teaches the agent the workflow, so any agent that can run shell
commands can use it.

- **Claude Code / Claude Desktop:** open this repo; the skill is picked up
  automatically from `.claude/skills/`. Just ask your question.
- **Cursor, Codex, and other agents:** the root `AGENTS.md` points them at
  `SKILL.md`. Run the setup above once, then ask your question.
- **Another project:** copy the `.claude/skills/wikipedia-trends/` folder into
  that project's `.claude/skills/` and run the setup there.

Tips for good answers:

- Name the topic and the language editions, for example "in Polish and Czech
  Wikipedia". Language codes are Wikipedia's own prefixes (`pl`, `cs`, `uk`,
  `de`, `es`, ...).
- Ask about trust explicitly ("how much can we trust this?"); the agent will
  foreground the confidence flags below.
- If a topic name is ambiguous (for example "Mercury"), the agent should tell
  you which meaning it used. If it does not, say so and ask it to re-check.

## Using the CLI directly

```bash
cd .claude/skills/wikipedia-trends

# One shot: resolve, analyze, and write a one-page PDF
node dist/cli.js analyze-and-report \
  --topic "astronomy" --langs uk,pl --months 24 --out astronomy.pdf

# Other subcommands (each supports --help)
node dist/cli.js resolve-topic --topic "Mercury" --langs de
node dist/cli.js analyze        --topic "astronomy" --langs uk --months 24
node dist/cli.js compare        --topics "astronomy,chess" --langs uk,pl
node dist/cli.js report         --from analysis.json --out report.pdf
```

All commands print JSON to stdout; failures print one `Error: ...` line to
stderr with a non-zero exit code. Results are cached on disk for 24 hours, so
repeated or overlapping queries are fast.

## Reading the results

Every series carries confidence flags. The report's "Assumptions & limitations"
section is generated from them.

| Flag | Meaning |
|---|---|
| `shortHistory` | Less data than the window you asked for; too young to call a trend. |
| `lowVolume` | Very low traffic; month-to-month noise likely dominates. |
| `hasSpike` | An outlier month, often a news event rather than sustained interest. |
| `hasGaps` | Months with zero recorded views. |
| `trailingMonthLikelyIncomplete` | The latest month looks unprocessed by Wikimedia; it is excluded from growth figures. |

Growth is reported raw and also normalized as a share of the whole language
edition's traffic, so a growing edition does not masquerade as growing interest
in your topic. Prefer the normalized numbers when comparing languages.

## Development

```bash
cd .claude/skills/wikipedia-trends
npm test          # unit tests, no network needed
npm run build     # compile src/ to dist/
```

### Evaluation benchmark

`eval/` measures how well cheap models use the skill, comparing runs with and
without it. It needs an OpenRouter key:

```bash
cd .claude/skills/wikipedia-trends
echo "OPENROUTER_API_KEY=sk-or-..." > .env     # git-ignored
npm run eval                                    # full matrix
npx tsx eval/run.ts astronomy-trust             # a single case
```

Environment variables: `EVAL_MODELS` (comma-separated OpenRouter model ids),
`JUDGE_MODEL`, and `EVAL_SKIP_JUDGE=true` to skip the LLM judge.

Scoring has three tiers: deterministic checks against ground truth computed
independently from live data, rubric checks (ambiguity disclosure, flags
surfaced), and an LLM judge scoring factual accuracy, caveat appropriateness and
actionability. Results are written to `eval/results/`.

Warning: the eval lets a remote model run shell commands through a bash tool
guarded only by a denylist, with no container isolation. Run it supervised, on a
machine you are comfortable with.

## More documentation

- `ARCHITECTURE.md`: design decisions
- `MILESTONES.md`: build plan and status
- `FUTURE_WORK.md`: known limitations and how to extend the skill
- `.claude/skills/wikipedia-trends/SKILL.md`: the agent-facing workflow
