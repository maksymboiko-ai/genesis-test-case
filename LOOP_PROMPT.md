Work the Wikipedia Trends Skill project in `C:\Users\Максим\genesis-test-case`.

Each iteration:
1. Read `MILESTONES.md`. Find the first unchecked `[ ]` item, in order (don't
   skip ahead even if a later item looks easier — earlier ones are
   dependencies).
2. Implement just that item. Match the design in `ARCHITECTURE.md`; don't
   introduce new dependencies or architectural changes without updating
   `ARCHITECTURE.md` first and noting why in the commit message.
3. Self-measure before checking it off:
   - Code changes: `npm run build` and `npm test` must pass inside
     `.claude/skills/wikipedia-trends/`.
   - M6/M7 (eval) items: the eval run must actually have executed (not just
     be wired up) and produced a results file you can point to.
   - If a milestone item can't be verified (e.g. needs a live network call
     you can't make right now), say so explicitly instead of checking it off.
4. Mark the item `[x]` in `MILESTONES.md`, commit (code + milestone update
   together, one commit per item or tightly related group of items).
5. Move to the next unchecked item.

Stop conditions:
- If you hit a genuine fork only the user can resolve (pricing/credentials
  for OpenRouter, a design choice not covered by ARCHITECTURE.md), stop and
  ask instead of guessing.
- When every item in MILESTONES.md is `[x]`, do a final pass: re-read
  ARCHITECTURE.md against what was actually built, note any drift, then stop
  and report the skill is ready for review — don't keep iterating past
  completion.

Keep a running one-line note in your own reply each iteration on what you
did and what self-measurement showed (build/test status, eval numbers) — this
is what lets the loop supervisor tell progress from stalling.
