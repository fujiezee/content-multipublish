/**
 * 抖音文章 — chrome.debugger 填稿确认制
 *
 * 对齐本机 Playwright：打开创作者「发文章」页，写入标题和正文，
 * 封面和发布留给人在打开的标签里点。不自动点发布。
 */
import { getCookieValue } from "./_cookie.js";
import { assertPublicImageUrl, assertNoLocalImages } from "./_images.js";
import { debuggerCall, isBenignDebuggerError, withDebugger } from "./_debugger.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const ARTICLE_EDITOR =
  "https://creator.douyin.com/creator-micro/content/post/article?default-tab=3&enter_from=publish_page&media_type=article&type=new";
const ARTICLE_FALLBACKS = [
  ARTICLE_EDITOR,
  "https://creator.douyin.com/creator-micro/content/post/article?media_type=article&type=new",
  "https://creator.douyin.com/creator-micro/content/post/article",
];
const LOGIN = "https://creator.douyin.com/";
const SESSION_NAMES = [
  "sessionid",
  "sessionid_ss",
  "sid_tt",
  "sid_ucp_v1",
  "sid_guard",
];

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createDouyinAdapter(BaseAdapter) {
  return class DouyinAdapter extends BaseAdapter {
    meta = {
      id: "douyin",
      name: "抖音文章",
      icon: "https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico",
      homepage: ARTICLE_EDITOR,
      capabilities: ["article"],
    };

    waitTabComplete(tabId, timeoutMs = 45_000) {
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

    async hasSessionCookie() {
      const urls = ["https://creator.douyin.com/", "https://www.douyin.com/"];
      const domains = [".douyin.com", "douyin.com", ".creator.douyin.com"];
      for (const name of SESSION_NAMES) {
        const value = await getCookieValue(this.runtime, domains, name, urls);
        if (value && String(value).length > 10) return true;
      }
      return false;
    }

    async checkAuth() {
      try {
        if (!(await this.hasSessionCookie())) {
          return {
            isAuthenticated: false,
            error: "未登录抖音，请先在 Chrome 打开 https://creator.douyin.com/ 扫码登录",
          };
        }
        return {
          isAuthenticated: true,
          userId: "douyin",
          username: "抖音创作者",
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      assertPublicImageUrl(src, "抖音文章");
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

    async openEditorTab() {
      const tabs = await chrome.tabs.query({
        url: ["*://creator.douyin.com/*", "*://www.douyin.com/*"],
      });
      let tab =
        tabs.find((t) => /creator-micro|post\/article/i.test(t.url || "")) ||
        tabs[0] ||
        null;
      const url = ARTICLE_FALLBACKS[0];
      if (!tab?.id) {
        tab = await chrome.tabs.create({ url, active: true });
      } else {
        await chrome.tabs.update(tab.id, { url, active: true });
      }
      await this.waitTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 2200));
      return tab;
    }

    async fillViaDebugger(tabId, title, html, plain) {
      return withDebugger(tabId, async (target) => {
        await new Promise((r) => setTimeout(r, 800));
        return debuggerCall(
          target,
          async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const clickText = (re) => {
              const nodes = Array.from(
                document.querySelectorAll("a, button, span, div, li, [role='tab']"),
              );
              const hit = nodes.find((n) => re.test((n.textContent || "").trim()));
              if (!hit) return false;
              hit.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true }),
              );
              return true;
            };
            const dismissDraft = () => {
              if (!/恢复上次|未保存的草稿|是否恢复|继续编辑上次|检测到草稿/.test(
                document.body?.innerText || "",
              )) {
                return;
              }
              clickText(/不恢复|放弃|不使用|新建/);
            };
            const loginBlocked = () => {
              const href = location.href + document.title;
              if (/passport|sso\.|\/login\b|scan\/login/i.test(href)) return true;
              const text = document.body?.innerText || "";
              return /扫码登录|请使用抖音APP扫码|打开抖音扫一扫|创作者登录/.test(text);
            };
            const articleBlocked = () =>
              /开通文章|暂未开放文章|文章功能未开通|申请开通文章|该功能暂未对你开放|暂无文章权限/.test(
                document.body?.innerText || "",
              );
            const pickTitle = () => {
              const sels = [
                'input[placeholder*="文章标题"]',
                'input[placeholder*="添加标题"]',
                'textarea[placeholder*="文章标题"]',
                'input[placeholder*="2-30"]',
                'input[placeholder*="标题"]',
                'textarea[placeholder*="标题"]',
                "input.semi-input",
              ];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) return el;
              }
              return null;
            };
            const pickBody = () => {
              const editors = Array.from(
                document.querySelectorAll(
                  [
                    ".ProseMirror[contenteditable='true']",
                    "[data-slate-editor='true']",
                    'div[contenteditable="true"][role="textbox"]',
                    ".syl-editor [contenteditable='true']",
                    'div[contenteditable="true"]',
                  ].join(","),
                ),
              );
              for (const el of editors) {
                if (el.offsetParent === null) continue;
                const ph = `${el.getAttribute("data-placeholder") || ""} ${
                  el.getAttribute("placeholder") || ""
                }`;
                if (/标题/.test(ph)) continue;
                const h = el.getBoundingClientRect().height;
                if (h >= 80) return el;
              }
              return editors[1] || editors[0] || null;
            };
            const setNativeValue = (el, value) => {
              const proto =
                el.tagName === "TEXTAREA"
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              const desc = Object.getOwnPropertyDescriptor(proto, "value");
              if (desc?.set) desc.set.call(el, value);
              else el.value = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            };

            if (loginBlocked()) {
              return { ok: false, error: "请先在这个标签扫码登录抖音创作者" };
            }
            dismissDraft();
            for (const label of [/发文章/, /写文章/, /^文章$/]) {
              clickText(label);
              await sleep(400);
            }
            dismissDraft();

            let titleEl = pickTitle();
            let bodyEl = pickBody();
            const deadline = Date.now() + 12_000;
            while (Date.now() < deadline && (!titleEl || !bodyEl)) {
              if (articleBlocked()) {
                return {
                  ok: false,
                  error: "这个号还没开通抖音文章。创作者中心开通后再同步",
                };
              }
              if (loginBlocked()) {
                return { ok: false, error: "请先在这个标签扫码登录抖音创作者" };
              }
              await sleep(400);
              titleEl = pickTitle();
              bodyEl = pickBody();
            }
            if (!titleEl || !bodyEl) {
              return {
                ok: false,
                error: "找不到抖音文章编辑器。请确认停在「发文章」页后再同步",
              };
            }

            titleEl.focus();
            setNativeValue(titleEl, payload.title);
            titleEl.dispatchEvent(
              new InputEvent("input", { bubbles: true, inputType: "insertText" }),
            );

            bodyEl.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(bodyEl);
            sel?.removeAllRanges();
            sel?.addRange(range);
            let ok = false;
            if (typeof document.execCommand === "function") {
              ok = document.execCommand("insertHTML", false, payload.html);
            }
            if (!ok) bodyEl.innerHTML = payload.html;
            if (!String(bodyEl.innerText || "").trim() && payload.plain) {
              bodyEl.innerText = payload.plain;
            }
            bodyEl.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertFromPaste",
              }),
            );
            bodyEl.dispatchEvent(new Event("change", { bubbles: true }));

            const filledTitle = String(titleEl.value || titleEl.textContent || "");
            const filledBody = String(bodyEl.innerText || "").trim();
            if (!filledBody) {
              return { ok: false, error: "正文没写进去，请在打开的页里再贴一次" };
            }
            return {
              ok: true,
              postUrl: location.href,
              awaitingUserPublish: true,
              message: `已写入标题「${filledTitle.slice(0, 16)}」和正文，请补封面后点发布`,
            };
          },
          [{ title, html, plain }],
          { awaitPromise: true },
        );
      });
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录抖音");
        }
        if (typeof chrome === "undefined" || !chrome.tabs?.create) {
          throw new Error("扩展没有标签页权限，请重新加载点物扩展");
        }

        const title = String(article.title || "").trim();
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["douyin.com", "byteimg.com", "douyinpic.com"],
            onProgress: options?.onImageProgress,
            allowPublicExternal: true,
          },
        );
        assertNoLocalImages(content, "抖音文章");

        const tab = await this.openEditorTab();
        if (!tab?.id) throw new Error("打不开抖音文章页");

        const dom = await this.fillViaDebugger(
          tab.id,
          title,
          content,
          this.htmlToPlain(content),
        );
        if (!dom?.ok) {
          return this.createResult(false, {
            error: dom?.error || "抖音文章填稿失败",
            draftOnly: true,
            postUrl: ARTICLE_EDITOR,
          });
        }

        watchFillConfirmTab({
          tabId: tab.id,
          platform: "douyin",
          isEditorUrl: (url) =>
            /creator-micro\/content\/(upload|post\/image|post\/video|post\/article)/i.test(
              url,
            ),
        });

        return this.createResult(true, {
          postUrl: dom.postUrl || ARTICLE_EDITOR,
          draftOnly: true,
          awaitingUserPublish: true,
          outcome: "filled_awaiting_publish",
          message:
            (dom.message || "抖音文章已写入标题和正文") +
            "。封面和发布请你在打开的标签里点。Chrome 若闪过「正在调试」是正常的。",
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (isBenignDebuggerError(msg)) {
          return this.createResult(true, {
            postUrl: ARTICLE_EDITOR,
            draftOnly: true,
            awaitingUserPublish: true,
            outcome: "filled_awaiting_publish",
            message:
              "标题和正文可能已写入抖音创作页（Chrome 调试器提示可忽略）。请核对打开的标签，补封面后点发布。",
          });
        }
        return this.createResult(false, {
          error: msg,
          draftOnly: true,
          postUrl: LOGIN,
        });
      }
    }
  };
}
