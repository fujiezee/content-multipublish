import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 头条号 — 覆盖内置适配器
 *
 * 正文图强制上传到头条 CDN（失败闭环）。
 * 封面不传：草稿只需正文带图，封面留给用户在编辑器里选，避免「图片资源无权限」。
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createToutiaoAdapter(BaseAdapter) {
  return class ToutiaoAdapter extends BaseAdapter {
    meta = {
      id: "toutiao",
      name: "头条",
      icon: "https://sf1-ttcdn-tos.pstatp.com/obj/ttfe/pgcfe/sz/mp_logo.png",
      homepage: "https://mp.toutiao.com/profile_v4/graphic/publish",
      capabilities: ["article", "draft", "image_upload"],
    };

    isToutiaoImageHost(url) {
      return /(?:pstatp\.com|byteimg\.com|toutiaoimg\.com|toutiao\.com|snssdk\.com)/i.test(
        String(url || ""),
      );
    }

    extractImageSrcs(html) {
      const srcs = [];
      const re = /<img[^>]+src=["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(html || ""))) {
        if (m[1]) srcs.push(m[1]);
      }
      return srcs;
    }

    assertToutiaoImages(html) {
      const bad = this.extractImageSrcs(html).filter(
        (src) => !src.startsWith("data:") && !this.isToutiaoImageHost(src),
      );
      if (bad.length) {
        throw new Error(
          `头条草稿需要平台图床地址，仍有 ${bad.length} 张未上传成功（如 ${bad[0].slice(0, 80)}）`,
        );
      }
    }

    async checkAuth() {
      try {
        const res = await this.get(
          "https://mp.toutiao.com/mp/agw/media/get_media_info",
        );
        const user = res?.data?.user;
        if (user?.id) {
          return {
            isAuthenticated: true,
            userId: String(user.id),
            username: user.screen_name,
            avatar: user.https_avatar_url,
          };
        }
        return { isAuthenticated: false };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async getAntiToken() {
      const res = await this.get("https://mp.toutiao.com/tt-anti-token");
      return res?.data?.token || "";
    }

    async getCsrfToken() {
      const response = await this.runtime.fetch(
        "https://mp.toutiao.com/ttwid/check/",
        {
          method: "HEAD",
          credentials: "include",
          headers: {
            "x-secsdk-csrf-request": "1",
            "x-secsdk-csrf-version": "1.2.22",
          },
        },
      );
      return response.headers.get("x-ware-csrf-token") || "";
    }

    async uploadImageByUrl(src) {
      if (this.isToutiaoImageHost(src)) {
        return { url: src, attrs: {} };
      }

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) {
        throw new Error(`图片下载失败(${imageResponse.status}): ${src}`);
      }
      const blob = await imageResponse.blob();
      const csrf = await this.getCsrfToken();
      const formData = new FormData();
      formData.append("image", blob, "image.jpg");

      const response = await this.runtime.fetch(
        "https://mp.toutiao.com/spice/image?upload_source=20020002&aid=1231&device_platform=web",
        {
          method: "POST",
          credentials: "include",
          headers: csrf ? { "x-secsdk-csrf-token": csrf } : undefined,
          body: formData,
        },
      );
      const text = await response.text();
      let res;
      try {
        res = JSON.parse(text);
      } catch {
        throw new Error("头条图片上传响应解析失败");
      }
      if (res.code !== 0 || !res.data) {
        throw new Error(res.message || "头条图片上传失败");
      }
      if (!res.data.image_url || !res.data.image_uri) {
        throw new Error("头条图片上传返回数据不完整");
      }
      return {
        url: res.data.image_url,
        attrs: {
          class: "",
          "ic-uri": "",
          image_type: "image/png",
          mime_type: "",
          web_uri: res.data.image_uri,
          img_width: String(res.data.image_width || 0),
          img_height: String(res.data.image_height || 0),
        },
        meta: {
          uri: res.data.image_uri,
          width: Number(res.data.image_width || 0),
          height: Number(res.data.image_height || 0),
        },
      };
    }

    wrapPgcImages(html) {
      return html.replace(
        /<img\s+([^>]+)>/gi,
        '<div class="pgc-img"><img $1><p class="pgc-img-caption"></p></div>',
      );
    }

    async ensureToutiaoTab() {
      const tabs = await chrome.tabs.query({ url: "https://mp.toutiao.com/*" });
      if (tabs.length > 0 && tabs[0].id) return tabs[0].id;

      const tab = await chrome.tabs.create({
        url: "https://mp.toutiao.com/profile_v4/graphic/publish",
        active: false,
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          reject(new Error("头条页面加载超时"));
        }, 30_000);
        const onUpdated = (id, info) => {
          if (id === tab.id && info.status === "complete") {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            setTimeout(resolve, 1000);
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
      return tab.id;
    }

    async publishViaContentScript(url, body) {
      const tabId = await this.ensureToutiaoTab();
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (reqUrl, reqBody) => {
          try {
            const res = await fetch(reqUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: reqBody,
              credentials: "include",
            });
            return { success: true, data: await res.json() };
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        args: [url, body],
      });
      if (!result?.success) {
        throw new Error(result?.error || "发布请求失败");
      }
      return result.data;
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) {
          throw new Error(auth.error || "请先登录头条号");
        }

        let content = article.html || article.markdown || "";
        if (typeof this.cleanHtml === "function") {
          content = this.cleanHtml(content, {
            removeLinks: true,
            removeIframes: true,
            removeSvgImages: true,
            removeTags: ["qqmusic"],
            removeAttrs: ["data-reader-unique-id"],
          });
        }
        content = content.replace(/<figure[^>]*>\s*<\/figure>/gi, "");
        content = content.replace(/\n{3,}/g, "\n\n");

        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: [
              "pstatp.com",
              "toutiao.com",
              "byteimg.com",
              "toutiaoimg.com",
            ],
            onProgress: options?.onImageProgress,
            platformName: "头条",
          },
        );
        content = this.wrapPgcImages(content);

        const extra = JSON.stringify({
          content_source: 100000000402,
          content_word_cnt: content.length,
          is_multi_title: 0,
          sub_titles: [],
          gd_ext: {
            entrance: "",
            from_page: "publisher_mp",
            enter_from: "PC",
            device_platform: "mp",
            is_message: 0,
          },
        });
        const titleId = `${Date.now()}_${Math.random().toString().slice(2, 18)}`;
        const params = new URLSearchParams();
        params.append("pgc_id", "0");
        params.append("source", "29");
        params.append("extra", extra);
        params.append("content", content);
        params.append("title", String(article.title || "").slice(0, 30));
        params.append(
          "search_creation_info",
          JSON.stringify({ searchTopOne: 0, abstract: "", clue_id: "" }),
        );
        params.append("title_id", titleId);
        params.append("mp_editor_stat", "{}");
        params.append("is_refute_rumor", "0");
        params.append("save", "0");
        params.append("timer_status", "0");
        params.append("timer_time", "");
        params.append("educluecard", "");
        // 无封面：正文图已够用，封面在编辑器里手选，避免「图片资源无权限」
        params.append("draft_form_data", JSON.stringify({ coverType: 3 }));
        params.append("pgc_feed_covers", "[]");
        params.append("article_ad_type", "3");
        params.append("is_fans_article", "0");
        params.append("govern_forward", "0");
        params.append("praise", "0");
        params.append("disable_praise", "0");
        params.append("tree_plan_article", "0");
        params.append("activity_tag", "0");
        params.append("trends_writing_tag", "0");
        params.append("claim_exclusive", "0");

        const res = await this.publishViaContentScript(
          "https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=1231",
          params.toString(),
        );
        if (res.err_no !== 0 || !res.data?.pgc_id) {
          throw new Error(res.message || "头条保存草稿失败");
        }
        const pgcId = res.data.pgc_id;
        return this.createResult(true, {
          postId: String(pgcId),
          postUrl: `https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=${pgcId}`,
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
