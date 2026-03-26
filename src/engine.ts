// WPlus Engine v2.0 — Main Entry Point
// by KuchiSofts — github.com/KuchiSofts — MIT License

import { VERSION } from "./constants";
import { dbg, createDebugAPI, cleanupDebug } from "./utils/debug";
import { settings, deletedMsgs } from "./utils/storage";
import { initModules, CC, CON, GRP, originals, findExport } from "./utils/modules";
import { applyToggle, cleanupPrivacy } from "./features/privacy";
import { hookAllChats, restoreMsg } from "./features/messages";
import { goToMessage, forceRestoreCurrentChat } from "./features/navigation";
import type { WPlusState } from "./types";

// Allow re-injection
if ((window as any).__wplus?.cleanup) {
  try { (window as any).__wplus.cleanup(); } catch {}
}

const wplus: Partial<WPlusState> = { version: VERSION, ready: false };
(window as any).__wplus = wplus;

// Boot sequence
let attempts = 0;

function boot(): void {
  if (++attempts > 120) return;
  if (!initModules()) { setTimeout(boot, 1000); return; }

  hookAllChats();

  // Restore deleted messages
  const saved = deletedMsgs("get");
  if (saved.length && CC) {
    let restored = 0;
    CC._models.forEach((ch) => {
      ch.msgs?._models?.forEach((m) => {
        if (m.__x_type !== "revoked") return;
        const match = saved.find((s) =>
          s.id === m.__x_id?._serialized ||
          (m.__x_t && s.time && Math.abs(m.__x_t * 1000 - s.time) < 5000)
        );
        if (match) { restoreMsg(m, match); restored++; }
      });
    });
    dbg("restore", `Restored ${restored}/${saved.length}`);
  }

  // Apply saved settings
  const S = settings();
  Object.keys(S).forEach((k) => { if (S[k]) applyToggle(k, true); });

  // Public API
  wplus.ready = true;
  wplus.settings = settings;
  wplus.deletedMsgs = deletedMsgs;
  wplus.applyToggle = applyToggle;
  wplus.goToMessage = goToMessage;
  wplus.forceRestoreCurrentChat = forceRestoreCurrentChat;
  wplus.exportContacts = () => {
    if (!CON) { alert("Loading..."); return; }
    const contacts = CON._models
      .filter((c) => c.id?.server === "c.us")
      .map((c) => ({
        phone: "+" + c.id.user,
        name: c.__x_name || c.__x_pushname || c.__x_formattedName || "",
        business: c.__x_isBusiness ? "Yes" : "No",
      }));
    const csv = "Phone,Name,Business\n" + contacts.map((c) =>
      `"${c.phone}","${c.name.replace(/"/g, '""')}","${c.business}"`
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = `WPlus_Contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    alert(`Exported ${contacts.length} contacts!`);
  };
  wplus.chatStats = () => {
    if (!CC) return "Loading...";
    const chats = CC._models;
    let groups = 0, personal = 0, unread = 0, totalMsgs = 0;
    const top: Array<{ n: string; m: number; u: number; g: boolean }> = [];
    chats.forEach((c) => {
      if (c.id?.server === "g.us") groups++; else personal++;
      if (c.__x_unreadCount && c.__x_unreadCount > 0) unread++;
      const mc = c.msgs?._models?.length || 0;
      totalMsgs += mc;
      top.push({ n: c.__x_name || c.__x_formattedTitle || c.id?.user || "?", m: mc, u: c.__x_unreadCount || 0, g: c.id?.server === "g.us" });
    });
    top.sort((a, b) => b.m - a.m);
    const cc = CON?._models.filter((c) => c.id?.server === "c.us").length || 0;
    let t = `${chats.length} chats (${personal} personal, ${groups} groups)\n${unread} unread · ${cc} contacts · ${totalMsgs} loaded\n\n`;
    top.slice(0, 10).forEach((c, i) => {
      t += `${i + 1}. ${c.n.substring(0, 22)}${c.g ? " [G]" : ""} — ${c.m}${c.u > 0 ? ` (${c.u})` : ""}\n`;
    });
    return t;
  };
  wplus.debug = createDebugAPI(() => ({
    version: VERSION,
    ready: wplus.ready || false,
    chats: CC?._models.length || 0,
    contacts: CON?._models.length || 0,
    groups: GRP?._models.length || 0,
    deletedMsgs: deletedMsgs("get").length,
    hookedChats: CC?._models.filter((c) => (c.msgs as any)?.__wp).length || 0,
    hooks: {
      composing: !!originals.markComposing,
      presence: !!originals.sendPresenceAvailable,
      seen: !!originals.sendConversationSeen,
      played: !!originals.markPlayed,
    },
    settings: settings(),
  }));

  // Cleanup function for uninject
  wplus.cleanup = () => {
    cleanupPrivacy();
    cleanupDebug();
    ["wplus-btn", "wplus-panel", "wplus-header-restore", "wplus-css", "wplus-style",
     "wplus-scroll-up", "wplus-media-viewer", "wplus-preview"].forEach((id) => {
      document.getElementById(id)?.remove();
    });
    document.querySelectorAll("[id*=wplus],.wplus-restore-btn,.wplus-b,.wpp,.wplus-msg-highlight").forEach((e) => e.remove());
    document.querySelectorAll(".wplus-blur-t,.wplus-blur-p").forEach((e) => {
      e.classList.remove("wplus-blur-t", "wplus-blur-p");
    });
    (window as any).__wplus = undefined;
  };

  dbg("boot", `READY — ${CC?._models.length} chats, ${CON?._models.length || 0} contacts`);
  window.dispatchEvent(new CustomEvent("wplus-ready"));
}

setTimeout(boot, 3000);
dbg("boot", `Engine v${VERSION} loaded`);
