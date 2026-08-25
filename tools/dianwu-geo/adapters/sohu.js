/**
 * 搜狐号 — 覆盖内置旧适配器（Wechatsync v2 sohu.ts）
 *
 * 旧版走 form draft，缺 dv-id / sp-cm，现网常返回「获取客户端失败」。
 * 新版：account/list + draft/v2 JSON + 设备头。
 */
import { getCookieValue } from "./_cookie.js";
import {
  processAndAssertImages,
} from "./_images.js";

function generateDeviceId() {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createSohuAdapter(BaseAdapter) {
  return class SohuAdapter extends BaseAdapter {
    meta = {
      id: "sohu",
      name: "搜狐号",
      icon: "https://mp.sohu.com/favicon.ico",
      homepage: "https://mp.sohu.com/mpfe/v3/main/first/page?newsType=1",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {{ id: string; nickName: string; avatar: string } | null} */
    accountInfo = null;

    deviceId = generateDeviceId();
    spCm = "";

    async fetchSpCm() {
      const cookieValue = await getCookieValue(
        this.runtime,
        [".sohu.com", "sohu.com", "mp.sohu.com"],
        "mp-cv",
      );
      if (cookieValue) {
        this.spCm = cookieValue;
        return;
      }
      this.spCm = `100-${Date.now()}-${generateDeviceId()}`;
    }

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          `https://mp.sohu.com/mpbp/bp/account/list?_=${Date.now()}`,
          {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );
        const res = await response.json();

        if (res.code !== 2000000 || !res.data?.data?.[0]?.accounts?.length) {
          // Fallback to older register-info (some sessions still work)
          return this.checkAuthLegacy();
        }

        /** @type {Array<{ id: string; nickName: string; avatar: string }>} */
        const allAccounts = [];
        for (const group of res.data.data) {
          if (group.accounts) allAccounts.push(...group.accounts);
        }
        if (!allAccounts.length) {
          return { isAuthenticated: false };
        }

        this.accountInfo = allAccounts[0];
        await this.fetchSpCm();

        const displayName =
          allAccounts.length > 1
            ? `${this.accountInfo.nickName} (共${allAccounts.length}个子账号)`
            : this.accountInfo.nickName;

        return {
          isAuthenticated: true,
          userId: String(this.accountInfo.id),
          username: displayName,
          avatar: this.accountInfo.avatar,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async checkAuthLegacy() {
      try {
        const response = await this.runtime.fetch(
          `https://mp.sohu.com/mpbp/bp/account/register-info?_=${Date.now()}`,
          { method: "GET", credentials: "include" },
        );
        const a = await response.json();
        if (a.code !== 2000000 || !a.data?.account) {
          return { isAuthenticated: false };
        }
        this.accountInfo = a.data.account;
        await this.fetchSpCm();
        return {
          isAuthenticated: true,
          userId: String(this.accountInfo.id),
          username: this.accountInfo.nickName,
          avatar: this.accountInfo.avatar,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      if (!this.accountInfo) throw new Error("未登录");

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const imageBlob = await imageResponse.blob();

      const formData = new FormData();
      formData.append("file", imageBlob, "image.jpg");
      formData.append("accountId", this.accountInfo.id);

      const uploadResponse = await this.runtime.fetch(
        `https://mp.sohu.com/commons/front/outerUpload/image/file?accountId=${this.accountInfo.id}`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      const res = await uploadResponse.json();
      if (!res.url) {
        throw new Error(`图片上传失败: ${res.msg || "未知错误"}`);
      }
      return { url: res.url };
    }

    async publish(article, options) {
      try {
        if (!this.accountInfo) {
          const auth = await this.checkAuth();
          if (!auth.isAuthenticated) throw new Error("请先登录搜狐号");
        }
        if (!this.spCm) await this.fetchSpCm();

        let content = article.html || article.markdown || "";
        if (typeof this.cleanHtml === "function") {
          content = this.cleanHtml(content, {
            removeIframes: true,
            removeSvgImages: true,
            removeAttrs: ["data-reader-unique-id"],
          });
        }

        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: ["sohu.com"],
            onProgress: options?.onImageProgress,
            platformName: "搜狐号",
          },
        );

        const postData = {
          title: article.title,
          brief: "",
          content,
          channelId: 24,
          categoryId: -1,
          id: 0,
          userColumnId: 0,
          columnNewsIds: [],
          businessCode: 0,
          declareOriginal: false,
          cover: "",
          topicIds: [],
          isAd: 0,
          userLabels: "[]",
          reprint: false,
          customTags: "",
          infoResource: 0,
          sourceUrl: "",
          visibleToLoginedUsers: 0,
          attrIds: [],
          auto: true,
          accountId: Number(this.accountInfo.id),
        };

        const response = await this.runtime.fetch(
          `https://mp.sohu.com/mpbp/bp/news/v4/news/draft/v2?accountId=${this.accountInfo.id}`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
              "dv-id": this.deviceId,
              "sp-cm": this.spCm,
            },
            body: JSON.stringify(postData),
          },
        );

        const text = await response.text();
        let res;
        try {
          res = JSON.parse(text);
        } catch {
          throw new Error(
            `保存失败: ${text.substring(0, 160) || response.status}`,
          );
        }

        if (!res.success) {
          throw new Error(res.msg || "保存失败");
        }

        const postId = res.data;
        return this.createResult(true, {
          postId: String(postId),
          postUrl: `https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?spm=smmp.articlelist.0.0&contentStatus=2&id=${postId}`,
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
