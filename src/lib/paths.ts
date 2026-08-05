import fs from "fs";
import path from "path";

export const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "content.db");
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const DEBUG_DIR = path.join(DATA_DIR, "debug");

export function ensureDataDirs() {
  for (const dir of [DATA_DIR, SESSIONS_DIR, UPLOADS_DIR, DEBUG_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function sessionPath(platform: string) {
  return path.join(SESSIONS_DIR, `${platform}.json`);
}
