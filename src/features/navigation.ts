// WPlus Chat Navigation — go to message, load older messages, scroll
import { WA_MODULES } from "../constants";
import { dbg } from "../utils/debug";
import { deletedMsgs } from "../utils/storage";
import { CC, findExport } from "../utils/modules";
import { restoreMsg } from "./messages";
import type { WAChat, WAMsg, DeletedMessage } from "../types";

function extractJid(msgId: string): string | null {
  const firstUs = msgId.indexOf("_");
  if (firstUs === -1) return null;
  const rest = msgId.substring(firstUs + 1);
  const m = rest.match(/^(.+?@[cgs]\.us)/);
  return m ? m[1] : rest.split("_")[0];
}

function findChatByJid(jid: string): WAChat | null {
  if (!CC) return null;
  for (const ch of CC._models) {
    if (ch.id?._serialized === jid || ch.id?.user === jid.split("@")[0]) return ch;
  }
  // Partial match
  const user = jid.split("@")[0];
  for (const ch of CC._models) {
    if (ch.id?._serialized?.includes(user)) return ch;
  }
  return null;
}

function openChat(chat: WAChat): boolean {
  try {
    const Cmd = (window as any).require(WA_MODULES.Cmd).Cmd;
    if (Cmd?.openChatAt) { Cmd.openChatAt({ chat }); return true; }
  } catch {}
  try {
    const poc = (window as any).require(WA_MODULES.PhoneNumberContactAction);
    if (poc?.handleOpenChat) { poc.handleOpenChat(null, chat.id, null); return true; }
  } catch {}
  return false;
}

function scrollToMsg(chat: WAChat, msgObj: WAMsg): boolean {
  try {
    const Cmd = (window as any).require(WA_MODULES.Cmd).Cmd;
    const search = (window as any).require(WA_MODULES.ChatMessageSearch);
    if (Cmd?.openChatAt && search?.getSearchContext) {
      const ctx = search.getSearchContext(chat, msgObj.__x_id || (msgObj as any).id);
      Cmd.openChatAt({ chat, msgContext: ctx }).then(() => {
        setTimeout(() => {
          // Flash highlight
          const mid = msgObj.__x_id?._serialized || "";
          document.querySelectorAll("[data-id]").forEach((el) => {
            if ((el as HTMLElement).dataset.id === mid || el.textContent?.includes("\u{1F6AB}")) {
              el.classList.add("wplus-msg-highlight");
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              setTimeout(() => el.classList.remove("wplus-msg-highlight"), 3000);
            }
          });
        }, 500);
      });
      dbg("nav", "Scrolled to message");
      return true;
    }
  } catch (e: any) {
    dbg("nav", `scrollToMsg failed: ${e.message}`);
  }
  return false;
}

function findRevokedInChat(chat: WAChat, saved: DeletedMessage): WAMsg | null {
  if (!chat?.msgs?._models) return null;
  const msgTime = saved.time;
  for (const m of chat.msgs._models) {
    if (m.__x_type !== "revoked") continue;
    const mTime = m.__x_t ? m.__x_t * 1000 : 0;
    if (mTime && msgTime && Math.abs(mTime - msgTime) < 5000) return m;
    if (m.__x_id?._serialized === saved.id) return m;
  }
  return null;
}

function searchAndRestore(chat: WAChat, saved: DeletedMessage, attempt: number): void {
  if (attempt > 15) {
    dbg("nav", "Gave up after 15 load attempts");
    return;
  }

  const found = findRevokedInChat(chat, saved);
  if (found) {
    dbg("nav", "FOUND! Restoring...");
    restoreMsg(found, saved);
    scrollToMsg(chat, found);
    window.dispatchEvent(new CustomEvent("wplus-update"));
    return;
  }

  dbg("nav", `Not found (attempt ${attempt + 1}), loading older...`);
  try {
    const loader = (window as any).require(WA_MODULES.ChatLoadMessages);
    if (loader?.loadEarlierMsgs) {
      const before = chat.msgs._models?.length || 0;
      loader.loadEarlierMsgs(chat).then(() => {
        const after = chat.msgs._models?.length || 0;
        dbg("nav", `Loaded ${after - before} more (total: ${after})`);
        if (after === before) {
          const lastTry = findRevokedInChat(chat, saved);
          if (lastTry) { restoreMsg(lastTry, saved); scrollToMsg(chat, lastTry); }
          else dbg("nav", "Message not in history");
          return;
        }
        setTimeout(() => searchAndRestore(chat, saved, attempt + 1), 500);
      });
      return;
    }
  } catch (e: any) {
    dbg("nav", `Loader error: ${e.message}`);
  }
}

