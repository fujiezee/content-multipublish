/**
 * 腾讯云开发者社区（cloud.tencent.com/developer）
 *
 * 参考 PenBridge：POST JSON /api/article/addArticleDraft
 * 登录校验：/api/article/getUserArticleDrafts
 * 内容：<!--markdown-->…<!--/markdown-->
 */
import { getCookieValue } from "./_cookie.js";

const BASE = "https://cloud.tencent.com/developer";
const WRITE = "https://cloud.tencent.com/developer/article/write-new";

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

    htmlToMarkdown(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h([1-6])>/gi, "\n\n")
        .replace(/<h([1-6])[^>]*>/gi, (_, n) => `${"#".repeat(Number(n))} `)
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/?(ul|ol|div|span|section)[^>]*>/gi, "")
        .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
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

    async apiPost(path, payload) {
      const response = await this.runtime.fetch(`${BASE}${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          Origin: "https://cloud.tencent.com",
          Referer: WRITE,
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`腾讯云+ 非 JSON 响应: ${text.slice(0, 120)}`);
      }
      const code = data?.code ?? data?.errorCode;
      if (response.status < 200 || response.status >= 300 || (code != null && code !== 0)) {
        throw new Error(data?.msg || data?.message || `HTTP ${response.status}`);
      }
      return data;
    }

    async checkAuth() {
      try {
        const session = await getCookieValue(
          this.runtime,
          [".tencent.com", "cloud.tencent.com", ".cloud.tencent.com"],
          "qcommunity_session",
          ["https://cloud.tencent.com/"],
        );
        const uin = await getCookieValue(
          this.runtime,
          [".tencent.com", "cloud.tencent.com", "qq.com"],
          "uin",
          ["https://cloud.tencent.com/", "https://qq.com/"],
        );

        await this.apiPost("/api/article/getUserArticleDrafts", {
          page: 1,
          pageSize: 1,
          contentType: "markdown",
        });

        return {
          isAuthenticated: true,
          userId: String(uin || session || "tencentcloud"),
          username: uin ? String(uin).replace(/^o/, "") : "腾讯云+",
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
        const ids = list
          .map((t) => Number(t.tagId ?? t.id))
          .filter((n) => Number.isFinite(n) && n > 0)
          .slice(0, 3);
        return ids;
      } catch {
        return [];
      }
    }

    async uploadImageByUrl(src) {
      // Best-effort：外链保留；完整 COS 上传需多步签名
      return { url: src };
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

        let md = String(article.markdown || "").trim();
        if (!md) md = this.htmlToMarkdown(article.html || "");
        md = await this.processImages(
          md,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["qcloudimg.com", "tencent.com", "myqcloud.com"],
            onProgress: options?.onImageProgress,
          },
        );

        let plain = this.extractPlain(md);
        if (plain.length < 140) {
          // 草稿接口也可能校验 plain；不足时补空白说明
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

        const draftId = data?.draftId ?? data?.data?.draftId;
        if (!draftId) throw new Error("创建草稿失败：无 draftId");

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
