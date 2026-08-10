/**
 * 搜狐焦点 — Wechatsync v1 focus.js 移植（publishNewsInfo status=4 草稿）
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createSohufocusAdapter(BaseAdapter) {
  return class SohufocusAdapter extends BaseAdapter {
    meta = {
      id: "sohufocus",
      name: "搜狐焦点",
      icon: "https://mp.focus.cn/favicon.ico",
      homepage: "https://mp.focus.cn/fe/index.html#/info/draft",
      capabilities: ["article", "draft", "image_upload"],
    };

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://mp-fe-pc.focus.cn/user/status?",
          {
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );
        const res = await response.json();
        const data = res?.data;
        if (!data?.uid) {
          return { isAuthenticated: false, error: "未登录" };
        }
        return {
          isAuthenticated: true,
          userId: String(data.uid),
          username: data.accountName || String(data.uid),
          avatar: data.avatar || undefined,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const formData = new FormData();
      formData.append("image", blob, `${Date.now()}.jpg`);

      const response = await this.runtime.fetch(
        "https://mp-fe-pc.focus.cn/common/image/upload?type=2",
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      const res = await response.json();
      if (res?.code != 200 || res?.data == null) {
        throw new Error(res?.msg || res?.message || "搜狐焦点图片上传失败");
      }
      const path = res.data;
      const url =
        typeof path === "string" && path.startsWith("http")
          ? path
          : `https://t-img.51f.com/sh740wsh${path}`;
      return { url };
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) throw new Error("未登录搜狐焦点");

        const title = String(article.title || "").slice(0, 64);
        let content = article.html || article.markdown || "";
        // collapse whitespace between tags (Wechatsync preEditPost)
        content = content.replace(/>[\t\s]*</g, "><");
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["focus.cn", "51f.com", "sohu.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const response = await this.runtime.fetch(
          "https://mp-fe-pc.focus.cn/news/info/publishNewsInfo",
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              projectIds: [],
              newsBasic: {
                id: "",
                cityId: 0,
                title,
                category: 1,
                headImg: "",
                newsAbstract: "",
                isGuide: 0,
                status: 4, // draft
              },
              newsContent: { content },
              videoIds: [],
            }),
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

        const articleId = res?.data?.id || res?.data?.data?.id;
        if (!articleId) {
          throw new Error(
            res?.msg || res?.message || res?.data?.msg || "保存草稿失败",
          );
        }

        return this.createResult(true, {
          postId: String(articleId),
          postUrl: `https://mp.focus.cn/fe/index.html#/info/subinfo/${articleId}`,
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
