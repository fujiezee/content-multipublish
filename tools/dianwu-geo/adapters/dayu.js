/**
 * 大鱼号 — Wechatsync v1 dayu.js 移植（dashboard/save-draft + ns 图床）
 *
 * 现网首页仍注入 globalConfig，但已无旧结束标记 `var G = {`；
 * 且游客页也会带 utoken，必须以 isLogin / wmid 判断登录。
 *
 * 封面/正文图必须落在 globalConfig.imageDomains 白名单内，否则 save-draft
 * 返回「封面图地址非法」。常见误伤：alicdn / ns.dayu.com / Vigma org_url。
 */
import { getCookieValue } from "./_cookie.js";
import { processAndAssertImages } from "./_images.js";

/** 与 mp.dayu.com globalConfig.imageDomains 对齐（子串匹配） */
const IMAGE_HOST_PATTERNS = [
  "image.uc.cn",
  "pfdev.uodoo.com",
  "image.zzd.sm.cn",
  "mp.dayu.com",
];

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

    /** @type {{
     *   utoken: string;
     *   uploadSign: string;
     *   outsiteUploadSign: string;
     *   feHost: string;
     *   appid: string;
     *   uid: string;
     *   title: string;
     *   avatar?: string;
     * } | null} */
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

    normalizeUrl(src) {
      const s = String(src || "").trim();
      if (!s) return "";
      if (s.startsWith("//")) return `https:${s}`;
      return s;
    }

    /** 仅接受大鱼 imageDomains 白名单 */
    isAllowedImageUrl(src) {
      const s = this.normalizeUrl(src);
      if (!s || s.startsWith("data:")) return false;
      return IMAGE_HOST_PATTERNS.some((h) => s.includes(h));
    }

    accountFromConfig(pageConfig) {
      const wmid = pageConfig?.wmid != null ? String(pageConfig.wmid).trim() : "";
      const isLogin = pageConfig?.isLogin === true || pageConfig?.isLogin === 1;
      if (!isLogin && !wmid) return null;
      if (!pageConfig?.utoken) return null;

      return {
        utoken: String(pageConfig.utoken),
        uploadSign: pageConfig.nsImageUploadSign || "",
        outsiteUploadSign: pageConfig.nsOutsiteImgUploadSign || "",
        feHost: String(pageConfig.nodeServiceFeHost || "https://ns.dayu.com").replace(
          /\/$/,
          "",
        ),
        appid: String(pageConfig.nsAppid || "website"),
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
          outsiteUploadSign: lastConfig.nsOutsiteImgUploadSign || "",
          feHost: String(lastConfig.nodeServiceFeHost || "https://ns.dayu.com").replace(
            /\/$/,
            "",
          ),
          appid: String(lastConfig.nsAppid || "website"),
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

    /**
     * 从上传响应里挑白名单 URL。优先 url（编辑器正文也用 url），不要误用外链 org_url。
     * @param {Record<string, unknown> | null | undefined} imgInfo
     */
    pickAllowedUrl(imgInfo) {
      if (!imgInfo || typeof imgInfo !== "object") return "";
      for (const key of ["url", "org_url"]) {
        const cand = this.normalizeUrl(imgInfo[key]);
        if (this.isAllowedImageUrl(cand)) return cand;
      }
      return "";
    }

    rememberImage(orgUrl, hostedUrl) {
      const image = {
        org_url: this.normalizeUrl(orgUrl) || hostedUrl,
        url: hostedUrl,
      };
      this.images.push(image);
      return { url: hostedUrl };
    }

    /** 站外 URL 转存（与编辑器 uploadOutsiteImages 同源，返回 image.uc.cn） */
    async uploadViaOutsite(src) {
      const account = await this.ensureAccount();
      if (!account.outsiteUploadSign) {
        throw new Error("缺少 nsOutsiteImgUploadSign");
      }
      const uploadUrl =
        `${account.feHost}/article/outsiteImgUpload` +
        `?appid=${encodeURIComponent(account.appid)}` +
        `&wmid=${encodeURIComponent(account.uid)}` +
        `&wmname=${encodeURIComponent(account.title)}` +
        `&sign=${account.outsiteUploadSign}`;

      const response = await this.runtime.fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
        body: new URLSearchParams({ imgSrc: src }).toString(),
      });
      const res = await response.json();
      if (res?.code != null && Number(res.code) !== 0) {
        throw new Error(res?.message || res?.msg || `outsiteImgUpload code=${res.code}`);
      }
      const imgInfo = res?.data?.imgInfo || res?.imgInfo || res?.data;
      const hosted = this.pickAllowedUrl(imgInfo);
      if (!hosted) {
        throw new Error(
          `outsiteImgUpload 未返回白名单地址: ${String(
            imgInfo?.url || imgInfo?.org_url || "",
          ).slice(0, 96)}`,
        );
      }
      return this.rememberImage(src, hosted);
    }

    /** 二进制上传（Wechatsync 路径）；仍须校验白名单 */
    async uploadViaBinary(src) {
      const account = await this.ensureAccount();
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const mimeType = blob.type || "image/jpeg";
      const filename = `${Date.now()}.jpg`;

      const uploadUrl =
        `${account.feHost}/article/imageUpload?appid=${encodeURIComponent(account.appid)}` +
        `&fromMaterial=0` +
        `&wmid=${encodeURIComponent(account.uid)}` +
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
      const hosted = this.pickAllowedUrl(imgInfo);
      if (!hosted) {
        throw new Error(
          res?.error ||
            res?.msg ||
            `大鱼号图床返回非白名单地址: ${String(
              imgInfo?.url || imgInfo?.org_url || "",
            ).slice(0, 96)}`,
        );
      }
      return this.rememberImage(src, hosted);
    }

    async uploadImageByUrl(src) {
      const normalized = this.normalizeUrl(src);
      if (this.isAllowedImageUrl(normalized)) {
        return this.rememberImage(normalized, normalized);
      }

      try {
        return await this.uploadViaOutsite(normalized);
      } catch (outsiteErr) {
        try {
          return await this.uploadViaBinary(normalized);
        } catch (binaryErr) {
          const a =
            outsiteErr instanceof Error ? outsiteErr.message : String(outsiteErr);
          const b =
            binaryErr instanceof Error ? binaryErr.message : String(binaryErr);
          throw new Error(`大鱼号图片转存失败: ${b}（outsite: ${a}）`);
        }
      }
    }

    async publish(article, options) {
      try {
        this.images = [];
        const account = await this.ensureAccount();
        const title = String(article.title || "").slice(0, 64);

        // 不传封面（coverImg 易触发「封面图地址非法」）；只转存正文图
        let content = article.html || article.markdown || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: IMAGE_HOST_PATTERNS,
            onProgress: options?.onImageProgress,
            platformName: "大鱼号",
          },
        );

        const body = new URLSearchParams({
          title,
          content,
          author: account.title,
          article_type: "1",
          utoken: account.utoken,
          // 显式清空，避免服务端沿用/自动抽封面
          coverImg: "",
          cover_from: "",
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
          message: "草稿已保存（未设封面，请在大鱼号编辑器里选封面）",
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
