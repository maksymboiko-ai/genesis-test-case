# Future work

Where this skill stands after M0-M7, and how to extend it further.

## What's built

A working CLI (`resolve-topic`, `analyze`, `compare`, `report`,
`analyze-and-report`) backed by real Wikimedia data, a trend-analysis engine
with four confidence flags (short history, low volume, spikes, likely-
incomplete trailing month), one-page PDF reports, a `SKILL.md`/`AGENTS.md`
pair so it works in Claude Code and other shell-capable agents, and an
OpenRouter-based eval harness that ran a real 6-case x 2-model x
skill/no-skill matrix (`eval/results/`). Headline result: skill-condition
runs grounded their answer in real fetched data in the large majority of
cases, vs. by-construction 0% for no-skill.

## What the eval run surfaced (already fixed, see git log)

- An OpenRouter model id going stale (`google/gemini-2.0-flash-001` no
  longer resolves) -> swapped to a current one, and it's worth periodically
  re-checking `EVAL_MODELS` against `GET /api/v1/models` rather than
  assuming a hardcoded id stays valid.
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
  math. These were only findable by testing against live data, not unit
  tests with synthetic fixtures -- worth remembering when extending the
  analysis further: re-run the live smoke test after any change to
  `analyze.ts` or `pageviews.ts`.

## Known limitations worth iterating on next

1. **Eval scorer is a heuristic, not a judge.** `score.ts` uses regex
   matching for "mentions caveats" and "used real data." It has false
   negatives (a hedged answer phrased unusually can slip past the regex)
   and no directional-correctness check against an independently computed
   ground truth (M6 deferred this). Next step: either widen the regex
   further and accept it stays approximate, or add an LLM-as-judge scoring
   pass (a second, cheap model call that reads the transcript + the
   ground-truth `analyze` JSON and scores groundedness/caveat-appropriateness
   on a rubric) -- more reliable, more expensive per eval run.
2. **The eval sandbox is a denylist, not real isolation.** `eval/tools.ts`
   blocks a few destructive patterns but runs real shell commands with no
   container/VM boundary. Fine for a small, known set of test cases running
   under supervision; not fine to leave unattended or to scale up without
   adding real sandboxing (Docker, a VM, or a locked-down service account)
   first.
3. **Tool-call efficiency varies a lot by model.** In the eval run, the
   weaker/cheaper model sometimes re-ran `analyze` after already having the
   data, or went several turns past having enough information before
   answering (see `follow-up-refinement` / gemini: 16 tool calls, ~97K
   tokens for a case gpt-4o-mini did in 2 calls, ~9.5K tokens). Worth
   tightening `SKILL.md`'s guidance on "you already have this data, don't
   re-fetch" for follow-up turns specifically, and/or lowering the eval's
   `maxTurns` to make inefficiency show up as a harder failure rather than
   just extra cost.
4. **Monthly granularity only, single-source (Wikidata sitelinks) topic
   resolution.** Extending to daily granularity is mostly a matter of
   passing `daily` through `pageviews.ts`'s existing REST call shape and
   adjusting the confidence-flag thresholds (a daily series needs different
   spike/gap heuristics than monthly). Larger topic/language matrices
   (dozens of languages, several topics at once) work today via `compare`
   but haven't been load-tested -- watch for Wikidata/Wikimedia rate limits
   at that scale (the retry/backoff in `http.ts` helps but isn't unlimited).
5. **No directional ground truth in the eval.** Right now nothing checks
   that a model's stated growth direction actually matches what `analyze`
   returned -- only that it used the tool and mentioned some numbers. Add a
   ground-truth step: run `analyze` yourself for each case before the eval,
   store the real momGrowthPct/yoyGrowthPct, and check the model's stated
   direction (growing/declining/flat) against it.
6. **Dashboards / longer-running research.** For a "watch this over time"
   use case rather than one-shot reports, the disk cache and CLI are
   already the right building blocks -- a thin wrapper that re-runs
   `analyze-and-report` on a schedule and diffs against the prior JSON
   result would get most of the way there without new architecture.
