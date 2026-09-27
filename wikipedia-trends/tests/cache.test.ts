import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache } from "../scripts/cache.js";

function withTempCache(fn: (cache: DiskCache) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "wt-cache-"));
  const cache = new DiskCache({ dir, ttlMs: 1000 });
  return Promise.resolve(fn(cache)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("returns undefined for a missing key", async () => {
  await withTempCache((cache) => {
    assert.equal(cache.get("nope"), undefined);
  });
});

test("round-trips a value through set/get", async () => {
  await withTempCache((cache) => {
    cache.set("k", { a: 1 });
    assert.deepEqual(cache.get("k"), { a: 1 });
  });
});

test("getOrFetch only calls the fetcher once per key", async () => {
  await withTempCache(async (cache) => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return "value";
    };
    const first = await cache.getOrFetch("k", fetcher);
    const second = await cache.getOrFetch("k", fetcher);
    assert.equal(first, "value");
    assert.equal(second, "value");
    assert.equal(calls, 1);
  });
});

test("expires entries past their TTL", async () => {
  await withTempCache(async (cache) => {
    cache.set("k", "old");
    // TTL is 1000ms in this fixture; force expiry by writing an old timestamp.
    const key = "k";
    cache.set(key, "old");
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(cache.get(key), undefined);
  });
});
