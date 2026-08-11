/**
 * 什么值得买 — 投稿草稿（post.smzdm.com）
 *
 * 依据 Wechatsync v2 feat(smzdm) 公开说明实现：
 * - 字段：editorValue / title / submit_type=auto_save
 * - 新文章 ID：/tougao/ 页 .release-new
 * - WAF：Origin/Referer + 挑战页检测重试
 *
 * 私有适配器源码未公开；现网若改版需对照 Network 微调 SAVE_CANDIDATES。
 */
import { getCookieValue } from "./_cookie.js";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createSmzdmAdapter(BaseAdapter) {
  return class SmzdmAdapter extends BaseAdapter {
    meta = {
      id: "smzdm",
      name: "什么值得买",
      icon: "https://www.smzdm.com/favicon.ico",
      homepage: "https://post.smzdm.com/tougao/",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {{ userId: string; username: string; avatar?: string } | null} */
    account = null;

    isWafHtml(text) {
      if (!text) return false;
      return (
        /probe\.js|probev3\.js|var buid\s*=|Safety check|x-waf-captcha|人机验证|安全检查/i.test(
          text,
        ) ||
        (text.length < 800 && /<!DOCTYPE html>/i.test(text) && /script/i.test(text))
      );
    }

    async fetchWithWafRetry(url, init = {}, maxAttempts = 3) {
      let lastText = "";
      let lastResponse = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
        const response = await this.runtime.fetch(url, {
          credentials: "include",
          ...init,
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            ...(init.headers || {}),
          },
        });
        lastResponse = response;
        const text = await response.text();
        lastText = text;
        if (!this.isWafHtml(text)) {
          return { response, text };
        }
      }
      return { response: lastResponse, text: lastText, waf: true };
    }

    parseJsonp(text) {
      const m = String(text || "").match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
      const raw = m ? m[1] : text;
      return JSON.parse(raw);
    }

    async ensureAccount() {
      if (this.account) return this.account;

      const { text, waf } = await this.fetchWithWafRetry(
        `https://zhiyou.smzdm.com/user/info/jsonp_get_current?with_avatar_ornament=1&callback=cb&_=${Date.now()}`,
        {
          headers: {
            Accept: "*/*",
            Referer: "https://post.smzdm.com/",
          },
        },
      );
      if (waf) throw new Error("什么值得买 WAF 拦截，请在 Chrome 打开 post.smzdm.com 后再试");

      let data;
      try {
        data = this.parseJsonp(text);
      } catch {
        throw new Error("未登录什么值得买");
      }

      const smzdmId = Number(data?.smzdm_id || data?.user_smzdm_id || 0);
      if (!smzdmId) {
        // Cookie fallback
        const sess = await getCookieValue(
          this.runtime,
          [".smzdm.com", "smzdm.com", "zhiyou.smzdm.com", "post.smzdm.com"],
          "sess",
          [
            "https://www.smzdm.com/",
            "https://zhiyou.smzdm.com/",
            "https://post.smzdm.com/",
          ],
        );
        if (!sess) throw new Error("未登录什么值得买");
        this.account = {
          userId: "sess",
          username: "什么值得买用户",
        };
        return this.account;
      }

      this.account = {
        userId: String(smzdmId),
        username: String(
          data?.nickname || data?.display_name || data?.username || smzdmId,
        ),
        avatar: data?.avatar || data?.avatar_url || undefined,
      };
      return this.account;
    }

    async checkAuth() {
      try {
        this.account = null;
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

    /**
     * 从投稿首页拿到新草稿编辑地址 / 文章 id（.release-new）
     */
    async createDraftContext() {
      const { text, waf } = await this.fetchWithWafRetry(
        "https://post.smzdm.com/tougao/",
        {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            Referer: "https://post.smzdm.com/",
          },
        },
      );
      if (waf || this.isWafHtml(text)) {
        throw new Error(
          "打不开投稿页（WAF）。请先在 Chrome 登录并打开 https://post.smzdm.com/tougao/ 后再同步",
        );
      }
      if (/user\/login|zhiyou\.smzdm\.com\/user\/login/i.test(text)) {
        throw new Error("未登录什么值得买");
      }

      // <a class="release-new" href="..."> 或 data-href
      const patterns = [
        /class=["'][^"']*release-new[^"']*["'][^>]*href=["']([^"']+)["']/i,
        /href=["']([^"']+)["'][^>]*class=["'][^"']*release-new[^"']*["']/i,
        /release-new[^>]*(?:data-href|data-url)=["']([^"']+)["']/i,
        /href=["'](https?:\/\/post\.smzdm\.com\/[^"']*(?:edit|tougao|write)[^"']*)["']/i,
      ];
      let href = null;
      for (const re of patterns) {
        const m = text.match(re);
        if (m?.[1]) {
          href = m[1];
          break;
        }
      }
      if (!href) {
        throw new Error("未找到新建投稿入口（.release-new），页面结构可能已变更");
      }
      if (href.startsWith("//")) href = `https:${href}`;
      if (href.startsWith("/")) href = `https://post.smzdm.com${href}`;

      const idMatch =
        href.match(/[?&](?:article_id|id|aid)=(\w+)/i) ||
        href.match(/\/(?:edit|tougao|write)\/(\w+)/i);
      const articleId = idMatch?.[1] || null;

      return { editUrl: href, articleId };
    }

    async uploadImageByUrl(src) {
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const ext = (blob.type || "image/jpeg").split("/")[1] || "jpg";
      const filename = `${Date.now()}.${ext === "jpeg" ? "jpg" : ext}`;

      const endpoints = [
        "https://post.smzdm.com/upload.php?action=uploadimage",
        "https://post.smzdm.com/php/controller.php?action=uploadimage",
        "https://post.smzdm.com/json_more/upload_image/",
      ];

      let lastError = "图片上传失败";
      for (const endpoint of endpoints) {
        const formData = new FormData();
        formData.append("upfile", blob, filename);
        formData.append("file", blob, filename);
        formData.append("upload", blob, filename);

        const { text, waf } = await this.fetchWithWafRetry(endpoint, {
          method: "POST",
          body: formData,
          headers: {
            Referer: "https://post.smzdm.com/tougao/",
          },
        });
        if (waf) {
          lastError = "图片上传被 WAF 拦截";
          continue;
        }
        try {
          const res = JSON.parse(text);
          const url =
            res?.url ||
            res?.data?.url ||
            res?.data?.src ||
            (res?.state === "SUCCESS" ? res.url : null);
          if (url) {
            return {
              url: url.startsWith("//")
                ? `https:${url}`
                : url.startsWith("/")
                  ? `https://post.smzdm.com${url}`
                  : url,
            };
          }
          lastError = res?.state || res?.message || lastError;
        } catch {
          const m = text.match(/https?:\/\/[^\s"'<>]+/);
          if (m) return { url: m[0] };
          lastError = text.slice(0, 120) || lastError;
        }
      }
      throw new Error(lastError);
    }

    buildSaveBody(title, html, articleId) {
      const params = new URLSearchParams();
      params.set("title", title);
      params.set("editorValue", html);
      params.set("submit_type", "auto_save");
      // 兼容旧字段名（若服务端仍读取）
      params.set("article_title", title);
      params.set("article_content", html);
      if (articleId) {
        params.set("article_id", String(articleId));
        params.set("id", String(articleId));
        params.set("aid", String(articleId));
      }
      return params;
    }

    isSaveOk(res, text) {
      if (res && typeof res === "object") {
        if (res.error_code === 0 || res.errorCode === 0 || res.code === 0) {
          return true;
        }
        if (res.success === true || res.status === 1 || res.state === "SUCCESS") {
          return true;
        }
        if (res.data?.article_id || res.article_id || res.id) return true;
      }
      // 纯文本成功提示
      if (/成功|已保存|auto_save/i.test(text) && !/失败|错误|未登录/i.test(text)) {
        return true;
      }
      return false;
    }

    async publish(article, options) {
      try {
        await this.ensureAccount();

        const title = String(article.title || "").trim().slice(0, 60);
        if (!title) throw new Error("标题不能为空");

        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: [
              "smzdm.com",
              "zdmimg.com",
              "qny.smzdm.com",
              "qna.smzdm.com",
              "a.zdmimg.com",
            ],
            onProgress: options?.onImageProgress,
          },
        );

        const { editUrl, articleId } = await this.createDraftContext();
        const body = this.buildSaveBody(title, content, articleId);

        const saveUrls = [
          editUrl,
          "https://post.smzdm.com/json_more/edit_article/",
          "https://post.smzdm.com/tougao/save",
          articleId
            ? `https://post.smzdm.com/tougao/?article_id=${articleId}`
            : null,
        ].filter(Boolean);

        let lastError = "保存草稿失败";
        let savedId = articleId;

        for (const saveUrl of saveUrls) {
          const { text, waf, response } = await this.fetchWithWafRetry(
            saveUrl,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/x-www-form-urlencoded; charset=UTF-8",
                Referer: editUrl || "https://post.smzdm.com/tougao/",
                Origin: "https://post.smzdm.com",
              },
              body: body.toString(),
            },
          );

          if (waf) {
            lastError = "保存被 WAF 拦截，请先在浏览器打开投稿页后再试";
            continue;
          }

          let res = null;
          try {
            res = JSON.parse(text);
          } catch {
            res = null;
          }

          if (this.isSaveOk(res, text) || (response && response.ok && !/失败|未登录|error/i.test(text.slice(0, 200)))) {
            savedId =
              res?.data?.article_id ||
              res?.article_id ||
              res?.id ||
              res?.data?.id ||
              articleId ||
              savedId;

            return this.createResult(true, {
              postId: savedId ? String(savedId) : undefined,
              postUrl: editUrl || "https://post.smzdm.com/tougao/",
              draftOnly: options?.draftOnly ?? true,
            });
          }

          lastError =
            res?.error_msg ||
            res?.message ||
            res?.msg ||
            text.slice(0, 160) ||
            lastError;
        }

        throw new Error(lastError);
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
