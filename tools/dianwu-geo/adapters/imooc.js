/**
 * 慕课手记 — Wechatsync v2 imooc.ts 移植
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createImoocAdapter(BaseAdapter) {
  return class ImoocAdapter extends BaseAdapter {
    meta = {
      id: "imooc",
      name: "慕课手记",
      icon: "https://www.imooc.com/favicon.ico",
      homepage: "https://www.imooc.com/article",
      capabilities: ["article", "draft", "image_upload"],
    };

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://www.imooc.com/u/card",
          { credentials: "include" },
        );
        let text = await response.text();
        text = text.replace("jsonpcallback(", "").replace("})", "}");
        const result = JSON.parse(text);

        if (result.result !== 0) {
          return {
            isAuthenticated: false,
            error: result.msg || "未登录",
          };
        }

        return {
          isAuthenticated: true,
          userId: String(result.data.uid),
          username: result.data.nickname,
          avatar: result.data.img,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(url) {
      const imageResponse = await this.runtime.fetch(url);
      const blob = await imageResponse.blob();
      const filename = `${Date.now()}.jpg`;
      const mimeType = blob.type || "image/jpeg";

      const formData = new FormData();
      formData.append("photo", blob, filename);
      formData.append("type", mimeType);
      formData.append("id", "WU_FILE_0");
      formData.append("name", filename);
      formData.append("lastModifiedDate", new Date().toString());
      formData.append("size", String(blob.size));

      const response = await this.runtime.fetch(
        "https://www.imooc.com/article/ajaxuploadimg",
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );

      const res = await response.json();
      if (res.result !== 0) {
        throw new Error(res.msg || "图片上传失败");
      }

      let imgUrl = res.data.imgpath;
      if (typeof imgUrl === "string" && imgUrl.startsWith("//")) {
        imgUrl = `https:${imgUrl}`;
      }
      return { url: imgUrl };
    }

    async publish(article, options) {
      try {
        let content = article.markdown || article.html || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["imooc.com", "img.mukewang.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const response = await this.runtime.fetch(
          "https://www.imooc.com/article/savedraft",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              editor: "0",
              draft_id: "0",
              title: article.title,
              content,
            }),
          },
        );

        const res = await response.json();
        if (!res.data) throw new Error(res.msg || "发布失败");

        return this.createResult(true, {
          postId: String(res.data),
          postUrl: `https://www.imooc.com/article/draft/id/${res.data}`,
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
