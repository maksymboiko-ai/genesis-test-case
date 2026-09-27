# Future work

Where this skill stands after M0-M8, and how to extend it further.

## What's built

A working CLI (`resolve-topic`, `analyze`, `compare`, `report`,
`analyze-and-report`) backed by real Wikimedia data, a trend-analysis engine
with five confidence flags (short history, low volume, spikes, data gaps,
likely-incomplete trailing month), one-page PDF reports, a `SKILL.md`/
`AGENTS.md` pair so it works in Claude Code and other shell-capable agents,
and a tiered OpenRouter-based eval harness:

- **Tier 1 (deterministic):** ground truth computed by calling this
  project's own `wikidata`/`pageviews`/`analyze` modules directly (not the
  CLI subprocess, not sharing the CLI's cache) -- an independent reference,
  not just "did the tool get called." Scores directional correctness
  (growing/declining/flat) against it.
- **Tier 2 (rubric, no AI):** ambiguity-disclosure (does the *final answer*
  tell the user the topic was ambiguous, not just whether the tool signaled
  it) and flags-surfaced checks.
- **Tier 3 (LLM-judge):** `anthropic/claude-sonnet-5` via OpenRouter, fixed
  and separate from the tested-model pool, scoring factual accuracy / caveat
  appropriateness / actionability from just the final answer + ground truth
  (not the full transcript, so it can't be swayed by *how* the work was
  done).

Latest full run: 6 cases x 3 models (`openai/gpt-4o-mini`,
`google/gemini-3.8-flash`, `anthropic/claude-haiku-4.5` -- the last being the
model the task brief explicitly names) x skill/no-skill, 36 runs, 0%
errored. Judge averages: factualAccuracy 4.5 vs 1.3, caveatAppropriateness
4.4 vs 2.0, actionability 3.2 vs 1.7 (skill vs no-skill); stated trend
direction matched real data in 15 of 15 skill runs vs 0 of 14 without. See
`eval/results/2026-09-27T10-16-46-034Z` (the first run after the end-of-month
request fix; the earlier 2026-09-23 runs used month-shifted data).

## What the eval run surfaced (already fixed, see git log)

- An OpenRouter model id going stale (`google/gemini-2.0-flash-001` no
  longer resolves) -> swapped to a current one, and it's worth periodically
  re-checking `EVAL_MODELS`/`JUDGE_MODEL` against `GET /api/v1/models`
  rather than assuming a hardcoded id stays valid.
- The CLI crashing with a raw Node stack trace on an unhandled `HttpError`
  instead of a clean one-line error -> now caught generically.
- The harness's agent loop returning raw tool JSON as the "final answer"
  when it hit the turn cap mid-investigation -> now forces one more
  tools-disabled call to synthesize an actual answer.
- A test case (`low-traffic-language`) that accidentally exercised "no
  article exists at all" instead of the intended "low-volume but present"
  scenario -> swapped topic.
- Two data-correctness bugs in how we requested data, both found only
  against live data: the window included the current, still-running month
  (fixed by ending at the last complete month), and every request ended on
  the 1st of its final month, which made Wikimedia count just one day for
  that month (11 views instead of 360 for astronomy/uk in August 2026). The
  second one was first misdiagnosed as "Wikimedia hasn't processed the month
  yet" and patched with the `trailingMonthLikelyIncomplete` flag, which hid
  it and shifted every YoY/MoM figure back a month. The real fix ends
  requests on the month's last day, with a regression test. The flag stays
  as a safeguard for the genuine lag in the first days of a month. Lesson:
  when a fix is a heuristic that hides a symptom, check the request first.
- A direction-matching heuristic that misread "growth ... decrease" as
  "growing" because it tested for the bare noun "growth" -> now excludes it,
  requires an actual directional verb/adjective.
