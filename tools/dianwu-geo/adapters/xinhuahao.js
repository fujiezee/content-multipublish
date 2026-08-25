import {
  processAndAssertImages,
  createHostOnlyUpload,
} from "./_images.js";
/**
 * 新华号 — xhh.app.xinhuanet.com
 * 探测草稿 JSON；失败则打开后台 DOM 填入并点「存草稿」。
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createXinhuahaoAdapter(BaseAdapter) {
  return class XinhuahaoAdapter extends BaseAdapter {
    meta = {
      id: "xinhuahao",
      name: "新华号",
      icon: "https://www.xinhuanet.com/favicon.ico",
      homepage: "https://xhh.app.xinhuanet.com/",
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
        "https://xhh.app.xinhuanet.com/api/user/info",
        "https://xhh.app.xinhuanet.com/api/account/info",
        "https://xhh.app.xinhuanet.com/mp/user/info",
        "https://mp.tt.cn/api/user/info",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "application/json",
              Referer: "https://xhh.app.xinhuanet.com/",
            },
          });
          const text = await response.text();
          const data = this.parseJsonSafe(text);
          if (!data) continue;
          const user = data.data?.user || data.data || data.user || data.result;
          const userId = user?.uid || user?.userId || user?.id || user?.mediaId;
          const username =
            user?.nickname || user?.name || user?.mediaName || userId;
          if (
            userId ||
            data.code === 0 ||
            data.code === 200 ||
            data.errno === 0 ||
            data.success === true
          ) {
            return {
              userId: String(userId || "session"),
              username: String(username || "新华号"),
              avatar: user?.avatar || user?.headImg || undefined,
            };
          }
        } catch {
          // next
        }
      }

      try {
        const response = await this.runtime.fetch("https://xhh.app.xinhuanet.com/", {
          credentials: "include",
          headers: { Accept: "text/html" },
          redirect: "follow",
        });
        const finalUrl = response.url || "";
        const html = await response.text();
        if (/\/login|passport|扫码登录|请登录/i.test(finalUrl + html.slice(0, 1200))) {
          return null;
        }
        if (/新华号|写文章|创作|草稿|文章管理/i.test(html)) {
          return { userId: "session", username: "新华号" };
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
          return {
            isAuthenticated: false,
            error: "未登录新华号。请打开 https://xhh.app.xinhuanet.com/ 登录（多为邀约入驻）",
          };
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
      return createHostOnlyUpload(["xinhuanet.com"], "新华号")(src);
    }

    async saveViaApi(title, content) {
      const payloads = [
        {
          url: "https://xhh.app.xinhuanet.com/api/article/draft",
          body: { title, content, status: "draft" },
        },
        {
          url: "https://xhh.app.xinhuanet.com/api/article/save",
          body: { title, content, draft: 1 },
        },
        {
          url: "https://xhh.app.xinhuanet.com/mp/article/save",
          body: { title, content, is_draft: 1 },
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
              Referer: "https://xhh.app.xinhuanet.com/",
              Origin: "https://xhh.app.xinhuanet.com",
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
              res.data?.id);
          if (ok) {
            return {
              ok: true,
              postId: res.data?.id ? String(res.data.id) : undefined,
              postUrl: "https://xhh.app.xinhuanet.com/",
            };
          }
        } catch {
          // next
        }
      }
      return { ok: false, error: "新华号草稿接口不可用" };
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
          url: ["*://xhh.app.xinhuanet.com/*", "*://*.xinhuanet.com/*"],
        });
        let tab =
          tabs.find((t) => /write|editor|article|create/i.test(t.url || "")) ||
          tabs[0] ||
          null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://xhh.app.xinhuanet.com/",
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

        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
              const nodes = Array.from(
                document.querySelectorAll("a, button, span, div"),
              );
              const hit = nodes.find((n) =>
                /写文章|发文章|新建文章|创作/.test((n.textContent || "").trim()),
              );
              if (hit) {
                hit.dispatchEvent(
                  new MouseEvent("click", { bubbles: true, cancelable: true }),
                );
              }
            },
          })
          .catch(() => undefined);
        await new Promise((r) => setTimeout(r, 2000));

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const { title: t, content: c } = payload;
            if (/login|passport|auth/i.test(location.href + document.title)) {
              return { ok: false, error: "请先登录新华号" };
            }

            const titleEl =
              document.querySelector('textarea[placeholder*="标题"]') ||
              document.querySelector('input[placeholder*="标题"]');
            if (titleEl) {
              titleEl.focus();
              if ("value" in titleEl) titleEl.value = t;
              else titleEl.textContent = t;
              titleEl.dispatchEvent(new Event("input", { bubbles: true }));
            }

            const editor =
              document.querySelector(".ql-editor") ||
              document.querySelector(".ProseMirror") ||
              document.querySelector('div[contenteditable="true"]');
            if (!editor) {
              return {
                ok: false,
                error: "未找到新华号编辑器，请手动点「写文章」后重试",
              };
            }
            editor.focus();
            editor.innerHTML = c;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(800);

            const buttons = Array.from(
              document.querySelectorAll("button, a, span"),
            );
            const draftBtn = buttons.find((b) =>
              /存草稿|保存草稿|暂存/.test((b.textContent || "").trim()),
            );
            if (draftBtn) {
              draftBtn.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true }),
              );
              await sleep(1500);
              return {
                ok: true,
                postUrl: location.href,
                message: "已点击存草稿",
              };
            }
            return {
              ok: true,
              postUrl: location.href,
              message: "已填入编辑器，请手动点「存草稿」或「发布」",
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
          throw new Error(auth.error || "未登录新华号");
        }

        const title = String(article.title || "").trim().slice(0, 64);
        let content = article.html || article.markdown || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["xinhuanet.com"],
            onProgress: options?.onImageProgress,
            platformName: "新华号",
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
            postUrl: dom.postUrl || "https://xhh.app.xinhuanet.com/",
            draftOnly: options?.draftOnly ?? true,
            message: dom.message || api.error,
          });
        }

        throw new Error(dom.error || api.error || "新华号保存草稿失败");
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
