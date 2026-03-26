// WPlus Message Protection — backup, restore deleted messages
import { BACKUP_TYPES, MEDIA_TYPES } from "../constants";
import { dbg } from "../utils/debug";
import { deletedMsgs } from "../utils/storage";
import { serverPost } from "../utils/server";
import { CC, findExport } from "../utils/modules";
import type { WAChat, WAMsg, DeletedMessage } from "../types";

export function restoreMsg(msg: WAMsg, saved: Partial<DeletedMessage>): boolean {
  try {
    const header = "\u{1F6AB} *This message was deleted:*\n";
    const type = saved.type || "chat";

    if (MEDIA_TYPES.includes(type as any)) {
      msg.__x_type = type;
      msg.__x_body = saved.body || "";
      msg.__x_text = header + (saved.text || "");
      msg.__x_caption = header + (saved.caption || "");
      msg.__x_isMMS = true;
      msg.__x_isMedia = true;
    } else {
      msg.__x_type = "chat";
      msg.__x_body = header + (saved.body || saved.text || "");
      msg.__x_text = header + (saved.body || saved.text || "");
    }
    msg.__x_isRevoked = false;
    dbg("restore", `Applied: ${type} | ${(saved.body || saved.text || "?").substring(0, 30)}`);
    return true;
  } catch (e: any) {
    dbg("restore", `Apply error: ${e.message}`);
    return false;
  }
}

export function hookChat(chat: WAChat): void {
  if (!chat?.msgs || (chat.msgs as any).__wp) return;
  (chat.msgs as any).__wp = true;

  const chatName = chat.__x_name || chat.__x_formattedTitle || chat.id?.user || "?";

  // Backup new incoming messages
  chat.msgs.on("add", (msg: WAMsg) => {
    try {
      if (!msg?.isNewMsg || msg.id?.fromMe) return;
      if (!BACKUP_TYPES.includes(msg.__x_type as any)) return;

      msg.__x_backupBody = msg.__x_body;
      msg.__x_backupText = msg.__x_text;
      msg.__x_backupType = msg.__x_type;
      msg.__x_backupCaption = msg.__x_caption;
      msg.__x_backupMediaData = msg.__x_mediaData;
      msg.__x_backupTime = Date.now();
      msg.__x_backupSender = msg.__x_from?._serialized || "";

      // Save to file server
      const entry: any = {
        id: msg.__x_id._serialized,
        type: msg.__x_type,
        body: msg.__x_body || "",
        text: msg.__x_text || "",
        caption: msg.__x_caption || "",
        sender: msg.__x_backupSender,
        time: Date.now(),
        chat: chatName,
      };

      // Capture media blob
      const md = msg.__x_mediaData;
      if (md?.mediaBlob?._blob) {
        const reader = new FileReader();
        reader.onload = () => {
          entry.media = reader.result;
          serverPost("/msg/new", entry);
        };
        reader.readAsDataURL(md.mediaBlob._blob);
      } else {
        serverPost("/msg/new", entry);
      }

      dbg("msg", `Backed up: ${msg.__x_type} in ${chatName}`);
    } catch (e: any) {
      dbg("msg", `Backup error: ${e.message}`);
    }
  });

  // Detect deletions
  chat.msgs.on("change", (msg: WAMsg) => {
    try {
      if (!msg || msg.__x_type !== "revoked" || !msg.__x_backupType) return;

      const entry: DeletedMessage = {
        id: msg.__x_id._serialized,
        type: msg.__x_backupType,
        body: msg.__x_backupBody || "",
        text: msg.__x_backupText || "",
        caption: msg.__x_backupCaption || "",
        sender: msg.__x_backupSender || "",
        time: msg.__x_backupTime || Date.now(),
        chat: chatName,
      };

      // Try to capture media
      const md = msg.__x_backupMediaData || msg.__x_mediaData;
      if (md?.mediaBlob?._blob) {
        const reader = new FileReader();
        reader.onload = () => {
          entry.media = reader.result as string;
          deletedMsgs("add", entry);
          serverPost("/msg/deleted", entry);
          // Update media in storage
          const d = deletedMsgs("get");
          for (let i = d.length - 1; i >= 0; i--) {
            if (d[i].id === entry.id) {
              d[i].media = entry.media;
              break;
            }
          }
        };
        reader.readAsDataURL(md.mediaBlob._blob);
      }

      // Also save without media immediately
      deletedMsgs("add", entry);
      serverPost("/msg/deleted", entry);
      restoreMsg(msg, entry);

      window.dispatchEvent(new CustomEvent("wplus-update"));
    } catch (e: any) {
      dbg("msg", `Deletion handler error: ${e.message}`);
    }
  });
}

export function hookAllChats(): void {
  if (!CC) return;
  CC._models.forEach(hookChat);
  CC.on("add", hookChat as any);
  dbg("msg", `Hooked ${CC._models.length} chats`);
}
