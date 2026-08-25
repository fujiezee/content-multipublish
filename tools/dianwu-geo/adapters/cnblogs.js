/**
 * 博客园 — Wechatsync v2 cnblogs.ts 移植
 */
import { getCookieValue } from "./_cookie.js";
import {
  processAndAssertImages,
} from "./_images.js";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createCnblogsAdapter(BaseAdapter) {
  return class CnblogsAdapter extends BaseAdapter {
    meta = {
      id: "cnblogs",
      name: "博客园",
      icon: "https://www.cnblogs.com/favicon.ico",
      homepage: "https://i.cnblogs.com/posts/edit",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | null} */
    xsrfToken = null;

    /** Editor sync often sends HTML only; blog API expects Markdown postBody. */
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
        .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) =>
          String(t)
            .split(/\n/)
            .map((line) => `> ${line.replace(/<[^>]+>/g, "")}`)
            .join("\n"),
        )
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    async getXsrfToken() {
      if (this.xsrfToken) return this.xsrfToken;

      await this.runtime.fetch("https://i.cnblogs.com/posts/edit", {
        method: "GET",
        credentials: "include",
      });

      const value = await getCookieValue(
        this.runtime,
        ["i.cnblogs.com", ".cnblogs.com", "cnblogs.com"],
        "XSRF-TOKEN",
      );
      this.xsrfToken = value;
      return this.xsrfToken;
    }

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://home.cnblogs.com/user/CurrentUserInfo",
          { method: "GET", credentials: "include" },
        );
        const text = await response.text();
        const avatarMatch = text.match(
          /<img[^>]+class="pfs"[^>]+src="([^"]+)"/,
        );
        const linkMatch = text.match(/href="\/u\/([^/]+)\/"/);
        if (!linkMatch) return { isAuthenticated: false };

        return {
          isAuthenticated: true,
          userId: linkMatch[1],
          username: linkMatch[1],
          avatar: avatarMatch ? avatarMatch[1] : undefined,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      if (!this.xsrfToken) throw new Error("XSRF-TOKEN 未获取");

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const imageBlob = await imageResponse.blob();

      const formData = new FormData();
      formData.append("image", imageBlob, "image.png");
      formData.append("app", "blog");
      formData.append("uploadType", "Select");

      const uploadResponse = await this.runtime.fetch(
        "https://upload.cnblogs.com/v2/images/cors-upload",
        {
          method: "POST",
          credentials: "include",
          headers: { "x-xsrf-token": this.xsrfToken },
          body: formData,
        },
      );

      const responseText = await uploadResponse.text();
      if (!uploadResponse.ok) {
        throw new Error(
          `图片上传失败: ${uploadResponse.status} - ${responseText}`,
        );
      }

      let res;
      try {
        res = JSON.parse(responseText);
      } catch {
        throw new Error(
          `图片上传失败: 响应不是 JSON - ${responseText.substring(0, 100)}`,
        );
      }

      const imageUrl = res.data || res.url || res.imageUrl || res.src;
      if (!imageUrl || typeof imageUrl !== "string") {
        throw new Error(`图片上传失败: 无法获取图片 URL - ${JSON.stringify(res)}`);
      }
      return { url: imageUrl };
    }

    async publish(article, options) {
      try {
        const xsrfToken = await this.getXsrfToken();
        if (!xsrfToken) {
          throw new Error("获取 XSRF-TOKEN 失败，请先在浏览器登录博客园");
        }
        this.xsrfToken = xsrfToken;

        let markdown = String(article.markdown || "").trim();
        if (!markdown) {
          markdown = this.htmlToMarkdown(
            article.html || article.content || "",
          );
        }
        if (!markdown) {
          throw new Error("正文不能为空（未收到 markdown/html）");
        }

        markdown = await processAndAssertImages(
          this,
          markdown,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: [
              "cnblogs.com",
              "img2024.cnblogs.com",
              "img2023.cnblogs.com",
            ],
            onProgress: options?.onImageProgress,
            platformName: "博客园",
          },
        );

        const response = await this.runtime.fetch(
          "https://i.cnblogs.com/api/posts",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "x-xsrf-token": xsrfToken,
            },
            body: JSON.stringify({
              id: null,
              postType: 2,
              accessPermission: 0,
              title: article.title,
              url: null,
              postBody: markdown,
              categoryIds: null,
              categories: null,
              collectionIds: [],
              inSiteCandidate: false,
              inSiteHome: false,
              siteCategoryId: null,
              blogTeamIds: null,
              isPublished: false,
              displayOnHomePage: false,
              isAllowComments: true,
              includeInMainSyndication: false,
              isPinned: false,
              showBodyWhenPinned: false,
              isOnlyForRegisterUser: false,
              isUpdateDateAdded: false,
              entryName: null,
              description: null,
              featuredImage: null,
              tags: null,
              password: null,
              publishAt: null,
              datePublished: new Date().toISOString(),
              dateUpdated: null,
              isMarkdown: true,
              isDraft: true,
              autoDesc: null,
              changePostType: false,
              blogId: 0,
              author: null,
              removeScript: false,
              clientInfo: null,
              changeCreatedTime: false,
              canChangeCreatedTime: false,
              isContributeToImpressiveBugActivity: false,
              usingEditorId: 5,
              sourceUrl: null,
            }),
          },
        );

        const responseText = await response.text();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error("未登录或登录已过期，请重新登录博客园");
          }
          throw new Error(`创建草稿失败: ${response.status} - ${responseText}`);
        }

        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          throw new Error(
            `创建草稿失败: 响应不是有效 JSON - ${responseText.substring(0, 100)}`,
          );
        }

        if (!responseData.id) {
          throw new Error(responseData.error || "创建草稿失败: 无效响应");
        }

        const postId = String(responseData.id);
        return this.createResult(true, {
          postId,
          postUrl: `https://i.cnblogs.com/articles/edit;postId=${postId}`,
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
