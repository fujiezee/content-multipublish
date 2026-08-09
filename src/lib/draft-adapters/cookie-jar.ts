import fs from "fs";
import { sessionPath } from "@/lib/paths";
import type { PlatformId } from "@/lib/types";

export type StorageCookie = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type StorageStateFile = {
  cookies?: StorageCookie[];
  origins?: unknown[];
};

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function loadStorageState(platform: PlatformId): StorageStateFile | null {
  const file = sessionPath(platform);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as StorageStateFile;
  } catch {
    return null;
  }
}

export function loadCookies(platform: PlatformId): StorageCookie[] {
  return loadStorageState(platform)?.cookies ?? [];
}

export function hasSessionFile(platform: PlatformId): boolean {
  return fs.existsSync(sessionPath(platform));
}

/** Match Playwright / browser cookie domain rules for a request URL. */
export function cookiesForUrl(
  cookies: StorageCookie[],
  url: string,
): StorageCookie[] {
  let hostname: string;
  let pathname: string;
  try {
    const u = new URL(url);
    hostname = u.hostname;
    pathname = u.pathname || "/";
  } catch {
    return [];
  }

  const now = Date.now() / 1000;
  return cookies.filter((c) => {
    if (c.expires != null && c.expires > 0 && c.expires < now) return false;
    const domain = (c.domain || "").replace(/^\./, "");
    if (!domain) return false;
    const hostOk =
      hostname === domain || hostname.endsWith(`.${domain}`);
    if (!hostOk) return false;
    const cookiePath = c.path || "/";
    if (cookiePath === "/") return true;
    return (
      pathname === cookiePath ||
      pathname.startsWith(
        cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`,
      )
    );
  });
}

export function cookieHeader(cookies: StorageCookie[], url: string): string {
  return cookiesForUrl(cookies, url)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export type SessionFetchOptions = RequestInit & {
  /** Override Origin / Referer defaults for the platform. */
  origin?: string;
  referer?: string;
};

/**
 * fetch() with Cookie jar from Playwright storageState.
 * Mimics extension SW credentials:include + DNR Origin/Referer.
 */
export function createSessionFetch(platform: PlatformId) {
  const cookies = loadCookies(platform);
  if (!cookies.length) {
    throw new Error(
      `未找到 ${platform} 本机会话，请先在「账号」页连接并登录`,
    );
  }

  return async function sessionFetch(
    input: string | URL,
    init: SessionFetchOptions = {},
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input.toString();
    const headerBag = new Headers(init.headers);
    const jar = cookieHeader(cookies, url);
    if (jar) headerBag.set("Cookie", jar);
    if (!headerBag.has("User-Agent")) {
      headerBag.set("User-Agent", DEFAULT_UA);
    }
    if (init.origin && !headerBag.has("Origin")) {
      headerBag.set("Origin", init.origin);
    }
    if (init.referer && !headerBag.has("Referer")) {
      headerBag.set("Referer", init.referer);
    }

    const { origin: _o, referer: _r, ...rest } = init;
    return fetch(url, {
      ...rest,
      headers: headerBag,
      redirect: init.redirect ?? "follow",
    });
  };
}
