/**
 * CSDN — 覆盖内置适配器
 *
 * 对齐 Wechatsync v2：扩展后台 runtime.fetch + Origin/Referer（及 Cookie）改写。
 * 不要在 editor 页内 fetch：自定义 x-ca-* 头会触发 CORS 预检，表现为 Failed to fetch。
 *
 * 草稿：POST /blog-console-api/v3/mdeditor/saveArticle
 * 图床：沿用内置 imgservice 凭证 + OSS（未改接口）
 */
import { assertHostedImages, extractImageSrcs } from "./_images.js";

const EDITOR_URL = "https://editor.csdn.net/md";
const SKIP = ["csdnimg.cn", "csdn.net"];
const FETCH_MS = 25_000;
const SAVE_MS = 45_000;
const UPLOAD_MS = 35_000;

const CA_HEADERS = {
  Origin: "https://editor.csdn.net",
  Referer: "https://editor.csdn.net/",
};

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

    async cookieHeader() {
      if (typeof chrome === "undefined" || !chrome.cookies?.getAll) return "";
      try {
        const cookies = await chrome.cookies.getAll({ domain: "csdn.net" });
        return cookies
          .filter((c) => c?.name && c?.value)
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
      } catch {
        return "";
      }
    }

    async hasLoginCookies() {
      const header = await this.cookieHeader();
      return /UserName=|UserToken=|UserInfo=|c_token=/i.test(header);
    }

    async headerRules() {
      const headers = { ...CA_HEADERS };
      const cookie = await this.cookieHeader();
      if (cookie) headers.Cookie = cookie;
      const resourceTypes = ["xmlhttprequest", "other"];
      return [
        {
          urlFilter: "*://bizapi.csdn.net/*",
          headers,
          resourceTypes,
        },
        {
          urlFilter: "*://imgservice.csdn.net/*",
          headers,
          resourceTypes,
        },
      ];
    }

    async addRulesSafe(rules) {
      const api = this.runtime?.headerRules;
      if (!api?.add) return [];
      const ids = [];
      try {
        for (const rule of rules) {
          const id = await api.add(rule);
          if (id) ids.push(id);
        }
        return ids;
      } catch {
        for (const id of ids) {
          await api.remove?.(id).catch(() => undefined);
        }
        const stripped = rules.map((rule) => {
          const headers = { ...rule.headers };
          delete headers.Cookie;
          return { ...rule, headers };
        });
        const retry = [];
        for (const rule of stripped) {
          const id = await api.add(rule);
          if (id) retry.push(id);
        }
        return retry;
      }
    }

    async withHeaderRules(fn) {
      const api = this.runtime?.headerRules;
      const ids = await this.addRulesSafe(await this.headerRules());
      try {
        return await fn();
      } finally {
        if (api?.remove) {
          for (const id of ids) {
            await api.remove(id).catch(() => undefined);
          }
        }
      }
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

    explainFetch(error, label) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        return `${label}失败: Failed to fetch。请确认 Chrome 已登录 CSDN 后重试`;
      }
      return `${label}失败: ${msg}`;
    }

    async apiJson(url, init = {}, timeoutMs = FETCH_MS, label = "CSDN 接口") {
      let res;
      try {
        res = await this.withTimeout(
          this.runtime.fetch(url, { credentials: "include", ...init }),
          timeoutMs,
          label,
        );
      } catch (error) {
        throw new Error(this.explainFetch(error, label));
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `${label}失败: 非 JSON HTTP ${res.status}: ${text.slice(0, 160)}`,
        );
      }
      return data;
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

      const cred = await this.apiJson(
        "https://imgservice.csdn.net/direct/v1.0/image/upload?watermark=&type=blog&rtype=markdown",
        {
          method: "GET",
          headers: {
            "x-image-app": "direct_blog",
            "x-image-suffix": suffix,
            "x-image-dir": "direct",
          },
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

      const form = new FormData();
      form.append("key", cred.data.filePath);
      form.append("policy", cred.data.policy);
      form.append("OSSAccessKeyId", cred.data.accessId);
      form.append("success_action_status", "200");
      form.append("signature", cred.data.signature);
      form.append("callback", cred.data.callbackUrl);
      form.append("file", imageBlob, `image.${suffix}`);

      let upRes;
      try {
        upRes = await this.withTimeout(
          this.runtime.fetch(cred.data.host, { method: "POST", body: form }),
          UPLOAD_MS,
          "CSDN 图片上传",
        );
      } catch (error) {
        throw new Error(this.explainFetch(error, "CSDN 图片上传"));
      }
      const upText = await upRes.text();
      if (/AccessDenied|InvalidAccessKeyId/i.test(upText)) {
        throw new Error(`OSS 拒绝: ${upText.slice(0, 160)}`);
      }
      let up;
      try {
        up = JSON.parse(upText);
      } catch {
        throw new Error(
          `CSDN 图片上传失败: 非 JSON HTTP ${upRes.status}: ${upText.slice(0, 160)}`,
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
        return await this.withHeaderRules(async () => {
          if (!this.userInfo) {
            if (!(await this.hasLoginCookies())) {
              throw new Error("请先登录 CSDN（打开 editor.csdn.net）");
            }
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
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
