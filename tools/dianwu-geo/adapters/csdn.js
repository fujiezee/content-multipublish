/**
 * CSDN — 覆盖内置适配器
 *
 * bizapi 的 x-ca-* 签名头会触发 CORS 预检。扩展后台 fetch 的 initiator 是
 * chrome-extension://，CSDN 不放行 → Failed to fetch。
 * 必须在已登录的 editor.csdn.net 页内发请求（隔离世界原生 XHR，避开页面劫持的 fetch）。
 *
 * 草稿：POST /blog-console-api/v3/mdeditor/saveArticle（页内 XHR）
 * 图床：imgservice 已 404；改走 bizapi /resource-api/v1/image/direct/upload/signature → OBS
 */
import { assertHostedImages, extractImageSrcs } from "./_images.js";

const EDITOR_URL = "https://editor.csdn.net/md";
const SKIP = ["csdnimg.cn", "csdn.net"];
const FETCH_MS = 25_000;
const SAVE_MS = 45_000;
const UPLOAD_MS = 35_000;

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createCsdnAdapter(BaseAdapter) {
  return class CsdnAdapter extends BaseAdapter {
    meta = {
      id: "csdn",
      name: "CSDN",
      icon: "https://g.csdnimg.cn/static/logo/favicon32.ico",
      homepage: EDITOR_URL,
      capabilities: ["article", "draft", "image_upload"],
    };

    API_KEY = "203803574";
    API_SECRET = "9znpamsyl2c7cdrr9sas0le9vbc3r6ba";

    /** @type {{ csdnid: string; username: string; avatarurl?: string } | null} */
    userInfo = null;

    /** @type {number | null} */
    editorTabId = null;

    /** @type {Set<number>} */
    hiddenEditorWindowIds = new Set();

    createUuid() {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      });
    }

    async hmacSha256(message, secret) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
      const bytes = new Uint8Array(sig);
      let bin = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        bin += String.fromCharCode(bytes[i]);
      }
      return btoa(bin);
    }

    async signRequest(path, method = "POST") {
      const nonce = this.createUuid();
      const signString =
        method === "GET"
          ? `GET\n*/*\n\n\n\nx-ca-key:${this.API_KEY}\nx-ca-nonce:${nonce}\n${path}`
          : `POST\n*/*\n\napplication/json\n\nx-ca-key:${this.API_KEY}\nx-ca-nonce:${nonce}\n${path}`;
      const signature = await this.hmacSha256(signString, this.API_SECRET);
      /** @type {Record<string, string>} */
      const headers = {
        accept: "*/*",
        "x-ca-key": this.API_KEY,
        "x-ca-nonce": nonce,
        "x-ca-signature": signature,
        "x-ca-signature-headers": "x-ca-key,x-ca-nonce",
      };
      if (method === "POST") headers["content-type"] = "application/json";
      return headers;
    }

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    withTimeout(promise, ms, label) {
      let timer;
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label}超时（>${ms}ms）`)),
            ms,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    }

    isEditorUrl(url) {
      return (
        /editor\.csdn\.net/i.test(url || "") &&
        !/passport|\/login/i.test(url || "")
      );
    }

    isLoginUrl(url) {
      return /passport\.csdn\.net|\/login/i.test(url || "");
    }

    async hasLoginCookies() {
      if (typeof chrome === "undefined" || !chrome.cookies?.getAll) return false;
      try {
        const cookies = await chrome.cookies.getAll({ domain: "csdn.net" });
        return cookies.some(
          (c) =>
            c?.value &&
            /UserName|UserToken|UserInfo|c_token/i.test(String(c.name || "")),
        );
      } catch {
        return false;
      }
    }

    async waitEditorReady(tabId, timeoutMs = 12_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let tab;
        try {
          tab = await chrome.tabs.get(tabId);
        } catch {
          throw new Error("CSDN 编辑器标签页已关闭");
        }
        const url = tab.url || tab.pendingUrl || "";
        if (this.isLoginUrl(url)) {
          throw new Error(
            "CSDN 需要登录，请先在浏览器打开 editor.csdn.net 登录后再同步",
          );
        }
        if (this.isEditorUrl(url) && tab.status === "complete") {
          await this.sleep(400);
          return tabId;
        }
        await this.sleep(250);
      }
      throw new Error("CSDN 编辑器页加载超时");
    }

    async openHiddenEditor() {
      const win = await chrome.windows.create({
        url: EDITOR_URL,
        type: "popup",
        focused: false,
        width: 400,
        height: 300,
        left: 0,
        top: 0,
      });
      if (win?.id != null) {
        this.hiddenEditorWindowIds.add(win.id);
        await chrome.windows
          .update(win.id, { focused: false, state: "minimized" })
          .catch(() => undefined);
      }
      const tab = win?.tabs?.[0];
      if (!tab?.id) {
        throw new Error("无法打开 CSDN 编辑器后台页");
      }
      return tab;
    }

    async closeHiddenEditors() {
      for (const id of this.hiddenEditorWindowIds) {
        await chrome.windows.remove(id).catch(() => undefined);
      }
      this.hiddenEditorWindowIds.clear();
      this.editorTabId = null;
    }

    async ensureEditorTab() {
      if (this.editorTabId) {
        try {
          const tab = await chrome.tabs.get(this.editorTabId);
          if (tab?.id && this.isEditorUrl(tab.url || "")) {
            return tab.id;
          }
        } catch {
          this.editorTabId = null;
        }
      }
      const tabs = await chrome.tabs.query({ url: ["*://editor.csdn.net/*"] });
      let tab =
        tabs.find((t) => t.id && this.isEditorUrl(t.url || "")) || tabs[0];
      if (!tab?.id) {
        tab = await this.openHiddenEditor();
      }
      this.editorTabId = tab.id;
      await this.waitEditorReady(tab.id);
      return tab.id;
    }

    explainFetch(error, label) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        return `${label}失败: Failed to fetch。请确认 Chrome 已登录 editor.csdn.net 后重试`;
      }
      return `${label}失败: ${msg}`;
    }

    /**
     * Isolated-world XHR on editor.csdn.net so Origin is the editor, not the extension.
     * Native XHR (not page fetch) — CSDN 常劫持 window.fetch。
     */
    async pageApiJson(url, init = {}, timeoutMs = FETCH_MS, label = "CSDN 接口") {
      const method = init.method || "GET";
      const headers = init.headers || {};
      const body = init.body ?? null;
      let lastErr = "未知错误";
      for (let attempt = 0; attempt < 3; attempt++) {
        const tabId = await this.ensureEditorTab();
        try {
          const [injection] = await this.withTimeout(
            chrome.scripting.executeScript({
              target: { tabId },
              world: "ISOLATED",
              func: (reqUrl, reqMethod, reqHeaders, reqBody, ms) =>
                new Promise((resolve) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open(reqMethod, reqUrl, true);
                  xhr.withCredentials = true;
                  xhr.timeout = ms;
                  Object.entries(reqHeaders || {}).forEach(([key, value]) => {
                    try {
                      xhr.setRequestHeader(key, String(value));
                    } catch {
                      // Origin / Referer 等禁改头，忽略
                    }
                  });
                  xhr.onload = () =>
                    resolve({
                      ok: true,
                      status: xhr.status,
                      text: String(xhr.responseText || ""),
                    });
                  xhr.onerror = () =>
                    resolve({ ok: false, error: "Failed to fetch" });
                  xhr.ontimeout = () =>
                    resolve({ ok: false, error: `请求超时（>${ms}ms）` });
                  try {
                    xhr.send(reqBody);
                  } catch (error) {
                    resolve({
                      ok: false,
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
                  }
                }),
              args: [url, method, headers, body, Math.max(3_000, timeoutMs - 1_000)],
            }),
            timeoutMs,
            label,
          );
          const result = injection?.result;
          if (!result?.ok) {
            lastErr = result?.error || "未知错误";
            if (attempt === 2) break;
            this.editorTabId = null;
            await this.sleep(400 + attempt * 300);
            continue;
          }
          let data;
          try {
            data = JSON.parse(result.text);
          } catch {
            throw new Error(
              `${label}失败: 非 JSON HTTP ${result.status}: ${String(result.text || "").slice(0, 160)}`,
            );
          }
          return data;
        } catch (error) {
          lastErr = error instanceof Error ? error.message : String(error);
          this.editorTabId = null;
          if (attempt === 2) break;
          await this.sleep(400 + attempt * 300);
        }
      }
      throw new Error(this.explainFetch(new Error(lastErr), label));
    }

    async apiJson(url, init = {}, timeoutMs = FETCH_MS, label = "CSDN 接口") {
      return this.pageApiJson(url, init, timeoutMs, label);
    }

    htmlToMarkdown(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h([1-6])>/gi, "\n\n")
        .replace(/<h([1-6])[^>]*>/gi, (_, n) => `${"#".repeat(Number(n))} `)
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/?(ul|ol|div|span|section)[^>]*>/gi, "")
        .replace(
          /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          "[$2]($1)",
        )
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "![]($1)")
        .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
        .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    suffixFromUrl(src, mime = "") {
      if (/png/i.test(mime)) return "png";
      if (/gif/i.test(mime)) return "gif";
      if (/webp/i.test(mime)) return "webp";
      if (/jpe?g/i.test(mime)) return "jpg";
      try {
        const path = new URL(src, "https://local.invalid").pathname;
        const ext = path.split(".").pop()?.toLowerCase() || "";
        if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) {
          return ext === "jpeg" ? "jpg" : ext;
        }
      } catch {
        // ignore
      }
      return "png";
    }

    async loadUserInfo() {
      const path = "/blog-console-api/v3/editor/getBaseInfo";
      const headers = await this.signRequest(path, "GET");
      const res = await this.apiJson(
        `https://bizapi.csdn.net${path}`,
        { method: "GET", headers },
        FETCH_MS,
        "CSDN 登录探测",
      );
      if (res.code === 200 && res.data?.name) {
        this.userInfo = {
          csdnid: res.data.name,
          username: res.data.nickname || res.data.name,
          avatarurl: res.data.avatar,
        };
        return this.userInfo;
      }
      throw new Error(
        res.message || res.msg || "CSDN 未登录，请打开 editor.csdn.net 登录后重试",
      );
    }

    async checkAuth() {
      try {
        if (!(await this.hasLoginCookies())) {
          return {
            isAuthenticated: false,
            error: "请先登录 CSDN（打开 editor.csdn.net）",
          };
        }
        return {
          isAuthenticated: true,
          userId: this.userInfo?.csdnid || "csdn",
          username: this.userInfo?.username || "CSDN",
          avatar: this.userInfo?.avatarurl,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      if (/(?:csdnimg\.cn|csdn\.net)/i.test(src)) return { url: src };

      let imageResponse;
      try {
        imageResponse = await this.withTimeout(
          this.runtime.fetch(src),
          FETCH_MS,
          "CSDN 下载图片",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`CSDN 下载图片失败: ${msg}（${src.slice(0, 96)}）`);
      }
      if (!imageResponse.ok) {
        throw new Error(
          `图片下载失败(${imageResponse.status}): ${src.slice(0, 96)}`,
        );
      }
      const mime = imageResponse.headers.get("content-type") || "image/png";
      const suffix = this.suffixFromUrl(src, mime);
      const imageBlob = await imageResponse.blob();
      if (!imageBlob.size) throw new Error("图片下载为空");

      const path = "/resource-api/v1/image/direct/upload/signature";
      const headers = await this.signRequest(path, "POST");
      const cred = await this.apiJson(
        `https://bizapi.csdn.net${path}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            imageTemplate: "",
            appName: "direct_blog_markdown",
            imageSuffix: suffix,
          }),
        },
        FETCH_MS,
        "CSDN 图床凭证",
      );
      if (cred.code !== 200 || !cred.data?.host || !cred.data?.filePath) {
        throw new Error(
          cred.message ||
            cred.msg ||
            `图床凭证失败 code=${cred.code}，请打开 editor.csdn.net 登录后重试`,
        );
      }

      const uploadData = cred.data;
      const customParam = uploadData.customParam || {};
      const fields = {
        key: uploadData.filePath,
        policy: uploadData.policy,
        signature: uploadData.signature,
        callbackBody: uploadData.callbackBody || "",
        callbackBodyType: uploadData.callbackBodyType || "",
        callbackUrl: uploadData.callbackUrl || "",
        AccessKeyId: uploadData.accessId,
        "x:rtype": String(customParam.rtype || ""),
        "x:filePath": String(customParam.filePath || ""),
        "x:isAudit": String(customParam.isAudit ?? ""),
        "x:x-image-app": String(customParam["x-image-app"] || ""),
        "x:type": String(customParam.type || ""),
        "x:x-image-suffix": String(customParam["x-image-suffix"] || ""),
        "x:username": String(customParam.username || ""),
      };

      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        form.append(key, value);
      }
      form.append("file", imageBlob, `image.${suffix}`);

      let upText = "";
      let upStatus = 0;
      try {
        const upRes = await this.withTimeout(
          this.runtime.fetch(uploadData.host, { method: "POST", body: form }),
          UPLOAD_MS,
          "CSDN 图片上传",
        );
        upStatus = upRes.status;
        upText = await upRes.text();
      } catch {
        const bytes = Array.from(new Uint8Array(await imageBlob.arrayBuffer()));
        const tabId = await this.ensureEditorTab();
        const [injection] = await this.withTimeout(
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: async (host, formFields, arr, contentType, filename, ms) => {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), ms);
              try {
                const blob = new Blob([new Uint8Array(arr)], {
                  type: contentType || "image/png",
                });
                const fd = new FormData();
                for (const [key, value] of Object.entries(formFields)) {
                  fd.append(key, value);
                }
                fd.append("file", blob, filename);
                const res = await fetch(host, {
                  method: "POST",
                  body: fd,
                  signal: ctrl.signal,
                });
                return { ok: true, status: res.status, text: await res.text() };
              } catch (error) {
                return {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                };
              } finally {
                clearTimeout(timer);
              }
            },
            args: [
              uploadData.host,
              fields,
              bytes,
              mime,
              `image.${suffix}`,
              UPLOAD_MS - 2_000,
            ],
          }),
          UPLOAD_MS,
          "CSDN 图片上传",
        );
        const result = injection?.result;
        if (!result?.ok) {
          throw new Error(
            this.explainFetch(
              new Error(result?.error || "Failed to fetch"),
              "CSDN 图片上传",
            ),
          );
        }
        upStatus = result.status;
        upText = result.text || "";
      }

      if (/AccessDenied|InvalidAccessKeyId/i.test(upText)) {
        throw new Error(`OSS 拒绝: ${upText.slice(0, 160)}`);
      }
      let up;
      try {
        up = JSON.parse(upText);
      } catch {
        throw new Error(
          `CSDN 图片上传失败: 非 JSON HTTP ${upStatus}: ${upText.slice(0, 160)}`,
        );
      }
      const imageUrl = up?.data?.imageUrl || up?.data?.url;
      if (up.code !== 200 || !imageUrl) {
        throw new Error(up.message || up.msg || "CSDN 图片上传失败");
      }
      return { url: imageUrl };
    }

    replaceSrcs(content, map) {
      let out = String(content || "");
      for (const [from, to] of map) {
        if (!from || from === to) continue;
        out = out.split(from).join(to);
      }
      return out;
    }

    async rehostContent(html, markdown, onProgress) {
      const srcs = [
        ...new Set([
          ...extractImageSrcs(html),
          ...extractImageSrcs(markdown),
        ]),
      ].filter(
        (src) =>
          src &&
          !src.startsWith("data:") &&
          !SKIP.some((p) => src.includes(p)),
      );

      const map = new Map();
      let done = 0;
      for (const src of srcs) {
        done += 1;
        onProgress?.(done, srcs.length);
        const uploaded = await this.uploadImageByUrl(src);
        map.set(src, uploaded.url);
      }

      const nextHtml = this.replaceSrcs(html, map);
      const nextMd = this.replaceSrcs(markdown, map);
      assertHostedImages(nextHtml, SKIP, "CSDN");
      if (nextMd) assertHostedImages(nextMd, SKIP, "CSDN");
      return { html: nextHtml, markdown: nextMd };
    }

    async publish(article, options) {
      try {
        if (!(await this.hasLoginCookies())) {
          throw new Error("请先登录 CSDN（打开 editor.csdn.net）");
        }
        await this.ensureEditorTab();
        if (!this.userInfo) {
          await this.loadUserInfo();
        }

        let html = article.html || "";
        let markdown = String(article.markdown || "").trim();
        if (!html && markdown) {
          html = markdown
            .split(/\n\n+/)
            .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
            .join("");
        }
        if (typeof this.cleanHtml === "function") {
          html = this.cleanHtml(html, {
            removeIframes: true,
            removeSvgImages: true,
            removeTags: ["qqmusic"],
            removeAttrs: ["data-reader-unique-id"],
          });
        }

        const rehosted = await this.rehostContent(
          html,
          markdown,
          options?.onImageProgress,
        );
        html = rehosted.html;
        markdown = rehosted.markdown || this.htmlToMarkdown(html);

        const path = "/blog-console-api/v3/mdeditor/saveArticle";
        const headers = await this.signRequest(path, "POST");
        const res = await this.apiJson(
          `https://bizapi.csdn.net${path}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              title: article.title,
              markdowncontent: markdown,
              content: html,
              readType: "public",
              level: 0,
              tags: "",
              status: 2,
              categories: "",
              type: "original",
              original_link: "",
              authorized_status: false,
              not_auto_saved: "1",
              source: "pc_mdeditor",
              cover_images: [],
              cover_type: 1,
              is_new: 1,
              vote_id: 0,
              resource_id: "",
              pubStatus: "draft",
              creator_activity_id: "",
            }),
          },
          SAVE_MS,
          "CSDN 保存草稿",
        );

        if (res.code !== 200 || !res.data?.id) {
          throw new Error(res.message || res.msg || "CSDN 保存草稿失败");
        }
        const id = res.data.id;
        return this.createResult(true, {
          postId: String(id),
          postUrl: `https://editor.csdn.net/md?articleId=${id}`,
          draftOnly: options?.draftOnly ?? true,
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await this.closeHiddenEditors();
      }
    }
  };
}
