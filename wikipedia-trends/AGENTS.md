# Agent instructions

## Wikipedia pageview trend research

For any task involving Wikipedia pageview trends, topic-interest research
across languages, or deciding which topic/locale a B2C product should invest
in next, use the tool in this directory. Full workflow guidance (how to
phrase queries, how to read confidence flags into your conclusions, worked
examples) lives in `SKILL.md` next to this file — read it before your first call
in a session; it applies whether you're Claude Code, Cursor, Codex, or any
other shell-capable agent, not just Claude-specific tooling.

Quick reference:
```
npm install && npm run build   # once per session
node dist/cli.js analyze-and-report --topic "<name>" --langs <lang,lang,...> --out report.pdf
node dist/cli.js <subcommand> --help   # for exact flags on any subcommand
```

The CLI returns structured JSON with confidence flags (short history, low
volume, spikes, data gaps, a possibly-unprocessed trailing month). Always
reflect those flags in whatever you tell the user — don't present a trend as
reliable if the tool flagged it as low-confidence. Repeated/overlapping
queries are cached on disk for 24h, so follow-up questions are cheap.