- A real skill gap, not a harness bug: `gpt-4o-mini` saw `"ambiguous": true`
  from the tool and never mentioned it to the user, silently proceeding as
  if "Mercury" had one obvious meaning. `SKILL.md` now requires a one-
  sentence disclosure even when confidently picking a candidate. Verified
  fixed in an isolated run, though a later full-matrix run showed the same
  model miss it again on one run -- see below, this isn't fully solved.

## Known limitations worth iterating on next

1. **Instruction compliance isn't 100%, even after strengthening the
   instruction.** The ambiguity-disclosure fix worked in an isolated
   verification run but the same model (`gpt-4o-mini`) missed it again in
   the full-matrix run -- normal model-to-model-call variance, but it means
   a single "it passed" run isn't proof the fix is robust. Worth either
   running each case N times and reporting a pass rate instead of a single
   pass/fail, or making the instruction even more forceful (e.g. a
   structural nudge like putting the disclosure requirement in the tool's
   own JSON output as a literal string field the model has to relay, not
   just prose in SKILL.md it has to remember).
2. **Judge calls can silently fail.** `judge.ts` swallows its own errors
   (returns `null` rather than crashing the run) -- correct so one bad judge
   call doesn't lose an otherwise-good run's data, but it means aggregate
   judge averages are computed over however many succeeded, not the full
   set, and that denominator isn't currently reported. Worth surfacing
   "N/total judged" alongside the averages.
3. **The eval sandbox is a denylist, not real isolation.** `eval/tools.ts`
   blocks a few destructive patterns but runs real shell commands with no
   container/VM boundary. Fine for a small, known set of test cases running
   under supervision; not fine to leave unattended or to scale up without
   adding real sandboxing (Docker, a VM, or a locked-down service account)
   first.
4. **Tool-call efficiency varies a lot by model.** `gemini-3.8-flash` used
   12 tool calls / ~78K tokens on `follow-up-refinement` where
   `claude-haiku-4.5` used 2 calls / ~14K tokens for the same case. Worth
   tightening `SKILL.md`'s "you already have this data, don't re-fetch"
   guidance further, and/or lowering the eval's `maxTurns` so inefficiency
   shows up as a harder failure rather than just extra cost.
5. **Monthly granularity only, single-source (Wikidata sitelinks) topic
   resolution.** Daily granularity is mostly a matter of passing `daily`
   through `pageviews.ts`'s existing REST call shape and adjusting the
   confidence-flag thresholds (different spike/gap heuristics than
   monthly). Larger topic/language matrices work today via `compare` but
   haven't been load-tested -- watch for Wikidata/Wikimedia rate limits at
   scale.
6. **Direction-match is still a coarse heuristic on the model's prose,** even
   with the bare-noun-"growth" bug fixed -- it can't parse every phrasing,
   and several skill-condition runs came back `n/a` (no clearly-stated
   direction matched the regex) despite the judge scoring factualAccuracy 5.
   The judge tier is the more reliable signal for those; tier 1's value is
   mainly as a fast, free, always-available cross-check.
7. **Dashboards / longer-running research.** For a "watch this over time"
   use case rather than one-shot reports, the disk cache and CLI are
   already the right building blocks -- a thin wrapper that re-runs
   `analyze-and-report` on a schedule and diffs against the prior JSON
   result would get most of the way there without new architecture.

## How to grow the skill past basic queries

The skill answers basic queries today: one or a few named topics, a
handful of languages, 24 months, monthly granularity. Growing it toward
harder research questions and bigger data should go in small steps,
using the same loop that got it this far (M6-M8).

### The iteration loop

