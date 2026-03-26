// WPlus WhatsApp Module Finder
import { WA_MODULES } from "../constants";
import { dbg } from "./debug";
import type { WACollection, WAChat, WAContact } from "../types";

// Module cache
export let CC: WACollection<WAChat> | null = null;
export let CON: WACollection<WAContact> | null = null;
export let GRP: WACollection<any> | null = null;

// Original function references for restore on cleanup
export let originals: Record<string, Function | undefined> = {};

export function findExport(name: string): any {
  try {
    const modMap = (window as any).require("__debug").modulesMap;
    const keys = Object.keys(modMap);
    for (const key of keys) {
      try {
        const mod = (window as any).require(key);
        const d = mod?.default || mod;
        if (d && typeof d[name] === "function") return d;
        if (mod && typeof mod[name] === "function") return mod;
      } catch {}
    }
  } catch {}
  return null;
}

export function initModules(): boolean {
  try {
    if (typeof (window as any).require !== "function") {
      dbg("init", "window.require not found");
      return false;
    }

    const cc = (window as any).require(WA_MODULES.ChatCollection);
    if (!cc?.ChatCollection?._models) {
      dbg("init", "ChatCollection not ready");
      return false;
    }
    CC = cc.ChatCollection;
    dbg("init", "ChatCollection found", { chats: CC!._models.length });

    try {
      CON = (window as any).require(WA_MODULES.ContactCollection).ContactCollection;
      dbg("init", "ContactCollection found", { contacts: CON!._models.length });
    } catch (e: any) {
      dbg("init", "ContactCollection failed", e.message);
    }

    try {
      GRP = (window as any).require(WA_MODULES.GroupMetadata).GroupMetadataCollection;
      dbg("init", "GroupMetadata found", { groups: GRP!._models.length });
    } catch {}

    // Cache original functions for privacy hooks
    const hookNames = ["markComposing", "markRecording", "sendPresenceAvailable",
      "sendPresenceUnavailable", "sendConversationSeen", "markPlayed"];

    for (const name of hookNames) {
      try {
        const mod = findExport(name);
        if (mod && typeof mod[name] === "function") {
          originals[name] = mod[name];
          dbg("init", `${name} hook ready`);
        }
      } catch {}
    }

    return true;
  } catch (e: any) {
    dbg("init", "FATAL", e.message);
    return false;
  }
}
