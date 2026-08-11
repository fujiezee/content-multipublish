/**
 * 360快传号 — kuaichuan.360kuai.com
 *
 * 1) 浏览器 Cookie 会话：探测创作者接口 + DOM 填编辑器
 * 2) 可选开放平台 Token（chrome.storage.local.kuaichuanOpenToken 或 kuaicToken）：
 *    POST https://api.kuaichuan.360kuai.com/openClaw/article
 *    Authorization: Basic <token>（与官方 @qihoo/kuaic CLI 一致）
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createKuaichuanAdapter(BaseAdapter) {
  return class KuaichuanAdapter extends BaseAdapter {
    meta = {
      id: "kuaichuan",
      name: "360快传号",
      icon: "https://kuaichuan.360kuai.com/favicon.ico",
      homepage: "https://kuaichuan.360kuai.com/",
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

    async getOpenToken() {
      try {
        const data = await chrome.storage.local.get([
          "kuaichuanOpenToken",
          "kuaicToken",
        ]);
        return data?.kuaichuanOpenToken || data?.kuaicToken || "";
      } catch {
        return "";
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

    async probeSessionAuth() {
      const urls = [
        "https://kuaichuan.360kuai.com/api/user/info",
        "https://kuaichuan.360kuai.com/api/v1/user/info",
        "https://api.kuaichuan.360kuai.com/user/info",
        "https://kuaichuan.360kuai.com/mp/user/info",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "application/json",
              Referer: "https://kuaichuan.360kuai.com/",
            },
          });
          const text = await response.text();
          const data = this.parseJsonSafe(text);
          if (!data) continue;
          if (
            data.errno !== undefined &&
            data.errno !== 0 &&
            data.errno !== "0"
          ) {
            continue;
          }
          const user = data.data?.user || data.data || data.user || data.result;
          const userId = user?.uid || user?.userId || user?.id || user?.qid;
          const username =
            user?.nickname || user?.name || user?.username || userId;
          if (userId || data.errno === 0) {
            return {
              userId: String(userId || "session"),
              username: String(username || "360快传号"),
              avatar: user?.avatar || user?.head || undefined,
            };
          }
        } catch {
          // next
        }
      }

      try {
        const response = await this.runtime.fetch(
          "https://kuaichuan.360kuai.com/",
          {
            credentials: "include",
            headers: { Accept: "text/html" },
            redirect: "follow",
          },
        );
        const finalUrl = response.url || "";
        const html = await response.text();
        if (/\/login|passport|扫码登录|请登录/i.test(finalUrl + html.slice(0, 1200))) {
          return null;
        }
        if (/快传|创作|发布|草稿/i.test(html)) {
          return { userId: "session", username: "360快传号" };
        }
      } catch {
        // ignore
      }
      return null;
    }

    async checkAuth() {
      try {
        const token = await this.getOpenToken();
        if (token) {
          this.account = {
            userId: "open-token",
            username: "360快传号(开放平台)",
          };
          return {
            isAuthenticated: true,
            userId: "open-token",
            username: "360快传号(开放平台)",
          };
        }

        const account = await this.probeSessionAuth();
        if (!account) {
          return {
            isAuthenticated: false,
            error:
              "未登录快传号。请打开 https://kuaichuan.360kuai.com/ 登录，或在扩展存储写入 kuaichuanOpenToken（开放平台 Key）",
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

    async publishViaOpenApi(title, content) {
      const token = await this.getOpenToken();
      if (!token) return { ok: false, error: "无开放平台 Token" };

      const response = await this.runtime.fetch(
        "https://api.kuaichuan.360kuai.com/openClaw/article",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Basic ${token}`,
          },
          body: JSON.stringify({ title, content }),
        },
      );
      const text = await response.text();
      const data = this.parseJsonSafe(text);
      if (data && (data.errno === 0 || data.errno === "0")) {
        return {
          ok: true,
          postUrl: "https://kuaichuan.360kuai.com/",
          message: "已通过开放平台 API 发布",
        };
      }
      return {
        ok: false,
        error: data?.errmsg || data?.message || text.slice(0, 160) || "开放平台发布失败",
      };
    }

    async saveViaSessionApi(title, content) {
      const payloads = [
        {
          url: "https://kuaichuan.360kuai.com/api/article/draft",
          body: { title, content, status: "draft" },
        },
        {
          url: "https://kuaichuan.360kuai.com/api/article/save",
          body: { title, content, draft: 1 },
        },
        {
          url: "https://api.kuaichuan.360kuai.com/article/draft",
          body: { title, content },
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
              Referer: "https://kuaichuan.360kuai.com/",
              Origin: "https://kuaichuan.360kuai.com",
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);
          const ok =
            res &&
            (res.errno === 0 ||
              res.code === 0 ||
              res.code === 200 ||
              res.success === true ||
              res.data?.id);
          if (ok) {
            return {
              ok: true,
              postId: res.data?.id ? String(res.data.id) : undefined,
              postUrl: "https://kuaichuan.360kuai.com/",
            };
          }
        } catch {
          // next
        }
      }
      return { ok: false, error: "会话草稿接口不可用" };
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
          url: ["*://kuaichuan.360kuai.com/*", "*://*.360kuai.com/*"],
        });
        let tab =
          tabs.find((t) => /publish|write|editor|create|article/i.test(t.url || "")) ||
          tabs[0] ||
          null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://kuaichuan.360kuai.com/",
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

        // Try click 写文章 / 发布
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
              const nodes = Array.from(
                document.querySelectorAll("a, button, span, div"),
              );
              const hit = nodes.find((n) =>
                /^(写文章|发布文章|发图文|新建)$|写文章|发图文/.test(
                  (n.textContent || "").trim(),
                ),
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
              return { ok: false, error: "请先登录 360 快传号" };
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
                error: "未找到快传号编辑器，请手动点「写文章」后重试",
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

    async uploadImageByUrl(src) {
      return { url: src };
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录快传号");
        }

        const title = String(article.title || "").trim().slice(0, 64);
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["360kuai.com", "qhimg.com", "360.cn"],
            onProgress: options?.onImageProgress,
          },
        );

        // Open platform token → publish API (official CLI path)
        const open = await this.publishViaOpenApi(title, content);
        if (open.ok) {
          return this.createResult(true, {
            postUrl: open.postUrl,
            draftOnly: false,
            message: open.message,
          });
        }

        const session = await this.saveViaSessionApi(title, content);
        if (session.ok) {
          return this.createResult(true, {
            postId: session.postId,
            postUrl: session.postUrl,
            draftOnly: options?.draftOnly ?? true,
          });
        }

        const dom = await this.saveViaDom(title, content);
        if (dom.ok) {
          return this.createResult(true, {
            postUrl: dom.postUrl || "https://kuaichuan.360kuai.com/",
            draftOnly: options?.draftOnly ?? true,
            message: dom.message || session.error || open.error,
          });
        }

        throw new Error(
          dom.error || session.error || open.error || "快传号同步失败",
        );
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
