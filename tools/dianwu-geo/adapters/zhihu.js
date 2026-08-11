/**
 * 知乎专栏 — 覆盖内置草稿适配器，改为自动发布并补全发布面板字段
 *
 * 流程：创建草稿 → 写正文/封面/设置 → 绑定话题 → PUT publish
 * 参考：VSCode-Zhihu / zhihu.nvim / 现网 zhuanlan API
 */
import { getCookieValue } from "./_cookie.js";

const DEFAULT_TOPIC_KEYWORDS = [
  "经验分享",
  "互联网",
  "科技",
  "职场",
  "生活",
  "编程",
  "产品",
];

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createZhihuAdapter(BaseAdapter) {
  return class ZhihuAdapter extends BaseAdapter {
    meta = {
      id: "zhihu",
      name: "知乎",
      icon: "https://static.zhihu.com/static/favicon.ico",
      homepage: "https://zhuanlan.zhihu.com/write",
      capabilities: ["article", "draft", "image_upload", "tags", "cover", "publish"],
    };

    /** @type {{ id: string; url_token?: string; name?: string } | null} */
    me = null;

    jsonHeaders(extra = {}) {
      return {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "x-requested-with": "fetch",
        Origin: "https://zhuanlan.zhihu.com",
        Referer: "https://zhuanlan.zhihu.com/write",
        ...extra,
      };
    }

    async getXsrf() {
      const value = await getCookieValue(
        this.runtime,
        [".zhihu.com", "zhihu.com", "www.zhihu.com", "zhuanlan.zhihu.com"],
        "_xsrf",
        [
          "https://www.zhihu.com/",
          "https://zhuanlan.zhihu.com/",
          "https://zhuanlan.zhihu.com/write",
        ],
      );
      return value || "";
    }

    async authHeaders() {
      const xsrf = await this.getXsrf();
      const headers = this.jsonHeaders();
      if (xsrf) {
        headers["X-Xsrftoken"] = xsrf;
        headers["x-xsrftoken"] = xsrf;
      }
      return headers;
    }

    async checkAuth() {
      try {
        const headers = await this.authHeaders();
        const response = await this.runtime.fetch(
          "https://www.zhihu.com/api/v4/me?include=account_status,is_bind_phone,email,url_token",
          {
            method: "GET",
            credentials: "include",
            headers,
          },
        );
        const res = await response.json();
        if (!res?.id) return { isAuthenticated: false, error: "未登录" };
        this.me = {
          id: String(res.id),
          url_token: res.url_token,
          name: res.name,
        };
        return {
          isAuthenticated: true,
          userId: String(res.id),
          username: res.name,
          avatar: res.avatar_url,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    transformTables(html) {
      let out = html.replace(
        /<figure[^>]*>\s*(<table[\s\S]*?<\/table>)\s*<\/figure>/gi,
        "$1",
      );
      return out.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner) => {
        const thead = inner.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
        const tbody = inner.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
        let head = "";
        let body = "";
        if (thead) {
          head = thead[1]
            .replace(/<td([^>]*)>/gi, "<th$1>")
            .replace(/<\/td>/gi, "</th>");
        }
        if (tbody) {
          body = tbody[1];
        } else {
          body = inner
            .replace(/<thead[^>]*>[\s\S]*?<\/thead>/gi, "")
            .replace(/<\/?tbody[^>]*>/gi, "");
        }
        if (!thead) {
          const first = body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
          if (first && /<th[^>]*>/i.test(first[1]) && !/<td[^>]*>/i.test(first[1])) {
            head = first[0];
            body = body.replace(first[0], "");
          }
        }
        return `<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="normal"><tbody>${head}${body}</tbody></table>`;
      });
    }

    transformContent(html) {
      let out = this.transformTables(html);
      out = out.replace(
        /<img([^>]+)src="([^"]+)"([^>]*)>/gi,
        '<figure><img$1src="$2"$3></figure>',
      );
      out = out.replace(
        /<pre><code class="language-(\w+)">/gi,
        '<pre lang="$1"><code>',
      );
      out = out.replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, "");
      out = out.replace(/\s*style="[^"]*"/gi, "");
      return out;
    }

    async md5Hex(buffer) {
      const hash = await crypto.subtle.digest("MD5", buffer);
      return [...new Uint8Array(hash)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    async uploadImageBinary(blob) {
      const buffer = await blob.arrayBuffer();
      let imageHash;
      try {
        imageHash = await this.md5Hex(buffer);
      } catch {
        // crypto.subtle MD5 unavailable in some runtimes — fall back to random
        imageHash = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      }
      const tokenRes = await this.runtime.fetch("https://api.zhihu.com/images", {
        method: "POST",
        credentials: "include",
        headers: {
          ...(await this.authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image_hash: imageHash, source: "article" }),
      });
      const token = await tokenRes.json();
      const uploadFile = token?.upload_file;
      if (!uploadFile) {
        throw new Error(token?.error?.message || "知乎图片 token 失败");
      }
      if (uploadFile.state === 1 && uploadFile.image_id) {
        // already on CDN
        const ready = await this.runtime.fetch(
          `https://api.zhihu.com/images/${uploadFile.image_id}`,
          { credentials: "include", headers: await this.authHeaders() },
        );
        const meta = await ready.json();
        const key = meta?.original_hash || uploadFile.image_id;
        return { url: `https://pic4.zhimg.com/${key}` };
      }
      const objectKey = uploadFile.object_key;
      const uploadToken = token.upload_token;
      if (!objectKey || !uploadToken?.access_token) {
        throw new Error("知乎 OSS 凭证缺失");
      }
      const contentType = blob.type || "image/png";
      const put = await fetch(
        `https://zhihu-pics-upload.zhimg.com/${objectKey}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "x-oss-security-token": uploadToken.access_token,
            Date: new Date().toUTCString(),
          },
          body: blob,
        },
      );
      if (!put.ok) {
        throw new Error(`知乎 OSS 上传失败 HTTP ${put.status}`);
      }
      let key = objectKey;
      if (contentType === "image/gif" && !key.endsWith(".gif")) key = `${key}.gif`;
      return { url: `https://pic4.zhimg.com/${key}` };
    }

    async uploadImageByUrl(src) {
      // Localhost / data URI: Zhihu server cannot fetch — upload binary via OSS.
      const needsBinary =
        src.startsWith("data:") ||
        /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?\//i.test(src) ||
        src.startsWith("/api/uploads/");

      if (needsBinary || src.startsWith("data:")) {
        let blob;
        if (src.startsWith("data:")) {
          const res = await fetch(src);
          blob = await res.blob();
        } else {
          const res = await this.runtime.fetch(src);
          if (!res.ok) throw new Error(`图片下载失败: ${src}`);
          blob = await res.blob();
        }
        return this.uploadImageBinary(blob);
      }

      const headers = await this.authHeaders();
      delete headers["Content-Type"];
      try {
        const response = await this.runtime.fetch(
          "https://zhuanlan.zhihu.com/api/uploaded_images",
          {
            method: "POST",
            credentials: "include",
            headers: {
              ...headers,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ url: src, source: "article" }),
          },
        );
        const res = await response.json();
        if (res?.src) return { url: res.src };
      } catch {
        // fall through to binary
      }

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      return this.uploadImageBinary(await imageResponse.blob());
    }

    async resolveTitleImage(article, contentHtml) {
      const candidates = [
        article.cover,
        article.thumb,
        article.titleImage,
        article.thumbnail,
      ]
        .map((v) => String(v || "").trim())
        .filter(Boolean);

      if (!candidates.length) {
        const m = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m?.[1]) candidates.push(m[1]);
      }
      if (!candidates.length) return "";

      const src = candidates[0];
      if (/zhimg\.com/i.test(src)) return src;
      try {
        const uploaded = await this.uploadImageByUrl(src);
        return uploaded.url || "";
      } catch {
        return src.startsWith("http") ? src : "";
      }
    }

    topicKeywordsFromTitle(title) {
      const text = String(title || "").trim();
      const parts = text
        .split(/[\s,，、|｜/\\·\-—_:：；;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 16);
      return [...parts.slice(0, 4), ...DEFAULT_TOPIC_KEYWORDS];
    }

    async searchTopic(keyword) {
      const token = encodeURIComponent(keyword);
      const url = `https://zhuanlan.zhihu.com/api/autocomplete/topics?token=${token}&max_matches=5&use_similar=0&topic_filter=1`;
      const response = await this.runtime.fetch(url, {
        method: "GET",
        credentials: "include",
        headers: await this.authHeaders(),
      });
      if (!response.ok) return null;
      const list = await response.json();
      if (!Array.isArray(list) || !list.length) return null;
      const hit =
        list.find((t) => t?.name === keyword) ||
        list.find((t) => t?.type === "topic" || t?.id) ||
        list[0];
      if (!hit?.id) return null;
      return {
        id: String(hit.id),
        name: hit.name || keyword,
        url: hit.url || `https://www.zhihu.com/topic/${hit.id}`,
        type: "topic",
      };
    }

    async bindTopics(articleId, title) {
      const bound = [];
      const seen = new Set();
      for (const keyword of this.topicKeywordsFromTitle(title)) {
        if (bound.length >= 3) break;
        try {
          const topic = await this.searchTopic(keyword);
          if (!topic || seen.has(topic.id)) continue;
          seen.add(topic.id);
          const ok = await this.bindOneTopic(articleId, topic);
          if (ok) bound.push(topic);
        } catch {
          // try next keyword
        }
      }
      return bound;
    }

    async bindOneTopic(articleId, topic) {
      const headers = await this.authHeaders();
      const bodies = [
        { id: topic.id },
        { topic_id: topic.id },
        { url_token: topic.id },
        { topic: { id: topic.id, type: "topic", name: topic.name } },
      ];
      for (const body of bodies) {
        const response = await this.runtime.fetch(
          `https://zhuanlan.zhihu.com/api/articles/${articleId}/topics`,
          {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify(body),
          },
        );
        if (response.ok || response.status === 201) return true;
        // 409 already bound
        if (response.status === 409) return true;
        const text = await response.text().catch(() => "");
        if (/already|存在|重复/i.test(text)) return true;
      }
      return false;
    }

    async fetchFirstColumn() {
      try {
        if (!this.me?.url_token && !this.me?.id) {
          await this.checkAuth();
        }
        const token = this.me?.url_token;
        if (!token) return null;
        const response = await this.runtime.fetch(
          `https://www.zhihu.com/api/v4/members/${token}/column-contributions?include=data[*].column.intro,followers,articles_count&offset=0&limit=20`,
          {
            method: "GET",
            credentials: "include",
            headers: await this.authHeaders(),
          },
        );
        if (!response.ok) return null;
        const res = await response.json();
        const col = res?.data?.[0]?.column;
        if (!col?.id && !col?.url_token) return null;
        return {
          id: col.id,
          url_token: col.url_token,
          title: col.title,
          type: "column",
        };
      } catch {
        return null;
      }
    }

    buildExcerpt(article, html) {
      const fromArticle = String(
        article.desc || article.summary || article.excerpt || "",
      ).trim();
      if (fromArticle) return fromArticle.slice(0, 120);
      const text = String(html || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text.slice(0, 120);
    }

    async publishViaPut(articleId, column, topics) {
      const headers = await this.authHeaders();
      const body = {
        column: column || null,
        commentPermission: "anyone",
        // 发布面板常见字段
        canReward: false,
        tipjarVote: false,
        disclaimer_type: "none",
        disclaimer_status: "close",
        thank_inviter_status: "close",
        thank_inviter: "",
        reshipment_settings: "allowed",
        table_of_contents_enabled: false,
        commercial_report_info: { is_report: false },
        topics: topics.map((t) => ({
          id: t.id,
          type: "topic",
          name: t.name,
        })),
      };
      const response = await this.runtime.fetch(
        `https://zhuanlan.zhihu.com/api/articles/${articleId}/publish`,
        {
          method: "PUT",
          credentials: "include",
          headers,
          body: JSON.stringify(body),
        },
      );
      const text = await response.text();
      let res = null;
      try {
        res = JSON.parse(text);
      } catch {
        // ignore
      }
      if (!response.ok) {
        throw new Error(
          res?.error?.message ||
            res?.message ||
            `发布失败: HTTP ${response.status} ${text.slice(0, 160)}`,
        );
      }
      return res;
    }

    async publishViaV4(articleId) {
      const headers = await this.authHeaders();
      headers.Origin = "https://www.zhihu.com";
      headers.Referer = "https://zhuanlan.zhihu.com/write";
      const traceId = `${Date.now()},${crypto.randomUUID()}`;
      const pcBusinessParams = {
        reward_setting: { can_reward: false },
        reshipment_settings: "allowed",
        thank_inviter: "",
        comment_permission: "all",
        commercial_zhitask_bind_info: null,
        column: null,
        is_report: false,
        thank_inviter_status: "close",
        table_of_contents_enabled: false,
        disclaimer_status: "close",
        disclaimer_type: "none",
        commercial_report_info: { is_report: false },
      };
      const body = {
        action: "article",
        data: {
          hybridInfo: [],
          toFollower: [],
          publish: { traceId },
          extra_info: {
            publisher: "pc",
            include:
              "is_visible,paid_info,has_column,admin_closed_comment,reward_info,comment_count,content,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,excerpt,is_labeled,relationship.is_authorized,voting,is_author",
            pc_business_params: JSON.stringify(pcBusinessParams),
          },
          draft: {
            disabled: 1,
            isPublished: false,
            id: String(articleId),
          },
          reprint: { reshipment_settings: "allowed" },
          publishSwitch: { draft_type: "normal" },
          creationStatement: {
            disclaimer_type: "none",
            disclaimer_status: "close",
          },
          contentsTables: { table_of_contents_enabled: false },
          commercialReportInfo: { isReport: 0 },
          thanksInvitation: {
            thank_inviter_status: "close",
            thank_inviter: "",
          },
          commentsPermission: { comment_permission: "all" },
          appreciate: { can_reward: false },
        },
      };
      const response = await this.runtime.fetch(
        "https://www.zhihu.com/api/v4/content/publish",
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify(body),
        },
      );
      const res = await response.json().catch(() => null);
      if (!response.ok || (res?.code != null && res.code !== 0)) {
        throw new Error(
          res?.message || res?.error?.message || `v4 发布失败: HTTP ${response.status}`,
        );
      }
      return res;
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) throw new Error("请先登录知乎");

        const title = String(article.title || "").trim().slice(0, 100);
        if (!title) throw new Error("标题不能为空");

        const headers = await this.authHeaders();

        // 1) 创建草稿
        const createRes = await this.runtime.fetch(
          "https://zhuanlan.zhihu.com/api/articles/drafts",
          {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify({
              title,
              content: "",
              delta_time: 0,
              can_reward: false,
              draft_type: "normal",
            }),
          },
        );
        const createText = await createRes.text();
        if (!createRes.ok) {
          throw new Error(`创建草稿失败: ${createRes.status} ${createText.slice(0, 160)}`);
        }
        let created;
        try {
          created = JSON.parse(createText);
        } catch {
          throw new Error("创建草稿失败: 响应不是 JSON");
        }
        const articleId = created?.id;
        if (!articleId) throw new Error("创建草稿失败: 无文章 ID");

        // 2) 正文处理
        let content = article.html || article.markdown || "";
        if (typeof this.cleanHtml === "function") {
          content = this.cleanHtml(content, {
            removeComments: true,
            removeSpecialTags: true,
            processCodeBlocks: true,
            convertSectionToDiv: true,
            removeEmptyLines: true,
            removeEmptyDivs: true,
            removeNestedEmptyContainers: true,
            unwrapSingleChildContainers: true,
            unwrapNestedFigures: true,
            removeTrailingBr: true,
            removeDataAttributes: true,
            removeSrcset: true,
            removeSizes: true,
            compactHtml: true,
          });
        }
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: [
              "zhimg.com",
              "pic1.zhimg.com",
              "pic2.zhimg.com",
              "pic3.zhimg.com",
              "pic4.zhimg.com",
              "picx.zhimg.com",
              "pica.zhimg.com",
            ],
            onProgress: options?.onImageProgress,
          },
        );
        content = this.transformContent(content);
        const titleImage = await this.resolveTitleImage(article, content);
        const excerpt = this.buildExcerpt(article, content);

        // 3) 写满草稿字段
        const draftBody = {
          title,
          content,
          delta_time: 30,
          titleImage: titleImage || "",
          isTitleImageFullScreen: false,
          table_of_contents: false,
          can_reward: false,
          comment_permission: "anyone",
          disclaimer_type: "none",
          disclaimer_status: "close",
          thank_inviter_status: "close",
          thank_inviter: "",
          reshipment_settings: "allowed",
          draft_type: "normal",
          excerpt,
          summary: excerpt,
        };
        const patchRes = await this.runtime.fetch(
          `https://zhuanlan.zhihu.com/api/articles/${articleId}/draft`,
          {
            method: "PATCH",
            credentials: "include",
            headers,
            body: JSON.stringify(draftBody),
          },
        );
        if (!patchRes.ok) {
          const t = await patchRes.text();
          throw new Error(`更新草稿失败: ${patchRes.status} ${t.slice(0, 160)}`);
        }

        // 4) 话题（发布面板必填）
        const topics = await this.bindTopics(articleId, title);
        if (!topics.length) {
          // 硬绑一个通用话题 ID：经验(19553380)，提升发布成功率
          const fallback = {
            id: "19553380",
            name: "经验",
            type: "topic",
          };
          if (await this.bindOneTopic(articleId, fallback)) {
            topics.push(fallback);
          }
        }

        // 5) 专栏（有则填）
        const column = await this.fetchFirstColumn();

        // 6) 正式发布（忽略上游 draftOnly:true，知乎按自动发布）
        let publishedUrl = `https://zhuanlan.zhihu.com/p/${articleId}`;
        try {
          await this.publishViaPut(articleId, column, topics);
        } catch (putErr) {
          try {
            await this.publishViaV4(articleId);
          } catch (v4Err) {
            const putMsg =
              putErr instanceof Error ? putErr.message : String(putErr);
            const v4Msg =
              v4Err instanceof Error ? v4Err.message : String(v4Err);
            // 发布失败仍返回可编辑草稿，方便人工点确认发布
            return this.createResult(false, {
              error: `知乎自动发布失败（已保存草稿）。PUT: ${putMsg}; v4: ${v4Msg}`,
              postId: String(articleId),
              postUrl: `https://zhuanlan.zhihu.com/p/${articleId}/edit`,
              draftOnly: true,
            });
          }
        }

        return this.createResult(true, {
          postId: String(articleId),
          postUrl: publishedUrl,
          draftOnly: false,
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
