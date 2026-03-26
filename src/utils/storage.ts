// WPlus Storage Utilities
import { MAX_DELETED_MSGS, STORAGE } from "../constants";
import type { DeletedMessage, SavedSettings } from "../types";

export const LS = {
  get<T>(key: string, fallback: T): T {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: any): void {
    localStorage.setItem(key, JSON.stringify(value));
  },
  del(key: string): void {
    localStorage.removeItem(key);
  },
};

// Settings
export function settings(key?: string, value?: any): any {
  const s = LS.get<SavedSettings>(STORAGE.settings, {} as SavedSettings);
  if (value === undefined) return key ? (s as any)[key] : s;
  (s as any)[key!] = value;
  LS.set(STORAGE.settings, s);
  return value;
}

// Deleted messages — with merge from old storage keys
let merged = false;

function mergeOldKeys(): void {
  if (merged) return;
  merged = true;

  const current = LS.get<DeletedMessage[]>(STORAGE.deletedMsgs, []);
  const ids = new Set(current.map((m) => m.id));
  const oldKeys = ["wplus_deleted_msgs", "wtplus_deleted_msgs", "wtplus_del"];
  let added = 0;

  for (const key of oldKeys) {
    try {
      const old: DeletedMessage[] = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(old)) {
        for (const m of old) {
          if (m.id && !ids.has(m.id)) {
            current.push(m);
            ids.add(m.id);
            added++;
          }
        }
      }
    } catch {}
  }

  if (added > 0) {
    const trimmed = current.length > MAX_DELETED_MSGS ? current.slice(-MAX_DELETED_MSGS) : current;
    LS.set(STORAGE.deletedMsgs, trimmed);
  }
}

export function deletedMsgs(action: "get"): DeletedMessage[];
export function deletedMsgs(action: "add", item: DeletedMessage): DeletedMessage[];
export function deletedMsgs(action: "clear"): DeletedMessage[];
export function deletedMsgs(action: string, item?: DeletedMessage): DeletedMessage[] {
  mergeOldKeys();
  let d = LS.get<DeletedMessage[]>(STORAGE.deletedMsgs, []);

  if (action === "get") return d;

  if (action === "add" && item) {
    const exists = d.some((m) => m.id === item.id);
    if (!exists) {
      d.push(item);
      if (d.length > MAX_DELETED_MSGS) d = d.slice(-MAX_DELETED_MSGS);
      LS.set(STORAGE.deletedMsgs, d);
    }
  }

  if (action === "clear") {
    LS.del(STORAGE.deletedMsgs);
    return [];
  }

  return d;
}
