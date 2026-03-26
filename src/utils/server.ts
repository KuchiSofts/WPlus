// WPlus File Server Communication
import { FILE_SERVER_URL } from "../constants";
import { dbg } from "./debug";

export function serverPost(path: string, data: any): void {
  try {
    fetch(FILE_SERVER_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then((r) => r.json())
      .then((r) => dbg("server", `${path} → ${JSON.stringify(r)}`))
      .catch((e) => dbg("server", `${path} error: ${e.message}`));
  } catch (e: any) {
    dbg("server", `fetch error: ${e.message}`);
  }
}

export function serverGet<T>(path: string): Promise<T | null> {
  return fetch(FILE_SERVER_URL + path)
    .then((r) => r.json() as Promise<T>)
    .catch(() => null);
}

export function mediaUrl(relativePath: string): string {
  return `${FILE_SERVER_URL}/media/${relativePath}`;
}
