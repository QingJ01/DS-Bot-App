import * as SQLite from "expo-sqlite";
let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!database)
    database = SQLite.openDatabaseAsync("ds-bot-mobile.db").then(
      async (value) => {
        await value.execAsync(
          "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS cache (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope, key));",
        );
        return value;
      },
    );
  return database;
}
export async function readCache<T>(
  scope: string,
  key: string,
): Promise<T | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM cache WHERE scope = ? AND key = ?",
    scope,
    key,
  );
  return row ? (JSON.parse(row.value) as T) : null;
}
export async function writeCache(scope: string, key: string, value: unknown) {
  await (
    await db()
  ).runAsync(
    "INSERT OR REPLACE INTO cache(scope,key,value) VALUES(?,?,?)",
    scope,
    key,
    JSON.stringify(value),
  );
}
export async function clearCache(scope: string) {
  await (await db()).runAsync("DELETE FROM cache WHERE scope = ?", scope);
}

export async function clearCachedContent(scope: string) {
  const database = await db();
  // An unresolved submission and its editable text must survive clearing history.
  await database.runAsync(
    `DELETE FROM cache WHERE scope = ? AND key != 'mobile-preferences' AND key NOT LIKE 'pending:%' AND key NOT LIKE 'archive:%' AND NOT (key LIKE 'draft:%' AND EXISTS (SELECT 1 FROM cache AS pending WHERE pending.scope = cache.scope AND pending.key = 'pending:' || substr(cache.key, 7) AND pending.value != 'null'))`,
    scope,
  );
}
