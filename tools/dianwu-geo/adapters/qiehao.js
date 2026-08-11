/**
 * 企鹅号（腾讯内容开放平台 om.qq.com）
 *
 * 登录：勿用 /mindex/userAuth/getLoginState（那是 QQ 扫码组件用的）。
 * 正确路径：创作页 HTML 里的 g_userInfo、或 /article/* 需登录接口、或已开标签页读 window.g_userInfo。
 * 草稿：POST /article/save；失败则标签页 DOM 点「存草稿」。
 */
import { getCookieValue } from "./_cookie.js";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createQiehaoAdapter(BaseAdapter) {
  return class QiehaoAdapter extends BaseAdapter {
    meta = {
      id: "qiehao",
      name: "企鹅号",
      icon: "https://om.gtimg.cn/om/om_2.0/images/favicon_om.ico",
      homepage: "https://om.qq.com/article/articlePublish",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {{ userId: string; username: string; avatar?: string; mediaId?: string } | null} */
    account = null;

    isLoginHtml(text, finalUrl = "") {
      if (/userAuth|ptlogin|登录-腾讯内容开放平台/i.test(finalUrl)) return true;
      if (!text) return false;
      return (
        /登录-腾讯内容开放平台|ptlogin-container|login-wrapper|扫码登录企鹅号/i.test(
          text,
        ) && !/g_userInfo|mediaId|articlePublish|ProseMirror/i.test(text)
      );
    }

    parseJsonSafe(text) {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    responseOk(data) {
      if (!data || typeof data !== "object") return false;
      const code =
        data.response?.code ?? data.code ?? data.ret ?? data.status;
      if (code === 0 || code === "0") return true;
      if (data.success === true) return true;
      return false;
    }

    accountFromUserInfo(info) {
      if (!info || typeof info !== "object") return null;
      const mediaId =
        info.mediaId ||
        info.media_id ||
        info.media ||
        info.uid ||
        info.openid;
      if (!mediaId && !info.mediaName && !info.nick && !info.nickname) {
        return null;
      }
      return {
        userId: String(mediaId || info.openid || info.mediaName || "qiehao"),
        username: String(
          info.mediaName ||
            info.nick ||
            info.nickname ||
            info.name ||
            info.accountName ||
            mediaId ||
            "企鹅号",
        ),
        avatar: info.header || info.avatar || info.head || undefined,
        mediaId: mediaId ? String(mediaId) : undefined,
      };
    }

    extractGUserInfo(html) {
      if (!html) return null;
      // window.g_userInfo = {...} or g_userInfo={...}
      const m = html.match(
        /(?:window\.)?g_userInfo\s*=\s*(\{[\s\S]*?\})\s*;/,
      );
      if (m?.[1]) {
        try {
          return new Function(`return (${m[1]})`)();
        } catch {
          try {
            return JSON.parse(m[1]);
          } catch {
            // fall through
          }
        }
      }
      // loose mediaId + mediaName in page bootstrap
      const id = html.match(/"mediaId"\s*:\s*"?(\d+)"?/);
      const name = html.match(/"mediaName"\s*:\s*"([^"]+)"/);
      if (id?.[1]) {
        return {
          mediaId: id[1],
          mediaName: name?.[1] || id[1],
        };
      }
      return null;
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

    async readAccountFromOpenTab() {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.scripting?.executeScript
      ) {
        return null;
      }
      try {
        const tabs = await chrome.tabs.query({ url: ["*://om.qq.com/*"] });
        const tab =
          tabs.find(
            (t) =>
              t.id &&
              /article|main|statistic|income/i.test(t.url || "") &&
              !/userAuth|login/i.test(t.url || ""),
          ) || tabs.find((t) => t.id && !/userAuth|login/i.test(t.url || ""));
        if (!tab?.id) return null;

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => {
            const info = window.g_userInfo || null;
            if (info?.mediaId || info?.mediaName) {
              return {
                mediaId: info.mediaId,
                mediaName: info.mediaName,
                header: info.header,
                nick: info.nick || info.nickname,
              };
            }
            if (/userAuth|login/i.test(location.href)) return null;
            // still on creator site without global — treat as logged-in shell
            if (!/userAuth|ptlogin/i.test(document.title + location.href)) {
              return { mediaId: "session", mediaName: "企鹅号" };
            }
            return null;
          },
        });
        return this.accountFromUserInfo(result);
      } catch {
        return null;
      }
    }

    async probeAuthApis() {
      const urls = [
        "https://om.qq.com/article/serverTime",
        "https://om.qq.com/article/categoryList",
        "https://om.qq.com/article/accountStatus",
        "https://om.qq.com/article/list?index=0&num=1",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "X-Requested-With": "XMLHttpRequest",
              Referer: "https://om.qq.com/article/articleManage",
            },
          });
          const finalUrl = response.url || url;
          const text = await response.text();
          if (this.isLoginHtml(text, finalUrl)) continue;
          const data = this.parseJsonSafe(text);
          if (!data) continue;

          // list/account often embed media info
          const nested =
            data.data?.userInfo ||
            data.data?.mediaInfo ||
            data.data?.media ||
            data.userInfo ||
            data.data;
          const fromNested = this.accountFromUserInfo(
            typeof nested === "object" ? nested : null,
          );
          if (fromNested) return fromNested;

          if (
            this.responseOk(data) ||
            (response.ok &&
              !/未登录|请登录|login/i.test(text.slice(0, 200)) &&
              !data?.response?.code?.toString().includes("10403"))
          ) {
            return {
              userId: "session",
              username: "企鹅号",
              mediaId: undefined,
            };
          }
        } catch {
          // next
        }
      }
      return null;
    }

    async probeAuthPages() {
      const urls = [
        "https://om.qq.com/article/articleManage",
        "https://om.qq.com/article/articlePublish",
        "https://om.qq.com/main",
      ];
      for (const url of urls) {
        try {
          const response = await this.runtime.fetch(url, {
            credentials: "include",
            headers: {
              Accept: "text/html,application/xhtml+xml",
              "Cache-Control": "no-cache",
            },
            redirect: "follow",
          });
          const finalUrl = response.url || url;
          const html = await response.text();
          if (this.isLoginHtml(html, finalUrl)) continue;
          const info = this.extractGUserInfo(html);
          const account = this.accountFromUserInfo(info);
          if (account) return account;
          // landed on creator UI without parseable g_userInfo
          if (
            /articleManage|articlePublish|header-logo|创作/i.test(html) &&
            !this.isLoginHtml(html, finalUrl)
          ) {
            return {
              userId: "session",
              username: "企鹅号",
              mediaId: undefined,
            };
          }
        } catch {
          // next
        }
      }
      return null;
    }

    async hasOmSessionCookies() {
      const names = ["uin", "skey", "p_skey", "om_token", "RK", "pt4_token"];
      for (const name of names) {
        const v = await getCookieValue(
          this.runtime,
          [".qq.com", "om.qq.com", ".om.qq.com", "qq.com"],
          name,
          ["https://om.qq.com/", "https://qq.com/"],
        );
        if (v) return true;
      }
      return false;
    }

    async checkAuth() {
      try {
        // 1) already-open creator tab (most reliable when user says they're logged in)
        const fromTab = await this.readAccountFromOpenTab();
        if (fromTab) {
          this.account = fromTab;
          return {
            isAuthenticated: true,
            userId: fromTab.userId,
            username: fromTab.username,
            avatar: fromTab.avatar,
          };
        }

        // 2) JSON endpoints that only work when session is valid
        const fromApi = await this.probeAuthApis();
        if (fromApi) {
          this.account = fromApi;
          return {
            isAuthenticated: true,
            userId: fromApi.userId,
            username: fromApi.username,
            avatar: fromApi.avatar,
          };
        }

        // 3) HTML pages with g_userInfo
        const fromPage = await this.probeAuthPages();
        if (fromPage) {
          this.account = fromPage;
          return {
            isAuthenticated: true,
            userId: fromPage.userId,
            username: fromPage.username,
            avatar: fromPage.avatar,
          };
        }

        // 4) cookies alone are weak — still not enough without creator session
        if (await this.hasOmSessionCookies()) {
          return {
            isAuthenticated: false,
            error:
              "检测到 QQ Cookie，但企鹅号创作后台未就绪。请打开 https://om.qq.com/article/articlePublish 确认已进后台后再同步",
          };
        }

        return { isAuthenticated: false, error: "未登录企鹅号" };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async ensureAccount() {
      if (this.account?.userId) return this.account;
      const auth = await this.checkAuth();
      if (!auth.isAuthenticated) throw new Error(auth.error || "未登录企鹅号");
      return this.account;
    }

    async uploadImageByUrl(src) {
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const formData = new FormData();
      formData.append("file", blob, `${Date.now()}.jpg`);
      formData.append("upfile", blob, `${Date.now()}.jpg`);

      const uploadUrls = [
        "https://om.qq.com/image/upload",
        "https://om.qq.com/article/uploadImage",
        "https://om.qq.com/upload/image",
      ];

      for (const url of uploadUrls) {
        try {
          const response = await this.runtime.fetch(url, {
            method: "POST",
            credentials: "include",
            headers: {
              Referer: "https://om.qq.com/article/articlePublish",
            },
            body: formData,
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);
          const out =
            res?.data?.url ||
            res?.url ||
            res?.data?.imgurl ||
            res?.imgurl ||
            res?.data?.src;
          if (out) return { url: out };
        } catch {
          // next
        }
      }
      return { url: src };
    }

    buildSavePayload(title, content, mediaId) {
      const params = new URLSearchParams();
      params.set("title", title);
      params.set("title2", "");
      params.set("content", content);
      params.set("HTML", content);
      params.set("html", content);
      if (mediaId && mediaId !== "session") {
        params.set("media", String(mediaId));
      }
      params.set("status", "0");
      params.set("type", "0");
      params.set("article_type", "0");
      params.set("original", "0");
      return params;
    }

    isSaveOk(res, text) {
      if (res && typeof res === "object") {
        if (this.responseOk(res)) return true;
        if (res.data?.articleId || res.data?.article_id || res.articleId) {
          return true;
        }
      }
      if (/成功|已保存|保存成功/i.test(text) && !/失败|未登录|error/i.test(text)) {
        return true;
      }
      return false;
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
        const tabs = await chrome.tabs.query({ url: ["*://om.qq.com/*"] });
        let tab =
          tabs.find((t) => /articlePublish/i.test(t.url || "")) || null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://om.qq.com/article/articlePublish",
            active: true,
          });
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 2500));
        } else {
          await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 600));
        }

        // wait for editor up to ~12s
        for (let i = 0; i < 8; i++) {
          const [{ result: ready } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () =>
              Boolean(
                document.querySelector(
                  'div.ProseMirror[contenteditable="true"], #omEditorTitle, [contenteditable="true"]',
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
            const { title, content } = payload;

            if (/userAuth|login|ptlogin/i.test(location.href + document.title)) {
              return { ok: false, error: "创作页跳到登录，请先在此标签登录企鹅号" };
            }

            const tip = document.querySelector("div.omui-countdowntip a");
            if (tip) {
              tip.click();
              await sleep(800);
            }

            const titleEl =
              document.querySelector(
                '#omEditorTitle span[data-placeholder*="标题"]',
              ) ||
              document.querySelector("#omEditorTitle [contenteditable]") ||
              document.querySelector("#omEditorTitle") ||
              document.querySelector('[data-placeholder*="标题"]');
            if (titleEl) {
              titleEl.focus();
              titleEl.textContent = title;
              titleEl.dispatchEvent(new Event("input", { bubbles: true }));
              titleEl.dispatchEvent(new Event("blur", { bubbles: true }));
            }

            const editor =
              document.querySelector(
                'div.ProseMirror[contenteditable="true"]',
              ) ||
              document.querySelector(
                '[contenteditable="true"].ProseMirror',
              ) ||
              document.querySelector('div[contenteditable="true"]');
            if (!editor) {
              return {
                ok: false,
                error: "未找到编辑器（请确认已进入图文创作页）",
              };
            }

            editor.focus();
            editor.innerHTML = content;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            await sleep(800);

            const buttons = Array.from(
              document.querySelectorAll("button, a, span, li, div"),
            );
            const draftBtn = buttons.find((b) =>
              /^[\s]*存草稿[\s]*$|保存草稿/.test(
                (b.textContent || "").trim(),
              ),
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
            await sleep(1800);
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
        let account = null;
        try {
          account = await this.ensureAccount();
        } catch (authErr) {
          // 已登录用户偶发鉴权接口 HTML 化：仍尝试保存/DOM
          const msg =
            authErr instanceof Error ? authErr.message : String(authErr);
          const dom = await this.saveViaDom(
            String(article.title || "").trim().slice(0, 64),
            article.html || article.markdown || "",
          );
          if (dom.ok) {
            return this.createResult(true, {
              postUrl:
                dom.postUrl || "https://om.qq.com/article/articlePublish",
              draftOnly: options?.draftOnly ?? true,
              message: dom.message || msg,
            });
          }
          throw new Error(msg);
        }

        const title = String(article.title || "").trim().slice(0, 64);
        if (title.length < 5) {
          throw new Error("企鹅号标题需 5–64 字");
        }

        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["om.qq.com", "gtimg.cn", "qpic.cn", "inews.qq.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const body = this.buildSavePayload(
          title,
          content,
          account?.mediaId || account?.userId,
        );

        const saveUrls = [
          "https://om.qq.com/article/save",
          "https://om.qq.com/article/saveAndPreview",
          "https://om.qq.com/article/batchSave",
        ];

        let lastError = "保存草稿失败";
        for (const saveUrl of saveUrls) {
          const response = await this.runtime.fetch(saveUrl, {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/javascript, */*; q=0.01",
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Referer: "https://om.qq.com/article/articlePublish",
              Origin: "https://om.qq.com",
            },
            body: body.toString(),
          });
          const text = await response.text();
          const res = this.parseJsonSafe(text);

          if (this.isSaveOk(res, text)) {
            const articleId =
              res?.data?.articleId ||
              res?.data?.article_id ||
              res?.articleId ||
              res?.data?.id;
            return this.createResult(true, {
              postId: articleId ? String(articleId) : undefined,
              postUrl: articleId
                ? `https://om.qq.com/article/articlePublish?articleId=${articleId}`
                : "https://om.qq.com/article/articlePublish",
              draftOnly: options?.draftOnly ?? true,
            });
          }

          lastError =
            res?.msg ||
            res?.message ||
            res?.response?.msg ||
            res?.data?.msg ||
            text.slice(0, 160) ||
            lastError;
        }

        const dom = await this.saveViaDom(title, content);
        if (dom.ok) {
          return this.createResult(true, {
            postUrl: dom.postUrl || "https://om.qq.com/article/articlePublish",
            draftOnly: options?.draftOnly ?? true,
            message: dom.message || lastError,
          });
        }

        throw new Error(dom.error || lastError);
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
