/**
 * 企鹅号（腾讯内容开放平台 om.qq.com）
 *
 * 登录：勿用 /mindex/userAuth/getLoginState，也勿打开 /userAuth/index
 *（扫码页会把已登录的 om 会话踢掉）。
 * 正确路径：已开创作页读 g_userInfo、/article/* 需登录接口、或 QQ/om Cookie。
 * 草稿：POST /article/save；失败则标签页 DOM 点「存草稿」。
 */
import { getCookieValue } from "./_cookie.js";
import {
  assertHostedImages,
  extractImageSrcs,
} from "./_images.js";

const OM_IMAGE_HOSTS = [
  "gtimg.cn",
  "gtimg.com",
  "qpic.cn",
  "inews.qq.com",
  "om.qq.com",
];

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createQiehaoAdapter(BaseAdapter) {
  return class QiehaoAdapter extends BaseAdapter {
    meta = {
      id: "qiehao",
      name: "企鹅号",
      icon: "https://om.gtimg.cn/om/om_2.0/images/favicon_om.ico",
      homepage: "https://om.qq.com/article/articlePublish",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {{ userId: string; username: string; avatar?: string; mediaId?: string } | null} */
    account = null;

    /** @type {number | null} */
    omUploadTabId = null;

    createdOmUploadTab = false;

    imageUploadUrls() {
      return [
        "https://om.qq.com/image/orginalupload",
        "https://om.qq.com/image/orginalupload?appkey=1&isRetImgAttr=1&from=article",
        "https://om.qq.com/image/archscaleupload?isRetImgAttr=1",
      ];
    }

    isLoginHtml(text, finalUrl = "") {
      if (/userAuth|ptlogin|登录-腾讯内容开放平台/i.test(finalUrl)) return true;
      if (!text) return false;
      return (
        /登录-腾讯内容开放平台|ptlogin-container|login-wrapper|扫码登录企鹅号/i.test(
          text,
        ) && !/g_userInfo|mediaId|articlePublish|ProseMirror/i.test(text)
      );
    }

    parseJsonSafe(text) {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    responseOk(data) {
      if (!data || typeof data !== "object") return false;
      const code =
        data.response?.code ?? data.code ?? data.ret ?? data.status;
      if (code === 0 || code === "0") return true;
      if (data.success === true) return true;
      return false;
    }

    accountFromUserInfo(info) {
      if (!info || typeof info !== "object") return null;
      const mediaId =
        info.mediaId ||
        info.media_id ||
        info.media ||
        info.uid ||
        info.openid;
      if (!mediaId && !info.mediaName && !info.nick && !info.nickname) {
        return null;
      }
      return {
        userId: String(mediaId || info.openid || info.mediaName || "qiehao"),
        username: String(
          info.mediaName ||
            info.nick ||
            info.nickname ||
            info.name ||
            info.accountName ||
            mediaId ||
            "企鹅号",
        ),
        avatar: info.header || info.avatar || info.head || undefined,
        mediaId: mediaId ? String(mediaId) : undefined,
      };
    }

    extractGUserInfo(html) {
      if (!html) return null;
      // window.g_userInfo = {...} or g_userInfo={...}
      const m = html.match(
        /(?:window\.)?g_userInfo\s*=\s*(\{[\s\S]*?\})\s*;/,
      );
      if (m?.[1]) {
        try {
          return new Function(`return (${m[1]})`)();
        } catch {
          try {
            return JSON.parse(m[1]);
          } catch {
            // fall through
          }
        }
      }
      // loose mediaId + mediaName in page bootstrap
      const id = html.match(/"mediaId"\s*:\s*"?(\d+)"?/);
      const name = html.match(/"mediaName"\s*:\s*"([^"]+)"/);
      if (id?.[1]) {
        return {
          mediaId: id[1],
          mediaName: name?.[1] || id[1],
        };
      }
      return null;
    }

    waitTabComplete(tabId, timeoutMs = 25_000) {
      return new Promise((resolve) => {
        const onUpdated = (id, info) => {
          if (id !== tabId) return;
          if (info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
          if (tab?.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        });
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }, timeoutMs);
      });
    }

    async readAccountFromOpenTab() {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.scripting?.executeScript
      ) {
        return null;
      }
      try {
        const tabs = await chrome.tabs.query({ url: ["*://om.qq.com/*"] });
        const tab =
          tabs.find(
            (t) =>
              t.id &&
              /article|main|statistic|income/i.test(t.url || "") &&
              !/userAuth|login/i.test(t.url || ""),
          ) || tabs.find((t) => t.id && !/userAuth|login/i.test(t.url || ""));
        if (!tab?.id) return null;

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => {
            const info = window.g_userInfo || null;
            if (info?.mediaId || info?.mediaName) {
              return {
                mediaId: info.mediaId,
                mediaName: info.mediaName,
                header: info.header,
                nick: info.nick || info.nickname,
              };
            }
            if (/userAuth|login/i.test(location.href)) return null;
            // still on creator site without global — treat as logged-in shell
            if (!/userAuth|ptlogin/i.test(document.title + location.href)) {
              return { mediaId: "session", mediaName: "企鹅号" };
            }
            return null;
          },
        });
        return this.accountFromUserInfo(result);
      } catch {
        return null;
      }
    }

    async probeAuthApis() {
      const urls = [
        "https://om.qq.com/article/serverTime",
        "https://om.qq.com/article/categoryList",
        "https://om.qq.com/article/accountStatus",
        "https://om.qq.com/article/list?index=0&num=1",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest",
              Referer: "https://om.qq.com/article/articleManage",
            },
          });
          const finalUrl = response.url || url;
          const text = await response.text();
          if (this.isLoginHtml(text, finalUrl)) continue;
          const data = this.parseJsonSafe(text);
          if (!data) continue;

          // list/account often embed media info
          const nested =
            data.data?.userInfo ||
            data.data?.mediaInfo ||
            data.data?.media ||
            data.userInfo ||
            data.data;
          const fromNested = this.accountFromUserInfo(
            typeof nested === "object" ? nested : null,
          );
          if (fromNested) return fromNested;

          if (
            this.responseOk(data) ||
            (response.ok &&
              !/未登录|请登录|login/i.test(text.slice(0, 200)) &&
              !data?.response?.code?.toString().includes("10403"))
          ) {
            return {
              userId: "session",
              username: "企鹅号",
              mediaId: undefined,
            };
          }
        } catch {
          // next
        }
      }
      return null;
    }

    async probeAuthPages() {
      const urls = [
        "https://om.qq.com/article/articleManage",
        "https://om.qq.com/article/articlePublish",
        "https://om.qq.com/main",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "text/html,application/xhtml+xml",
              "Cache-Control": "no-cache",
            },
            redirect: "follow",
          });
          const finalUrl = response.url || url;
          const html = await response.text();
          if (this.isLoginHtml(html, finalUrl)) continue;
          const info = this.extractGUserInfo(html);
          const account = this.accountFromUserInfo(info);
          if (account) return account;
          // landed on creator UI without parseable g_userInfo
          if (
            /articleManage|articlePublish|header-logo|创作/i.test(html) &&
            !this.isLoginHtml(html, finalUrl)
          ) {
            return {
              userId: "session",
              username: "企鹅号",
              mediaId: undefined,
            };
          }
        } catch {
          // next
        }
      }
      return null;
    }

    async hasOmSessionCookies() {
      const names = [
        "omtoken",
        "omaccesstoken",
        "userid",
        "om_token",
        "uin",
        "skey",
        "p_skey",
        "RK",
        "pt4_token",
      ];
      for (const name of names) {
        const v = await getCookieValue(
          this.runtime,
          [".qq.com", "om.qq.com", ".om.qq.com", "qq.com"],
          name,
          ["https://om.qq.com/", "https://qq.com/"],
        );
        if (v) return true;
      }
      return false;
    }

    async checkAuth() {
      try {
        // 1) already-open creator tab (most reliable when user says they're logged in)
        const fromTab = await this.readAccountFromOpenTab();
        if (fromTab) {
          this.account = fromTab;
          return {
            isAuthenticated: true,
            userId: fromTab.userId,
            username: fromTab.username,
            avatar: fromTab.avatar,
          };
        }

        // 2) JSON endpoints that only work when session is valid
        const fromApi = await this.probeAuthApis();
        if (fromApi) {
          this.account = fromApi;
          return {
            isAuthenticated: true,
            userId: fromApi.userId,
            username: fromApi.username,
            avatar: fromApi.avatar,
          };
        }

        // 3) HTML pages with g_userInfo
        const fromPage = await this.probeAuthPages();
        if (fromPage) {
          this.account = fromPage;
          return {
            isAuthenticated: true,
            userId: fromPage.userId,
            username: fromPage.username,
            avatar: fromPage.avatar,
          };
        }

        // 4) QQ/om cookies: treat as logged in. Calling this "not ready"
        // used to make the site open /userAuth/index and kick the session.
        if (await this.hasOmSessionCookies()) {
          this.account = {
            userId: "session",
            username: "企鹅号",
            mediaId: undefined,
          };
          return {
            isAuthenticated: true,
            userId: "session",
            username: "企鹅号",
          };
        }

        return { isAuthenticated: false, error: "未登录企鹅号" };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async ensureAccount() {
      if (this.account?.userId) return this.account;
      const auth = await this.checkAuth();
      if (!auth.isAuthenticated) throw new Error(auth.error || "未登录企鹅号");
      return this.account;
    }

    isOmImageHost(url) {
      return /(?:gtimg\.cn|gtimg\.com|qpic\.cn|inews\.qq\.com|om\.qq\.com)/i.test(
        String(url || ""),
      );
    }

    extractCdnUrl(text) {
      const m = String(text || "").match(
        /https?:\/\/[^"'\\\s>]+(?:gtimg\.(?:cn|com)|qpic\.cn|inews\.qq\.com)[^"'\\\s>]*/i,
      );
      return m?.[0] || null;
    }

    pickUploadedUrl(res) {
      const found = [];
      const walk = (value, depth = 0) => {
        if (value == null || depth > 8) return;
        if (typeof value === "string") {
          if (/^https?:\/\//i.test(value) && this.isOmImageHost(value)) {
            found.push(value);
          }
          return;
        }
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1);
          return;
        }
        if (typeof value === "object") {
          const preferred = [
            value.imgurl,
            value.url,
            value.src,
            value.image_url,
            value.size?.[0]?.imgurl,
            value.size?.[641]?.imgurl,
            value.size?.["0"]?.imgurl,
            value.size?.["641"]?.imgurl,
          ];
          for (const item of preferred) walk(item, depth + 1);
          if (value.size && typeof value.size === "object") {
            walk(value.size, depth + 1);
          }
          if (value.data) walk(value.data, depth + 1);
        }
      };
      walk(res);
      return found[0] || null;
    }

    bytesToBase64(bytes) {
      const chunk = 0x8000;
      let binary = "";
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }

    sniffImageType(bytes) {
      if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
        return "image/png";
      }
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        return "image/jpeg";
      }
      if (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46
      ) {
        return "image/gif";
      }
      if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45
      ) {
        return "image/webp";
      }
      return "";
    }

    async downloadImageBlob(src) {
      const url = String(src || "").trim();
      if (url.startsWith("data:")) {
        const blob = await fetch(url).then((r) => r.blob());
        if (!blob.size) throw new Error("data URI 图片为空");
        return blob;
      }
      const res = await this.runtime.fetch(url, { credentials: "omit" });
      if (!res.ok) {
        throw new Error(
          `图片下载失败 HTTP ${res.status}: ${url.slice(0, 96)}`,
        );
      }
      const blob = await res.blob();
      if (!blob.size) {
        throw new Error(`图片下载为空: ${url.slice(0, 96)}`);
      }
      return blob;
    }

    isUploadLoginBody(text, status, finalUrl = "") {
      if (this.isLoginHtml(text, finalUrl)) return true;
      if (/userAuth|\/login/i.test(finalUrl)) return true;
      if (status === 302 || status === 301 || status === 303 || status === 307) {
        return true;
      }
      const head = String(text || "").replace(/\s+/g, " ").slice(0, 80);
      return /<!DOCTYPE html/i.test(head) || /<html[\s>]/i.test(head);
    }

    explainUploadFailure(text, status, finalUrl = "") {
      if (this.isUploadLoginBody(text, status, finalUrl)) {
        return "企鹅号图床要登录态，请打开 https://om.qq.com/article/articlePublish 刷新确认已进后台后再同步";
      }
      const res = this.parseJsonSafe(text);
      const msg =
        res?.response?.msg ||
        res?.msg ||
        res?.message ||
        res?.state;
      if (msg && String(msg) !== "success!") return String(msg);
      const snippet = String(text || "").replace(/\s+/g, " ").slice(0, 140);
      if (snippet) return snippet;
      return `HTTP ${status || "?"} 空响应`;
    }

    parseUploadResult(text, status, finalUrl = "") {
      const raw = String(text || "");
      const res = this.parseJsonSafe(raw);
      const out =
        this.pickUploadedUrl(res) ||
        this.extractCdnUrl(raw);
      if (out && this.isOmImageHost(out)) {
        return { url: out.replace(/^http:\/\//i, "https://") };
      }
      throw new Error(
        `企鹅号图片上传失败: ${this.explainUploadFailure(raw, status, finalUrl)}`,
      );
    }

    appendUploadFields(formData, file, filename, mime) {
      formData.append("Filedata", file, filename);
      formData.append("Filename", filename);
      formData.append("subModule", "article_image");
      formData.append("id", `WU_FILE_${Date.now()}`);
      formData.append("name", filename);
      formData.append("type", mime);
      formData.append("lastModifiedDate", new Date().toString());
      formData.append("appkey", "1");
      formData.append("isRetImgAttr", "1");
      formData.append("from", "article");
    }

    isOmEditorUrl(url) {
      return (
        /om\.qq\.com/i.test(url || "") &&
        !/userAuth|ptlogin|\/login/i.test(url || "")
      );
    }

    async waitOmEditorReady(tabId, timeoutMs = 18_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let tab;
        try {
          tab = await chrome.tabs.get(tabId);
        } catch {
          throw new Error("企鹅号创作页已关闭");
        }
        const url = tab.url || tab.pendingUrl || "";
        if (/userAuth|ptlogin|\/login/i.test(url)) {
          throw new Error(
            "企鹅号创作页跳到登录，请先在浏览器打开 https://om.qq.com/article/articlePublish 登录后再同步",
          );
        }
        if (this.isOmEditorUrl(url) && tab.status === "complete") {
          const [{ result } = {}] = await chrome.scripting
            .executeScript({
              target: { tabId },
              world: "MAIN",
              func: () => {
                const info = window.g_userInfo || null;
                if (info?.mediaId || info?.mediaName) return "ok";
                if (/userAuth|ptlogin|登录-腾讯内容开放平台/i.test(
                  document.title + location.href,
                )) {
                  return "login";
                }
                return "shell";
              },
            })
            .catch(() => [{}]);
          if (result === "login") {
            throw new Error(
              "企鹅号创作页未登录，请先打开 https://om.qq.com/article/articlePublish 登录后再同步",
            );
          }
          if (result === "ok" || result === "shell") {
            await new Promise((r) => setTimeout(r, 400));
            return tabId;
          }
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error("企鹅号创作页加载超时");
    }

    async ensureOmUploadTab() {
      if (this.omUploadTabId) {
        try {
          const tab = await chrome.tabs.get(this.omUploadTabId);
          if (tab?.id && this.isOmEditorUrl(tab.url || "")) {
            return tab.id;
          }
        } catch {
          this.omUploadTabId = null;
        }
      }
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.scripting?.executeScript
      ) {
        throw new Error("无 tabs/scripting，无法页内上传");
      }
      const tabs = await chrome.tabs.query({ url: ["*://om.qq.com/*"] });
      let tab =
        tabs.find((t) => t.id && /articlePublish/i.test(t.url || "")) ||
        tabs.find((t) => t.id && this.isOmEditorUrl(t.url || ""));
      if (!tab?.id) {
        tab = await chrome.tabs.create({
          url: "https://om.qq.com/article/articlePublish",
          active: true,
        });
        this.createdOmUploadTab = true;
      }
      this.omUploadTabId = tab.id;
      await this.waitOmEditorReady(tab.id);
      return tab.id;
    }

    async closeOmUploadTabIfCreated() {
      if (this.createdOmUploadTab && this.omUploadTabId) {
        await chrome.tabs.remove(this.omUploadTabId).catch(() => undefined);
      }
      this.createdOmUploadTab = false;
      this.omUploadTabId = null;
    }

    async storeUploadPayload(bytes, filename, mime) {
      const key = `om_img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await chrome.storage.local.set({
        [key]: {
          b64: this.bytesToBase64(bytes),
          name: filename,
          type: mime,
        },
      });
      return key;
    }

    async clearUploadPayload(key) {
      if (key) await chrome.storage.local.remove(key).catch(() => undefined);
    }

    async uploadImageBinary(blob) {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (!bytes.length) throw new Error("图片下载为空");
      const sniffed = this.sniffImageType(bytes);
      if (!sniffed) {
        throw new Error("下载结果不是图片（可能被拦或返回了登录页）");
      }
      const mime =
        blob.type && blob.type.startsWith("image/") ? blob.type : sniffed;
      const uploadMime = mime === "image/webp" ? "image/jpeg" : mime;
      const ext = /png/i.test(uploadMime)
        ? "png"
        : /gif/i.test(uploadMime)
          ? "gif"
          : "jpg";
      const filename = `${Date.now()}.${ext}`;

      const page = await this.uploadViaOmTab(bytes, filename, uploadMime);
      if (page?.url) return page;

      const typed = new Blob([bytes], { type: uploadMime });
      let lastError = page?.error || "企鹅号图片上传失败";
      for (const uploadUrl of this.imageUploadUrls()) {
        try {
          const formData = new FormData();
          this.appendUploadFields(formData, typed, filename, uploadMime);
          const response = await this.runtime.fetch(uploadUrl, {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: formData,
          });
          const text = await response.text();
          return this.parseUploadResult(
            text,
            response.status,
            response.url || uploadUrl,
          );
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      throw new Error(lastError);
    }

    async uploadViaOmTab(bytes, filename, mime) {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.scripting?.executeScript ||
        !chrome.storage?.local
      ) {
        return { error: "无 tabs/scripting，无法页内上传" };
      }
      const key = await this.storeUploadPayload(bytes, filename, mime);
      try {
        const tabId = await this.ensureOmUploadTab();
        const xhrHit = await this.uploadViaPageXhr(tabId, key);
        if (xhrHit?.url) return xhrHit;
        const inputHit = await this.uploadViaEditorInput(tabId, key);
        if (inputHit?.url) return inputHit;
        return {
          error:
            inputHit?.error ||
            xhrHit?.error ||
            "页内上传无返回",
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        await this.clearUploadPayload(key);
      }
    }

    async uploadViaPageXhr(tabId, key) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: (storageKey, urls) =>
          new Promise((resolve) => {
            chrome.storage.local.get(storageKey, (bag) => {
              const payload = bag?.[storageKey];
              if (!payload?.b64) {
                resolve({ status: 0, text: "页内读图失败", url: "" });
                return;
              }
              const binary = Uint8Array.from(atob(payload.b64), (c) =>
                c.charCodeAt(0),
              );
              const blob = new Blob([binary], {
                type: payload.type || "image/jpeg",
              });
              const post = (url) =>
                new Promise((done) => {
                  const fd = new FormData();
                  fd.append("Filedata", blob, payload.name);
                  fd.append("Filename", payload.name);
                  fd.append("subModule", "article_image");
                  fd.append("id", `WU_FILE_${Date.now()}`);
                  fd.append("name", payload.name);
                  fd.append("type", payload.type || "image/jpeg");
                  fd.append("lastModifiedDate", new Date().toString());
                  fd.append("appkey", "1");
                  fd.append("isRetImgAttr", "1");
                  fd.append("from", "article");
                  const xhr = new XMLHttpRequest();
                  xhr.open("POST", url, true);
                  xhr.withCredentials = true;
                  xhr.timeout = 30_000;
                  xhr.onload = () =>
                    done({
                      status: xhr.status,
                      text: String(xhr.responseText || ""),
                      url: xhr.responseURL || url,
                    });
                  xhr.onerror = () =>
                    done({ status: 0, text: "Failed to fetch", url });
                  xhr.ontimeout = () =>
                    done({ status: 0, text: "企鹅号图床上传超时", url });
                  xhr.send(fd);
                });
              (async () => {
                let last = { status: 0, text: "页内上传无返回", url: "" };
                for (const url of urls) {
                  last = await post(url);
                  if (last.text && last.status >= 200 && last.status < 300) {
                    resolve(last);
                    return;
                  }
                }
                resolve(last);
              })().catch((err) =>
                resolve({
                  status: 0,
                  text: err instanceof Error ? err.message : String(err),
                  url: "",
                }),
              );
            });
          }),
        args: [key, this.imageUploadUrls()],
      });
      if (!result?.text && !result?.status) {
        return { error: "页内上传无返回" };
      }
      try {
        return this.parseUploadResult(result.text, result.status, result.url);
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    async uploadViaEditorInput(tabId, key) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          if (window.__dwOmHooked) return;
          window.__dwOmHooked = true;
          window.__dwOmUploads = [];
          const open = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__dwOmUrl = String(url || "");
            return open.call(this, method, url, ...rest);
          };
          const send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function (body) {
            if (/\/image\//i.test(this.__dwOmUrl || "")) {
              this.addEventListener("load", () => {
                window.__dwOmUploads.push({
                  status: this.status,
                  text: String(this.responseText || ""),
                  url: this.responseURL || this.__dwOmUrl,
                });
              });
            }
            return send.call(this, body);
          };
        },
      });

      const [{ result: dispatched } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: (storageKey) =>
          new Promise((resolve) => {
            chrome.storage.local.get(storageKey, (bag) => {
              const payload = bag?.[storageKey];
              if (!payload?.b64) {
                resolve({ ok: false, error: "页内读图失败" });
                return;
              }
              const binary = Uint8Array.from(atob(payload.b64), (c) =>
                c.charCodeAt(0),
              );
              const file = new File([binary], payload.name, {
                type: payload.type || "image/jpeg",
              });
              const inputs = [
                ...document.querySelectorAll(
                  'input[type="file"][accept*="image"], input[type="file"][name="Filedata"], input[type="file"]',
                ),
              ];
              const input =
                inputs.find((el) =>
                  /image|filedata/i.test(
                    `${el.accept || ""} ${el.name || ""} ${el.id || ""}`,
                  ),
                ) || inputs[0];
              if (!input) {
                resolve({ ok: false, error: "创作页没有图片上传框" });
                return;
              }
              const dt = new DataTransfer();
              dt.items.add(file);
              input.files = dt.files;
              input.dispatchEvent(new Event("change", { bubbles: true }));
              resolve({ ok: true });
            });
          }),
        args: [key],
      });
      if (!dispatched?.ok) {
        return { error: dispatched?.error || "无法触发创作页上传" };
      }

      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            const hits = window.__dwOmUploads || [];
            return hits[hits.length - 1] || null;
          },
        });
        if (result?.text || result?.status) {
          try {
            return this.parseUploadResult(
              result.text,
              result.status,
              result.url,
            );
          } catch (err) {
            return {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
        const [{ result: img } = {}] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            const node = document.querySelector(
              'img[src*="gtimg"], img[src*="qpic.cn"], img[src*="inews.qq.com"]',
            );
            return node?.src || "";
          },
        });
        if (img && this.isOmImageHost(img)) {
          return { url: img.replace(/^http:\/\//i, "https://") };
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return { error: "创作页上传超时" };
    }

    async uploadImageByUrl(src) {
      const url = String(src || "").trim();
      if (!url) throw new Error("空图片地址");
      if (this.isOmImageHost(url)) return { url };
      return this.uploadImageBinary(await this.downloadImageBlob(url));
    }

    async rehostContentImages(content, options) {
      const html = content || "";
      const srcs = [...new Set(extractImageSrcs(html))];
      const pending = srcs.filter(
        (src) => src && !src.startsWith("data:") && !this.isOmImageHost(src),
      );
      let out = html;
      let done = 0;
      try {
        for (const src of pending) {
          const uploaded = await this.uploadImageByUrl(src);
          if (!uploaded?.url || !this.isOmImageHost(uploaded.url)) {
            throw new Error(
              `企鹅号图床未返回平台地址（${String(src).slice(0, 80)}）`,
            );
          }
          out = out.split(src).join(uploaded.url);
          done += 1;
          options?.onImageProgress?.({
            current: done,
            total: pending.length,
            src,
          });
          if (done < pending.length) {
            await new Promise((r) => setTimeout(r, 280));
          }
        }
        assertHostedImages(out, OM_IMAGE_HOSTS, "企鹅号");
        return out;
      } finally {
        await this.closeOmUploadTabIfCreated();
      }
    }

    buildSavePayload(title, content, mediaId) {
      const params = new URLSearchParams();
      params.set("title", title);
      params.set("title2", "");
      params.set("content", content);
      params.set("HTML", content);
      params.set("html", content);
      if (mediaId && mediaId !== "session") {
        params.set("media", String(mediaId));
      }
      params.set("status", "0");
      params.set("type", "0");
      params.set("article_type", "0");
      params.set("original", "0");
      return params;
    }

    isSaveOk(res, text) {
      if (res && typeof res === "object") {
        if (this.responseOk(res)) return true;
        if (res.data?.articleId || res.data?.article_id || res.articleId) {
          return true;
        }
      }
      if (/成功|已保存|保存成功/i.test(text) && !/失败|未登录|error/i.test(text)) {
        return true;
      }
      return false;
    }

    async saveViaDom(title, content) {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.create ||
        !chrome.scripting?.executeScript
      ) {
        return { ok: false, error: "无 tabs/scripting 权限" };
      }

      try {
        const tabs = await chrome.tabs.query({ url: ["*://om.qq.com/*"] });
        let tab =
          tabs.find((t) => /articlePublish/i.test(t.url || "")) || null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://om.qq.com/article/articlePublish",
            active: true,
          });
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 2500));
        } else {
          await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 600));
        }

        // wait for editor up to ~12s
        for (let i = 0; i < 8; i++) {
          const [{ result: ready } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () =>
              Boolean(
                document.querySelector(
                  'div.ProseMirror[contenteditable="true"], #omEditorTitle, [contenteditable="true"]',
                ),
              ),
          });
          if (ready) break;
          await new Promise((r) => setTimeout(r, 1500));
        }

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const { title, content } = payload;

            if (/userAuth|login|ptlogin/i.test(location.href + document.title)) {
              return { ok: false, error: "创作页跳到登录，请先在此标签登录企鹅号" };
            }

            const tip = document.querySelector("div.omui-countdowntip a");
            if (tip) {
              tip.click();
              await sleep(800);
            }

            const titleEl =
              document.querySelector(
                '#omEditorTitle span[data-placeholder*="标题"]',
              ) ||
              document.querySelector("#omEditorTitle [contenteditable]") ||
              document.querySelector("#omEditorTitle") ||
              document.querySelector('[data-placeholder*="标题"]');
            if (titleEl) {
              titleEl.focus();
              titleEl.textContent = title;
              titleEl.dispatchEvent(new Event("input", { bubbles: true }));
              titleEl.dispatchEvent(new Event("blur", { bubbles: true }));
            }

            const editor =
              document.querySelector(
                'div.ProseMirror[contenteditable="true"]',
              ) ||
              document.querySelector(
                '[contenteditable="true"].ProseMirror',
              ) ||
              document.querySelector('div[contenteditable="true"]');
            if (!editor) {
              return {
                ok: false,
                error: "未找到编辑器（请确认已进入图文创作页）",
              };
            }

            editor.focus();
            editor.innerHTML = content;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(800);

            const buttons = Array.from(
              document.querySelectorAll("button, a, span, li, div"),
            );
            const draftBtn = buttons.find((b) =>
              /^[\s]*存草稿[\s]*$|保存草稿/.test(
                (b.textContent || "").trim(),
              ),
            );
            if (!draftBtn) {
              return {
                ok: true,
                postUrl: location.href,
                message: "已填入编辑器，请手动点「存草稿」",
              };
            }
            draftBtn.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true }),
            );
            await sleep(1800);
            return {
              ok: true,
              postUrl: location.href,
              message: "已点击存草稿",
            };
          },
          args: [{ title, content }],
        });

        return result || { ok: false, error: "DOM 同步无结果" };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async publish(article, options) {
      try {
        let account = null;
        try {
          account = await this.ensureAccount();
        } catch (authErr) {
          // 已登录用户偶发鉴权接口 HTML 化：仍尝试保存/DOM（先上传图床）
          const msg =
            authErr instanceof Error ? authErr.message : String(authErr);
          const title = String(article.title || "").trim().slice(0, 64);
          const content = await this.rehostContentImages(
            article.html || article.markdown || "",
            options,
          );
          const dom = await this.saveViaDom(title, content);
          if (dom.ok) {
            return this.createResult(true, {
              postUrl:
                dom.postUrl || "https://om.qq.com/article/articlePublish",
              draftOnly: options?.draftOnly ?? true,
              message: dom.message || msg,
            });
          }
          throw new Error(msg);
        }

        const title = String(article.title || "").trim().slice(0, 64);
        if (title.length < 5) {
          throw new Error("企鹅号标题需 5–64 字");
        }

        const content = await this.rehostContentImages(
          article.html || article.markdown || "",
          options,
        );

        const body = this.buildSavePayload(
          title,
          content,
          account?.mediaId || account?.userId,
        );

        const saveUrls = [
          "https://om.qq.com/article/save",
          "https://om.qq.com/article/saveAndPreview",
          "https://om.qq.com/article/batchSave",
        ];

        let lastError = "保存草稿失败";
        for (const saveUrl of saveUrls) {
          const response = await this.runtime.fetch(saveUrl, {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Referer: "https://om.qq.com/article/articlePublish",
              Origin: "https://om.qq.com",
            },
            body: body.toString(),
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);

          if (this.isSaveOk(res, text)) {
            const articleId =
              res?.data?.articleId ||
              res?.data?.article_id ||
              res?.articleId ||
              res?.data?.id;
            return this.createResult(true, {
              postId: articleId ? String(articleId) : undefined,
              postUrl: articleId
                ? `https://om.qq.com/article/articlePublish?articleId=${articleId}`
                : "https://om.qq.com/article/articlePublish",
              draftOnly: options?.draftOnly ?? true,
            });
          }

          lastError =
            res?.msg ||
            res?.message ||
            res?.response?.msg ||
            res?.data?.msg ||
            text.slice(0, 160) ||
            lastError;
        }

        const dom = await this.saveViaDom(title, content);
        if (dom.ok) {
          return this.createResult(true, {
            postUrl: dom.postUrl || "https://om.qq.com/article/articlePublish",
            draftOnly: options?.draftOnly ?? true,
            message: dom.message || lastError,
          });
        }

        throw new Error(dom.error || lastError);
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
