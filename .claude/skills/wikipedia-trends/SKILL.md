---
name: wikipedia-trends
description: Analyze Wikipedia pageview trends across topics and language editions to inform B2C product decisions (which topic to build next, which language to localize into). Fetches real pageview data from Wikimedia's public APIs, computes growth trends with confidence/reliability flags, and produces a one-page PDF report. Use for questions about topic interest over time, cross-language comparisons of interest, or whether a growth signal in Wikipedia traffic can be trusted.
compatibility: Requires Node.js 20+, npm, and internet access to the Wikimedia and Wikidata APIs.
---

# Wikipedia pageview trends

A CLI in this skill directory turns a topic + language question into real
Wikimedia pageview data, a trend analysis with explicit confidence flags,
and a one-page PDF report. It has no Claude-specific dependency — it's a
plain Node script you run with `node`.

## Setup (once per session)

Run everything from this skill's directory (the one containing this
SKILL.md):

```
npm install   # first time only; installs pdfkit + tsx/typescript
npm run build # compiles src/ -> dist/
```

After that, every call is `node dist/cli.js <subcommand> --flags`.
Run `node dist/cli.js --help` or `node dist/cli.js <subcommand> --help`
any time you're unsure of the exact flags.

## The five subcommands

- `resolve-topic --topic "<name>" --langs <lang,lang,...>` — maps a topic
  name to a Wikidata entity and the equivalent article title in each
  requested language edition. Returns a candidate list; if more than one
  is plausible, this is where ambiguity shows up.
- `analyze --topic "<name>" --langs <lang,lang,...> [--months 24]` —
  fetches pageviews and returns trend stats + confidence flags as JSON.
- `compare --topics "<a>,<b>" --langs <lang,lang,...> [--months 24]` —
  same, for multiple topics across one language set.
- `report --from <analyze-output.json> --out <report.pdf>` — renders the
  PDF from a JSON result you already have (useful for iterating on the
  same data without re-fetching).
- `analyze-and-report --topic "<name>" --langs <lang,lang,...> --out
  <report.pdf> [--months 24] [--title "..."]` — the one-shot path; use
  this for a first pass at most questions.

All subcommands print JSON to stdout on success and a one-line `Error:
...` to stderr with a non-zero exit code on failure — check the exit
code, don't guess from prose.

## Workflow

1. **Turn the product question into topic + language codes.** Language
   codes are Wikipedia's own (ISO-ish) prefixes: `pl`, `cs`, `uk`, `en`,
   `de`, etc — the part before `.wikipedia.org`. If the user names a
   country or "our markets" instead of language codes, map it yourself
   (e.g. "Ukrainian Wikipedia" → `uk`) rather than asking, unless it's
   genuinely unclear which edition they mean.
2. **Call `analyze-and-report` first** for the common case (one topic,
   one or a few languages, a "how's this doing" or "is X growing"
   question). Only reach for `resolve-topic` up front if the topic name
   is likely ambiguous on its own (a common word, a brand name that's
   also a common noun, etc).
3. **If the result's `ambiguous` field is true or `unresolvedLangs` is
   non-empty**, don't silently pick a candidate or drop a language —
   surface it. If it's genuinely unclear which concept is meant, run
   `resolve-topic` to show the candidates and ask the user to confirm. If one
   candidate is obviously the intended concept (matching label, on-topic
   description), you can proceed without asking, but **your final answer
   must still say, in one sentence, that the topic name was ambiguous and
   which interpretation you used** (e.g. "Note: 'Mercury' could also refer
   to the chemical element or Roman god; this analysis uses the planet.").
   Getting `ambiguous: true` back from the tool and not mentioning it
   anywhere in your answer is always wrong, even when you're confident in
   the interpretation you picked.
4. **Read the `flags` in the result before writing anything about
   trust.** Every entry carries:
   - `shortHistory` — less data than the requested lookback; the article
     or edition may be too young for a "trend" to mean much yet.
   - `lowVolume` — average views are low enough that month-to-month noise
     likely swamps the signal. Treat any growth % here as indicative, not
     conclusive.
   - `hasSpike` — one or more months are statistical outliers. Growth
     driven by a spike (a news event, a viral link) is a different claim
     than sustained rising interest — say which one it looks like.
   - `hasGaps` — some months have zero recorded views; the series may be
     unreliable.
   - `trailingMonthLikelyIncomplete` — the most recent month's number is
     implausibly low relative to the trend and was excluded from the
     growth figures (Wikimedia sometimes hasn't finished processing the
     latest month yet). This is already handled for you — momGrowthPct/
     yoyGrowthPct are computed without that month — but mention it if the
     user asks about the very latest month specifically.
   **Your written conclusion should name the flags that apply**, in plain
   language, not just repeat the percentage. "Growing, but low-volume and
   partly driven by one spike month" is a materially different claim than
   "growing 40% YoY" with no caveats, even if the number is the same.
5. **Use the normalized (share-of-edition-traffic) numbers, not just raw
   views, when comparing across languages or making a "is this really
   growing" judgment.** A raw increase can just mean that language
   edition's overall traffic grew. The report's second chart and the
   `trend.normalized` stats in the JSON already control for this — lead
   with normalized growth when the two disagree.
6. **For follow-ups and refinements** ("now also check Czech", "extend
   to 3 years", "what about a related topic"), just make the new CLI
   call with the adjusted flags — repeated (topic, lang, month-count)
   combinations are cached on disk for 24h, so re-running the same or an
   overlapping query is fast and doesn't re-hit Wikimedia. You don't need
   to re-explain earlier findings from scratch; build on the prior JSON
   output if you still have it (or re-run `analyze`/`compare`, which will
   mostly hit cache).
7. **Ground every claim in the tool's numbers.** Don't estimate,
   extrapolate, or state a trend/percentage the CLI didn't return. If the
   CLI returns no data for a topic/language, say so plainly rather than
   filling the gap with general knowledge.

## Worked examples

**"Compare growth of intermittent fasting interest in Polish and Czech
Wikipedia over the last two years."**
```
node dist/cli.js analyze-and-report \
  --topic "intermittent fasting" --langs pl,cs --months 24 \
  --out fasting-pl-cs.pdf
```
Read `flags` for each entry, note if one edition is much lower-volume
than the other (comparing a noisy small-edition number to a stable
large-edition one needs a caveat), and lead with the normalized
(share-of-traffic) comparison since PL and CS Wikipedia have very
different overall sizes.

**"We're thinking about adding an astronomy course — is interest growing
in Ukrainian Wikipedia, and how much can we trust that?"**
```
node dist/cli.js analyze-and-report \
  --topic "astronomy" --langs uk --months 24 \
  --out astronomy-uk.pdf
```
This is explicitly a trust question — the answer must foreground the
confidence flags (volume, spikes, data completeness), not just the
growth number.

**"Compare interest in learning English across several language
editions and tell us which audiences to investigate next."**
```
node dist/cli.js analyze-and-report \
  --topic "English language" --langs pl,cs,uk,de,es \
  --months 24 --out english-learning.pdf
```
Rank editions by normalized growth (not raw views, which will just favor
the largest editions), flag any that are low-volume or spike-driven as
lower-priority/needs-more-data rather than dropping them, and name the
top 2-3 as "investigate next" with the specific reason (highest
normalized growth, most stable trend, etc).
