/**
 * 大鱼号 — Wechatsync v1 dayu.js 移植（dashboard/save-draft + ns 图床）
 *
 * 现网首页仍注入 globalConfig，但已无旧结束标记 `var G = {`；
 * 且游客页也会带 utoken，必须以 isLogin / wmid 判断登录。
 */
import { getCookieValue } from "./_cookie.js";

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createDayuAdapter(BaseAdapter) {
  return class DayuAdapter extends BaseAdapter {
    meta = {
      id: "dayu",
      name: "大鱼号",
      icon: "https://image.uc.cn/s/uae/g/1v/images/index/favicon.ico",
      homepage: "https://mp.dayu.com/#/article/write",
      capabilities: ["article", "draft", "image_upload", "cover"],
    };

    /** @type {{ utoken: string; uploadSign: string; uid: string; title: string; avatar?: string } | null} */
    account = null;

    /** @type {Array<{ org_url: string; url: string }>} */
    images = [];

    /** Extract JS object after `var globalConfig =` (JSON or object literal). */
    parseGlobalConfig(html) {
      const marks = ["var globalConfig = ", "window.globalConfig = "];
      let start = -1;
      for (const mark of marks) {
        const idx = html.indexOf(mark);
        if (idx !== -1) {
          start = idx + mark.length;
          break;
        }
      }
      if (start === -1) return null;

      // Prefer brace-balanced extract; legacy pages ended before `var G = {`
      const legacyEnd = html.indexOf("var G = {", start);
      let raw;
      if (legacyEnd !== -1) {
        raw = html.substring(start, legacyEnd).trim().replace(/;+\s*$/, "");
      } else {
        const braceStart = html.indexOf("{", start);
        if (braceStart === -1) return null;
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < html.length; i++) {
          const ch = html[i];
          if (ch === "{") depth += 1;
          else if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        if (end === -1) return null;
        raw = html.substring(braceStart, end);
      }

      try {
        return JSON.parse(raw);
      } catch {
        try {
          return new Function(`return (${raw})`)();
        } catch {
          return null;
        }
      }
    }

    normalizeAvatar(avatar) {
      if (!avatar) return undefined;
      if (avatar.startsWith("http")) return avatar;
      if (avatar.startsWith("//")) return `https:${avatar}`;
      return `https://${avatar.replace(/^\/+/, "")}`;
    }

    accountFromConfig(pageConfig) {
      const wmid = pageConfig?.wmid != null ? String(pageConfig.wmid).trim() : "";
      const isLogin = pageConfig?.isLogin === true || pageConfig?.isLogin === 1;
      if (!isLogin && !wmid) return null;
      if (!pageConfig?.utoken) return null;

      return {
        utoken: String(pageConfig.utoken),
        uploadSign: pageConfig.nsImageUploadSign || "",
        uid: wmid || String(pageConfig.ucid || pageConfig.aid || "dayu"),
        title:
          pageConfig.weMediaName ||
          pageConfig.subjectname ||
          wmid ||
          "大鱼号用户",
        avatar: this.normalizeAvatar(pageConfig.wmAvator),
      };
    }

    async fetchConfigFromUrl(url) {
      const response = await this.runtime.fetch(url, {
        credentials: "include",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
      });
      const finalUrl = response.url || url;
      // Unauthenticated dashboard hops to ids.dayu.com
      if (/ids\.dayu\.com|passport\.uc\.cn|redirect-login|\/login/i.test(finalUrl)) {
        return null;
      }
      const html = await response.text();
      if (/扫码登录|请使用UC浏览器扫码|正在生成二维码/.test(html) && !/isLogin"\s*:\s*true/.test(html)) {
        // still try parse — guest pages also have QR copy
      }
      return this.parseGlobalConfig(html);
    }

    async ensureAccount() {
      if (this.account) return this.account;

      const urls = [
        "https://mp.dayu.com/",
        "https://mp.dayu.com/dashboard/index",
        "https://mp.dayu.com/dashboard/article/write",
      ];

      let lastConfig = null;
      for (const url of urls) {
        try {
          const cfg = await this.fetchConfigFromUrl(url);
          if (!cfg) continue;
          lastConfig = cfg;
          const account = this.accountFromConfig(cfg);
          if (account) {
            this.account = account;
            return this.account;
          }
        } catch {
          // try next
        }
      }

      // Cookie hint: some sessions keep wmid-like values even if HTML parse fails
      const cookieWmid = await getCookieValue(
        this.runtime,
        [".dayu.com", "dayu.com", "mp.dayu.com"],
        "wmid",
      );
      if (lastConfig?.utoken && cookieWmid) {
        this.account = {
          utoken: String(lastConfig.utoken),
          uploadSign: lastConfig.nsImageUploadSign || "",
          uid: String(cookieWmid),
          title: lastConfig.weMediaName || String(cookieWmid),
          avatar: this.normalizeAvatar(lastConfig.wmAvator),
        };
        return this.account;
      }

      throw new Error("大鱼号未登录或登录已过期（未检测到 isLogin/wmid）");
    }

    async checkAuth() {
      try {
        // Always refresh — avoid caching a previous guest/false negative
        this.account = null;
        const account = await this.ensureAccount();
        return {
          isAuthenticated: true,
          userId: account.uid,
          username: account.title || account.uid,
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
      const account = await this.ensureAccount();
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const mimeType = blob.type || "image/jpeg";
      const filename = `${Date.now()}.jpg`;

      const uploadUrl =
        `https://ns.dayu.com/article/imageUpload?appid=website&fromMaterial=0` +
        `&wmid=${account.uid}` +
        `&wmname=${encodeURIComponent(account.title)}` +
        `&sign=${account.uploadSign}`;

      const formData = new FormData();
      formData.append("upfile", blob, filename);
      formData.append("type", mimeType);
      formData.append("id", "WU_FILE_1");
      formData.append(
        "fileid",
        `uploadm-${Math.floor(Math.random() * 1_000_000)}`,
      );
      formData.append("name", filename);
      formData.append("lastModifiedDate", new Date().toString());
      formData.append("size", String(blob.size));

      const response = await this.runtime.fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const res = await response.json();
      const imgInfo = res?.data?.imgInfo || res?.imgInfo;
      if (!imgInfo?.url && !imgInfo?.org_url) {
        throw new Error(res?.error || res?.msg || "大鱼号图片上传失败");
      }
      const image = {
        org_url: imgInfo.org_url || imgInfo.url,
        url: imgInfo.url || imgInfo.org_url,
      };
      this.images.push(image);
      return { url: image.url };
    }

    async publish(article, options) {
      try {
        this.images = [];
        const account = await this.ensureAccount();
        const title = String(article.title || "").slice(0, 64);

        let content = article.html || article.markdown || "";
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["dayu.com", "uc.cn", "alicdn.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const coverImg = this.images[0]?.org_url || "";
        const body = new URLSearchParams({
          title,
          content,
          author: account.title,
          coverImg,
          article_type: "1",
          utoken: account.utoken,
          cover_from: "auto",
        });

        const response = await this.runtime.fetch(
          "https://mp.dayu.com/dashboard/save-draft",
          {
            method: "POST",
            credentials: "include",
            headers: {
              utoken: account.utoken,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "application/json, text/javascript, */*; q=0.01",
            },
            body: body.toString(),
          },
        );

        const text = await response.text();
        let res;
        try {
          res = JSON.parse(text);
        } catch {
          throw new Error(
            `保存草稿失败: ${text.substring(0, 160) || response.status}`,
          );
        }
        if (res?.error) throw new Error(String(res.error));
        const draftId = res?.data?._id || res?.data?.id;
        if (!draftId) {
          throw new Error(res?.msg || "保存草稿失败：无 draft id");
        }

        return this.createResult(true, {
          postId: String(draftId),
          postUrl: `https://mp.dayu.com/dashboard/article/write?draft_id=${draftId}`,
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
