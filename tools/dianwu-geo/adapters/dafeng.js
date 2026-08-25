import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 大风号（原凤凰号）— mp.ifeng.com
 * 优先试常见草稿 JSON；失败则打开创作页 DOM 填入并点「存草稿」。
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createDafengAdapter(BaseAdapter) {
  return class DafengAdapter extends BaseAdapter {
    meta = {
      id: "dafeng",
      name: "大风号",
      icon: "https://www.ifeng.com/favicon.ico",
      homepage: "https://mp.ifeng.com/manage/originalArticle",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {{ userId: string; username: string; avatar?: string } | null} */
    account = null;

    parseJsonSafe(text) {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    isLoginUrl(url = "") {
      return /\/login|passport|sso|auth/i.test(url);
    }

    waitTabComplete(tabId, timeoutMs = 25_000) {
      return new Promise((resolve) => {
        const onUpdated = (id, info) => {
          if (id !== tabId) return;
          if (info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
          if (tab?.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        });
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }, timeoutMs);
      });
    }

    async probeAuth() {
      const urls = [
        "https://mp.ifeng.com/api/user/info",
        "https://mp.ifeng.com/api/account/info",
        "https://mp.ifeng.com/api/v1/user/info",
        "https://mp.ifeng.com/cmpp/user/info",
        "https://mp.ifeng.com/manage/api/user/info",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "application/json",
              Referer: "https://mp.ifeng.com/manage/originalArticle",
            },
          });
          const finalUrl = response.url || url;
          if (this.isLoginUrl(finalUrl)) continue;
          const text = await response.text();
          if (/登录|请登录|passport/i.test(text.slice(0, 200)) && !/"uid"|"userId"/i.test(text)) {
            continue;
          }
          const data = this.parseJsonSafe(text);
          const user =
            data?.data?.user ||
            data?.data?.account ||
            data?.data ||
            data?.user ||
            data?.result;
          const userId =
            user?.uid ||
            user?.userId ||
            user?.id ||
            user?.wmid ||
            data?.data?.uid;
          const username =
            user?.nickname ||
            user?.name ||
            user?.mediaName ||
            user?.username ||
            userId;
          if (userId || (response.ok && data && !data.code && !data.errno)) {
            return {
              userId: String(userId || "session"),
              username: String(username || "大风号"),
              avatar: user?.avatar || user?.headImg || undefined,
            };
          }
          if (
            response.ok &&
            data &&
            (data.code === 0 ||
              data.code === 200 ||
              data.errno === 0 ||
              data.success === true)
          ) {
            return {
              userId: String(userId || "session"),
              username: String(username || "大风号"),
              avatar: user?.avatar || undefined,
            };
          }
        } catch {
          // next
        }
      }

      // HTML shell probe
      try {
        const response = await this.runtime.fetch(
          "https://mp.ifeng.com/manage/originalArticle",
          {
            credentials: "include",
            headers: { Accept: "text/html" },
            redirect: "follow",
          },
        );
        const finalUrl = response.url || "";
        const html = await response.text();
        if (this.isLoginUrl(finalUrl) || /登录大风号|扫码登录/i.test(html.slice(0, 800))) {
          return null;
        }
        if (/manage|originalArticle|创作|草稿/i.test(html)) {
          return { userId: "session", username: "大风号" };
        }
      } catch {
        // ignore
      }
      return null;
    }

    async checkAuth() {
      try {
        const account = await this.probeAuth();
        if (!account) {
          return { isAuthenticated: false, error: "未登录大风号" };
        }
        this.account = account;
        return {
          isAuthenticated: true,
          userId: account.userId,
          username: account.username,
          avatar: account.avatar,
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
      if (!imageResponse.ok) {
        throw new Error(`图片下载失败(${imageResponse.status}): ${src}`);
      }
      const blob = await imageResponse.blob();
      const formData = new FormData();
      formData.append("file", blob, `${Date.now()}.jpg`);
      formData.append("upload", blob, `${Date.now()}.jpg`);

      const uploadUrls = [
        "https://mp.ifeng.com/api/upload/image",
        "https://mp.ifeng.com/api/v1/upload/image",
        "https://mp.ifeng.com/cmpp/upload/image",
      ];
      let lastError = "未返回平台图床地址";
      for (const url of uploadUrls) {
        try {
          const response = await this.runtime.fetch(url, {
            method: "POST",
            credentials: "include",
            headers: { Referer: "https://mp.ifeng.com/manage/originalArticle" },
            body: formData,
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);
          const out =
            res?.data?.url ||
            res?.url ||
            res?.data?.src ||
            res?.result?.url;
          if (out) return { url: out };
          lastError =
            (res?.msg || res?.message || text || "").slice(0, 120) || lastError;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      throw new Error(`大风号图片上传失败: ${lastError}`);
    }

    async saveViaApi(title, content) {
      const payloads = [
        {
          url: "https://mp.ifeng.com/api/article/draft/save",
          body: { title, content, status: "draft" },
        },
        {
          url: "https://mp.ifeng.com/api/v1/article/save",
          body: { title, content, type: "draft", status: 0 },
        },
        {
          url: "https://mp.ifeng.com/api/article/save",
          body: { title, content, draft: 1 },
        },
      ];

      for (const { url, body } of payloads) {
        try {
          const response = await this.runtime.fetch(url, {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Referer: "https://mp.ifeng.com/manage/originalArticle",
              Origin: "https://mp.ifeng.com",
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);
          const ok =
            res &&
            (res.code === 0 ||
              res.code === 200 ||
              res.errno === 0 ||
              res.success === true ||
              res.data?.id ||
              res.data?.articleId);
          if (ok) {
            const id =
              res.data?.id ||
              res.data?.articleId ||
              res.data?.aid ||
              res.result?.id;
            return {
              ok: true,
              postId: id ? String(id) : undefined,
              postUrl: "https://mp.ifeng.com/manage/originalArticle",
            };
          }
        } catch {
          // next
        }
      }
      return { ok: false, error: "草稿接口不可用" };
    }

    async saveViaDom(title, content) {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.create ||
        !chrome.scripting?.executeScript
      ) {
        return { ok: false, error: "无 tabs/scripting 权限" };
      }

      try {
        const tabs = await chrome.tabs.query({
          url: ["*://mp.ifeng.com/*"],
        });
        let tab =
          tabs.find((t) => /originalArticle|editor|write|create/i.test(t.url || "")) ||
          null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://mp.ifeng.com/manage/originalArticle",
            active: true,
          });
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 2500));
        } else {
          await chrome.tabs
            .update(tab.id, { active: true })
            .catch(() => undefined);
          await new Promise((r) => setTimeout(r, 600));
        }

        for (let i = 0; i < 8; i++) {
          const [{ result: ready } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () =>
              Boolean(
                document.querySelector(
                  'textarea[placeholder*="标题"], input[placeholder*="标题"], .ql-editor, .ProseMirror, [contenteditable="true"]',
                ),
              ),
          });
          if (ready) break;
          await new Promise((r) => setTimeout(r, 1500));
        }

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const { title: t, content: c } = payload;
            if (/login|passport/i.test(location.href + document.title)) {
              return { ok: false, error: "创作页跳到登录，请先登录大风号" };
            }

            const titleEl =
              document.querySelector('textarea[placeholder*="标题"]') ||
              document.querySelector('input[placeholder*="标题"]') ||
              document.querySelector('[contenteditable="true"][data-placeholder*="标题"]');
            if (titleEl) {
              titleEl.focus();
              if ("value" in titleEl) {
                titleEl.value = t;
              } else {
                titleEl.textContent = t;
              }
              titleEl.dispatchEvent(new Event("input", { bubbles: true }));
            }

            const editor =
              document.querySelector(".ql-editor") ||
              document.querySelector(".ProseMirror") ||
              document.querySelector('div[contenteditable="true"]');
            if (!editor) {
              return { ok: false, error: "未找到大风号编辑器" };
            }
            editor.focus();
            editor.innerHTML = c;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(800);

            const buttons = Array.from(
              document.querySelectorAll("button, a, span, div"),
            );
            const draftBtn = buttons.find((b) =>
              /存草稿|保存草稿|暂存/.test((b.textContent || "").trim()),
            );
            if (!draftBtn) {
              return {
                ok: true,
                postUrl: location.href,
                message: "已填入编辑器，请手动点「存草稿」",
              };
            }
            draftBtn.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true }),
            );
            await sleep(1500);
            return {
              ok: true,
              postUrl: location.href,
              message: "已点击存草稿",
            };
          },
          args: [{ title, content }],
        });

        return result || { ok: false, error: "DOM 同步无结果" };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录大风号");
        }

        const title = String(article.title || "").trim().slice(0, 64);
        let content = article.html || article.markdown || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: ["ifeng.com", "ifengimg.com"],
            onProgress: options?.onImageProgress,
            platformName: "大风号",
          },
        );

        const api = await this.saveViaApi(title, content);
        if (api.ok) {
          return this.createResult(true, {
            postId: api.postId,
            postUrl: api.postUrl,
            draftOnly: options?.draftOnly ?? true,
          });
        }

        const dom = await this.saveViaDom(title, content);
        if (dom.ok) {
          return this.createResult(true, {
            postUrl: dom.postUrl || "https://mp.ifeng.com/manage/originalArticle",
            draftOnly: options?.draftOnly ?? true,
            message: dom.message || api.error,
          });
        }

        throw new Error(dom.error || api.error || "大风号保存草稿失败");
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