1. **Write the harder question down as an eval case first.** Add a JSON
   case under `eval/cases/` for the new kind of query (for example "which
   of these 15 hobbies grew fastest across 8 Central European languages")
   and extend `eval/groundtruth.ts` so it can compute the reference answer
   without the CLI.
2. **Run it with and without the skill, on several models.** Where it
   fails, find out whether the tool lacks something (missing subcommand,
   wrong math, rate limit) or the model misused it (didn't pass on a flag,
   fetched the same data twice). Tool gaps get fixed in `src/`. Usage gaps
   get fixed in `SKILL.md`, or better, in fields of the tool's JSON output
   that the model has to pass on (see limitation 1).
3. **Keep the case as a regression test,** and run each case several
   times so the result is a pass rate, not one pass/fail. A new capability
   is done when its case passes reliably and the older cases still pass.
4. **Check against live data before trusting a fix.** Both real data bugs
   so far only showed up against real Wikimedia responses, not fixtures.

Each stage below is one or more runs of this loop.

### Stage 1: more data per question

Needed before anything else, because more complex research means more
requests.

- **Bounded concurrency.** `compare` starts every topic at once
  (`Promise.all` in `cli.ts`) and fetches the languages of each topic one
  after another. That is fine for 2-3 topics. For a 20x10 matrix it should
  go through a small worker pool with a limit you can set, so throughput
  stays predictable and `http.ts`'s 429 retries are the rare case, not the
  normal one.
- **Load-test `compare`** on a realistic matrix and record the time, the
  request count and the number of 429s, so later changes can be measured.
- **A lasting cache for finished months.** Pageviews for a closed month
  don't change after Wikimedia has processed them, so they don't need the
  24h TTL. Only the most recent month does. Keeping closed months
  indefinitely (the same disk files, or SQLite once it grows) makes
  follow-up and repeat research almost free.
- **Keep the output small for the model.** A big matrix shouldn't dump
  every monthly point into the model's context. Return a ranked summary
  (top movers and flagged entries) by default and put the full data in a
  file the model can open if it needs it.

### Stage 2: better signal per topic

The kind of question stays the same, but the answer is closer to how much
interest the topic really gets.

- **Redirects and related articles.** Per-article counts cover only the
  exact title, so views that arrive through redirects or sit on closely
  related articles (sub-topics, a local-language synonym) are missed.
  Adding them into one "topic" series needs a link or redirect lookup and
  a rule for what belongs to the topic. That rule should appear in the
  output so the user can check it.
- **Daily granularity** for event-driven questions (limitation 5). Spike
  and gap flags need their own thresholds at daily resolution.
- **Seasonality and significance.** Report year-over-year change next to
  a simple seasonal baseline, and mark a growth figure as not significant
  when it is within normal noise, not only when the volume is low.
- **Mobile vs desktop split** (`access` in the REST path, currently
  `all-access`) where the product decision depends on it.

### Stage 3: open-ended research

The user asks "what should we build next" instead of naming the topics.

- **Topic discovery.** Build candidate lists from the Wikimedia
  top-articles endpoint per language, or from a Wikidata SPARQL query (all
  items of a class or category), then run them through the Stage 1
  pipeline.
- **Multi-step workflows in `SKILL.md`:** narrow the candidates, compare
  them, look closer at the leaders, write the report. Each step should use
  cached data from the step before. Eval cases for this should score the
  final recommendation and how efficiently the tools were used
  (limitation 4).
- **Multi-page or multi-section reports** for comparisons across many
  topics, keeping the one-page summary on top.

### Stage 4: data volumes the REST API can't handle

Past a few thousand articles per question, calling the API article by
article is the wrong tool. Wikimedia publishes bulk pageview dumps
(hourly/daily files covering all articles on every project). A batch job
that loads the relevant months into a local columnar store (DuckDB or
Parquet) and has the CLI read from it lets the skill answer questions over
whole categories or languages without API limits. This is a separate
ingestion component with its own storage and freshness concerns, so it
should wait until an eval case shows the REST path can't do the job.

Everything above keeps the current contract: the CLI returns structured
JSON with confidence flags, and the model has to reflect those flags in its
answer. New capabilities need new flags where their failure modes are
different (for example "topic series includes N redirects", "significance
not established").
