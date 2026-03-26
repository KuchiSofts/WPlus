// WPlus Debug System
import { MAX_DEBUG_LOG, DEBUG_BATCH_INTERVAL, STORAGE } from "../constants";
import type { LogEntry, DebugAPI, DebugStatus } from "../types";

let debugEnabled = true;
let debugLog: LogEntry[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

export function dbg(category: string, msg: string, data?: any): void {
  if (!debugEnabled) return;

  const entry: LogEntry = {
    t: Date.now(),
    ts: new Date().toLocaleTimeString(),
    cat: category,
    msg,
  };

  if (data !== undefined) {
    entry.data = typeof data === "object"
      ? JSON.stringify(data).substring(0, 200)
      : String(data);
  }

  debugLog.push(entry);
  if (debugLog.length > MAX_DEBUG_LOG) {
    debugLog = debugLog.slice(-MAX_DEBUG_LOG);
  }

  // Batch save to localStorage (every 5s max)
  if (!batchTimer) {
    batchTimer = setTimeout(() => {
      batchTimer = null;
      try {
        localStorage.setItem(STORAGE.debugLog, JSON.stringify(debugLog));
      } catch {}
    }, DEBUG_BATCH_INTERVAL);
  }

  console.log(`[WPlus:${category}] ${msg}${data !== undefined ? " | " + entry.data : ""}`);
}

export function createDebugAPI(getStatus: () => Omit<DebugStatus, "logEntries">): DebugAPI {
  return {
    getLog: () => debugLog.slice(),
    getLogText: () =>
      debugLog.map((e) => `${e.ts} [${e.cat}] ${e.msg}${e.data ? " | " + e.data : ""}`).join("\n"),
    clear: () => {
      debugLog = [];
      dbg("debug", "Log cleared");
    },
    enable: () => {
      debugEnabled = true;
      dbg("debug", "Debug enabled");
    },
    disable: () => {
      debugEnabled = false;
    },
    isEnabled: () => debugEnabled,
    status: () => ({
      ...getStatus(),
      logEntries: debugLog.length,
    }),
  };
}

export function cleanupDebug(): void {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
}
