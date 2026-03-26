// WPlus Constants
// by KuchiSofts — github.com/KuchiSofts

export const VERSION = "2.0";
export const MAX_DELETED_MSGS = 1000;
export const MAX_DEBUG_LOG = 500;
export const DEBUG_BATCH_INTERVAL = 5000;
export const FILE_SERVER_PORT = 18733;
export const FILE_SERVER_URL = `http://127.0.0.1:${FILE_SERVER_PORT}`;

// WhatsApp module names (Comet/Metro bundler)
export const WA_MODULES = {
  ChatCollection: "WAWebChatCollection",
  ContactCollection: "WAWebContactCollection",
  GroupMetadata: "WAWebGroupMetadataCollection",
  Cmd: "WAWebCmd",
  ChatLoadMessages: "WAWebChatLoadMessages",
  ChatMessageSearch: "WAWebChatMessageSearch",
  PhoneNumberContactAction: "WAWebPhoneNumberContactAction",
} as const;

// Privacy hook function names
export const HOOKS = {
  markComposing: "markComposing",
  markRecording: "markRecording",
  sendPresenceAvailable: "sendPresenceAvailable",
  sendPresenceUnavailable: "sendPresenceUnavailable",
  sendConversationSeen: "sendConversationSeen",
  markPlayed: "markPlayed",
} as const;

// Message types we backup
export const BACKUP_TYPES = [
  "chat", "image", "video", "ptt", "audio",
  "document", "sticker", "vcard", "location"
] as const;

// Media types (have binary data)
export const MEDIA_TYPES = [
  "image", "video", "ptt", "audio", "sticker", "document"
] as const;

// Storage keys
export const STORAGE = {
  deletedMsgs: "wplus_del",
  settings: "wplus_cfg",
  debugLog: "wplus_log",
  syncFlag: "wplus_sync_now",
} as const;

// Blur CSS selectors
export const BLUR_CSS = {
  blurMessages: {
    selectors: `span.selectable-text,[data-pre-plain-text],.copyable-text,._ak8k,.message-in .copyable-text,.message-out .copyable-text`,
  },
  blurContacts: {
    selectors: `span[title][dir],span._ahxt,header span[dir="auto"],header span.x1iyjqo2,[data-testid="conversation-header"] span,[data-testid="cell-frame-title"] span,.message-in span._ahxt,span[aria-label*="Maybe"]`,
  },
  blurPhotos: {
    selectors: `img[draggable="false"],img[src*="pps.whatsapp.net"],img[src*="mmg.whatsapp.net"]`,
  },
} as const;

// Type icons for UI
export const TYPE_ICONS: Record<string, string> = {
  image: "\u{1F4F7}",
  video: "\u{1F3AC}",
  ptt: "\u{1F3A4}",
  audio: "\u{1F3B5}",
  sticker: "\u{1F3A8}",
  vcard: "\u{1F464}",
  location: "\u{1F4CD}",
  document: "\u{1F4C4}",
  chat: "\u{1F4AC}",
};

// MIME type mapping
export const MIME_MAP: Record<string, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  ptt: "audio/ogg",
  audio: "audio/mpeg",
  sticker: "image/webp",
  document: "application/octet-stream",
};

// File extension mapping
export const EXT_MAP: Record<string, string> = {
  image: "jpg",
  video: "mp4",
  ptt: "ogg",
  audio: "mp3",
  sticker: "webp",
  document: "bin",
};
