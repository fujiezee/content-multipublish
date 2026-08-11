/**
 * 新浪看点 — mp.sina.com.cn（已与微博头条文章整合）
 * 能独立草稿则保存；若跳到微博长文编辑器则明确提示改用 weibo 平台。
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createSinakandianAdapter(BaseAdapter) {
  return class SinakandianAdapter extends BaseAdapter {
    meta = {
      id: "sinakandian",
      name: "新浪看点",
      icon: "https://www.sina.com.cn/favicon.ico",
      homepage: "https://mp.sina.com.cn/",
      capabilities: ["article", "draft"],
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
        "https://mp.sina.com.cn/aj/account/info",
        "https://mp.sina.com.cn/api/account/info",
        "https://mp.sina.com.cn/aj/v2/account/info",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "application/json",
              Referer: "https://mp.sina.com.cn/",
            },
          });
          const text = await response.text();
          const data = this.parseJsonSafe(text);
          if (!data) continue;
          const user = data.data || data.result || data.user || data;
          const userId = user?.uid || user?.userId || user?.id;
          const username =
            user?.nickname || user?.name || user?.screen_name || userId;
          if (
            userId ||
            data.code === 0 ||
            data.code === "0" ||
            data.result === true
          ) {
            return {
              userId: String(userId || "session"),
              username: String(username || "新浪看点"),
              avatar: user?.avatar || user?.profile_image_url || undefined,
            };
          }
        } catch {
          // next
        }
      }

      try {
        const response = await this.runtime.fetch("https://mp.sina.com.cn/", {
          credentials: "include",
          headers: { Accept: "text/html" },
          redirect: "follow",
        });
        const finalUrl = response.url || "";
        const html = await response.text();
        if (/weibo\.com|card\.weibo\.com/i.test(finalUrl)) {
          return {
            userId: "weibo-merge",
            username: "新浪看点→微博",
          };
        }
        if (/login|passport|登录/i.test(finalUrl)) {
          return null;
        }
        if (/看点|头条文章|创作|草稿/i.test(html)) {
          return { userId: "session", username: "新浪看点" };
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
            error:
              "未登录新浪看点。请打开 https://mp.sina.com.cn/ ；若已并入微博头条文章，请改用「微博」平台",
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

    async saveViaApi(title, content) {
      const payloads = [
        {
          url: "https://mp.sina.com.cn/aj/article/draft",
          body: { title, content, status: "draft" },
        },
        {
          url: "https://mp.sina.com.cn/aj/v2/article/save",
          body: { title, content, is_draft: 1 },
        },
        {
          url: "https://mp.sina.com.cn/api/article/save",
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
              Referer: "https://mp.sina.com.cn/",
              Origin: "https://mp.sina.com.cn",
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);
          const ok =
            res &&
            (res.code === 0 ||
              res.code === "0" ||
              res.result === true ||
              res.success === true ||
              res.data?.id);
          if (ok) {
            return {
              ok: true,
              postId: res.data?.id ? String(res.data.id) : undefined,
              postUrl: "https://mp.sina.com.cn/",
            };
          }
        } catch {
          // next
        }
      }
      return { ok: false, error: "看点草稿接口不可用" };
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
        const tab = await chrome.tabs.create({
          url: "https://mp.sina.com.cn/",
          active: true,
        });
        await this.waitTabComplete(tab.id);
        await new Promise((r) => setTimeout(r, 2500));

        const [{ result: loc } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => location.href,
        });

        if (/weibo\.com|card\.weibo\.com/i.test(loc || "")) {
          return {
            ok: false,
            error:
              "新浪看点已并入微博「头条文章」。请改用「微博」平台同步本篇，或在此窗口用微博编辑器手动完成",
            weiboMerge: true,
            postUrl: loc,
          };
        }

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const { title: t, content: c } = payload;

            if (/login|passport/i.test(location.href + document.title)) {
              return { ok: false, error: "请先登录新浪看点/微博" };
            }

            // try enter create
            const nodes = Array.from(
              document.querySelectorAll("a, button, span"),
            );
            const createBtn = nodes.find((n) =>
              /写文章|发文章|创作|新建/.test((n.textContent || "").trim()),
            );
            if (createBtn) {
              createBtn.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true }),
              );
              await sleep(2000);
            }

            if (/weibo\.com|card\.weibo\.com/i.test(location.href)) {
              return {
                ok: false,
                weiboMerge: true,
                error:
                  "新浪看点已并入微博「头条文章」。请改用「微博」平台同步",
                postUrl: location.href,
              };
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
                error:
                  "未找到看点编辑器。若后台已引导至微博头条文章，请改用「微博」平台",
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
              /存草稿|保存草稿|暂存|保存/.test((b.textContent || "").trim()),
            );
            if (draftBtn) {
              draftBtn.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true }),
              );
              await sleep(1500);
              return {
                ok: true,
                postUrl: location.href,
                message: "已点击保存/存草稿",
              };
            }
            return {
              ok: true,
              postUrl: location.href,
              message: "已填入编辑器，请手动保存",
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

    async uploadImageByUrl(src) {
      return { url: src };
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录新浪看点");
        }

        if (this.account?.userId === "weibo-merge") {
          return this.createResult(false, {
            error:
              "新浪看点已并入微博「头条文章」。请改用「微博」平台同步本篇",
          });
        }

        const title = String(article.title || "").trim().slice(0, 64);
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["sina.com.cn", "sinaimg.cn", "weibo.com"],
            onProgress: options?.onImageProgress,
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
        if (dom.weiboMerge) {
          return this.createResult(false, {
            error:
              dom.error ||
              "新浪看点已并入微博「头条文章」。请改用「微博」平台同步本篇",
          });
        }
        if (dom.ok) {
          return this.createResult(true, {
            postUrl: dom.postUrl || "https://mp.sina.com.cn/",
            draftOnly: options?.draftOnly ?? true,
            message: dom.message || api.error,
          });
        }

        throw new Error(
          dom.error ||
            api.error ||
            "新浪看点同步失败；若后台已并入微博，请改用「微博」平台",
        );
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
