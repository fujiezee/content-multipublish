/**
 * 思否 (SegmentFault) — 点物GEO 扩展额外平台适配器示例
 *
 * 上游参考: wechatsync/Wechatsync v2
 * packages/core/src/adapters/platforms/segmentfault.ts
 *
 * 新增平台步骤:
 * 1. 在本目录添加 <platform>.js，导出 createXxxAdapter(BaseAdapter)
 * 2. 在 register-extra-adapters.js 里 register 一次
 * 3. 若平台 API 有 CORS/Origin 限制，在 rules/<platform>.json + manifest.json 加 DNR 规则
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createSegmentfaultAdapter(BaseAdapter) {
  return class SegmentfaultAdapter extends BaseAdapter {
    meta = {
      id: "segmentfault",
      name: "思否",
      icon: "https://imgcache.iyiou.com/Company/2016-05-11/cf-segmentfault.jpg",
      homepage: "https://segmentfault.com/user/draft",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {string | null} */
    sessionToken = null;

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://segmentfault.com/user/settings",
          { credentials: "include" },
        );
        const html = await response.text();
        const userLinkMatch = html.match(/href="\/u\/([^"]+)"/);
        if (!userLinkMatch) {
          return { isAuthenticated: false, error: "未登录" };
        }
        const uid = userLinkMatch[1];
        const avatarMatch = html.match(
          /src="(https:\/\/avatar-static\.segmentfault\.com\/[^"]+)"/,
        );
        return {
          isAuthenticated: true,
          userId: uid,
          username: uid,
          avatar: avatarMatch ? avatarMatch[1] : undefined,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async getSessionToken() {
      const response = await this.runtime.fetch(
        "https://segmentfault.com/write",
        { credentials: "include" },
      );
      const html = await response.text();

      const tokenMatch = html.match(
        /serverData":\s*\{\s*"Token"\s*:\s*"([^"]+)"/,
      );
      if (tokenMatch) return tokenMatch[1];

      const markStr = "window.g_initialProps = ";
      const authIndex = html.indexOf(markStr);
      if (authIndex === -1) {
        throw new Error("获取 session token 失败");
      }
      const endIndex = html.indexOf(";\n\t</script>", authIndex);
      if (endIndex === -1) {
        throw new Error("解析 session token 失败");
      }
      const configStr = html.substring(authIndex + markStr.length, endIndex);
      const config = JSON.parse(configStr);
      const token = config?.global?.sessionInfo?.key;
      if (!token) throw new Error("session token 为空");
      return token;
    }

    async uploadImageByUrl(url) {
      if (!this.sessionToken) {
        throw new Error("未获取 token");
      }

      const imageResponse = await this.runtime.fetch(url);
      const blob = await imageResponse.blob();
      const formData = new FormData();
      formData.append("image", blob);

      const response = await this.runtime.fetch(
        "https://segmentfault.com/gateway/image",
        {
          method: "POST",
          credentials: "include",
          headers: { token: this.sessionToken },
          body: formData,
        },
      );

      const text = await response.text();
      if (
        text === "Unauthorized" ||
        text.includes("禁言") ||
        text.includes("锁定")
      ) {
        throw new Error(text === "Unauthorized" ? "未授权" : text);
      }

      let res;
      try {
        res = JSON.parse(text);
      } catch {
        throw new Error(`图片上传失败: ${text}`);
      }

      const imageUrl =
        res.result ||
        (Array.isArray(res)
          ? res[0] === 1
            ? null
            : res[1] || `https://image-static.segmentfault.com/${res[2]}`
          : null);
      if (!imageUrl) {
        throw new Error(
          Array.isArray(res) ? res[1] || "图片上传失败" : "图片上传失败",
        );
      }
      return { url: imageUrl };
    }

    async publish(article, options) {
      try {
        this.sessionToken = await this.getSessionToken();

        let content = article.markdown || article.html || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["segmentfault.com", "image-static.segmentfault.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const response = await this.runtime.fetch(
          "https://segmentfault.com/gateway/draft",
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              token: this.sessionToken,
              accept: "*/*",
            },
            body: JSON.stringify({
              title: article.title,
              tags: [],
              text: content,
              object_id: "",
              type: "article",
            }),
          },
        );

        const text = await response.text();
        if (
          text === "Unauthorized" ||
          text.includes("禁言") ||
          text.includes("锁定")
        ) {
          throw new Error(text === "Unauthorized" ? "未授权" : text);
        }

        let res;
        try {
          res = JSON.parse(text);
        } catch {
          throw new Error(`发布失败: ${text}`);
        }

        if (Array.isArray(res)) {
          if (res[0] === 1) {
            throw new Error(res[1] || "发布失败");
          }
          const data = res[1];
          if (data?.id) {
            return this.createResult(true, {
              postId: data.id,
              postUrl: `https://segmentfault.com/write?draftId=${data.id}`,
              draftOnly: options?.draftOnly ?? true,
            });
          }
        }

        if (!res.id) {
          const errorMsg =
            res.message || res.msg || res.error || res.errMsg || JSON.stringify(res);
          throw new Error(errorMsg);
        }

        return this.createResult(true, {
          postId: res.id,
          postUrl: `https://segmentfault.com/write?draftId=${res.id}`,
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
