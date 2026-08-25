/**
 * 人人都是产品经理 — 覆盖内置适配器
 *
 * 图床：POST /tensorflow/upyun/upload（JLStar: Bearer <PURE.jltoken>）
 * 成功字段 result[0].url。
 *
 * 不同步时打开 /writing 标签页；全部走扩展后台 fetch，并加超时，避免「同步中」挂死。
 */
import { processAndAssertImages } from "./_images.js";

const HOME = "https://www.woshipm.com";
const WRITE = `${HOME}/writing`;
const UPLOAD = `${HOME}/tensorflow/upyun/upload`;
const SKIP = ["woshipm.com", "image.woshipm.com"];
const FETCH_MS = 20_000;
const UPLOAD_MS = 45_000;

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createWoshipmAdapter(BaseAdapter) {
  return class WoshipmAdapter extends BaseAdapter {
    meta = {
      id: "woshipm",
      name: "人人都是产品经理",
      icon: "https://www.woshipm.com/favicon.ico",
      homepage: WRITE,
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | null} */
    jlToken = null;

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

    async fetchText(url, init = {}, ms = FETCH_MS, label = "请求") {
      const res = await this.withTimeout(
        this.runtime.fetch(url, { credentials: "include", ...init }),
        ms,
        label,
      );
      return { res, text: await res.text() };
    }

    extractJlToken(html) {
      const m =
        String(html || "").match(/"jltoken"\s*:\s*"([^"]+)"/) ||
        String(html || "").match(/jltoken["']?\s*[:=]\s*["']([^"']+)["']/);
      return m?.[1] || "";
    }

    async ensureJlToken() {
      if (this.jlToken) return this.jlToken;
      const { text } = await this.fetchText(
        WRITE,
        { method: "GET" },
        FETCH_MS,
        "读取写作页 token",
      );
      const token = this.extractJlToken(text);
      if (!token) {
        throw new Error(
          "未拿到图床 token。请先在浏览器登录 https://www.woshipm.com/writing（无需保持打开），再重试同步",
        );
      }
      this.jlToken = token;
      return token;
    }

    async checkAuth() {
      try {
        if (typeof chrome !== "undefined" && chrome.cookies?.getAll) {
          const cookies = await chrome.cookies.getAll({ domain: "woshipm.com" });
          const logged = (cookies || []).some(
            (c) =>
              c?.value &&
              /wordpress_logged_in|wordpress_sec|wp_?user|PHPSESSID|jl|token|session/i.test(
                String(c.name || ""),
              ),
          );
          if (logged) {
            return {
              isAuthenticated: true,
              userId: "woshipm",
              username: "人人都是产品经理",
            };
          }
        }

        const { text } = await this.fetchText(
          WRITE,
          { method: "GET" },
          12_000,
          "登录探测",
        );
        const uid = text.match(
          /var\s+userSettings\s*=\s*\{[^}]*"uid"\s*:\s*"(\d+)"/,
        )?.[1];
        const token = this.extractJlToken(text);
        if (token) this.jlToken = token;
        if (uid || token) {
          return {
            isAuthenticated: true,
            userId: uid || "woshipm",
            username: "人人都是产品经理",
          };
        }
        return {
          isAuthenticated: false,
          error: "未登录人人都是产品经理，请先打开 woshipm.com/writing 登录",
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    suffixFromUrl(src, mime) {
      const path = String(src || "").split("?")[0];
      const m = path.match(/\.(png|jpe?g|gif|bmp|webp)$/i);
      if (m) {
        const ext = m[1].toLowerCase();
        return ext === "jpeg" ? "jpg" : ext === "webp" ? "png" : ext;
      }
      if (/jpeg/i.test(mime || "")) return "jpg";
      if (/gif/i.test(mime || "")) return "gif";
      if (/bmp/i.test(mime || "")) return "bmp";
      return "png";
    }

    parseUploadPayload(data) {
      const list = data?.result || data?.data || data?.RESULT || [];
      if (Array.isArray(list) && list[0]?.url) return String(list[0].url);
      if (typeof data?.url === "string") return data.url;
      if (typeof data?.result === "string") return data.result;
      return "";
    }

    async uploadImageByUrl(src) {
      if (SKIP.some((p) => String(src || "").includes(p))) {
        return { url: src };
      }

      const token = await this.ensureJlToken();
      const imageResponse = await this.withTimeout(
        this.runtime.fetch(src),
        FETCH_MS,
        "下载图片",
      );
      if (!imageResponse.ok) {
        throw new Error(
          `图片下载失败(${imageResponse.status}): ${String(src).slice(0, 96)}`,
        );
      }
      const mime = imageResponse.headers.get("content-type") || "image/png";
      const blob = await imageResponse.blob();
      if (!blob.size) throw new Error("图片下载为空");
      if (blob.size > 5 * 1024 * 1024) {
        throw new Error(
          `图片超过人人都是产品经理 5MB 限制（${Math.round(blob.size / 1024)}KB）`,
        );
      }

      const ext = this.suffixFromUrl(src, mime);
      const filename = `dwgeo-${Date.now()}.${ext}`;
      const form = new FormData();
      form.append("action", "wpuf_insert_image");
      form.append("name", filename);
      form.append("files", blob, filename);

      const uploadRes = await this.withTimeout(
        this.runtime.fetch(UPLOAD, {
          method: "POST",
          credentials: "include",
          headers: {
            JLStar: `Bearer ${token}`,
            "X-Requested-With": "XMLHttpRequest",
          },
          body: form,
        }),
        UPLOAD_MS,
        "图床上传",
      );
      const text = await uploadRes.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `图床响应非 JSON（HTTP ${uploadRes.status}）: ${text.slice(0, 160)}`,
        );
      }

      const url = this.parseUploadPayload(data);
      if (!url || !/woshipm\.com/i.test(url)) {
        throw new Error(
          data?.error ||
            data?.msg ||
            data?.message ||
            `图床上传失败 HTTP ${uploadRes.status}: ${text.slice(0, 160)}`,
        );
      }
      return { url };
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录人人都是产品经理");
        }
        await this.ensureJlToken();

        const title = String(article.title || "").trim();
        let content = article.html || article.markdown || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: SKIP,
            onProgress: options?.onImageProgress,
            platformName: "人人都是产品经理",
          },
        );

        const { res, text } = await this.fetchText(
          `${HOME}/wp-admin/admin-ajax.php`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
              JLStar: `Bearer ${this.jlToken}`,
            },
            body: new URLSearchParams({
              action: "add_draft",
              post_title: title,
              post_content: content,
            }),
          },
          FETCH_MS,
          "创建草稿",
        );
        if (!res.ok) {
          throw new Error(`创建草稿失败: ${res.status} - ${text.slice(0, 160)}`);
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`创建草稿失败: 响应不是有效 JSON - ${text.slice(0, 100)}`);
        }
        if (!data?.post_id) {
          throw new Error(data?.error || "创建草稿失败: 无效响应");
        }
        const postId = String(data.post_id);
        return this.createResult(true, {
          postId,
          postUrl: data.url || `${WRITE}?pid=${postId}`,
          draftOnly: options?.draftOnly ?? true,
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
