/**
 * 阿里云开发者社区 — mzlogin/Wechatsync aliyun 驱动移植
 *
 * 登录：/developer/api/my/user/getUser
 * 草稿：POST /developer/api/articleDraft/putDraft?p_csrf=
 * 图片：getImageUploadUrl → PUT
 */
import { getCookieValue } from "./_cookie.js";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createAliyunAdapter(BaseAdapter) {
  return class AliyunAdapter extends BaseAdapter {
    meta = {
      id: "aliyun",
      name: "阿里云开发者",
      icon: "https://developer.aliyun.com/favicon.ico",
      homepage: "https://developer.aliyun.com/article/new",
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
      const csrf = await getCookieValue(
        this.runtime,
        [
          "developer.aliyun.com",
          ".aliyun.com",
          "aliyun.com",
          ".developer.aliyun.com",
        ],
        "c_csrf",
        ["https://developer.aliyun.com/"],
      );
      if (!csrf) {
        throw new Error(
          "未检测到 c_csrf，请先在 Chrome 打开并登录 developer.aliyun.com",
        );
      }
      this.csrf = csrf;
      return csrf;
    }

    async checkAuth() {
      try {
        await this.ensureCsrf();
        const response = await this.runtime.fetch(
          "https://developer.aliyun.com/developer/api/my/user/getUser",
          {
            credentials: "include",
            headers: {
              Accept: "application/json",
              Referer: "https://developer.aliyun.com/",
              Origin: "https://developer.aliyun.com",
            },
          },
        );
        const data = await response.json();
        const user = data?.data;
        if (!user?.uccId && !user?.nickname) {
          return {
            isAuthenticated: false,
            error: data?.message || "未登录",
          };
        }
        return {
          isAuthenticated: true,
          userId: String(user.uccId || user.userId || user.nickname),
          username: user.nickname || String(user.uccId),
          avatar: user.avatar,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      const csrf = await this.ensureCsrf();
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const name = `${Date.now()}.jpg`;

      const infoRes = await this.runtime.fetch(
        `https://developer.aliyun.com/developer/api/image/getImageUploadUrl?p_csrf=${encodeURIComponent(csrf)}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Origin: "https://developer.aliyun.com",
            Referer: "https://developer.aliyun.com/article/new",
          },
          body: JSON.stringify({
            imageName: name,
            imageSize: blob.size,
          }),
        },
      );
      const info = await infoRes.json();
      if (info?.success === false || !info?.data?.uploadUrl) {
        throw new Error(info?.message || "获取上传地址失败");
      }

      const headers = { ...(info.data.header || {}) };
      const put = await this.runtime.fetch(info.data.uploadUrl, {
        method: "PUT",
        headers,
        body: blob,
      });
      if (!put.ok) throw new Error(`图片上传失败 HTTP ${put.status}`);
      return { url: info.data.imageUrl };
    }

    async putDraft({ title, markdown, abstract, aid }) {
      const csrf = await this.ensureCsrf();
      const body = {
        title,
        content: markdown,
        abstractContent: abstract || "",
        contentRender: "",
        productTags: [],
        freeTierVOS: [],
      };
      if (aid) body.aid = aid;

      const response = await this.runtime.fetch(
        `https://developer.aliyun.com/developer/api/articleDraft/putDraft?p_csrf=${encodeURIComponent(csrf)}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Origin: "https://developer.aliyun.com",
            Referer: "https://developer.aliyun.com/article/new",
          },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (data?.success === false) {
        throw new Error(data?.message || "保存草稿失败");
      }
      const postId = data?.data?.aid || aid;
      if (!postId) throw new Error("保存草稿失败：无 aid");
      return String(postId);
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录阿里云开发者社区");
        }

        const title = String(article.title || "").trim().slice(0, 100);
        if (!title) throw new Error("标题不能为空");

        let md = String(article.markdown || "").trim();
        if (!md) md = this.htmlToMarkdown(article.html || "");
        md = await this.processImages(
          md,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["aliyuncs.com", "aliyun.com", "alicdn.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const abstract = String(article.desc || article.summary || "")
          .trim()
          .slice(0, 200);

        const postId = await this.putDraft({
          title,
          markdown: md,
          abstract,
        });

        return this.createResult(true, {
          postId,
          postUrl: `https://developer.aliyun.com/article/new?edit=${postId}`,
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
