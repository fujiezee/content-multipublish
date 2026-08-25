/**
 * 腾讯云开发者社区（cloud.tencent.com/developer）
 *
 * 草稿：POST /api/article/addArticleDraft
 * 必须在站点页 MAIN world 发请求（带登录 Cookie）；扩展后台 fetch 常挂起导致「同步中」一直不结束。
 */
import { assertNoLocalImages, extractImageSrcs } from "./_images.js";

const BASE = "https://cloud.tencent.com/developer";
const WRITE = "https://cloud.tencent.com/developer/article/write-new";
const FETCH_MS = 25_000;

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createTencentcloudAdapter(BaseAdapter) {
  return class TencentcloudAdapter extends BaseAdapter {
    meta = {
      id: "tencentcloud",
      name: "腾讯云+",
      icon: "https://cloud.tencent.com/favicon.ico",
      homepage: WRITE,
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {number | null} */
    siteTabId = null;

    htmlToMarkdown(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h([1-6])>/gi, "\n\n")
        .replace(/<h([1-6])[^>]*>/gi, (_, n) => `${"#".repeat(Number(n))} `)
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/?(ul|ol|div|span|section)[^>]*>/gi, "")
        .replace(
          /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          "[$2]($1)",
        )
        .replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, "![]($1)")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    extractPlain(md) {
      return String(md || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/(\*\*|__)([\s\S]*?)\1/g, "$2")
        .replace(/(\*|_)([^*_\n]+)\1/g, "$2")
        .replace(/^>\s?/gm, "")
        .replace(/^[-*+]\s+/gm, "")
        .replace(/^\d+\.\s+/gm, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    wrapMarkdown(md) {
      return `<!--markdown-->\n${md}\n<!--/markdown-->`;
    }

    waitTabComplete(tabId, timeoutMs = 30_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          reject(new Error("腾讯云+ 页面加载超时"));
        }, timeoutMs);
        const onUpdated = (id, info) => {
          if (id === tabId && info.status === "complete") {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            setTimeout(resolve, 600);
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
          if (tab?.status === "complete") {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            setTimeout(resolve, 300);
          }
        });
      });
    }

    /**
     * @param {{ createIfMissing?: boolean }} [opts]
     * createIfMissing 仅同步草稿时为 true；CHECK_ALL_AUTH / 重载验登录禁止建页。
     */
    async ensureSiteTab(opts = {}) {
      const createIfMissing = opts.createIfMissing !== false;
      if (this.siteTabId) {
        try {
          const tab = await chrome.tabs.get(this.siteTabId);
          if (tab?.id && /cloud\.tencent\.com\/developer/i.test(tab.url || "")) {
            return tab.id;
          }
        } catch {
          this.siteTabId = null;
        }
      }
      const tabs = await chrome.tabs.query({
        url: ["*://cloud.tencent.com/developer/*"],
      });
      let tab =
        tabs.find((t) => /write-new|article/i.test(t.url || "")) || tabs[0];
      if (!tab?.id) {
        if (!createIfMissing) return null;
        tab = await chrome.tabs.create({ url: WRITE, active: false });
        await this.waitTabComplete(tab.id);
      } else if (tab.status !== "complete") {
        await this.waitTabComplete(tab.id);
      }
      this.siteTabId = tab.id;
      return tab.id;
    }

    async hasLoginCookies() {
      if (typeof chrome === "undefined" || !chrome.cookies?.getAll) {
        return false;
      }
      try {
        const chunks = await Promise.all([
          chrome.cookies.getAll({ domain: "cloud.tencent.com" }),
          chrome.cookies.getAll({ domain: "tencent.com" }),
          chrome.cookies.getAll({ domain: "qq.com" }),
        ]);
        const all = chunks.flat().filter(Boolean);
        return all.some(
          (c) =>
            c?.value &&
            /uin|skey|p_skey|sid|token|session|login|RK|uid|openkey/i.test(
              String(c.name || ""),
            ),
        );
      } catch {
        return false;
      }
    }

    /**
     * Run JSON POST in the developer site page (has session cookies).
     * @param {string} path
     * @param {Record<string, unknown>} payload
     */
    async apiPost(path, payload) {
      const tabId = await this.ensureSiteTab({ createIfMissing: true });
      if (!tabId) {
        throw new Error("无法打开腾讯云+ 开发者页");
      }
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (reqPath, body, timeoutMs) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          try {
            const res = await fetch(
              `https://cloud.tencent.com/developer${reqPath}`,
              {
                method: "POST",
                credentials: "include",
                headers: {
                  Accept: "application/json, text/plain, */*",
                  "Content-Type": "application/json",
                  Origin: "https://cloud.tencent.com",
                  Referer:
                    "https://cloud.tencent.com/developer/article/write-new",
                },
                body: JSON.stringify(body),
                signal: ctrl.signal,
              },
            );
            const text = await res.text();
            let data = null;
            try {
              data = JSON.parse(text);
            } catch {
              return {
                ok: false,
                error: `非 JSON 响应 HTTP ${res.status}: ${text.slice(0, 120)}`,
              };
            }
            const code = data?.code ?? data?.errorCode;
            if (
              res.status < 200 ||
              res.status >= 300 ||
              (code != null && code !== 0)
            ) {
              return {
                ok: false,
                error:
                  data?.msg ||
                  data?.message ||
                  data?.errorMsg ||
                  `HTTP ${res.status} code=${code}`,
                data,
              };
            }
            return { ok: true, data };
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : String(error);
            return {
              ok: false,
              error: /abort/i.test(msg)
                ? `请求超时（>${timeoutMs}ms）`
                : msg,
            };
          } finally {
            clearTimeout(timer);
          }
        },
        args: [path, payload, FETCH_MS],
      });

      if (!result?.ok) {
        throw new Error(result?.error || "腾讯云+ 接口失败");
      }
      return result.data;
    }

    async checkAuth() {
      // 勿在验登录时 apiPost/开 write-new：扩展重载会 CHECK_ALL_AUTH，会误开腾讯云页
      try {
        if (await this.hasLoginCookies()) {
          return {
            isAuthenticated: true,
            userId: "tencentcloud",
            username: "腾讯云+",
          };
        }
        const existingId = await this.ensureSiteTab({ createIfMissing: false });
        if (!existingId) {
          return {
            isAuthenticated: false,
            error:
              "未登录腾讯云开发者社区，请先打开 cloud.tencent.com/developer 登录",
          };
        }
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: existingId },
          world: "MAIN",
          func: async () => {
            try {
              const res = await fetch(
                "https://cloud.tencent.com/developer/api/article/getUserArticleDrafts",
                {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    Accept: "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    page: 1,
                    pageSize: 1,
                    contentType: "markdown",
                  }),
                },
              );
              const data = await res.json().catch(() => null);
              const code = data?.code ?? data?.errorCode;
              if (
                res.ok &&
                (code == null || code === 0) &&
                !/login|未登录|未登/i.test(JSON.stringify(data || {}))
              ) {
                return { ok: true };
              }
              return { ok: false };
            } catch {
              return { ok: false };
            }
          },
        });
        if (result?.ok) {
          return {
            isAuthenticated: true,
            userId: "tencentcloud",
            username: "腾讯云+",
          };
        }
        return {
          isAuthenticated: false,
          error:
            "未登录腾讯云开发者社区，请先打开 cloud.tencent.com/developer 登录",
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async pickTagIds() {
      try {
        const data = await this.apiPost("/api/tag/search", {
          keyword: "开发",
          limit: 5,
        });
        const list = Array.isArray(data)
          ? data
          : data?.data || data?.list || data?.result || [];
        return list
          .map((t) => Number(t.tagId ?? t.id))
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(0, 3);
      } catch {
        return [];
      }
    }

    /**
     * Markdown 草稿可直接引用公网外链（Vigma / 任意 https）。
     * 不再要求腾讯自有图床，也不再走 createHostOnlyUpload。
     */
    async uploadImageByUrl(src) {
      if (
        !src ||
        src.startsWith("/api/uploads/") ||
        /127\.0\.0\.1|localhost/i.test(src) ||
        !/^https?:\/\//i.test(src)
      ) {
        throw new Error(
          "腾讯云+ 需要公网图片地址，请先同步到 CDN（勿用本机 /api/uploads）",
        );
      }
      return { url: src };
    }

    prepareMarkdown(article) {
      let md = String(article.markdown || "").trim();
      if (!md) md = this.htmlToMarkdown(article.html || "");
      // 不走 processImages；公网图（含 api.vigma.app）直接写入草稿
      assertNoLocalImages(md, "腾讯云+");
      const bad = extractImageSrcs(md).filter(
        (src) =>
          !src.startsWith("data:") &&
          (src.startsWith("/api/uploads/") ||
            /127\.0\.0\.1|localhost/i.test(src) ||
            !/^https?:\/\//i.test(src)),
      );
      if (bad.length) {
        throw new Error(
          `腾讯云+ 仍有本机图片（${bad.length} 张），请先上云后再同步`,
        );
      }
      return md;
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(
            auth.error ||
              "未登录腾讯云开发者社区，请先打开 cloud.tencent.com/developer 登录",
          );
        }

        const title = String(article.title || "").trim().slice(0, 80);
        if (!title) throw new Error("标题不能为空");

        const md = this.prepareMarkdown(article);
        options?.onImageProgress?.(1, 1);

        let plain = this.extractPlain(md);
        if (plain.length < 140) {
          plain = `${plain}${"　".repeat(Math.max(0, 140 - plain.length))}`;
        }

        const tagIds = await this.pickTagIds();
        const content = this.wrapMarkdown(md);

        const data = await this.apiPost("/api/article/addArticleDraft", {
          articleId: 0,
          title,
          content,
          plain,
          sourceType: 1,
          classifyIds: [],
          tagIds,
          longtailTag: [],
          columnIds: [],
          openComment: 1,
          closeTextLink: 0,
          userSummary: "",
          pic: "",
          sourceDetail: {},
          zoneName: "",
          summary: plain.slice(0, 200),
        });

        const draftId =
          data?.draftId ??
          data?.data?.draftId ??
          data?.data?.id ??
          data?.id;
        if (!draftId) {
          throw new Error(
            `创建草稿失败：无 draftId（${JSON.stringify(data).slice(0, 160)}）`,
          );
        }

        return this.createResult(true, {
          postId: String(draftId),
          postUrl: `${WRITE}?draftId=${draftId}`,
          draftOnly: options?.draftOnly ?? true,
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
