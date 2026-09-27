import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchEntities, getArticleTitles, resolveTopic } from "../scripts/wikidata.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockSequence(responses: unknown[]) {
  let i = 0;
  globalThis.fetch = (async () => {
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}

test("searchEntities filters out disambiguation pages", async () => {
  mockSequence([
    {
      search: [
        { id: "Q333", label: "Astronomy", description: "scientific study of celestial objects" },
        { id: "Q999", label: "Astronomy (disambiguation)", description: "Wikimedia disambiguation page" },
      ],
    },
  ]);
  const candidates = await searchEntities("astronomy");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "Q333");
});

test("getArticleTitles maps ISO lang codes to sitelinks, null when missing", async () => {
  mockSequence([
    {
      entities: {
        Q333: {
          sitelinks: {
            plwiki: { title: "Astronomia" },
            ukwiki: { title: "Астрономія" },
          },
        },
      },
    },
  ]);
  const titles = await getArticleTitles("Q333", ["pl", "uk", "cs"]);
  assert.deepEqual(titles, { pl: "Astronomia", uk: "Астрономія", cs: null });
});

test("resolveTopic auto-resolves the top candidate and flags ambiguity when >1 candidate", async () => {
  mockSequence([
    {
      search: [
        { id: "Q333", label: "Astronomy", description: "scientific study" },
        { id: "Q334", label: "Astronomy (journal)", description: "academic journal" },
      ],
    },
    {
      entities: { Q333: { sitelinks: { plwiki: { title: "Astronomia" } } } },
    },
  ]);
  const result = await resolveTopic("astronomy", ["pl"]);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.resolved?.entityId, "Q333");
  assert.deepEqual(result.resolved?.titles, { pl: "Astronomia" });
});

test("resolveTopic reports no candidates cleanly", async () => {
  mockSequence([{ search: [] }]);
  const result = await resolveTopic("zzzznotaconcept", ["pl"]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.resolved, undefined);
});
