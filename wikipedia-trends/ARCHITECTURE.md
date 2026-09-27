# Architecture — Wikipedia Trends Skill

## Goal
An Agent Skill that lets a B2C product team ask things like "is interest in
astronomy growing in Ukrainian Wikipedia, and can we trust that growth?" and
get back a grounded, one-page PDF report backed by real Wikimedia pageview
data — usable well by a cheap/fast tool-calling model (Haiku 4.5-class), and
portable beyond Claude Code.

## Placement & portability
Single self-contained directory, `wikipedia-trends/`, laid out per the
[Agent Skills specification](https://agentskills.io/specification). The folder
is the deliverable: it is installed by copying it into an agent's skills
directory (`~/.claude/skills/`, `~/.agents/skills/`, or the project-level
equivalents).
- `SKILL.md` — spec frontmatter + instructions, discovered by any Agent
  Skills client (Claude Code, Codex, Cursor, Gemini CLI, Copilot, ...).
- Everything the skill needs to *do real work* is a plain Node/TypeScript CLI
  inside that same directory (`src/cli.ts` → built to `dist/cli.js`), invoked
  via ordinary shell commands (`node dist/cli.js <subcommand> ...`). It has no
  dependency on any Claude-specific tool — any agent that can run shell
  commands can drive it.
- `AGENTS.md` inside the skill gives the same CLI invocation instructions in
  tool-agnostic form, for agents started inside the folder that read
  `AGENTS.md` rather than discovering skills.

## Why this stack
- **TypeScript/Node** — required by the task, ubiquitous runtime, no build
  toolchain surprises.
- **No native deps.** All chart rendering is pure-JS vector drawing inside
  `pdfkit` (line/bar primitives drawn directly onto the PDF canvas). No
  headless Chromium, no `node-canvas`, no native compilation — `npm ci` behaves
  identically on any machine, which matters because the eval harness will
  install and run this repeatedly across many models/sandboxes.
- **Wikimedia public REST APIs only** — no API keys, nothing to leak, nothing
  to configure:
  - Wikidata `wbsearchentities` + entity sitelinks → resolve a topic/name to
    the equivalent article title in each requested language edition (handles
    "astronomy" → "Астрономія" in ukwiki).
  - Wikimedia REST `pageviews/per-article` → monthly (or daily) pageview
    series per article/project.
  - Wikimedia REST `pageviews/aggregate` → total pageviews for a whole
    project/edition in the same period, used to normalize a topic's raw
    growth against that edition's overall traffic growth (an edition getting
    more popular overall would otherwise look like "interest is growing" for
    every topic in it).
- **Disk cache** (`cache/`, gitignored) keyed by request params + TTL, so a
  follow-up/refinement question ("now also compare Czech") or a repeated
  query doesn't re-hit the network or cost extra model turns re-deriving data
  it already has.

## Analysis contract
Every `analyze`/`compare` call returns structured JSON with:
- raw monthly series per (topic, language) pair
- MoM and YoY growth, linear-regression slope + R²
- **confidence flags**: short history (article younger than lookback window),
  low absolute volume (edition too small for the series to be meaningful),
  spike detection (z-score outliers — a news event, not sustained interest),
  data gaps/zero-view months
- normalized-vs-edition-baseline growth, alongside raw growth

The report generator (and SKILL.md instructions) treat these flags as
mandatory inputs to the written conclusion — the skill's job is to make sure
a cheap model *states* the caveats rather than inventing confidence it
doesn't have.

## CLI surface (agent-facing contract)
Few subcommands, JSON in/out, defaults that make the common case a single
call, explicit disambiguation instead of silent guessing:
- `resolve-topic --topic "<name>" --langs pl,cs` → candidate Wikidata
  entities + per-language article titles (or a disambiguation list if
  ambiguous)
- `analyze --topic "<name>" --langs pl,cs --months 24` → structured stats +
  confidence flags (JSON to stdout)
- `compare --topics "<a>,<b>" --langs ... ` → same, multi-series
- `report --from <analyze-output.json> --out report.pdf` → the one-pager
- `analyze-and-report` → the one-shot convenience path for the common case

## Eval / benchmark harness
Lives in `eval/` inside the skill dir:
- Test cases derived from the task's three example prompts plus edge cases
  (ambiguous topic, low-traffic language, follow-up refinement).
- A runner drives a tool-calling model via OpenRouter twice per case — once
  with the skill available (shell access to the CLI), once without (same
  model, no skill, general knowledge only) — and scores: did it fetch real
  data vs hallucinate numbers, did it state caveats, tool-call/token
  efficiency, directional correctness vs an independently computed ground
  truth.
- Results written as a comparison table; used to iterate on `SKILL.md`
  wording and CLI ergonomics until cheap models reliably produce grounded,
  caveat-aware reports.
