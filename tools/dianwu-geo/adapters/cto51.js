import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 51CTO — Wechatsync v2 cto51.ts 移植
 * meta.id 使用产品侧 PlatformId `cto51`（上游为 `51cto`）
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createCto51Adapter(BaseAdapter) {
  return class Cto51Adapter extends BaseAdapter {
    meta = {
      id: "cto51",
      name: "51CTO",
      icon: "https://blog.51cto.com/favicon.ico",
      homepage: "https://blog.51cto.com/blogger/publish",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | null} */
    csrf = null;

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://blog.51cto.com/blogger/publish",
          { credentials: "include" },
        );
        const html = await response.text();

        const imgMatch = html.match(
          /<a[^>]*href="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"/,
        );
        if (!imgMatch) {
          return { isAuthenticated: false, error: "未登录" };
        }

        const userLink = imgMatch[1];
        const avatar = imgMatch[2];
        const uid = userLink.split("/").filter(Boolean).pop() || "";

        const csrfMatch = html.match(
          /<meta\s+name="csrf-token"\s+content="([^"]+)"/,
        );
        if (csrfMatch) this.csrf = csrfMatch[1];

        return {
          isAuthenticated: true,
          userId: uid,
          username: uid,
          avatar,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async getUploadSign() {
      const response = await this.runtime.fetch(
        "https://blog.51cto.com/getUploadSign",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: "upload_type=image",
        },
      );
      const res = await response.json();
      if (res.code !== 0) throw new Error(res.msg || "获取上传签名失败");
      return res.data;
    }

    async getUploadConfig(uploadSign, ext, filename) {
      const response = await this.runtime.fetch(
        "https://blog.51cto.com/getUploadConfig",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams({
            upload_type: "image",
            upload_sign: uploadSign,
            ext,
            name: filename,
          }).toString(),
        },
      );
      const res = await response.json();
      if (res.code !== 0) throw new Error(res.msg || "获取上传配置失败");
      return res.data;
    }

    async uploadToCOS(cosUrl, fields, blob, mimeType) {
      const formData = new FormData();
      formData.append("key", fields.key);
      formData.append("policy", fields.policy);
      formData.append("x-amz-algorithm", fields["x-amz-algorithm"]);
      formData.append("x-amz-signature", fields["x-amz-signature"]);
      formData.append("x-amz-credential", fields["x-amz-credential"]);
      formData.append("X-Amz-Date", fields["X-Amz-Date"]);
      formData.append("Content-Type", mimeType);
      formData.append("file", blob, `image.${mimeType.split("/")[1] || "jpg"}`);

      const response = await this.runtime.fetch(cosUrl, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(`上传到 COS 失败: ${response.status}`);
      }
      return `https://s2.51cto.com/${fields.key}`;
    }

    async uploadImageByUrl(url) {
      const imageResponse = await this.runtime.fetch(url);
      const blob = await imageResponse.blob();
      const mimeType = blob.type || "image/jpeg";
      const ext = mimeType.split("/")[1] || "jpeg";
      const filename = `${Date.now()}.${ext}`;

      const signData = await this.getUploadSign();
      const configData = await this.getUploadConfig(
        signData.sign,
        mimeType,
        filename,
      );
      const imageUrl = await this.uploadToCOS(
        configData.url,
        configData.fields,
        blob,
        mimeType,
      );
      return { url: imageUrl };
    }

    async publish(article, options) {
      try {
        if (!this.csrf) {
          const auth = await this.checkAuth();
          if (!auth.isAuthenticated) throw new Error("未登录");
        }

        const hasMarkdown = !!article.markdown;
        let content = article.markdown || article.html || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: ["51cto.com", "s2.51cto.com"],
            onProgress: options?.onImageProgress,
            platformName: "51CTO",
          },
        );

        const postData = {
          title: article.title,
          content,
          pid: "",
          cate_id: "",
          custom_id: "0",
          tag: "",
          abstract: "",
          banner_type: "0",
          blog_type: "1",
          copy_code: "1",
          is_hide: "0",
          top_time: "0",
          is_comment: "0",
          is_old: hasMarkdown ? "0" : "2",
          blog_id: "",
          did: "",
          work_id: "",
          class_id: "",
          subjectId: "",
          import_type: "-1",
          invite_code: "",
          raffle: "",
          orig: "",
          _csrf: this.csrf || "",
        };

        const response = await this.runtime.fetch(
          "https://blog.51cto.com/blogger/draft",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Accept: "application/json, text/javascript, */*; q=0.01",
            },
            body: new URLSearchParams(postData).toString(),
          },
        );

        const res = await response.json();
        if (res.status !== 1 || !res.data) {
          throw new Error(res.msg || "发布失败");
        }

        return this.createResult(true, {
          postId: String(res.data.did),
          postUrl: `https://blog.51cto.com/blogger/draft/${res.data.did}`,
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
