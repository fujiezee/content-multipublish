/**
 * 东方财富 — Wechatsync v2 eastmoney.ts 移植
 */
import { getCookieValue } from "./_cookie.js";
import {
  assertHostedImages,
  extractImageSrcs,
} from "./_images.js";

const SKIP = ["gbres.dfcfw.com", "eastmoney.com", "dfcfw.com"];

function isEastmoneyCdn(url) {
  const s = String(url || "");
  return SKIP.some((p) => s.includes(p));
}

function sniffImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
}

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createEastmoneyAdapter(BaseAdapter) {
  return class EastmoneyAdapter extends BaseAdapter {
    meta = {
      id: "eastmoney",
      name: "东方财富",
      icon: "https://mp.eastmoney.com/collect/pc_article/favicon.ico",
      homepage: "https://mp.eastmoney.com",
      capabilities: ["article", "draft", "image_upload", "cover"],
    };

    ctoken = "";
    utoken = "";
    deviceId = "";

    async getDeviceId() {
      if (this.deviceId) return this.deviceId;
      const stored = await this.runtime.storage?.get?.("eastmoney_deviceId");
      if (stored) {
        this.deviceId = stored;
        return this.deviceId;
      }
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      this.deviceId = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join("");
      await this.runtime.storage?.set?.("eastmoney_deviceId", this.deviceId);
      return this.deviceId;
    }

    async fetchToken() {
      const ctoken = await getCookieValue(
        this.runtime,
        [".eastmoney.com", "eastmoney.com", "mp.eastmoney.com"],
        "ct",
      );
      const utoken = await getCookieValue(
        this.runtime,
        [".eastmoney.com", "eastmoney.com", "mp.eastmoney.com"],
        "ut",
      );
      if (!ctoken || !utoken) {
        throw new Error("未检测到登录信息，请先登录东方财富");
      }
      this.ctoken = ctoken;
      this.utoken = utoken;
    }

    async checkAuth() {
      try {
        await this.fetchToken();
        const response = await this.runtime.fetch(
          `https://caifuhaoapi.eastmoney.com/api/v2/getauthorinfo?platform=&ctoken=${this.ctoken}&utoken=${this.utoken}`,
          {
            method: "GET",
            credentials: "include",
            headers: { "x-requested-with": "fetch" },
          },
        );
        const data = await response.json();
        if (data.Success === 1 && data.Result?.accountId) {
          return {
            isAuthenticated: true,
            userId: data.Result.accountId,
            username: data.Result.accountName,
            avatar: data.Result.portrait,
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

    async buildParm({ draftid, title, text }) {
      const deviceid = await this.getDeviceId();
      return [
        { ip: "$IP$" },
        { deviceid },
        { version: "100" },
        { plat: "web" },
        { product: "CFH" },
        { ctoken: this.ctoken },
        { utoken: this.utoken },
        { draftid: draftid ?? "" },
        { drafttype: "0" },
        { type: "0" },
        { title: encodeURIComponent(title) },
        { text: encodeURIComponent(text) },
        { columns: "2" },
        { cover: "" },
        { issimplevideo: "0" },
        { videos: "" },
        { vods: "" },
        { isoriginal: "0" },
        { tgProduct: "" },
        { spcolumns: "" },
        { textsource: "0" },
        { replyauthority: "" },
        { modules: encodeURIComponent("[]") },
      ];
    }

    async callDraftApi(parm, draftId) {
      const pageUrl = draftId
        ? `https://mp.eastmoney.com/collect/pc_article/index.html#/?id=${draftId}`
        : "https://mp.eastmoney.com/collect/pc_article/index.html#/";

      const body = JSON.stringify({
        pageUrl,
        path: "draft/api/Article/SaveDraft",
        parm: JSON.stringify(parm),
      });

      const response = await this.runtime.fetch(
        "https://emfront.eastmoney.com/apifront/Tran/GetData?platform=",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`草稿 API 请求失败: ${response.status}`);
      }

      let rawData;
      try {
        rawData = JSON.parse(responseText);
      } catch {
        throw new Error("草稿 API 响应不是有效 JSON");
      }

      if (!rawData.RRquestSuccess || rawData.RCode !== 200) {
        throw new Error(`草稿 API 错误: ${rawData.RMsg || "未知错误"}`);
      }

      let innerData;
      try {
        innerData = JSON.parse(rawData.RData);
      } catch {
        throw new Error("无法解析草稿响应数据");
      }

      if (innerData.error_code !== 0) {
        throw new Error(`草稿业务错误: ${innerData.me || "未知错误"}`);
      }
      return innerData;
    }

    async createDraft(title) {
      const parm = await this.buildParm({ title, text: "<p> </p>" });
      const result = await this.callDraftApi(parm);
      if (!result.draft_id) {
        throw new Error("创建草稿失败: 响应缺少 draft_id");
      }
      return result.draft_id;
    }

    async updateDraft(draftId, title, content) {
      const parm = await this.buildParm({
        draftid: draftId,
        title,
        text: `<div>${content}</div>`,
      });
      await this.callDraftApi(parm, draftId);
    }

    async dataUriToBlob(src) {
      const res = await fetch(src);
      return res.blob();
    }

    async uploadImageBlob(file) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (!bytes.length) throw new Error("图片为空");
      const sniffed = sniffImageType(bytes);
      const type =
        file.type && file.type.startsWith("image/") ? file.type : sniffed || "image/png";
      if (!sniffed && !file.type?.startsWith("image/")) {
        throw new Error("下载结果不是图片（可能被拦或返回了登录页）");
      }
      const ext = /jpeg|jpg/i.test(type)
        ? "jpg"
        : /gif/i.test(type)
          ? "gif"
          : /webp/i.test(type)
            ? "webp"
            : "png";
      const blob = new Blob([bytes], { type });
      const filename = `dwgeo-${Date.now()}.${ext}`;
      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("noinlist", "1");
      formData.append("utoken", this.utoken);
      formData.append("ctoken", this.ctoken);

      const response = await this.runtime.fetch(
        "https://gbapi.eastmoney.com/iimage/image?platform=",
        { method: "POST", credentials: "include", body: formData },
      );
      const text = await response.text();
      let res;
      try {
        res = JSON.parse(text);
      } catch {
        throw new Error(
          `图床响应非 JSON（HTTP ${response.status}）: ${text.slice(0, 120)}`,
        );
      }
      const url = res.data?.url || res.data?.Url || res.result?.url;
      if ((res.code === 200 || res.Success === 1) && url && isEastmoneyCdn(url)) {
        return { url: String(url) };
      }
      throw new Error(
        `图片上传失败: ${res.message || res.msg || res.me || "未知错误"} (code: ${res.code})`,
      );
    }

    async uploadImageByUrl(src) {
      const url = String(src || "").trim();
      if (!url) throw new Error("空图片地址");
      if (isEastmoneyCdn(url)) return { url };

      if (url.startsWith("data:")) {
        return this.uploadImageBlob(await this.dataUriToBlob(url));
      }

      // 站内 byLink 经常拉不到 Vigma 等外链；只接受真正的东财图床地址。
      const canByLink =
        /^https?:\/\//i.test(url) &&
        !/vigma\.app|localhost|127\.0\.0\.1/i.test(url);
      if (canByLink) {
        try {
          const response = await this.runtime.fetch(
            "https://gbapi.eastmoney.com/iimage/image/byLink?platform=",
            {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                noinlist: "1",
                linkUrl: url,
                ctoken: this.ctoken,
                utoken: this.utoken,
              }),
            },
          );
          const res = await response.json().catch(() => null);
          const hosted = res?.data?.url || res?.data?.Url;
          if (res?.code === 200 && hosted && isEastmoneyCdn(hosted)) {
            return { url: String(hosted) };
          }
        } catch {
          // fall through to binary
        }
      }

      const imageResponse = await this.runtime.fetch(url, {
        credentials: "omit",
      });
      if (!imageResponse.ok) {
        throw new Error(
          `图片下载失败 HTTP ${imageResponse.status}: ${url.slice(0, 96)}`,
        );
      }
      const blob = await imageResponse.blob();
      if (!blob.size) throw new Error(`图片下载为空: ${url.slice(0, 96)}`);
      return this.uploadImageBlob(blob);
    }

    async rehostContent(html, onProgress) {
      const srcs = [...new Set(extractImageSrcs(html))];
      let out = html;
      let done = 0;
      const pending = srcs.filter((src) => src && !isEastmoneyCdn(src));
      for (const src of pending) {
        const uploaded = await this.uploadImageByUrl(src);
        if (!uploaded?.url || !isEastmoneyCdn(uploaded.url)) {
          throw new Error(
            `东方财富图床未返回平台地址（${String(src).slice(0, 80)}）`,
          );
        }
        out = out.split(src).join(uploaded.url);
        done += 1;
        onProgress?.({ current: done, total: pending.length, src });
      }
      assertHostedImages(out, SKIP, "东方财富");
      return out;
    }

    async publish(article, options) {
      try {
        await this.fetchToken();
        const draftId = await this.createDraft(article.title);
        const content = await this.rehostContent(
          article.html || "",
          options?.onImageProgress,
        );
        await this.updateDraft(draftId, article.title, content);

        return this.createResult(true, {
          postId: draftId,
          postUrl: `https://mp.eastmoney.com/collect/pc_article/index.html#/?id=${draftId}`,
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
