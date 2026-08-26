/**
 * 微信公众号 — 优先走草稿接口（operate_appmsg），把带行内样式的 HTML 直接存草稿。
 * 接口失败时再打开编辑器粘贴（ProseMirror 吃 paste，不吃 insertHTML，后者会丢样式）。
 */
import { getCookieValue } from "./_cookie.js";
import { assertPublicImageUrl, assertNoLocalImages } from "./_images.js";
import { debuggerCall, withDebugger } from "./_debugger.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";
import { styleWeixinHtml } from "./_weixin-html.js";

const HOME = "https://mp.weixin.qq.com/";
const SESSION_NAMES = ["slave_sid", "slave_user", "data_ticket", "xid"];

const API_ERRORS = {
  [-6]: "请输入验证码",
  [-8]: "请输入验证码",
  [-1]: "系统错误，请注意备份内容后重试",
  [-2]: "参数错误，请注意备份内容后重试",
  [-5]: "服务错误，请注意备份内容后重试",
  [-99]: "内容超出字数，请调整",
  [-206]: "服务负荷过大，请稍后重试",
  200002: "参数错误，请注意备份内容后重试",
  200003: "登录态超时，请重新登录",
  412: "图文中含非法外链",
  62752: "可能含有具备安全风险的链接，请检查",
  64502: "你输入的微信号不存在",
  64505: "发送预览失败，请稍后再试",
  64506: "保存失败，链接不合法",
  64507: "内容不能包含外部链接",
  64509: "正文中不能包含超过3个视频",
  64515: "当前素材非最新内容，请重新打开并编辑",
  64702: "标题超出64字长度限制",
  64703: "摘要超出120字长度限制",
  64705: "内容超出字数，请调整",
  10806: "正文不能有违规内容，请重新编辑",
  10807: "内容不能违反公众平台协议",
  220001: "素材管理中的存储数量已达上限",
  220002: "图片库已达到存储上限",
};

function editorUrl(token) {
  return `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&lang=zh_CN&token=${token}`;
}

function isEditorHref(url) {
  return (
    /mp\.weixin\.qq\.com\/cgi-bin\/appmsg/i.test(url || "") &&
    /action=edit|appmsg_edit/i.test(url || "")
  );
}

