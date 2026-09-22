import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPerArticleMonthly,
  fetchProjectAggregateMonthly,
  lastNMonths,
  toProjectId,
} from "./pageviews.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOnce(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

test("toProjectId maps ISO lang codes to Wikimedia project ids", () => {
  assert.equal(toProjectId("pl"), "pl.wikipedia");
  assert.equal(toProjectId("uk"), "uk.wikipedia");
});

test("lastNMonths ends at the last complete month, not the current (partial) one", () => {
  const range = lastNMonths(3, new Date(Date.UTC(2026, 5, 15))); // "today" is June 2026
  assert.equal(range.end.getUTCFullYear(), 2026);
  assert.equal(range.end.getUTCMonth(), 4); // May (0-indexed) -- last complete month
  assert.equal(range.start.getUTCMonth(), 2); // March: 3-month window ending in May
});

test("fetchPerArticleMonthly parses REST timestamps into YYYY-MM points", async () => {
  mockFetchOnce(200, {
    items: [
      { timestamp: "2025010100", views: 100 },
      { timestamp: "2025020100", views: 150 },
    ],
  });
  const points = await fetchPerArticleMonthly("pl", "Astronomia", lastNMonths(2));
  assert.deepEqual(points, [
    { month: "2025-01", views: 100 },
    { month: "2025-02", views: 150 },
  ]);
});

test("fetchPerArticleMonthly returns [] on 404 instead of throwing", async () => {
  mockFetchOnce(404, {});
  const points = await fetchPerArticleMonthly("pl", "NoSuchArticleAtAll", lastNMonths(2));
  assert.deepEqual(points, []);
});

test("fetchProjectAggregateMonthly parses aggregate totals", async () => {
  mockFetchOnce(200, {
    items: [{ timestamp: "2025010100", views: 5_000_000 }],
  });
  const points = await fetchProjectAggregateMonthly("pl", lastNMonths(1));
  assert.deepEqual(points, [{ month: "2025-01", views: 5_000_000 }]);
});
