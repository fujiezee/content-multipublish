import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 开源中国 — Wechatsync v2 oschina.ts 移植
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createOschinaAdapter(BaseAdapter) {
  return class OschinaAdapter extends BaseAdapter {
    meta = {
      id: "oschina",
      name: "开源中国",
      icon: "https://www.oschina.net/favicon.ico",
      homepage: "https://my.oschina.net",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | null} */
    userId = null;

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://apiv1.oschina.net/oschinapi/user/myDetails",
          { credentials: "include" },
        );
        const data = await response.json();

        if (!data.success || !data.result?.userId) {
          return { isAuthenticated: false, error: "未登录" };
        }

        this.userId = String(data.result.userId);
        return {
          isAuthenticated: true,
          userId: this.userId,
          username: data.result.userVo?.name || this.userId,
          avatar: data.result.userVo?.portraitUrl,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    getFilenameFromUrl(url) {
      try {
        const name = new URL(url).pathname.split("/").pop();
        return name && name.trim() ? name : null;
      } catch {
        return null;
      }
    }

    async uploadImageByUrl(url) {
      if (!this.userId) await this.checkAuth();

      const imageResponse = await this.runtime.fetch(url);
      const blob = await imageResponse.blob();
      const filename = this.getFilenameFromUrl(url) || "image.png";

      const formData = new FormData();
      formData.append("file", blob, filename);

      const response = await this.runtime.fetch(
        "https://apiv1.oschina.net/oschinapi/ai/creation/project/uploadDetail",
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );

      const res = await response.json();
      if (!res.success || !res.result) {
        throw new Error(res.message || "图片上传失败");
      }
      return { url: res.result };
    }

    async publish(article, options) {
      try {
        if (!this.userId) {
          const auth = await this.checkAuth();
          if (!auth.isAuthenticated) throw new Error("未登录");
        }

        const rawMarkdown = article.markdown || "";
        const rawHtml = article.html || "";
        const useMarkdown = rawMarkdown.trim().length > 0;
        let content = useMarkdown ? rawMarkdown : rawHtml;
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: ["oschina.net", "static.oschina.net"],
            onProgress: options?.onImageProgress,
            platformName: "开源中国",
          },
        );

        const response = await this.runtime.fetch(
          "https://apiv1.oschina.net/oschinapi/api/draft/save_draft",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: article.title,
              user: Number(this.userId),
              content,
              contentType: useMarkdown ? 1 : 2,
              catalog: 0,
              originUrl: "",
              privacy: true,
              disableComment: false,
            }),
          },
        );

        const res = await response.json();
        if (!res.success || !res.result?.id) {
          throw new Error(res.message || "发布失败");
        }

        const draftId = String(res.result.id);
        return this.createResult(true, {
          postId: draftId,
          postUrl: `https://my.oschina.net/u/${this.userId}/blog/write/draft/${draftId}`,
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
