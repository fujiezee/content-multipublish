/**
 * 顺企网新闻 — 填稿确认制（无稳定公开草稿 API）
 *
 * 打开会员后台「添加新闻」页 → 填标题/正文 → 把 1 张公网图挂到新闻图片
 * （封面优先，否则正文首图）→ 留给用户确认后点发布。
 */
import {
  assertPublicImageUrl,
  assertNoLocalImages,
  extractImageSrcs,
} from "./_images.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const EDITOR_URL = "https://cp.11467.com/Home/personal/news_add";
const LOGIN_URL = "https://cp.11467.com/home/login/index";
/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createShunqiAdapter(BaseAdapter) {
  return class ShunqiAdapter extends BaseAdapter {
    meta = {
      id: "shunqi",
      name: "顺企网",
      icon: "https://www.11467.com/favicon.ico",
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
        const all = await chrome.cookies.getAll({ domain: "11467.com" });
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
        if (/\/login|nologin/i.test(url)) return false;
        const text = await res.text();
        if (
          /请输入手机号|用户登录|欢迎回来/.test(text) &&
          !/新闻标题|发布新闻|添加新闻|news_add/i.test(text)
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
          `未登录顺企网，请先在 Chrome 打开 ${LOGIN_URL} 登录会员后台`,
        );
      }
      // Cookie 名因微信登录不稳定；最终以打开 news_add 是否跳登录页为准
      this.account = {
        userId: "shunqi",
        username: "顺企网会员",
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
      assertPublicImageUrl(src, "顺企网");
      return { url: src };
    }

    collectCoverUrl(article, contentHtml) {
      const push = (u) => {
        const s = String(u || "").trim();
        if (!s || !/^https?:\/\//i.test(s)) return "";
        return s;
      };
      return (
        push(article.cover || article.thumb) ||
        extractImageSrcs(contentHtml).map(push).find(Boolean) ||
        ""
      );
    }

    async fetchImagesAsPayload(urls, onProgress) {
      /** @type {Array<{ name: string; type: string; base64: string }>} */
      const files = [];
      const total = urls.length;
      for (let i = 0; i < urls.length; i++) {
        const src = urls[i];
        onProgress?.({ current: i + 1, total, phase: "download" });
        assertPublicImageUrl(src, "顺企网");
        const res = await this.runtime.fetch(src, { credentials: "omit" });
        if (!res.ok) {
          throw new Error(`新闻图下载失败(${res.status}): ${src.slice(0, 96)}`);
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
          name: `news_${Date.now()}_${i}.${ext}`,
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
          url: ["*://cp.11467.com/*", "*://*.11467.com/*"],
        });
        let tab =
          tabs.find((t) => /news_add|personal/i.test(t.url || "")) ||
          tabs[0] ||
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
            if (/\/login|nologin|用户登录|欢迎回来/i.test(href)) {
              return {
                ok: false,
                error: "请先登录顺企网会员后台后再同步",
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
              'input[name="title"]',
              'input[name="news_title"]',
              'input[name="newstitle"]',
              'input#title',
              'input[placeholder*="标题"]',
              'textarea[placeholder*="标题"]',
              'input[placeholder*="新闻"]',
              'input.layui-input[name*="title"]',
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
                document.querySelectorAll("label, span, td, th, div"),
              ).find((n) =>
                /^(新闻)?标题/.test((n.textContent || "").trim()),
              );
              const wrap = labeled?.closest("tr, .layui-form-item, .form-group, li, div");
              titleEl =
                wrap?.querySelector("input, textarea") ||
                document.querySelector("form input[type='text']");
            }
            if (!titleEl) {
              return {
                ok: false,
                error: "未找到顺企网新闻标题输入框，请确认已打开「添加新闻」页",
              };
            }
            titleEl.focus();
            if ("value" in titleEl) setNativeValue(titleEl, t);
            else titleEl.textContent = t;

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
              ? images.map(b64ToFile).filter(Boolean).slice(0, 1)
              : [];

            if (fileList.length) {
              const isEditorUpload = (el) => {
                const blob = `${el.id} ${el.name} ${el.className}`;
                if (/edui|ueditor|webuploader|ke-upload|w-e-|ql-image/i.test(blob)) {
                  return true;
                }
                return Boolean(
                  el.closest(
                    ".edui-dialog, .edui-container, .ke-dialog, .w-e-modal, .ql-tooltip",
                  ),
                );
              };

              const scoreInput = (el) => {
                if (isEditorUpload(el)) return -100;
                let s = 0;
                const name = `${el.name} ${el.id} ${el.className}`.toLowerCase();
                if (/pic|thumb|cover|image|img|photo|logo|news.?img/.test(name)) {
                  s += 8;
                }
                const wrap = el.closest(
                  "tr, .layui-form-item, .form-group, .control-group, li, div",
                );
                const label = (wrap?.innerText || wrap?.textContent || "").slice(
                  0,
                  120,
                );
                if (/新闻图片|缩略图|封面|配图|标题图/.test(label)) s += 12;
                else if (/图片/.test(label) && !/正文|内容|编辑器/.test(label)) {
                  s += 5;
                }
                return s;
              };

              const injectFiles = (input, files) => {
                try {
                  const dt = new DataTransfer();
                  dt.items.add(files[0]);
                  input.files = dt.files;
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                  return dt.files.length;
                } catch {
                  return 0;
                }
              };

              /** @type {HTMLInputElement[]} */
              const fileInputs = Array.from(
                document.querySelectorAll('input[type="file"]'),
              )
                .filter((el) => {
                  const acc = (el.getAttribute("accept") || "").toLowerCase();
                  if (acc && !/image|\.png|\.jpe?g|\.gif|\.webp|\*/i.test(acc)) {
                    return false;
                  }
                  return scoreInput(el) >= 0;
                })
                .sort((a, b) => scoreInput(b) - scoreInput(a));

              if (fileInputs.length && scoreInput(fileInputs[0]) > 0) {
                uploaded = injectFiles(fileInputs[0], fileList);
              } else {
                const uploadBtn = Array.from(
                  document.querySelectorAll(
                    "button, a, span, div, label, .layui-btn",
                  ),
                ).find((n) => {
                  if (n.closest(".edui-dialog, .edui-container, .ke-dialog")) {
                    return false;
                  }
                  return /上传图片|选择图片|新闻图片|添加图片|点击上传/.test(
                    (n.textContent || "").trim(),
                  );
                });
                uploadBtn?.dispatchEvent(
                  new MouseEvent("click", { bubbles: true }),
                );
                await sleep(600);
                const again = Array.from(
                  document.querySelectorAll('input[type="file"]'),
                )
                  .filter((el) => scoreInput(el) >= 0)
                  .sort((a, b) => scoreInput(b) - scoreInput(a))[0];
                if (again) uploaded = injectFiles(again, fileList);
                else if (fileInputs.length) {
                  uploaded = injectFiles(fileInputs[0], fileList);
                }
              }

              const preview =
                document.querySelector(
                  "img#pic, img.thumb, img.preview, .news-pic img, .layui-upload-img",
                ) ||
                fileInputs[0]
                  ?.closest("tr, .layui-form-item, .form-group, div")
                  ?.querySelector("img");
              if (preview && fileList[0]) {
                try {
                  preview.src = URL.createObjectURL(fileList[0]);
                } catch {
                  // preview optional
                }
              }
            }

            const trySetEditorHtml = (htmlContent) => {
              // UEditor
              try {
                const UE = window.UE;
                if (UE?.getEditor) {
                  for (const id of [
                    "content",
                    "editor",
                    "news_content",
                    "body",
                    "description",
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

              // KindEditor
              try {
                const KE = window.KindEditor;
                if (KE?.instances?.length) {
                  KE.instances[0].html(htmlContent);
                  return "kindeditor";
                }
              } catch {
                // ignore
              }

              // wangEditor / toastui / quill / proseMirror / contenteditable
              const editor =
                document.querySelector(".ql-editor") ||
                document.querySelector(".ProseMirror") ||
                document.querySelector(".w-e-text") ||
                document.querySelector(".w-e-text-container [contenteditable]") ||
                document.querySelector(
                  'iframe.edui-editor-iframeholder iframe, iframe#ueditor_0, .edui-editor iframe',
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
                document.querySelector('textarea[name="content"]') ||
                document.querySelector('textarea[name="news_content"]') ||
                document.querySelector("textarea#content") ||
                document.querySelector("textarea.layui-textarea") ||
                Array.from(document.querySelectorAll("textarea")).find((el) =>
                  /内容|正文|详情/.test(
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
                  "未找到顺企网新闻正文编辑器（UEditor/文本框）。请确认页面已加载完成",
              };
            }

            await sleep(500);
            const imgHint =
              fileList.length > 0 && uploaded === 0
                ? "；新闻图未能自动挂上，请在页面手动上传 1 张图后再发布"
                : uploaded > 0
                  ? "；已尝试挂载 1 张新闻图"
                  : "；未提供新闻图，可在页面补一张后再发布";
            return {
              ok: true,
              postUrl: location.href,
              awaitingUserPublish: true,
              uploaded,
              message: `已填入标题与正文（${mode}）${imgHint}。请确认分类后点「发布」（不自动发布）`,
            };
          },
          args: [
            {
              title: String(title || "").slice(0, 80),
              html,
              images: imageFiles || [],
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
          throw new Error(auth.error || "未登录顺企网");
        }

        const title = String(article.title || "").trim().slice(0, 80);
        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["11467.com", "static.11467.com"],
            onProgress: options?.onImageProgress,
            allowPublicExternal: true,
          },
        );
        assertNoLocalImages(content, "顺企网");

        /** @type {Array<{ name: string; type: string; base64: string }>} */
        let imageFiles = [];
        const coverUrl = this.collectCoverUrl(article, content);
        if (coverUrl) {
          try {
            imageFiles = await this.fetchImagesAsPayload(
              [coverUrl],
              options?.onImageProgress,
            );
          } catch (err) {
            console.warn("[dianwu-geo] shunqi news image:", err);
          }
        }

        const dom = await this.fillViaDom(title, content, imageFiles);
        if (!dom.ok) {
          return this.createResult(false, {
            error: dom.error || "顺企网填稿失败",
            draftOnly: true,
          });
        }

        watchFillConfirmTab({
          tabId: dom.tabId,
          platform: "shunqi",
          isEditorUrl: (url) => /news_add/i.test(url),
        });

        return this.createResult(true, {
          postUrl: dom.postUrl || EDITOR_URL,
          draftOnly: true,
          awaitingUserPublish: true,
          outcome: "filled_awaiting_publish",
          message:
            dom.message ||
            "已填入标题、正文与新闻图，请确认后点「发布」",
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
