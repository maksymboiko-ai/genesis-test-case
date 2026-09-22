# Milestones — Wikipedia Trends Skill

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done.
Each milestone must leave the repo in a building, committed state before
moving to the next. Commit at each milestone boundary.

## M0 — Repo scaffold
- [x] `.gitignore` (node_modules, dist, cache/*.json, eval/results/*)
- [x] `package.json`, `tsconfig.json` under `.claude/skills/wikipedia-trends/`
- [x] `npm run build` and `npm test` wired (even with 0 tests) and green
- [x] `AGENTS.md` at repo root pointing to the skill
- [x] `SKILL.md` skeleton (frontmatter only, body TODO)

## M1 — Wikimedia data layer
- [x] `src/wikidata.ts`: resolve topic → candidate entities → per-language
      article titles via sitelinks; returns disambiguation list when >1
      plausible candidate
- [x] `src/pageviews.ts`: fetch per-article monthly pageviews (Wikimedia REST),
      with proper `User-Agent`, retry/backoff, date-range handling
- [x] `src/pageviews.ts`: fetch project-wide aggregate pageviews (for
      normalization baseline)
- [x] `src/cache.ts`: disk cache keyed by request signature + TTL
- [x] Unit tests with mocked HTTP for all of the above (no live network in CI)

## M2 — Analysis engine
- [ ] `src/analyze.ts`: MoM/YoY growth, linear regression slope + R²
- [ ] confidence flags: short-history, low-volume, spike (z-score), data gaps
- [ ] normalization vs project-wide baseline
- [ ] multi-series comparison (cross-language and/or cross-topic)
- [ ] unit tests with synthetic series covering each flag condition

## M3 — Reporting
- [ ] `src/chart.ts`: vector line-chart primitives drawn via pdfkit (no
      native deps)
- [ ] `src/report.ts`: one-page PDF — headline numbers, chart(s), a visible
      "assumptions & limitations" section sourced from the confidence flags
- [ ] Golden-file/smoke test: report generation doesn't throw and produces a
      valid, non-trivial PDF for a fixture dataset

## M4 — CLI + agent-facing contract
- [ ] `src/cli.ts` subcommands: `resolve-topic`, `analyze`, `compare`,
      `report`, `analyze-and-report`
- [ ] JSON in/out, `--help` on every subcommand, actionable validation errors
- [ ] Ambiguous topic resolution surfaces choices instead of guessing
- [ ] End-to-end smoke test against live Wikimedia API for one real query
      (astronomy / ukwiki) — run manually/CI-optional, not part of unit suite

## M5 — SKILL.md authoring
- [ ] Frontmatter `name`/`description` tuned to trigger on: topic-interest
      research, language/locale rollout decisions, Wikipedia pageview trends
- [ ] Body: step-by-step workflow, how to turn a vague ask into CLI calls,
      how to fold confidence flags into the written conclusion, how to handle
      follow-ups cheaply (reuse cache/prior JSON instead of re-fetching)
- [ ] Worked example for each of the task's 3 sample prompts
- [ ] `AGENTS.md` body finalized to match

## M6 — Eval harness (OpenRouter, skill vs no-skill)
- [ ] `eval/cases/*.json`: test cases (the 3 sample prompts + ambiguous-topic
      + low-traffic-language + follow-up-refinement cases)
- [ ] `eval/run.ts`: drives a cheap tool-calling model via OpenRouter with a
      shell/bash tool, twice per case (skill present / absent)
- [ ] `eval/score.ts`: grounded-data check (no hallucinated numbers), caveat
      presence, tool-call/token efficiency, directional correctness vs
      independently computed ground truth
- [ ] Run end-to-end on 2-3 cheap/free OpenRouter models; write results table
      to `eval/results/`

## M7 — Iterate to a pass bar
- [ ] Read eval failures, patch `SKILL.md` wording and/or CLI ergonomics
- [ ] Re-run eval, confirm improvement, repeat until skill-vs-no-skill gap is
      clear and cheap models pass reliably
- [ ] `FUTURE_WORK.md`: how to extend to daily granularity, larger topic/lang
      matrices, dashboards, more eval models/cases