function pickToken(html, url) {
  try {
    const fromUrl = new URL(url || HOME).searchParams.get("token");
    if (fromUrl) return fromUrl;
  } catch {
    // ignore
  }
  return (
    (html.match(/data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/) || [])[1] ||
    (html.match(/[?&]token=(\d{6,})/) || [])[1] ||
    (html.match(/token["']?\s*[:=]\s*["']?(\d{6,})/) || [])[1] ||
    ""
  );
}

function formatApiError(data) {
  const ret = data?.ret ?? data?.base_resp?.ret;
  if (ret != null && API_ERRORS[ret]) return API_ERRORS[ret];
  const msg =
    data?.base_resp?.err_msg ||
    data?.errmsg ||
    data?.error ||
    (ret != null ? `同步失败（错误码 ${ret}）` : "");
  return msg || "公众号草稿接口没有返回稿件 ID";
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
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {{ token: string, userName: string, nickName: string, ticket: string, svrTime: number, avatar: string } | null} */
    weixinMeta = null;

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

    async loadWeixinMeta() {
      const res = await this.runtime.fetch(HOME, {
        method: "GET",
        credentials: "include",
        redirect: "follow",
      });
      const html = await res.text();
      const finalUrl = res.url || HOME;
      if (
        /loginpage|login\?/i.test(finalUrl) ||
        (/微信扫一扫/.test(html) && /login__type|login_qrcode/.test(html))
      ) {
        this.weixinMeta = null;
        return null;
      }
      const token = pickToken(html, finalUrl);
      if (!token) {
        this.weixinMeta = null;
        return null;
      }
      const ticket = (html.match(/ticket:\s*["']([^"']+)["']/) || [])[1] || "";
      const userName =
        (html.match(/user_name:\s*["']([^"']+)["']/) || [])[1] || "";
      const nickName =
        (html.match(/nick_name:\s*["']([^"']+)["']/) || [])[1] || "微信公众号";
      const svrTime = Number((html.match(/time:\s*["'](\d+)["']/) || [])[1] || 0);
      const thumb =
        (html.match(
          /class="weui-desktop-account__thumb"[^>]*src="([^"]+)"/,
        ) || [])[1] ||
        (html.match(/head_img:\s*['"]([^'"]+)['"]/) || [])[1] ||
        "";
      this.weixinMeta = {
        token,
        userName,
        nickName,
        ticket,
        svrTime: svrTime || Math.floor(Date.now() / 1000),
        avatar: thumb.replace(/^http:\/\//i, "https://"),
      };
      return this.weixinMeta;
    }

    async checkAuth() {
      try {
        if (!(await this.hasSessionCookie())) {
          return {
            isAuthenticated: false,
            error: "未登录公众号，请先在 Chrome 打开 https://mp.weixin.qq.com/ 扫码登录",
          };
        }
        const meta = await this.loadWeixinMeta();
        if (!meta?.token) {
          return {
            isAuthenticated: false,
            error: "公众号登录已过期，请重新扫码登录后再同步",
          };
        }
        return {
          isAuthenticated: true,
          userId: meta.userName || "weixin",
          username: meta.nickName || "微信公众号",
          avatar: meta.avatar,
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
      if (/mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn|qpic\.cn/i.test(src)) {
        return { url: src };
      }
      if (!this.weixinMeta?.token) {
        const meta = await this.loadWeixinMeta();
        if (!meta?.token) throw new Error("未登录公众号，无法上传图片");
      }
      const imageRes = await this.runtime.fetch(src);
      if (!imageRes.ok) throw new Error(`图片下载失败：${src.slice(0, 80)}`);
      const blob = await imageRes.blob();
      const id = Date.now();
      const name = `${id}.jpg`;
      const form = new FormData();
      form.append("type", blob.type || "image/jpeg");
      form.append("id", String(id));
      form.append("name", name);
      form.append("lastModifiedDate", new Date().toString());
      form.append("size", String(blob.size));
      form.append("file", blob, name);
      const { token, userName, ticket, svrTime } = this.weixinMeta;
      const seq = Date.now();
      const uploadUrl =
        `https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material` +
        `&f=json&scene=8&writetype=doublewrite&groupid=1` +
        `&ticket_id=${encodeURIComponent(userName || "")}` +
        `&ticket=${encodeURIComponent(ticket || "")}` +
        `&svr_time=${svrTime}&token=${token}&lang=zh_CN` +
        `&seq=${seq}&t=${Math.random()}`;
      const res = await this.runtime.fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await this.parseJson(res);
      if (data?.base_resp?.err_msg !== "ok" || !data?.cdn_url) {
        throw new Error(`公众号图片上传失败：${src.slice(0, 80)}`);
      }
      return { url: data.cdn_url };
    }

    async parseJson(res) {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text.slice(0, 200), ret: -1 };
      }
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

    prepareHtml(raw) {
      let html = String(raw || "");
      if (typeof this.cleanHtml === "function") {
        html = this.cleanHtml(html, {
          removeIframes: true,
          removeSvgImages: true,
          removeTags: ["qqmusic"],
          removeAttrs: ["data-reader-unique-id", "_src"],
        });
      }
      return styleWeixinHtml(html);
    }

    async saveDraftViaApi(article, html) {
      if (!this.weixinMeta?.token) {
        await this.loadWeixinMeta();
      }
      const token = this.weixinMeta?.token;
      if (!token) throw new Error("无法从公众号后台取得 token，请重新登录");

      const title = String(article.title || "").trim().slice(0, 64);
      const digest = String(article.desc || article.summary || title)
        .trim()
        .slice(0, 120);
      const body = new URLSearchParams({
        token,
        lang: "zh_CN",
        f: "json",
        ajax: "1",
        random: String(Math.random()),
        AppMsgId: "",
        count: "1",
        data_seq: "0",
        operate_from: "Chrome",
        isnew: "0",
        ad_video_transition0: "",
        can_reward0: "0",
        related_video0: "",
        is_video_recommend0: "-1",
        title0: title,
        author0: "",
        writerid0: "0",
        fileid0: "",
        digest0: digest,
        auto_gen_digest0: digest ? "0" : "1",
        content0: html,
        sourceurl0: "",
        need_open_comment0: "1",
        only_fans_can_comment0: "0",
        cdn_url0: "",
        cdn_235_1_url0: "",
        cdn_1_1_url0: "",
        cdn_url_back0: "",
        crop_list0: "",
        music_id0: "",
        video_id0: "",
        voteid0: "",
        voteismlt0: "",
        supervoteid0: "",
        cardid0: "",
        cardquantity0: "",
        cardlimit0: "",
        vid_type0: "",
        show_cover_pic0: "0",
        shortvideofileid0: "",
        copyright_type0: "0",
        releasefirst0: "",
        platform0: "",
        reprint_permit_type0: "",
        allow_reprint0: "",
        allow_reprint_modify0: "",
        original_article_type0: "",
        ori_white_list0: "",
        free_content0: "",
        fee0: "0",
        ad_id0: "",
        guide_words0: "",
        is_share_copyright0: "0",
        share_copyright_url0: "",
        source_article_type0: "",
        reprint_recommend_title0: "",
        reprint_recommend_content0: "",
        share_page_type0: "0",
        share_imageinfo0: '{"list":[]}',
        share_video_id0: "",
        dot0: "{}",
        share_voice_id0: "",
        insert_ad_mode0: "",
        categories_list0: "[]",
      });
      const res = await this.runtime.fetch(
        `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${token}&lang=zh_CN`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
      );
      const data = await this.parseJson(res);
      const appMsgId = data?.appMsgId || data?.appmsgid;
      if (!appMsgId) throw new Error(formatApiError(data));
      return {
        appMsgId: String(appMsgId),
        postUrl: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${appMsgId}&token=${token}&lang=zh_CN`,
      };
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
            const pageHtml = document.documentElement?.innerHTML || "";
            token =
              (pageHtml.match(/t:\s*["'](\d+)["']/) || [])[1] ||
              (pageHtml.match(/token["']?\s*[:=]\s*["']?(\d+)/) || [])[1] ||
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
            const makeDataTransfer = (htmlValue, textValue) => {
              const dt = new DataTransfer();
              dt.setData("text/html", htmlValue);
              dt.setData("text/plain", textValue || htmlValue);
              return dt;
            };
            const pasteHtml = (el, htmlValue, textValue) => {
              el.focus();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              sel?.removeAllRanges();
              sel?.addRange(range);
              const dt = makeDataTransfer(htmlValue, textValue);
              const before = new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertFromPaste",
                dataTransfer: dt,
              });
              if (el.dispatchEvent(before) === false) return true;
              const pasted = el.dispatchEvent(
                new ClipboardEvent("paste", {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: dt,
                }),
              );
              if (pasted === false) return true;
              if (typeof document.execCommand === "function") {
                if (document.execCommand("insertHTML", false, htmlValue)) {
                  return true;
                }
              }
              el.innerHTML = htmlValue;
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  inputType: "insertFromPaste",
                }),
              );
              return true;
            };
            const replaceText = (el, value) => {
              el.focus();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              sel?.removeAllRanges();
              sel?.addRange(range);
              if (typeof document.execCommand === "function") {
                document.execCommand("insertText", false, value);
              } else {
                el.textContent = value;
              }
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  inputType: "insertText",
                }),
              );
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

            const nextTitle = String(payload.title || "").slice(0, 64);
            setHiddenTitle(nextTitle);
            replaceText(titlePm, nextTitle);
            if (titlePm === bodyPm) {
              const after = Array.from(document.querySelectorAll(".ProseMirror"));
              bodyPm = after.length >= 2 ? after[1] : bodyPm;
            }

            pasteHtml(
              bodyPm,
              payload.html || `<p>${payload.plain || ""}</p>`,
              payload.plain || "",
            );
            let filledBody = String(bodyPm.innerText || "").trim();
            if (filledBody.length < 5 && payload.plain) {
              replaceText(bodyPm, payload.plain.slice(0, 5000));
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
              message: `已写入标题「${nextTitle.slice(0, 16)}」和正文`,
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

    async fillEditorFallback(title, html, plain, summary) {
      if (typeof chrome === "undefined" || !chrome.tabs?.create) {
        throw new Error("扩展没有标签页权限，请重新加载点物扩展");
      }
      const tab = await this.openEditorTab();
      if (!tab?.id) throw new Error("打不开公众号图文编辑器");
      const dom = await this.fillViaDebugger(tab.id, title, html, plain, summary);
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
          "。封面和发表请你在打开的标签里点。",
      });
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "未登录微信公众号");
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
          },
        );
        assertNoLocalImages(content, "微信公众号");
        const styled = this.prepareHtml(content);
        const plain = this.htmlToPlain(styled);
        const summary = String(article.desc || article.summary || "").trim();

        try {
          const saved = await this.saveDraftViaApi(article, styled);
          return this.createResult(true, {
            postId: saved.appMsgId,
            postUrl: saved.postUrl,
            draftOnly: true,
            message: `已存公众号草稿「${title.slice(0, 16)}」，打开即可改封面和发表`,
          });
        } catch (apiErr) {
          const apiMsg =
            apiErr instanceof Error ? apiErr.message : String(apiErr);
          if (/登录|验证码|未登录/.test(apiMsg)) {
            throw apiErr;
          }
          return this.fillEditorFallback(title, styled, plain, summary);
        }
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
