import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 一点号 — 基于 mp.yidianzixun.com SPA（/model/Account + /model/Article + /upload）
 * 上游 v2 适配器已私有化；字段按现网 SPA 约定做最小可用草稿保存。
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createYidianAdapter(BaseAdapter) {
  return class YidianAdapter extends BaseAdapter {
    meta = {
      id: "yidian",
      name: "一点号",
      icon: "https://www.yidianzixun.com/favicon.ico",
      homepage: "https://mp.yidianzixun.com/#/Writing/articleEditor",
      capabilities: ["article", "draft", "image_upload"],
    };

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://mp.yidianzixun.com/model/Account",
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          return { isAuthenticated: false, error: "未登录" };
        }

        // shapes vary: {code, result} or account object
        const account =
          data?.result || data?.data || data?.account || data;
        const mediaId =
          account?.media_id ||
          account?.mediaId ||
          account?.id ||
          account?.uid;
        const name =
          account?.name ||
          account?.media_name ||
          account?.nickname ||
          account?.title;

        if (
          data?.errorCode === 299 ||
          String(data?.error || "").includes("自媒体") ||
          !mediaId
        ) {
          return {
            isAuthenticated: false,
            error: data?.error || data?.message || "未登录",
          };
        }

        return {
          isAuthenticated: true,
          userId: String(mediaId),
          username: name ? String(name) : String(mediaId),
          avatar: account?.avatar || account?.image || undefined,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      // Prefer server-side pull when available
      try {
        const pull = await this.runtime.fetch(
          `https://mp.yidianzixun.com/api/image?src=${encodeURIComponent(src)}`,
          { credentials: "include" },
        );
        const pullData = await pull.json();
        const pulled = pullData?.url || pullData?.result?.url;
        if (pulled) return { url: pulled };
      } catch {
        // fall through
      }

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const formData = new FormData();
      formData.append("upfile", blob, `${Date.now()}.jpg`);

      const response = await this.runtime.fetch(
        "https://mp.yidianzixun.com/upload?action=uploadimage&picType=wemedia_cnt",
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      const res = await response.json();
      const url = res?.url || res?.data?.url || res?.result?.url;
      if (!url) {
        throw new Error(res?.error || res?.message || "一点号图片上传失败");
      }
      return { url };
    }

    buildArticlePayload(title, content) {
      // Minimal subset of Vuex articleEditable used by SPA create
      return {
        title,
        content: `${content}<div class="post-end"></div>`,
        cate: "",
        cateB: "",
        coverType: "auto",
        covers: [],
        original: false,
        tags: [],
        editorType: "articleEditor",
        wm_content_source: { type: 0 },
        is_mobile: 0,
        status: "draft",
      };
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) throw new Error("未登录一点号");

        const title = String(article.title || "").slice(0, 64);
        let content = article.html || article.markdown || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: ["yidianzixun.com", "go2yd.com"],
            onProgress: options?.onImageProgress,
            platformName: "一点资讯",
          },
        );

        const response = await this.runtime.fetch(
          "https://mp.yidianzixun.com/model/Article",
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(this.buildArticlePayload(title, content)),
          },
        );

        const text = await response.text();
        let res;
        try {
          res = JSON.parse(text);
        } catch {
          throw new Error(
            `保存草稿失败: ${text.substring(0, 160) || response.status}`,
          );
        }

        if (
          res?.errorCode &&
          res.errorCode !== 0 &&
          res.errorCode !== "0"
        ) {
          throw new Error(
            res.error || res.message || `保存草稿失败: ${res.errorCode}`,
          );
        }

        const articleId =
          res?.result?._id ||
          res?.result?.id ||
          res?.result?.docid ||
          res?.data?._id ||
          res?.data?.id ||
          res?._id ||
          res?.id;

        if (!articleId) {
          throw new Error(res?.error || res?.message || "保存草稿失败：无文章 id");
        }

        return this.createResult(true, {
          postId: String(articleId),
          postUrl: `https://mp.yidianzixun.com/#/Writing/articleEditor/${articleId}`,
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
