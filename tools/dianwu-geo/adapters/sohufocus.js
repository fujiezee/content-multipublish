/**
 * 搜狐焦点 — 登录检测对齐现网 house/login.focus.cn
 *
 * 旧 mp.focus.cn / mp-fe-pc.focus.cn 媒体后台已 302 下线；
 * 现网登录态看 Cookie `ppinf`（及 focusinf / pprdig），
 * 用户信息走 login.focus.cn/passport/getUserInfo。
 * 草稿接口若仍可用则走 publishNewsInfo status=4，否则给出明确失败原因。
 */
import { getCookieValue } from "./_cookie.js";

const DOMAINS = [".focus.cn", "focus.cn", "house.focus.cn", "login.focus.cn", "www.focus.cn"];
const COOKIE_URLS = [
  "https://house.focus.cn/",
  "https://login.focus.cn/",
  "https://www.focus.cn/",
  "https://u.focus.cn/",
];
const SESSION_COOKIE_NAMES = ["ppinf", "focusinf", "pprdig"];

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createSohufocusAdapter(BaseAdapter) {
  return class SohufocusAdapter extends BaseAdapter {
    meta = {
      id: "sohufocus",
      name: "搜狐焦点",
      icon: "https://house.focus.cn/favicon.ico",
      homepage: "https://login.focus.cn/?ru=https%3A%2F%2Fhouse.focus.cn%2F",
      capabilities: ["article", "draft", "image_upload"],
    };

    async listFocusCookies() {
      if (typeof chrome === "undefined" || !chrome.cookies?.getAll) return [];
      try {
        const all = await chrome.cookies.getAll({ domain: "focus.cn" });
        return Array.isArray(all) ? all : [];
      } catch {
        try {
          return (await chrome.cookies.getAll({})).filter((c) =>
            String(c.domain || "").includes("focus.cn"),
          );
        } catch {
          return [];
        }
      }
    }

    async getSessionCookie() {
      for (const name of SESSION_COOKIE_NAMES) {
        const byUrl = await getCookieValue(
          this.runtime,
          DOMAINS,
          name,
          COOKIE_URLS,
        );
        if (byUrl) return { name, value: byUrl };
      }
      const all = await this.listFocusCookies();
      for (const name of SESSION_COOKIE_NAMES) {
        const hit = all.find((c) => c.name === name && c.value);
        if (hit?.value) return { name, value: String(hit.value) };
      }
      return null;
    }

    async fetchPassportUser() {
      const response = await this.runtime.fetch(
        "https://login.focus.cn/passport/getUserInfo",
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            Origin: "https://house.focus.cn",
            Referer: "https://house.focus.cn/",
          },
        },
      );
      const text = await response.text();
      let res;
      try {
        res = JSON.parse(text);
      } catch {
        return null;
      }
      if (res?.code !== 200 || !res?.data) return null;
      return res.data;
    }

    async checkAuth() {
      try {
        const session = await this.getSessionCookie();
        const user = await this.fetchPassportUser().catch(() => null);

        if (user?.uid != null || user?.nickName || user?.mobile) {
          return {
            isAuthenticated: true,
            userId: String(user.uid || user.mobile || "focus"),
            username:
              user.nickName ||
              user.mobile ||
              (user.uid != null ? String(user.uid) : "搜狐焦点用户"),
            avatar: user.avatar || user.headPic || undefined,
          };
        }

        // Passport API 偶发失败时，有登录 Cookie 仍视为已登录（对齐豆瓣策略）
        if (session?.value) {
          return {
            isAuthenticated: true,
            userId: "focus-session",
            username: "搜狐焦点用户",
          };
        }

        return { isAuthenticated: false, error: "未登录" };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async uploadImageByUrl(src) {
      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const formData = new FormData();
      formData.append("image", blob, `${Date.now()}.jpg`);

      const response = await this.runtime.fetch(
        "https://mp-fe-pc.focus.cn/common/image/upload?type=2",
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      if (response.status === 301 || response.status === 302) {
        throw new Error(
          "搜狐焦点旧媒体后台已下线，无法上传图片；请改用搜狐号或本机自动",
        );
      }
      const res = await response.json().catch(() => null);
      if (res?.code != 200 || res?.data == null) {
        throw new Error(res?.msg || res?.message || "搜狐焦点图片上传失败");
      }
      const path = res.data;
      const url =
        typeof path === "string" && path.startsWith("http")
          ? path
          : `https://t-img.51f.com/sh740wsh${path}`;
      return { url };
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) throw new Error("未登录搜狐焦点");

        const title = String(article.title || "").slice(0, 64);
        let content = article.html || article.markdown || "";
        content = content.replace(/>[\t\s]*</g, "><");

        // 先探测旧草稿 API 是否仍可用（多数环境已 302 到 www.focus.cn）
        const probe = await this.runtime.fetch(
          "https://mp-fe-pc.focus.cn/user/status?",
          {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
            redirect: "manual",
          },
        ).catch(() => null);

        const probeStatus = probe?.status ?? 0;
        const probeType = String(probe?.headers?.get?.("content-type") || "");
        if (
          !probe ||
          probeStatus === 0 ||
          probeStatus === 301 ||
          probeStatus === 302 ||
          probeType.includes("text/html")
        ) {
          throw new Error(
            "搜狐焦点媒体后台（mp.focus.cn）已下线，扩展草稿不可用。请改用「搜狐号」草稿，或本机自动打开发布页",
          );
        }

        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["focus.cn", "51f.com", "sohu.com"],
            onProgress: options?.onImageProgress,
          },
        );

        const response = await this.runtime.fetch(
          "https://mp-fe-pc.focus.cn/news/info/publishNewsInfo",
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              projectIds: [],
              newsBasic: {
                id: "",
                cityId: 0,
                title,
                category: 1,
                headImg: "",
                newsAbstract: "",
                isGuide: 0,
                status: 4, // draft
              },
              newsContent: { content },
              videoIds: [],
            }),
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

        const articleId = res?.data?.id || res?.data?.data?.id;
        if (!articleId) {
          throw new Error(
            res?.msg || res?.message || res?.data?.msg || "保存草稿失败",
          );
        }

        return this.createResult(true, {
          postId: String(articleId),
          postUrl: `https://house.focus.cn/`,
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
