/**
 * 八方资源网 — 填稿确认制
 *
 * 打开会员中心「发布产品」页（pg=Supply）→ 填标题/详情 → 注入产品图
 * → 留给用户确认分类/属性后点发布。
 */
import {
  assertPublicImageUrl,
  assertNoLocalImages,
  extractImageSrcs,
} from "./_images.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const EDITOR_URL = "https://m.b2b168.com/Index.aspx?pg=Supply";
const LOGIN_URL = "https://m.b2b168.com/Index.aspx?pg=login";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createBafangAdapter(BaseAdapter) {
  return class BafangAdapter extends BaseAdapter {
    meta = {
      id: "bafang",
      name: "八方资源网",
      icon: "https://www.b2b168.com/favicon.ico",
      homepage: EDITOR_URL,
      capabilities: ["article", "image_upload", "cover"],
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

    async hasSiteCookies() {
      if (typeof chrome === "undefined" || !chrome.cookies?.getAll) {
        return false;
      }
      try {
        const all = await chrome.cookies.getAll({ domain: "b2b168.com" });
        return (Array.isArray(all) ? all : []).some((c) => Boolean(c?.value));
      } catch {
        return false;
      }
    }

    async probeLoggedIn() {
      try {
        const res = await fetch(EDITOR_URL, {
          credentials: "include",
          redirect: "follow",
          cache: "no-store",
        });
        const url = String(res.url || "");
        if (/pg=login|\/login/i.test(url)) return false;
        const text = await res.text();
        if (
          /会员登录|请输入您注册的会员帐号|微信扫码登录/.test(text) &&
          !/发布产品|产品标题|详细说明|pg=Supply/i.test(text)
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    async ensureAccount() {
      if (this.account) return this.account;
      const probed = await this.probeLoggedIn();
      if (!probed && !(await this.hasSiteCookies())) {
        throw new Error(
          `未登录八方资源网，请先在 Chrome 打开 ${LOGIN_URL} 登录会员中心`,
        );
      }
      this.account = {
        userId: "bafang",
        username: "八方资源网会员",
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
      assertPublicImageUrl(src, "八方资源网");
      return { url: src };
    }

    collectImageUrls(article, contentHtml) {
      /** @type {string[]} */
      const urls = [];
      const push = (u) => {
        const s = String(u || "").trim();
        if (!s || !/^https?:\/\//i.test(s)) return;
        if (urls.includes(s)) return;
        urls.push(s);
      };
      push(article.cover || article.thumb);
      for (const src of extractImageSrcs(contentHtml)) push(src);
      return urls.slice(0, 6);
    }

    async fetchImagesAsPayload(urls, onProgress) {
      /** @type {Array<{ name: string; type: string; base64: string }>} */
      const files = [];
      const total = urls.length;
      for (let i = 0; i < urls.length; i++) {
        const src = urls[i];
        onProgress?.({ current: i + 1, total, phase: "download" });
        assertPublicImageUrl(src, "八方资源网");
        const res = await this.runtime.fetch(src, { credentials: "omit" });
        if (!res.ok) {
          throw new Error(`产品图下载失败(${res.status}): ${src.slice(0, 96)}`);
        }
        const blob = await res.blob();
        const type = blob.type || "image/jpeg";
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let j = 0; j < bytes.length; j += chunk) {
          binary += String.fromCharCode(...bytes.subarray(j, j + chunk));
        }
        const ext = /png/i.test(type)
          ? "png"
          : /webp/i.test(type)
            ? "webp"
            : /gif/i.test(type)
              ? "gif"
              : "jpg";
        files.push({
          name: `bafang_${Date.now()}_${i}.${ext}`,
          type,
          base64: btoa(binary),
        });
      }
      return files;
    }

    async fillViaDom(title, html, imageFiles) {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.create ||
        !chrome.scripting?.executeScript
      ) {
        return { ok: false, error: "无 tabs/scripting 权限" };
      }

      try {
        const tabs = await chrome.tabs.query({
          url: ["*://m.b2b168.com/*", "*://*.b2b168.com/*"],
        });
        let tab =
          tabs.find((t) => /pg=Supply|pg=Product/i.test(t.url || "")) ||
          tabs.find((t) => /m\.b2b168\.com/i.test(t.url || "")) ||
          null;

        if (!tab?.id) {
          tab = await chrome.tabs.create({ url: EDITOR_URL, active: true });
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 2200));
        } else {
          await chrome.tabs
            .update(tab.id, { url: EDITOR_URL, active: true })
            .catch(() => chrome.tabs.update(tab.id, { active: true }));
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 1800));
        }

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const { title: t, html: h, images } = payload;
            const href = location.href + " " + document.title;
            if (/pg=login|会员登录|请输入您注册的会员帐号/i.test(href)) {
              return {
                ok: false,
                error: "请先登录八方资源网会员中心后再同步",
              };
            }

            const setNativeValue = (el, value) => {
              const proto =
                el.tagName === "TEXTAREA"
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              const nativeSet = Object.getOwnPropertyDescriptor(
                proto,
                "value",
              )?.set;
              if (nativeSet) nativeSet.call(el, value);
              else el.value = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            };

            const titleCandidates = [
              'input[name="Title"]',
              'input[name="title"]',
              'input#Title',
              'input#title',
              'input[name="ProductTitle"]',
              'input[name="txtTitle"]',
              'input[id*="Title"]',
              'input[name*="Title"]',
              'input[placeholder*="标题"]',
              'input[placeholder*="产品名称"]',
              'textarea[placeholder*="标题"]',
            ];
            let titleEl = null;
            for (const sel of titleCandidates) {
              try {
                titleEl = document.querySelector(sel);
              } catch {
                titleEl = null;
              }
              if (titleEl) break;
            }
            if (!titleEl) {
              const labeled = Array.from(
                document.querySelectorAll("label, span, td, th, div, b, strong"),
              ).find((n) =>
                /^(产品)?(信息)?标题$|产品名称|信息标题/.test(
                  (n.textContent || "").trim(),
                ),
              );
              const wrap = labeled?.closest(
                "tr, .layui-form-item, .form-group, li, div, table",
              );
              titleEl =
                wrap?.querySelector("input[type='text'], input:not([type]), textarea") ||
                document.querySelector("form input[type='text']");
            }
            if (!titleEl) {
              return {
                ok: false,
                error:
                  "未找到八方资源网产品标题输入框，请确认已打开「发布产品」页",
              };
            }
            titleEl.focus();
            if ("value" in titleEl) setNativeValue(titleEl, t);
            else titleEl.textContent = t;

            const keywordEl =
              document.querySelector('input[name="Keyword"]') ||
              document.querySelector('input[name="Keywords"]') ||
              document.querySelector('input[name="txtKeyword"]') ||
              document.querySelector('input[id*="Keyword"]') ||
              document.querySelector('input[placeholder*="关键词"]');
            if (keywordEl && "value" in keywordEl && !keywordEl.value) {
              setNativeValue(keywordEl, String(t).slice(0, 8));
            }

            const b64ToFile = (item) => {
              const bin = atob(item.base64);
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              return new File([arr], item.name, {
                type: item.type || "image/jpeg",
              });
            };

            let uploaded = 0;
            const fileList = Array.isArray(images)
              ? images.map(b64ToFile).filter(Boolean)
              : [];

            if (fileList.length) {
              /** @type {HTMLInputElement[]} */
              const fileInputs = Array.from(
                document.querySelectorAll('input[type="file"]'),
              ).filter((el) => {
                const acc = (el.getAttribute("accept") || "").toLowerCase();
                if (!acc) return true;
                return /image|\.png|\.jpe?g|\.gif|\.webp|\*/i.test(acc);
              });

              const injectFiles = (input, files) => {
                try {
                  const dt = new DataTransfer();
                  const max = input.multiple ? files.length : 1;
                  for (let i = 0; i < max; i++) dt.items.add(files[i]);
                  input.files = dt.files;
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                  return dt.files.length;
                } catch {
                  return 0;
                }
              };

              if (fileInputs.length) {
                uploaded = injectFiles(fileInputs[0], fileList);
                if (fileInputs[0].multiple === false && fileList.length > 1) {
                  for (
                    let i = 1;
                    i < Math.min(fileInputs.length, fileList.length);
                    i++
                  ) {
                    uploaded += injectFiles(fileInputs[i], [fileList[i]]);
                  }
                }
              } else {
                const uploadBtn = Array.from(
                  document.querySelectorAll(
                    "button, a, span, div, label, input[type='button']",
                  ),
                ).find((n) =>
                  /上传图片|添加图片|选择图片|产品图片|点击上传|浏览/.test(
                    (n.textContent || n.value || "").trim(),
                  ),
                );
                uploadBtn?.dispatchEvent(
                  new MouseEvent("click", { bubbles: true }),
                );
                await sleep(600);
                const again = document.querySelector('input[type="file"]');
                if (again) uploaded = injectFiles(again, fileList);
              }
            }

            const trySetEditorHtml = (htmlContent) => {
              try {
                const UE = window.UE;
                if (UE?.getEditor) {
                  for (const id of [
                    "editor",
                    "content",
                    "txtContent",
                    "Description",
                    "description",
                    "body",
                  ]) {
                    try {
                      const ed = UE.getEditor(id);
                      if (ed && !ed.isDestroyed?.()) {
                        ed.setContent(htmlContent);
                        return "ueditor:" + id;
                      }
                    } catch {
                      // next
                    }
                  }
                  const list = UE.instants || UE.instances;
                  if (list) {
                    const keys = Object.keys(list);
                    if (keys.length) {
                      list[keys[0]].setContent(htmlContent);
                      return "ueditor:first";
                    }
                  }
                }
              } catch {
                // ignore
              }

              try {
                const KE = window.KindEditor;
                if (KE?.instances?.length) {
                  KE.instances[0].html(htmlContent);
                  return "kindeditor";
                }
              } catch {
                // ignore
              }

              const editor =
                document.querySelector(".ql-editor") ||
                document.querySelector(".ProseMirror") ||
                document.querySelector(".w-e-text") ||
                document.querySelector(
                  ".w-e-text-container [contenteditable]",
                ) ||
                document.querySelector(
                  "iframe.edui-editor-iframeholder iframe, iframe#ueditor_0, .edui-editor iframe",
                ) ||
                document.querySelector('[contenteditable="true"]');

              if (editor?.tagName === "IFRAME") {
                const doc =
                  editor.contentDocument || editor.contentWindow?.document;
                if (doc?.body) {
                  doc.body.innerHTML = htmlContent;
                  return "iframe";
                }
              }
              if (editor) {
                editor.focus?.();
                try {
                  document.execCommand("selectAll", false);
                  document.execCommand("insertHTML", false, htmlContent);
                } catch {
                  editor.innerHTML = htmlContent;
                }
                editor.dispatchEvent?.(new Event("input", { bubbles: true }));
                return "contenteditable";
              }

              const ta =
                document.querySelector('textarea[name="Content"]') ||
                document.querySelector('textarea[name="content"]') ||
                document.querySelector('textarea[name="Description"]') ||
                document.querySelector("textarea#editor") ||
                document.querySelector("textarea#content") ||
                Array.from(document.querySelectorAll("textarea")).find((el) =>
                  /内容|详情|说明|描述/.test(
                    (
                      el.getAttribute("placeholder") ||
                      el.name ||
                      el.id ||
                      ""
                    ).toString(),
                  ),
                );
              if (ta) {
                setNativeValue(ta, htmlContent);
                return "textarea";
              }
              return null;
            };

            const mode = trySetEditorHtml(h);
            if (!mode) {
              return {
                ok: false,
                error:
                  "未找到八方资源网产品详情编辑器。请确认「发布产品」页已加载完成",
              };
            }

            await sleep(500);
            const needImgHint =
              fileList.length > 0 && uploaded === 0
                ? "；产品图未能自动挂上，请在页面手动上传后再发布"
                : uploaded > 0
                  ? `；已尝试挂载 ${uploaded} 张产品图`
                  : "；未提供产品图，请在页面上传后再发布";

            return {
              ok: true,
              postUrl: location.href,
              awaitingUserPublish: true,
              uploaded,
              message: `已填入产品标题与详情（${mode}）${needImgHint}。请确认分类/属性后点「发布」（不自动发布）`,
            };
          },
          args: [
            {
              title: String(title || "").slice(0, 32),
              html,
              images: imageFiles,
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
          throw new Error(auth.error || "未登录八方资源网");
        }

        const title = String(article.title || "").trim().slice(0, 32);
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["b2b168.com", "i.b2b168.com"],
            onProgress: options?.onImageProgress,
            allowPublicExternal: true,
          },
        );
        assertNoLocalImages(content, "八方资源网");

        const imageUrls = this.collectImageUrls(article, content);
        if (!imageUrls.length) {
          throw new Error(
            "八方资源网发布产品需要图片：请先给文章加封面或正文图（公网地址）",
          );
        }
        const imageFiles = await this.fetchImagesAsPayload(
          imageUrls,
          options?.onImageProgress,
        );

        const dom = await this.fillViaDom(title, content, imageFiles);
        if (!dom.ok) {
          return this.createResult(false, {
            error: dom.error || "八方资源网填稿失败",
            draftOnly: true,
          });
        }

        watchFillConfirmTab({
          tabId: dom.tabId,
          platform: "bafang",
          isEditorUrl: (url) => /pg=Supply|pg=Product/i.test(url),
        });

        return this.createResult(true, {
          postUrl: dom.postUrl || EDITOR_URL,
          draftOnly: true,
          awaitingUserPublish: true,
          outcome: "filled_awaiting_publish",
          message:
            dom.message || "已填入产品信息，请确认图片与分类后点「发布」",
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
