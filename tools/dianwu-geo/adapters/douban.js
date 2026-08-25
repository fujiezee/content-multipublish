/**
 * 豆瓣日记 — 新版话题编辑器 API
 *
 * 登录：Cookie `dbcl2`（checkAuth 快路径）
 * Frodo：先访问 m.douban.com 拿到 `frodotk`，请求头 `Authorization: Bearer <frodotk>`
 * 发文：POST https://m.douban.com/rexxar/api/v2/topic/post?ck=
 *       content 为 Draft.js raw JSON 字符串；草稿用 accessible=private
 */
import { getCookieValue } from "./_cookie.js";
import { extractImageSrcs } from "./_images.js";

const DOMAINS = [".douban.com", "douban.com", "www.douban.com", "m.douban.com"];
const COOKIE_URLS = [
  "https://www.douban.com/",
  "https://m.douban.com/",
  "https://www.douban.com/topic/create?subtype=note",
  "https://accounts.douban.com/",
];
const WRITE = "https://www.douban.com/topic/create?subtype=note";
const POST_API = "https://m.douban.com/rexxar/api/v2/topic/post";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createDoubanAdapter(BaseAdapter) {
  return class DoubanAdapter extends BaseAdapter {
    meta = {
      id: "douban",
      name: "豆瓣",
      icon: "https://img3.doubanio.com/favicon.ico",
      homepage: WRITE,
      capabilities: ["article", "draft"],
    };

    username = "";
    avatar = "";

    async listAllDoubanCookies() {
      if (typeof chrome === "undefined" || !chrome.cookies?.getAll) return [];
      try {
        const all = await chrome.cookies.getAll({ domain: "douban.com" });
        return Array.isArray(all) ? all : [];
      } catch {
        try {
          return (await chrome.cookies.getAll({})).filter((c) =>
            String(c.domain || "").includes("douban"),
          );
        } catch {
          return [];
        }
      }
    }

    stripQuotes(value) {
      return String(value || "").replace(/^"|"$/g, "");
    }

    async getDbcl2() {
      const byUrl = await getCookieValue(
        this.runtime,
        DOMAINS,
        "dbcl2",
        COOKIE_URLS,
      );
      if (byUrl) return this.stripQuotes(byUrl);

      const all = await this.listAllDoubanCookies();
      const dbcl2 = all.find((c) => c.name === "dbcl2" || c.name === "dbcl2_v2");
      if (dbcl2?.value) return this.stripQuotes(dbcl2.value);
      return null;
    }

    parseUserIdFromDbcl2(dbcl2) {
      const id = String(dbcl2 || "").split(":")[0];
      return id && /^\d+$/.test(id) ? id : null;
    }

    async checkAuth() {
      try {
        const dbcl2 = await this.getDbcl2();
        if (!dbcl2) {
          return {
            isAuthenticated: false,
            error:
              "未检测到豆瓣登录 Cookie（dbcl2）。请在 Chrome 打开 douban.com 登录后刷新",
          };
        }
        const userId = this.parseUserIdFromDbcl2(dbcl2);
        this.username = userId || "豆瓣用户";
        return {
          isAuthenticated: true,
          userId: userId || this.username,
          username: this.username,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    /** Warm m.douban.com so frodotk / talionusr are set. */
    async ensureFrodoToken() {
      let token = await getCookieValue(
        this.runtime,
        [".m.douban.com", "m.douban.com", ".douban.com"],
        "frodotk",
        ["https://m.douban.com/", "https://www.douban.com/"],
      );
      token = this.stripQuotes(token);
      if (token) return token;

      await this.runtime.fetch("https://m.douban.com/", {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "text/html",
          Referer: "https://www.douban.com/",
        },
        redirect: "follow",
      });

      token = this.stripQuotes(
        await getCookieValue(
          this.runtime,
          [".m.douban.com", "m.douban.com", ".douban.com"],
          "frodotk",
          ["https://m.douban.com/", "https://www.douban.com/"],
        ),
      );
      if (!token) {
        throw new Error(
          "未获取 frodotk。请在 Chrome 打开并登录 https://www.douban.com 后重试",
        );
      }
      return token;
    }

    async ensureCk() {
      const ck = this.stripQuotes(
        await getCookieValue(this.runtime, DOMAINS, "ck", COOKIE_URLS),
      );
      if (!ck) {
        throw new Error("未检测到 ck Cookie，请重新登录豆瓣");
      }
      return ck;
    }

    blockKey() {
      return Math.random().toString(36).slice(2, 7);
    }

    plainToDraftContent(text) {
      const lines = String(text || "")
        .replace(/\r\n/g, "\n")
        .split(/\n/)
        .map((l) => l.trimEnd());
      // collapse excessive blanks but keep paragraph breaks
      const paras = [];
      let buf = [];
      const flush = () => {
        if (buf.length) {
          paras.push(buf.join("\n"));
          buf = [];
        }
      };
      for (const line of lines) {
        if (!line.trim()) flush();
        else buf.push(line);
      }
      flush();
      if (!paras.length) paras.push("");

      const blocks = paras.map((p) => ({
        key: this.blockKey(),
        text: p,
        type: "unstyled",
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
        data: { align: "" },
      }));
      return JSON.stringify({ blocks, entityMap: {} });
    }

    htmlToPlain(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "请先登录豆瓣");
        }

        const title = String(article.title || "").trim().slice(0, 100);
        if (!title) throw new Error("标题不能为空");

        const rawHtml = article.html || article.content || "";
        const rawMd = String(article.markdown || "");
        const hadImages =
          extractImageSrcs(rawHtml).length > 0 ||
          /!\[[^\]]*]\([^)]+\)/.test(rawMd);

        let plain = rawMd.trim();
        if (!plain) {
          plain = this.htmlToPlain(rawHtml);
        } else {
          // strip light markdown markers for Draft.js plain blocks
          plain = plain
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/(\*\*|__)(.*?)\1/g, "$2")
            .replace(/(\*|_)([^*_\n]+)\1/g, "$2")
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .trim();
        }
        // HTML path: strip residual image alt leftovers
        plain = plain.replace(/\n{3,}/g, "\n\n").trim();
        if (!plain) throw new Error("正文不能为空");

        const frodotk = await this.ensureFrodoToken();
        const ck = await this.ensureCk();
        const draftOnly = options?.draftOnly ?? true;
        const content = this.plainToDraftContent(plain);

        const response = await this.runtime.fetch(
          `${POST_API}?ck=${encodeURIComponent(ck)}`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Content-Type": "application/json;charset=UTF-8",
              Authorization: `Bearer ${frodotk}`,
              Origin: "https://www.douban.com",
              Referer: WRITE,
            },
            body: JSON.stringify({
              title,
              content,
              image_ids: "",
              topic_tag_ids: "",
              interest_tags: "",
              is_event: false,
              subtype: "note",
              // private ≈ 仅自己可见，作为草稿优先；公开发布用 public
              accessible: draftOnly ? "private" : "public",
              explanation_types: "",
              send_status: !draftOnly,
              original: false,
            }),
          },
        );

        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`豆瓣非 JSON 响应: ${text.slice(0, 120)}`);
        }

        if (data?.msg === "need_login" || data?.code === 103) {
          throw new Error("豆瓣登录失效，请重新登录后再同步");
        }
        if (data?.msg === "post too frequently") {
          throw new Error("豆瓣发文过快，请稍后再试");
        }
        if (!data?.id) {
          throw new Error(
            data?.localized_message ||
              data?.msg ||
              data?.error ||
              `保存失败 HTTP ${response.status}`,
          );
        }

        const postUrl =
          data.url ||
          `https://www.douban.com/topic/${data.id}/` ||
          WRITE;

        return this.createResult(true, {
          postId: String(data.id),
          postUrl: String(postUrl).replace(/\\\//g, "/"),
          draftOnly,
          message: hadImages
            ? "豆瓣日记暂不支持插图，已同步纯文字（图片已跳过）"
            : undefined,
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
