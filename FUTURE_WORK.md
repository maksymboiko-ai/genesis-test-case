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
errored. Judge averages: factualAccuracy 4.6 vs 1.3, caveatAppropriateness
4.2 vs 1.8, actionability 3.3 vs 1.9 (skill vs no-skill). See
`eval/results/2026-09-23T08-00-55-397Z`.

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
- Two genuine data-correctness bugs in the analysis itself (current-month
  and even last-calendar-month pageview data can be partial/unprocessed at
  Wikimedia) -> `trailingMonthLikelyIncomplete` flag, excluded from growth
  math. Only findable by testing against live data, not synthetic fixtures.
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
