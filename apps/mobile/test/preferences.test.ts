import test from "node:test";
import assert from "node:assert/strict";
import { clearCachedContent, readCache, writeCache } from "../src/storage/cache.web.ts";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

test("clearing history keeps the phone's text size and local preferences", async () => {
  globalThis.localStorage = storage();
  await writeCache("server", "mobile-preferences", { fontScale: 1.15, classic: false });
  await writeCache("server", "messages:chat", [{ id: "old" }]);
  await clearCachedContent("server");
  assert.deepEqual(await readCache("server", "mobile-preferences"), { fontScale: 1.15, classic: false });
  assert.equal(await readCache("server", "messages:chat"), null);
});
