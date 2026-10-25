const prefix = "ds-bot:cache:";
function key(scope: string, name: string) {
  return prefix + JSON.stringify([scope, name]);
}
export async function readCache<T>(
  scope: string,
  name: string,
): Promise<T | null> {
  try {
    const value = localStorage.getItem(key(scope, name));
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
export async function writeCache(scope: string, name: string, value: unknown) {
  try {
    localStorage.setItem(key(scope, name), JSON.stringify(value));
  } catch {
    /* Browser preview may disable storage. */
  }
}
function storageKeys() {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((value): value is string => !!value);
}
export async function clearCache(scope: string) {
  for (const value of storageKeys())
    if (value.startsWith(prefix + JSON.stringify([scope]).slice(0, -1) + ","))
      localStorage.removeItem(value);
}

export async function clearCachedContent(scope: string) {
  const entries = storageKeys().filter((value) => value.startsWith(prefix));
  for (const entry of entries) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.slice(prefix.length));
    } catch {
      continue;
    }
    if (
      !Array.isArray(parsed) ||
      parsed[0] !== scope ||
      typeof parsed[1] !== "string"
    )
      continue;
    const name = parsed[1];
    if (name === "mobile-preferences" || name.startsWith("pending:") || name.startsWith("archive:")) continue;
    if (
      name.startsWith("draft:") &&
      (await readCache(scope, "pending:" + name.slice(6)))
    )
      continue;
    localStorage.removeItem(entry);
  }
}
