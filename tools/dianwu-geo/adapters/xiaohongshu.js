/**
 * 小红书 — 填稿确认制（无稳定公开草稿 API）
 *
 * 打开创作者中心长文页 → DOM 填入标题/正文 → 留给用户确认后点「发布」。
 * 返回 success + awaitingUserPublish，SaaS 记为 filled_awaiting_publish（非失败）。
 */
import { getCookieValue } from "./_cookie.js";
import { assertPublicImageUrl, assertNoLocalImages } from "./_images.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const EDITOR_URL =
  "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createXiaohongshuAdapter(BaseAdapter) {
  return class XiaohongshuAdapter extends BaseAdapter {
    meta = {
      id: "xiaohongshu",
      name: "小红书",
      icon: "https://www.xiaohongshu.com/favicon.ico",
      homepage: EDITOR_URL,
      capabilities: ["article", "image_upload"],
    };

    /** @type {{ userId: string; username: string; avatar?: string } | null} */
    account = null;

    waitTabComplete(tabId, timeoutMs = 30_000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }, timeoutMs);
        const onUpdated = (id, info) => {
          if (id !== tabId) return;
          if (info.status === "complete") {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
          if (tab?.status === "complete") {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        });
      });
    }

    async ensureAccount() {
      if (this.account) return this.account;
      const session = await getCookieValue(
        this.runtime,
        [
          ".xiaohongshu.com",
          "xiaohongshu.com",
          ".creator.xiaohongshu.com",
          "creator.xiaohongshu.com",
        ],
        "web_session",
        [
          "https://creator.xiaohongshu.com/",
          "https://www.xiaohongshu.com/",
        ],
      );
      const a1 = await getCookieValue(
        this.runtime,
        [".xiaohongshu.com", "xiaohongshu.com"],
        "a1",
        ["https://www.xiaohongshu.com/", "https://creator.xiaohongshu.com/"],
      );
      if (!session && !a1) {
        throw new Error(
          "未登录小红书，请先在 Chrome 打开 https://creator.xiaohongshu.com/ 登录",
        );
      }
      this.account = {
        userId: String(a1 || session || "xhs").slice(0, 24),
        username: "小红书创作者",
      };
      return this.account;
    }

    async checkAuth() {
      try {
        const account = await this.ensureAccount();
        return {
          isAuthenticated: true,
          userId: account.userId,
          username: account.username,
          avatar: account.avatar,
        };
      } catch (error) {
        this.account = null;
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      assertPublicImageUrl(src, "小红书");
      return { url: src };
    }

    htmlToPlain(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n")
        .replace(/<li>/gi, "• ")
        .replace(/<img[^>]*>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    async fillViaDom(title, html) {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.create ||
        !chrome.scripting?.executeScript
      ) {
        return { ok: false, error: "无 tabs/scripting 权限" };
      }

      try {
        const tabs = await chrome.tabs.query({
          url: [
            "*://creator.xiaohongshu.com/*",
            "*://www.xiaohongshu.com/*",
          ],
        });
        let tab =
          tabs.find((t) => /publish|creator/i.test(t.url || "")) ||
          tabs[0] ||
          null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({ url: EDITOR_URL, active: true });
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 2800));
        } else {
          await chrome.tabs
            .update(tab.id, { url: EDITOR_URL, active: true })
            .catch(() =>
              chrome.tabs.update(tab.id, { active: true }),
            );
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 2000));
        }

        // Try enter 写长文
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
              const nodes = Array.from(
                document.querySelectorAll("a, button, span, div, li"),
              );
              const hit = nodes.find((n) =>
                /写长文|新的创作|发长文/.test((n.textContent || "").trim()),
              );
              if (hit) {
                hit.dispatchEvent(
                  new MouseEvent("click", { bubbles: true, cancelable: true }),
                );
              }
            },
          })
          .catch(() => undefined);
        await new Promise((r) => setTimeout(r, 2200));

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const { title: t, html: h, plain } = payload;
            if (/login|passport|sso/i.test(location.href + document.title)) {
              return { ok: false, error: "请先登录小红书创作者中心" };
            }

            const titleEl =
              document.querySelector('textarea[placeholder*="标题"]') ||
              document.querySelector('input[placeholder*="标题"]') ||
              document.querySelector('textarea[maxlength="20"]') ||
              document.querySelector('textarea[maxlength="30"]');
            if (titleEl) {
              titleEl.focus();
              const nativeSet = Object.getOwnPropertyDescriptor(
                titleEl.tagName === "TEXTAREA"
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype,
                "value",
              )?.set;
              if (nativeSet) nativeSet.call(titleEl, t);
              else if ("value" in titleEl) titleEl.value = t;
              else titleEl.textContent = t;
              titleEl.dispatchEvent(new Event("input", { bubbles: true }));
              titleEl.dispatchEvent(new Event("change", { bubbles: true }));
            }

            const editor =
              document.querySelector(
                "div.tiptap.ProseMirror[contenteditable='true']",
              ) ||
              document.querySelector(".ProseMirror[contenteditable='true']") ||
              document.querySelector("#quillEditor .ql-editor") ||
              document.querySelector('.ql-editor[contenteditable="true"]') ||
              document.querySelector('[contenteditable="true"][role="textbox"]') ||
              document.querySelector('div[contenteditable="true"]');

            if (!editor) {
              return {
                ok: false,
                error:
                  "未进入小红书长文编辑器（可能停在上传图文页）。请点「写长文」→「新的创作」后重试",
              };
            }

            editor.focus();
            try {
              document.execCommand("selectAll", false);
              document.execCommand("insertHTML", false, h);
            } catch {
              editor.innerHTML = h;
            }
            if (!String(editor.innerText || "").trim() && plain) {
              editor.innerText = plain;
            }
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(600);

            return {
              ok: true,
              postUrl: location.href,
              awaitingUserPublish: true,
              message:
                "已填入标题与正文，请确认封面/话题后点「发布」（不自动发布）",
            };
          },
          args: [
            {
              title: String(title || "").slice(0, 20),
              html,
              plain: this.htmlToPlain(html),
            },
          ],
        });

        return {
          ...(result || { ok: false, error: "DOM 填稿无结果" }),
          tabId: tab.id,
        };
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
          throw new Error(auth.error || "未登录小红书");
        }

        const title = String(article.title || "").trim().slice(0, 20);
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["xhscdn.com", "xiaohongshu.com", "sns-webpic"],
            onProgress: options?.onImageProgress,
            allowPublicExternal: true,
          },
        );
        assertNoLocalImages(content, "小红书");

        const dom = await this.fillViaDom(title, content);
        if (!dom.ok) {
          return this.createResult(false, {
            error: dom.error || "小红书填稿失败",
            draftOnly: true,
          });
        }

        watchFillConfirmTab({
          tabId: dom.tabId,
          platform: "xiaohongshu",
          isEditorUrl: (url) =>
            /edith\.xiaohongshu|creator\.xiaohongshu/i.test(url),
        });

        return this.createResult(true, {
          postUrl: dom.postUrl || EDITOR_URL,
          draftOnly: true,
          awaitingUserPublish: true,
          outcome: "filled_awaiting_publish",
          message:
            dom.message ||
            "已填入标题与正文，请确认封面/话题后点「发布」",
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
          draftOnly: true,
        });
      }
    }
  };
}
