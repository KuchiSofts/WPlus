// WPlus Privacy Features — blur, hide typing, hide online, etc.
import { BLUR_CSS } from "../constants";
import { findExport, originals } from "../utils/modules";
import { dbg } from "../utils/debug";

let presenceInterval: ReturnType<typeof setInterval> | null = null;

export function applyToggle(id: string, on: boolean): void {
  // Hide typing
  if (id === "hideTyping") {
    const comp = findExport("markComposing");
    if (comp && originals.markComposing) {
      if (on) {
        comp.markComposing = () => {};
        comp.markRecording = () => {};
      } else {
        comp.markComposing = originals.markComposing;
        if (originals.markRecording) comp.markRecording = originals.markRecording;
      }
    }
  }

  // Hide online
  if (id === "hideOnline") {
    const pres = findExport("sendPresenceAvailable");
    if (pres && originals.sendPresenceAvailable) {
      if (on) {
        pres.sendPresenceAvailable = () => {};
        if (!presenceInterval) {
          const pu = findExport("sendPresenceUnavailable");
          if (pu) {
            presenceInterval = setInterval(() => {
              try { pu.sendPresenceUnavailable(); } catch {}
            }, 1000);
          }
        }
      } else {
        pres.sendPresenceAvailable = originals.sendPresenceAvailable;
        if (presenceInterval) {
          clearInterval(presenceInterval);
          presenceInterval = null;
        }
      }
    }
  }

  // Disable read receipts
  if (id === "disableReceipts") {
    const seen = findExport("sendConversationSeen");
    if (seen && originals.sendConversationSeen) {
      if (on) {
        seen.sendConversationSeen = () => Promise.resolve();
      } else {
        seen.sendConversationSeen = originals.sendConversationSeen;
      }
    }
  }

  // Private audio
  if (id === "playAudioPrivate") {
    const pl = findExport("markPlayed");
    if (pl && originals.markPlayed) {
      if (on) pl.markPlayed = () => {};
      else pl.markPlayed = originals.markPlayed;
    }
  }

  // Blur features — inject/remove CSS <style> tags
  const blurConfig = BLUR_CSS[id as keyof typeof BLUR_CSS];
  if (blurConfig) {
    const styleId = `wplus-css-${id}`;
    const existing = document.getElementById(styleId);

    if (on && !existing) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `${blurConfig.selectors}{filter:blur(${id === "blurPhotos" ? "8" : "5"}px)!important;transition:filter .15s!important}` +
        `${blurConfig.selectors.split(",").map(s => s + ":hover").join(",")}{filter:none!important}`;
      document.head.appendChild(style);
    } else if (!on && existing) {
      existing.remove();
    }
  }
}

export function cleanupPrivacy(): void {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }

  // Restore all original functions
  for (const [name, fn] of Object.entries(originals)) {
    if (!fn) continue;
    try {
      const mod = findExport(name);
      if (mod) mod[name] = fn;
    } catch {}
  }

  // Remove blur CSS
  ["blurMessages", "blurContacts", "blurPhotos"].forEach((id) => {
    const el = document.getElementById(`wplus-css-${id}`);
    if (el) el.remove();
  });
}
