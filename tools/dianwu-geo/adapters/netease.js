/**
 * 网易号 — 基于 mp.163.com SPA（navinfo + checkTitle + publish.do saveDraft）
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createNeteaseAdapter(BaseAdapter) {
  return class NeteaseAdapter extends BaseAdapter {
    meta = {
      id: "netease",
      name: "网易号",
      icon: "https://mp.163.com/favicon.ico",
      homepage: "https://mp.163.com/#/article/publish",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | number | null} */
    wemediaId = null;

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          `https://mp.163.com/wemedia/navinfo.do?_=${Date.now()}`,
          {
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
            },
          },
        );
        const data = await response.json();
        if (data?.code !== 1 || !data?.data?.wemediaId) {
          return { isAuthenticated: false, error: "未登录" };
        }
        this.wemediaId = data.data.wemediaId;
        return {
          isAuthenticated: true,
          userId: String(data.data.wemediaId),
          username: data.data.tname || String(data.data.wemediaId),
          avatar: data.data.icon,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async ensureWemediaId() {
      if (this.wemediaId != null) return this.wemediaId;
      const auth = await this.checkAuth();
      if (!auth.isAuthenticated) throw new Error("未登录网易号");
      return this.wemediaId;
    }

    /** SPA double-encodes the title query param. */
    async fetchTitleSign(title) {
      const encoded = encodeURIComponent(encodeURIComponent(title));
      const response = await this.runtime.fetch(
        `https://mp.163.com/wemedia/article/checkTitle?title=${encoded}`,
        {
          credentials: "include",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
          },
        },
      );
      const data = await response.json();
      if (data?.code !== 1 || !data?.data?.sign) {
        throw new Error(data?.msg || data?.message || "标题校验失败");
      }
      return {
        sign: data.data.sign,
        timestamp: data.data.timestamp,
      };
    }

    async uploadImageByUrl(src) {
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const ext = (blob.type || "image/jpeg").split("/")[1] || "jpg";
      const filename = `${Date.now()}.${ext}`;

      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("from", "neteasecode_mp");

      const response = await this.runtime.fetch(
        "https://mp.163.com/api/v3/upload/picupload",
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      const res = await response.json();
      // SPA axios shape may nest: data.data.url or data.url
      const url =
        res?.data?.data?.url ||
        res?.data?.url ||
        res?.url;
      if ((res?.code === 200 || res?.code === 1) && url) {
        return { url };
      }

      // Legacy fallback
      const wemediaId = await this.ensureWemediaId();
      const legacy = await this.runtime.fetch(
        `https://upload.ws.126.net/picupload?_=${Date.now()}&wemediaId=${wemediaId}`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      const legacyRes = await legacy.json();
      const legacyUrl = legacyRes?.data?.url || legacyRes?.url;
      if (legacyUrl) return { url: legacyUrl };
      throw new Error(res?.msg || res?.message || "网易号图片上传失败");
    }

    async publish(article, options) {
      try {
        const wemediaId = await this.ensureWemediaId();
        let title = String(article.title || "").trim();
        if (title.length < 5) {
          throw new Error("网易号标题至少 5 个字");
        }
        title = title.slice(0, 64);

        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["126.net", "163.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const { sign, timestamp } = await this.fetchTitleSign(title);
        const body = new URLSearchParams({
          wemediaId: String(wemediaId),
          articleId: "-1",
          title,
          content,
          userClassify: "",
          cover: "auto",
          picUrl: "",
          scheduled: "0",
          operation: "saveDraft",
          NECaptchaValidate: "",
          sign: String(sign),
          timestamp: String(timestamp ?? Date.now()),
        });

        const response = await this.runtime.fetch(
          "https://mp.163.com/wemedia/article/status/api/publish.do",
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "Content-Type":
                "application/x-www-form-urlencoded; charset=utf-8",
            },
            body: body.toString(),
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

        if (res?.code === 100502 || res?.code === 100503) {
          throw new Error("网易号触发验证码，请在浏览器打开网易号后台完成验证后再试");
        }
        if (res?.code !== 1) {
          throw new Error(res?.msg || res?.message || `保存草稿失败: code ${res?.code}`);
        }

        const articleId =
          res?.data?.articleId ||
          res?.data?.id ||
          res?.data?.docId ||
          res?.articleId;
        const postId = articleId != null ? String(articleId) : "draft";
        const postUrl = articleId
          ? `https://mp.163.com/#/edit/article/${articleId}`
          : `https://mp.163.com/#/article/manage?wemediaId=${wemediaId}`;

        return this.createResult(true, {
          postId,
          postUrl,
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