export function goToMessage(savedMsgId: string): boolean {
  if (!CC) { dbg("nav", "No ChatCollection"); return false; }

  const allSaved = deletedMsgs("get");
  const saved = allSaved.find((m) => m.id === savedMsgId);
  if (!saved) { dbg("nav", `Not found: ${savedMsgId.substring(0, 30)}`); return false; }

  const jid = extractJid(savedMsgId);
  if (!jid) { dbg("nav", "Bad ID"); return false; }
  dbg("nav", `Target: ${jid} type=${saved.type}`);

  const chat = findChatByJid(jid);
  if (!chat) { dbg("nav", "Chat not found"); return false; }
  dbg("nav", `Chat: ${chat.__x_name || chat.__x_formattedTitle || "?"}`);

  openChat(chat);

  // Wait for chat to render then search
  function waitReady(attempts: number): void {
    if (attempts > 20) { dbg("nav", "Chat never loaded"); return; }
    if (chat.msgs?._models?.length > 0) {
      dbg("nav", `Chat ready (${chat.msgs._models.length} msgs)`);
      searchAndRestore(chat, saved, 0);
    } else {
      setTimeout(() => waitReady(attempts + 1), 500);
    }
  }
  setTimeout(() => waitReady(0), 2000);
  return true;
}

export function forceRestoreCurrentChat(callback: (count: number) => void): void {
  if (!CC) { callback(0); return; }

  // Find current chat by header name
  let currentChat: WAChat | null = null;
  const hdr = document.querySelector("header span.x1iyjqo2, header span[dir='auto']") as HTMLElement;
  const headerName = hdr?.textContent?.trim() || "";

  if (headerName) {
    currentChat = CC._models.find((c) =>
      c.__x_name === headerName || c.__x_formattedTitle === headerName
    ) || null;
  }
  if (!currentChat) {
    currentChat = CC._models.find((c) => c.__x_active) || null;
  }
  if (!currentChat) { dbg("restore", "No active chat"); callback(0); return; }

  const chatJid = currentChat.id._serialized;
  const chatSaved = deletedMsgs("get").filter((s) =>
    s.id?.includes(chatJid.split("@")[0])
  );

  if (!chatSaved.length) { callback(0); return; }
  dbg("restore", `Force restoring ${chatSaved.length} in ${headerName}`);

  let totalRestored = 0;
  const restored = new Set<string>();

  function loadAndRestore(attempt: number): void {
    if (attempt > 20) { callback(totalRestored); return; }

    currentChat!.msgs._models?.forEach((m) => {
      if (m.__x_type !== "revoked") return;
      const mTime = m.__x_t ? m.__x_t * 1000 : 0;
      for (const s of chatSaved) {
        if (restored.has(s.id)) continue;
        if (s.id === m.__x_id._serialized || (mTime && s.time && Math.abs(mTime - s.time) < 5000)) {
          restoreMsg(m, s);
          restored.add(s.id);
          totalRestored++;
          break;
        }
      }
    });

    if (restored.size >= chatSaved.length) {
      callback(totalRestored);
      return;
    }

    try {
      const loader = (window as any).require(WA_MODULES.ChatLoadMessages);
      const before = currentChat!.msgs._models?.length || 0;
      loader.loadEarlierMsgs(currentChat).then(() => {
        const after = currentChat!.msgs._models?.length || 0;
        if (after === before) { callback(totalRestored); return; }
        setTimeout(() => loadAndRestore(attempt + 1), 300);
      }).catch(() => callback(totalRestored));
    } catch { callback(totalRestored); }
  }

  loadAndRestore(0);
}
