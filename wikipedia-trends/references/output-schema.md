# CLI output reference

Every subcommand prints one JSON object to stdout. On failure it prints
`Error: ...` to stderr and exits non-zero.

## `analyze-and-report`: summary only

```json
{
  "ok": true,
  "out": "astronomy-uk.pdf",
  "unresolvedLangs": [],
  "ambiguous": false,
  "entries": [
    { "label": "astronomy / uk", "flags": { ... }, "momGrowthPct": 11.8, "yoyGrowthPct": -4 }
  ]
}
```

`momGrowthPct` and `yoyGrowthPct` here are computed on **raw** views. The
normalized (share-of-edition) trend appears only in the PDF: its trend
direction line and second chart. To quote normalized numbers, run `analyze`
with the same flags, which is served from the cache.

## `analyze` and `compare`: full result

```json
{
  "entries": [ { "label": "astronomy / uk", "trend": { "raw": TrendStats, "sharePpm": [MonthlyPoint], "normalized": TrendStats } } ],
  "unresolvedLangs": ["xx"],
  "ambiguous": false
}
```

`compare` returns the same shape with one entry per topic × language.

- `raw` is computed on article views.
- `normalized` is computed on `sharePpm`: the article's views per million
  views of the whole language edition that month. It controls for an edition
  growing or shrinking overall, so lead with it when comparing languages.

### `TrendStats`

| Field | Meaning |
|---|---|
| `months` | `[{ "month": "YYYY-MM", "views": number }]`, oldest first |
| `totalViews`, `meanMonthlyViews` | Over the whole series |
| `momGrowthPct` | Latest month vs the month before, %. `null` with fewer than 2 months |
| `yoyGrowthPct` | Latest month vs the same month a year earlier, %. `null` with fewer than 13 months |
| `regression` | `{ slopePerMonth, r2 }` of a linear fit, or `null`. The PDF calls a trend "consistent" when `r2` > 0.6 and "noisy" otherwise |
| `flags` | See the flags in `SKILL.md` |
| `spikeMonths` | `"YYYY-MM"` months with \|z-score\| > 2.5 |

If `flags.trailingMonthLikelyIncomplete` is true, the growth figures and the
regression already exclude the latest month.

### Flag thresholds

- `lowVolume`: mean monthly views below 500.
- `hasSpike`: any month with \|z-score\| > 2.5.
- `trailingMonthLikelyIncomplete`: latest month below 25% of the prior
  3-month average.

## `resolve-topic`

```json
{
  "query": "mercury",
  "candidates": [ { "id": "Q613883", "label": "Mercury", "description": "automobile marque of the Ford Motor Company" }, ... ],
  "ambiguous": true,
  "resolved": { "entityId": "Q613883", "label": "Mercury", "titles": { "de": "Mercury (Automarke)", "xx": null } }
}
```

`resolved` is always the top search candidate, and `analyze` uses it. It is
not necessarily the intended meaning: for "mercury" it is the car brand, not
the planet. When `ambiguous` is true, check `candidates` before trusting the
analysis. A `null` title means that language edition has no article on the
entity, so the language ends up in `unresolvedLangs`.
