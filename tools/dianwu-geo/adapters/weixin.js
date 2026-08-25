/**
 * 微信公众号 — chrome.debugger 填稿确认制
 *
 * 覆盖内置草稿 API。对齐本机 Playwright：打开图文编辑器，写入标题和正文，
 * 尽量点「保存为草稿」。封面和发表留给人在打开的标签里点。
 */
import { getCookieValue } from "./_cookie.js";
import { assertPublicImageUrl, assertNoLocalImages } from "./_images.js";
import { debuggerCall, withDebugger } from "./_debugger.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const HOME = "https://mp.weixin.qq.com/";
const SESSION_NAMES = ["slave_sid", "slave_user", "data_ticket", "xid"];

function editorUrl(token) {
  return `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`;
}

function isEditorHref(url) {
  return (
    /mp\.weixin\.qq\.com\/cgi-bin\/appmsg/i.test(url || "") &&
    /action=edit|appmsg_edit/i.test(url || "")
  );
}

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createWeixinAdapter(BaseAdapter) {
  return class WeixinAdapter extends BaseAdapter {
    meta = {
      id: "weixin",
      name: "微信公众号",
      icon: "https://mp.weixin.qq.com/favicon.ico",
      homepage: HOME,
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
      const urls = [HOME];
      const domains = [".mp.weixin.qq.com", "mp.weixin.qq.com", ".weixin.qq.com"];
      for (const name of SESSION_NAMES) {
        const value = await getCookieValue(this.runtime, domains, name, urls);
        if (value && String(value).length > 6) return true;
      }
      return false;
    }

    async checkAuth() {
      try {
        if (!(await this.hasSessionCookie())) {
          return {
            isAuthenticated: false,
            error: "未登录公众号，请先在 Chrome 打开 https://mp.weixin.qq.com/ 扫码登录",
          };
        }
        return {
          isAuthenticated: true,
          userId: "weixin",
          username: "微信公众号",
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      assertPublicImageUrl(src, "微信公众号");
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

    async ensureMpTab() {
      const tabs = await chrome.tabs.query({
        url: ["*://mp.weixin.qq.com/*"],
      });
      let tab = tabs[0] || null;
      if (!tab?.id) {
        tab = await chrome.tabs.create({ url: HOME, active: true });
      } else {
        await chrome.tabs.update(tab.id, { url: HOME, active: true });
      }
      await this.waitTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 2500));
      return tab;
    }

    async waitForNewEditorTab(timeoutMs = 15_000) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(null);
        }, timeoutMs);
        const onUpdated = (id, info, tab) => {
          const url = String(info.url || tab?.url || "");
          if (!isEditorHref(url)) return;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(tab);
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
    }

    async readPageState(tabId) {
      return withDebugger(tabId, async (target) => {
        return debuggerCall(target, () => {
          const href = location.href;
          const text = document.body?.innerText || "";
          const login =
            /loginpage|login\?/i.test(href) ||
            (text.includes("微信扫一扫") &&
              !!document.querySelector(
                ".login__type__container, .login_panel, .qrcheck_box, .js_qrcode, .login_qrcode",
              ));
          let token = null;
          try {
            token = new URL(href).searchParams.get("token");
          } catch {
            // ignore
          }
          if (!token) {
            token = (href.match(/[?&]token=(\d+)/i) || [])[1] || null;
          }
          if (!token) {
            const html = document.documentElement?.innerHTML || "";
            token =
              (html.match(/t:\s*["'](\d+)["']/) || [])[1] ||
              (html.match(/token["']?\s*[:=]\s*["']?(\d+)/) || [])[1] ||
              null;
          }
          const editorReady = !!(
            document.querySelector("#title") ||
            document.querySelector(".ProseMirror")
          );
          return { login, token, editorReady, href };
        });
      });
    }

    async clickNewArticleCard(tabId) {
      return withDebugger(tabId, async (target) => {
        return debuggerCall(target, () => {
          const items = Array.from(
            document.querySelectorAll(".new-creation__menu-item"),
          );
          for (const el of items) {
            const t = (el.textContent || "").replace(/\s+/g, "");
            if (t === "文章" || t === "图文消息" || t === "写新图文") {
              el.click();
              return t;
            }
          }
          return null;
        });
      });
    }

    async fillViaDebugger(tabId, title, html, plain, summary) {
      return withDebugger(tabId, async (target) => {
        await new Promise((r) => setTimeout(r, 800));
        return debuggerCall(
          target,
          async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const loginBlocked = () => {
              const href = location.href;
              const text = document.body?.innerText || "";
              return (
                /loginpage|login\?/i.test(href) ||
                (text.includes("微信扫一扫") &&
                  !!document.querySelector(
                    ".login__type__container, .login_panel, .qrcheck_box, .js_qrcode, .login_qrcode",
                  ))
              );
            };
            const dismissChrome = () => {
              const popovers = document.querySelectorAll(
                ".weui-desktop-popover, .weui-desktop-msg",
              );
              for (const n of popovers) n.style.display = "none";
              for (let i = 0; i < 3; i++) {
                const wrap = document.querySelector(".weui-desktop-dialog__wrp");
                if (!wrap) break;
                const close = document.querySelector(
                  ".weui-desktop-dialog__close-btn",
                );
                if (close) close.click();
              }
              document.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                }),
              );
            };
            const pickTitlePm = () => {
              const all = Array.from(document.querySelectorAll(".ProseMirror"));
              return all[0] || null;
            };
            const pickBodyPm = () => {
              const all = Array.from(document.querySelectorAll(".ProseMirror"));
              for (const el of all) {
                const text = (el.innerText || "").trim();
                if (/从这里开始写正文|写正文/.test(text)) return el;
              }
              return all.length >= 2 ? all[1] : all[0] || null;
            };
            const setHiddenTitle = (value) => {
              const input = document.querySelector("#title");
              if (!input) return;
              input.value = value;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            };
            const replaceEditable = (el, mode, value) => {
              el.focus();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              sel?.removeAllRanges();
              sel?.addRange(range);
              let ok = false;
              if (typeof document.execCommand === "function") {
                ok =
                  mode === "html"
                    ? document.execCommand("insertHTML", false, value)
                    : document.execCommand("insertText", false, value);
              }
              if (!ok) {
                if (mode === "html") el.innerHTML = value;
                else el.textContent = value;
              }
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  inputType:
                    mode === "html" ? "insertFromPaste" : "insertText",
                }),
              );
              el.dispatchEvent(new Event("change", { bubbles: true }));
            };
            const fillDigest = (text) => {
              if (!text) return;
              const box = document.querySelector(
                "#js_description, textarea.js_desc, textarea[placeholder*='摘要'], textarea[placeholder*='选填']",
              );
              if (!box) return;
              const proto = HTMLTextAreaElement.prototype;
              const desc = Object.getOwnPropertyDescriptor(proto, "value");
              if (desc?.set) desc.set.call(box, text);
              else box.value = text;
              box.dispatchEvent(new Event("input", { bubbles: true }));
              box.dispatchEvent(new Event("change", { bubbles: true }));
            };
            const clickSaveDraft = () => {
              const buttons = Array.from(
                document.querySelectorAll("button, a"),
              );
              for (const el of buttons) {
                if ((el.textContent || "").replace(/\s+/g, "") === "保存为草稿") {
                  el.click();
                  return true;
                }
              }
              return false;
            };

            if (loginBlocked()) {
              return { ok: false, error: "请先在这个标签扫码登录微信公众号" };
            }

            dismissChrome();
            let titlePm = pickTitlePm();
            let bodyPm = pickBodyPm();
            const deadline = Date.now() + 18_000;
            while (Date.now() < deadline && (!titlePm || !bodyPm)) {
              if (loginBlocked()) {
                return { ok: false, error: "请先在这个标签扫码登录微信公众号" };
              }
              await sleep(400);
              titlePm = pickTitlePm();
              bodyPm = pickBodyPm();
            }
            if (!titlePm || !bodyPm) {
              return {
                ok: false,
                error: "找不到公众号图文编辑器。请确认已打开「文章」编辑页后再同步",
              };
            }

            const title = String(payload.title || "").slice(0, 64);
            setHiddenTitle(title);
            replaceEditable(titlePm, "text", title);
            if (titlePm === bodyPm) {
              const after = Array.from(document.querySelectorAll(".ProseMirror"));
              bodyPm = after.length >= 2 ? after[1] : bodyPm;
            }

            replaceEditable(
              bodyPm,
              "html",
              payload.html || `<p>${payload.plain || ""}</p>`,
            );
            let filledBody = String(bodyPm.innerText || "").trim();
            if (filledBody.length < 5 && payload.plain) {
              replaceEditable(bodyPm, "text", payload.plain.slice(0, 5000));
              filledBody = String(bodyPm.innerText || "").trim();
            }
            if (filledBody.length < 2) {
              return { ok: false, error: "正文没写进去，请在打开的页里再贴一次" };
            }

            fillDigest(
              String(payload.summary || payload.plain || "").slice(0, 120),
            );
            const saved = clickSaveDraft();
            if (saved) await sleep(1600);
            const toast = /保存成功|已保存|已存入草稿/.test(
              document.body?.innerText || "",
            );
            const hasMsgId = /appmsgid=\d+/i.test(location.href);

            return {
              ok: true,
              postUrl: location.href,
              awaitingUserPublish: true,
              saved: !!(saved && (toast || hasMsgId)) || toast || hasMsgId,
              message: `已写入标题「${title.slice(0, 16)}」和正文`,
            };
          },
          [{ title, html, plain, summary }],
          { awaitPromise: true },
        );
      });
    }

    async openEditorTab() {
      const tab = await this.ensureMpTab();
      if (!tab?.id) throw new Error("打不开公众号后台");

      let state = await this.readPageState(tab.id);
      const tokenDeadline = Date.now() + 15_000;
      while (!state?.token && Date.now() < tokenDeadline) {
        if (state?.login) {
          throw new Error("请先在这个标签扫码登录微信公众号");
        }
        await new Promise((r) => setTimeout(r, 600));
        state = await this.readPageState(tab.id);
      }
      if (state?.login) {
        throw new Error("请先在这个标签扫码登录微信公众号");
      }
      if (!state?.token) {
        throw new Error("无法从公众号首页取得 token，请重新登录后再同步");
      }

      await chrome.tabs.update(tab.id, {
        url: editorUrl(state.token),
        active: true,
      });
      await this.waitTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 3000));

      let ready = await this.readPageState(tab.id);
      if (ready?.editorReady && !ready.login) return tab;

      await chrome.tabs.update(tab.id, {
        url: `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${state.token}`,
        active: true,
      });
      await this.waitTabComplete(tab.id);
      await new Promise((r) => setTimeout(r, 2000));

      const popupPromise = this.waitForNewEditorTab(15_000);
      const clicked = await this.clickNewArticleCard(tab.id);
      const popup = await popupPromise;
      if (popup?.id) {
        await chrome.tabs.update(popup.id, { active: true });
        await this.waitTabComplete(popup.id);
        await new Promise((r) => setTimeout(r, 2500));
        return popup;
      }

      ready = await this.readPageState(tab.id);
      if (ready?.editorReady && !ready.login) return tab;
      throw new Error(
        `未能打开图文编辑器（clicked=${clicked || "none"}）。请手动点首页「文章」后再同步`,
      );
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录微信公众号");
        }
        if (typeof chrome === "undefined" || !chrome.tabs?.create) {
          throw new Error("扩展没有标签页权限，请重新加载点物扩展");
        }

        const title = String(article.title || "").trim().slice(0, 64);
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: [
              "qpic.cn",
              "mmbiz.qpic.cn",
              "mmbiz.qlogo.cn",
              "weixin.qq.com",
            ],
            onProgress: options?.onImageProgress,
            allowPublicExternal: true,
          },
        );
        assertNoLocalImages(content, "微信公众号");

        const tab = await this.openEditorTab();
        if (!tab?.id) throw new Error("打不开公众号图文编辑器");

        const summary = String(article.desc || article.summary || "").trim();
        const dom = await this.fillViaDebugger(
          tab.id,
          title,
          content,
          this.htmlToPlain(content),
          summary,
        );
        if (!dom?.ok) {
          return this.createResult(false, {
            error: dom?.error || "公众号填稿失败",
            draftOnly: true,
            postUrl: HOME,
          });
        }

        watchFillConfirmTab({
          tabId: tab.id,
          platform: "weixin",
          isEditorUrl: isEditorHref,
        });

        return this.createResult(true, {
          postUrl: dom.postUrl || HOME,
          draftOnly: true,
          awaitingUserPublish: true,
          outcome: "filled_awaiting_publish",
          message:
            (dom.message || "公众号已写入标题和正文") +
            "。封面和发表请你在打开的标签里点。Chrome 若闪过「正在调试」是正常的。",
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
          draftOnly: true,
          postUrl: HOME,
        });
      }
    }
  };
}
