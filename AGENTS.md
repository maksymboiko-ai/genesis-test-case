# Agent instructions

## Wikipedia pageview trend research

For any task involving Wikipedia pageview trends, topic-interest research
across languages, or deciding which topic/locale a B2C product should invest
in next, use the tool at
`.claude/skills/wikipedia-trends/`.

- Full workflow guidance: `.claude/skills/wikipedia-trends/SKILL.md`
- It's a plain Node/TypeScript CLI, no Claude-specific tooling required:
  ```
  cd .claude/skills/wikipedia-trends
  npm install
  npm run build
  node dist/cli.js --help
  ```
- Run `node dist/cli.js <subcommand> --help` for each subcommand's arguments.
  Prefer `analyze-and-report` for a single-shot query; use `resolve-topic`
  first if the topic name is ambiguous across languages.
- The CLI returns structured JSON with confidence flags (short history,
  low volume, spikes, data gaps). Always reflect those flags in whatever you
  tell the user — don't present a trend as reliable if the tool flagged it as
  low-confidence.
