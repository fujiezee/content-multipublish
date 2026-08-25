import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 华为云社区博客（bbs.huaweicloud.com）
 *
 * CSRF：GET /api/get-ainfo → Response header `csrf`
 * 草稿：POST devdata…/hdblogservice/v1/blog/save-draft
 *       body: { title, content, draftID, source }  source=2 Markdown / 1 富文本
 * 图片：POST …/file/storage { img_url }
 */
const BBS = "https://bbs.huaweicloud.com";
const WRITE = `${BBS}/blogs/article`;
const DEVDATA = "https://devdata.huaweicloud.com";
const API =
  `${DEVDATA}/rest/developer/fwdu/rest/developer/user/hdblogservice/v1`;

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createHuaweicloudAdapter(BaseAdapter) {
  return class HuaweicloudAdapter extends BaseAdapter {
    meta = {
      id: "huaweicloud",
      name: "华为云社区",
      icon: "https://bbs.huaweicloud.com/favicon.ico",
      homepage: WRITE,
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | null} */
    csrf = null;

    htmlToMarkdown(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h([1-6])>/gi, "\n\n")
        .replace(/<h([1-6])[^>]*>/gi, (_, n) => `${"#".repeat(Number(n))} `)
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/?(ul|ol|div|span|section)[^>]*>/gi, "")
        .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "![]($1)")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    async ensureCsrf() {
      if (this.csrf) return this.csrf;
      const response = await this.runtime.fetch(`${BBS}/api/get-ainfo`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "*/*",
          Referer: WRITE,
          Origin: BBS,
        },
      });
      if (!response.ok) {
        throw new Error(
          "未登录华为云社区，请先在 Chrome 打开 bbs.huaweicloud.com 登录",
        );
      }
      const csrf =
        response.headers.get("csrf") ||
        response.headers.get("Csrf") ||
        response.headers.get("CSRF");
      if (!csrf || csrf === "nologin") {
        throw new Error(
          "未获取到 csrf，请先打开并登录 https://bbs.huaweicloud.com/blogs/article",
        );
      }
      this.csrf = csrf;
      return csrf;
    }

    async apiJson(path, { method = "GET", body } = {}) {
      const csrf = await this.ensureCsrf();
      const response = await this.runtime.fetch(`${API}${path}`, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          csrf,
          Origin: BBS,
          Referer: WRITE,
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      if (response.status === 403 && /not login/i.test(text)) {
        throw new Error("未登录华为云社区");
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`华为云社区非 JSON 响应: ${text.slice(0, 120)}`);
      }
      return { response, data };
    }

    async checkAuth() {
      try {
        const { data } = await this.apiJson("/blog/get-draft");
        if (data?.code === "HD.92300000" || Array.isArray(data?.DraftList)) {
          return {
            isAuthenticated: true,
            userId: "huaweicloud",
            username: "华为云社区",
          };
        }
        if (data?.code && String(data.code).includes("9232")) {
          // 业务错误但仍说明已鉴权（如草稿相关）
          return {
            isAuthenticated: true,
            userId: "huaweicloud",
            username: "华为云社区",
          };
        }
        return {
          isAuthenticated: false,
          error: data?.message || data?.msg || data?.code || "未登录",
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      const { data } = await this.apiJson("/file/storage", {
        method: "POST",
        body: { img_url: src },
      });
      if (!data?.url) {
        throw new Error(
          data?.message || data?.msg || "华为云图片转存失败（需白名单图床）",
        );
      }
      return { url: data.url };
    }

    async saveDraft({ title, content, draftID = "" }) {
      const { data } = await this.apiJson("/blog/save-draft", {
        method: "POST",
        body: {
          title,
          content,
          draftID: draftID || "",
          source: 2, // Markdown
        },
      });
      if (data?.code === "HD.92300000" && data.draftID) {
        return String(data.draftID);
      }
      if (data?.code === "HD.92320055") {
        throw new Error("草稿箱已满（最多 10 篇），请先在华为云社区删除旧草稿");
      }
      if (data?.code === "HD.92320023" || data?.code === "HD.92330003") {
        throw new Error(
          "图片不在白名单，请使用本地上传或华为云图床链接后再同步",
        );
      }
      throw new Error(
        data?.message || data?.msg || data?.code || "保存草稿失败",
      );
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录华为云社区");
        }

        const title = String(article.title || "").trim().slice(0, 64);
        if (!title) throw new Error("标题不能为空");

        let md = String(article.markdown || "").trim();
        if (!md) md = this.htmlToMarkdown(article.html || article.content || "");
        md = await processAndAssertImages(
          this,
          md,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: [
              "huaweicloud.com",
              "huawei.com",
              "myhuaweicloud.com",
              "hc-cdn.cn",
              "hc-cdn.com",
            ],
            onProgress: options?.onImageProgress,
            platformName: "华为云社区",
          },
        );

        const draftID = await this.saveDraft({ title, content: md });

        return this.createResult(true, {
          postId: draftID,
          postUrl: `${WRITE}?draftID=${encodeURIComponent(draftID)}`,
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
