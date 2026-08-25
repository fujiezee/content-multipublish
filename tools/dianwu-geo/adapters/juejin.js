/**
 * 掘金 — 覆盖内置适配器
 *
 * 内置 uploadImageByUrl 走 urlSave，第三方 CDN（如 Vigma）常失败后又 fail-open
 * 保留外链，被 assertHostedImages 拦住。这里改为下载后走 content_api 二进制上传。
 */
import { processAndAssertImages } from "./_images.js";

const SKIP = [
  "juejin.cn",
  "p1-juejin",
  "p3-juejin",
  "p6-juejin",
  "p9-juejin",
  "byteimg.com",
  "juejin.im",
];

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createJuejinAdapter(BaseAdapter) {
  return class JuejinAdapter extends BaseAdapter {
    meta = {
      id: "juejin",
      name: "掘金",
      icon: "https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/favicon-32x32.png",
      homepage: "https://juejin.cn",
      capabilities: [
        "article",
        "draft",
        "image_upload",
        "categories",
        "tags",
        "cover",
      ],
    };

    /** @type {string | null} */
    cachedCsrfToken = null;

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
        .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "```\n$1\n```\n")
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    async checkAuth() {
      try {
        const data = await (
          await this.runtime.fetch(
            "https://api.juejin.cn/user_api/v1/user/get",
            { method: "GET", credentials: "include" },
          )
        ).json();
        if (data?.data?.user_id) {
          return {
            isAuthenticated: true,
            userId: data.data.user_id,
            username: data.data.user_name,
            avatar: data.data.avatar_large,
          };
        }
        return {
          isAuthenticated: false,
          error: "未登录掘金，请先在 Chrome 打开 juejin.cn 登录",
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async getCsrfToken() {
      if (this.cachedCsrfToken) return this.cachedCsrfToken;
      const res = await this.runtime.fetch(
        "https://api.juejin.cn/user_api/v1/sys/token",
        {
          method: "HEAD",
          headers: {
            "x-secsdk-csrf-request": "1",
            "x-secsdk-csrf-version": "1.2.10",
          },
          credentials: "include",
        },
      );
      const raw = res.headers.get("x-ware-csrf-token");
      if (!raw) throw new Error("获取掘金 CSRF 失败，请重新登录后重试");
      const parts = raw.split(",");
      if (parts.length < 2) throw new Error("掘金 CSRF 格式无效");
      this.cachedCsrfToken = parts[1];
      return this.cachedCsrfToken;
    }

    async uploadImageBinary(blob) {
      const csrf = await this.getCsrfToken();
      const form = new FormData();
      const type = blob.type || "image/png";
      const ext = /jpeg|jpg/i.test(type)
        ? "jpg"
        : /gif/i.test(type)
          ? "gif"
          : /webp/i.test(type)
            ? "webp"
            : "png";
      form.append("file", blob, `dwgeo-${Date.now()}.${ext}`);

      const res = await this.runtime.fetch(
        "https://api.juejin.cn/content_api/v1/upload/image",
        {
          method: "POST",
          headers: { "x-secsdk-csrf-token": csrf },
          body: form,
          credentials: "include",
        },
      );
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `掘金图床响应非 JSON（HTTP ${res.status}）: ${text.slice(0, 160)}`,
        );
      }
      const url = data?.data?.url;
      if (!url) {
        throw new Error(
          data?.err_msg ||
            data?.message ||
            `掘金图床上传失败 HTTP ${res.status}: ${text.slice(0, 160)}`,
        );
      }
      return { url: String(url) };
    }

    async uploadImageByUrl(src) {
      if (SKIP.some((p) => String(src || "").includes(p))) {
        return { url: src };
      }

      // data URI → binary
      if (String(src || "").startsWith("data:")) {
        const blob = await fetch(src).then((r) => r.blob());
        return this.uploadImageBinary(blob);
      }

      // urlSave 对 Vigma 等外链经常失败；仍先试一次，失败则二进制上传，绝不 fail-open
      try {
        const saved = await (
          await this.runtime.fetch("https://juejin.cn/image/urlSave", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: src }),
            credentials: "include",
          })
        ).json();
        if (
          saved?.data &&
          typeof saved.data === "string" &&
          SKIP.some((p) => saved.data.includes(p))
        ) {
          return { url: saved.data };
        }
      } catch {
        // fall through
      }

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) {
        throw new Error(
          `图片下载失败(${imageResponse.status}): ${String(src).slice(0, 96)}`,
        );
      }
      const blob = await imageResponse.blob();
      if (!blob.size) throw new Error("图片下载为空");
      return this.uploadImageBinary(blob);
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录掘金");
        }

        const csrf = await this.getCsrfToken();
        let content = article.html || article.markdown || "";
        if (typeof this.cleanHtml === "function") {
          content = this.cleanHtml(content, {
            removeIframes: true,
            removeSvgImages: true,
            removeTags: ["mpprofile", "qqmusic"],
            removeAttrs: ["data-reader-unique-id"],
          });
        }

        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: SKIP,
            onProgress: options?.onImageProgress,
            platformName: "掘金",
          },
        );

        const markContent = /<[a-z][\s\S]*>/i.test(content)
          ? this.htmlToMarkdown(content)
          : content;

        const res = await this.runtime.fetch(
          "https://api.juejin.cn/content_api/v1/article_draft/create",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "x-secsdk-csrf-token": csrf,
            },
            body: JSON.stringify({
              brief_content: "",
              category_id: "0",
              cover_image: "",
              edit_type: 10,
              html_content: "deprecated",
              link_url: "",
              mark_content: markContent,
              tag_ids: [],
              title: String(article.title || "").trim(),
            }),
          },
        );
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`创建草稿失败: ${res.status} - ${text.slice(0, 160)}`);
        }
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`创建草稿失败: 响应不是有效 JSON - ${text.slice(0, 100)}`);
        }
        if (data.err_no && data.err_no !== 0) {
          throw new Error(data.err_msg || `创建草稿失败: 错误码 ${data.err_no}`);
        }
        if (!data?.data?.id) {
          throw new Error(data.err_msg || "创建草稿失败: 无效响应");
        }
        const postId = String(data.data.id);
        return this.createResult(true, {
          postId,
          postUrl: `https://juejin.cn/editor/drafts/${postId}`,
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
