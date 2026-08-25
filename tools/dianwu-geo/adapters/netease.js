import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 网易号 — 新版 publishV2.do（旧 publish.do 会提示「旧版文章发布页已…」）
 *
 * ursToken 来自页面易盾 NEGuardian（neg.getToken），在已打开的 mp.163.com 标签页中取。
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
      homepage:
        "https://mp.163.com/subscribe_v3/index.html#/article-publish",
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

    async fetchTitleSign(title) {
      // Newer UI: spam check also returns sign
      try {
        const spam = await this.runtime.fetch(
          "https://mp.163.com/wemedia/check/title/spam.do",
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "Content-Type":
                "application/x-www-form-urlencoded; charset=utf-8",
            },
            body: new URLSearchParams({ title }).toString(),
          },
        );
        const spamData = await spam.json();
        if (spamData?.code === 1 && spamData?.data?.sign) {
          return {
            sign: spamData.data.sign,
            timestamp: spamData.data.timestamp,
          };
        }
      } catch {
        // fall through
      }

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

    waitTabComplete(tabId, timeoutMs = 20_000) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const onUpdated = (id, info) => {
          if (id !== tabId) return;
          if (info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (tab?.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        });
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(); // best-effort
        }, timeoutMs);
        void started;
      });
    }

    /**
     * YiDun token from page-world `neg.getToken()` on mp.163.com.
     */
    async getUrsToken() {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.scripting?.executeScript
      ) {
        return "";
      }

      let createdId = null;
      try {
        const tabs = await chrome.tabs.query({ url: ["*://mp.163.com/*"] });
        let tab =
          tabs.find((t) => /subscribe_v[34]|article-publish|mp\.163\.com/i.test(t.url || "")) ||
          tabs[0];

        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://mp.163.com/subscribe_v3/index.html#/article-publish",
            active: false,
          });
          createdId = tab.id;
          await this.waitTabComplete(tab.id);
          // YiDun + SPA boot
          await new Promise((r) => setTimeout(r, 1500));
        }

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async () => {
            try {
              if (typeof neg !== "undefined" && neg?.getToken) {
                return await neg.getToken();
              }
            } catch (e) {
              return {
                code: -1,
                token: "",
                error: e instanceof Error ? e.message : String(e),
              };
            }
            return { code: -1, token: "", error: "neg missing" };
          },
        });

        if (result?.token && (result.code === 200 || result.code === 201)) {
          return String(result.token);
        }
        return result?.token ? String(result.token) : "";
      } catch {
        return "";
      } finally {
        if (createdId != null) {
          chrome.tabs.remove(createdId).catch(() => undefined);
        }
      }
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
      const url = res?.data?.data?.url || res?.data?.url || res?.url;
      if ((res?.code === 200 || res?.code === 1) && url) {
        return { url };
      }

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

    parseDraftId(data) {
      if (data == null) return null;
      if (typeof data === "object") {
        return (
          data.docId ||
          data.articleId ||
          data.id ||
          data.docid ||
          null
        );
      }
      if (typeof data === "string") {
        if (/^\d+$/.test(data)) return data;
        try {
          const params = new URLSearchParams(
            data.startsWith("?") ? data : `?${data}`,
          );
          return params.get("docId") || params.get("articleId") || null;
        } catch {
          return null;
        }
      }
      return null;
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
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: ["126.net", "163.com"],
            onProgress: options?.onImageProgress,
            platformName: "网易号",
          },
        );

        const { sign, timestamp } = await this.fetchTitleSign(title);
        const ursToken = await this.getUrsToken();

        const body = new URLSearchParams({
          wemediaId: String(wemediaId),
          articleId: "-1",
          title,
          content,
          cover: "auto",
          picUrl: "",
          scheduled: "0",
          operation: "saveDraft",
          NECaptchaValidate: "",
          sign: String(sign),
          timestamp: String(timestamp ?? Date.now()),
        });
        if (ursToken) body.set("ursToken", ursToken);

        const response = await this.runtime.fetch(
          `https://mp.163.com/wemedia/article/status/api/publishV2.do?_=${Date.now()}`,
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

        const msg = String(res?.msg || res?.message || "");
        if (/旧版/.test(msg)) {
          throw new Error(
            "网易号旧版发布接口已停用。请重新加载扩展后重试（已切换 publishV2）",
          );
        }
        if (res?.code === 100502 || res?.code === 100503) {
          throw new Error(
            "网易号触发验证码，请在浏览器打开网易号后台完成验证后再试",
          );
        }
        if (res?.code !== 1) {
          const hint = !ursToken
            ? "（未取到易盾 ursToken，可先打开网易号后台再同步）"
            : "";
          throw new Error(
            `${msg || `保存草稿失败: code ${res?.code}`}${hint}`,
          );
        }

        const articleId = this.parseDraftId(res.data);
        const postId = articleId != null ? String(articleId) : "draft";
        const base =
          "https://mp.163.com/subscribe_v3/index.html#/article-publish";
        const postUrl = articleId ? `${base}/${articleId}` : base;

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
