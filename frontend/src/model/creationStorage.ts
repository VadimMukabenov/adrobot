import type { Creation } from "../types";

const currentKey = "adrobot.creation";
const entryPrefix = "adrobot.creation.v1.";
function isCreation(value: unknown): value is Creation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    ["name", "country", "operation_id"].every(
      (k) => typeof item[k] === "string",
    ) &&
    ["offer_id", "domain_id", "group_id", "traffic_source_id"].every((k) =>
      Number.isInteger(item[k]),
    )
  );
}
function decode(raw: string): Creation {
  try {
    const value: unknown = JSON.parse(raw);
    if (isCreation(value)) return value;
  } catch {
    /* Keep unreadable recovery data rather than overwrite it. */
  }
  throw new Error(
    "Saved creation could not be read. It has been kept unchanged; no request was sent.",
  );
}
function legacyCreation(): Creation | null {
  const raw = localStorage.getItem(currentKey);
  return raw ? decode(raw) : null;
}
export function currentCreation(): Creation | null {
  try {
    return legacyCreation();
  } catch {
    return null;
  }
}
export function savedCreations(): Creation[] {
  const entries = new Map<string, Creation>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(entryPrefix)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const entry = decode(raw);
    if (key !== entryPrefix + entry.operation_id)
      throw new Error(
        "Saved creation identity does not match its storage key.",
      );
    entries.set(entry.operation_id, entry);
  }
  const current = legacyCreation();
  if (current) entries.set(current.operation_id, current);
  return [...entries.values()];
}
export function saveCreation(request: Creation) {
  // Each operation has its own canonical key. A shared array loses entries
  // when two tabs replace it concurrently. Persist BEFORE any remote POST.
  const previous = legacyCreation();
  if (previous)
    localStorage.setItem(
      entryPrefix + previous.operation_id,
      JSON.stringify(previous),
    );
  localStorage.setItem(
    entryPrefix + request.operation_id,
    JSON.stringify(request),
  );
  // Advisory pointer for compatibility with earlier application versions.
  localStorage.setItem(currentKey, JSON.stringify(request));
}
export function forgetCreation(operationId: string) {
  // The pointer can race across tabs; every new request still has its own
  // canonical entry, so removing the pointer cannot erase another operation.
  if (currentCreation()?.operation_id === operationId)
    localStorage.removeItem(currentKey);
  localStorage.removeItem(entryPrefix + operationId);
}
