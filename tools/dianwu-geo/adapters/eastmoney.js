/**
 * 东方财富 — Wechatsync v2 eastmoney.ts 移植
 */
import { getCookieValue } from "./_cookie.js";

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
      const res = await this.runtime.fetch(src);
      return res.blob();
    }

    async uploadImageBlob(file) {
      const ext = file.type.split("/")[1] || "png";
      const filename = `${Date.now()}.${ext}`;
      const formData = new FormData();
      formData.append("file", file, filename);
      formData.append("noinlist", "1");
      formData.append("utoken", this.utoken);
      formData.append("ctoken", this.ctoken);

      const response = await this.runtime.fetch(
        "https://gbapi.eastmoney.com/iimage/image?platform=",
        { method: "POST", credentials: "include", body: formData },
      );
      const res = await response.json();
      if (res.code === 200 && res.data?.url) return { url: res.data.url };
      throw new Error(
        `图片上传失败: ${res.message || "未知错误"} (code: ${res.code})`,
      );
    }

    async uploadImageByUrl(src) {
      if (src.startsWith("data:")) {
        const blob = await this.dataUriToBlob(src);
        return this.uploadImageBlob(blob);
      }

      const response = await this.runtime.fetch(
        "https://gbapi.eastmoney.com/iimage/image/byLink?platform=",
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            noinlist: "1",
            linkUrl: src,
            ctoken: this.ctoken,
            utoken: this.utoken,
          }),
        },
      );
      const res = await response.json();
      if (res.code === 200 && res.data?.url) return { url: res.data.url };
      throw new Error(
        `图片上传失败: ${res.message || "未知错误"} (code: ${res.code})`,
      );
    }

    async publish(article, options) {
      try {
        await this.fetchToken();
        const draftId = await this.createDraft(article.title);
        const content = await this.processImages(
          article.html || "",
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ["gbres.dfcfw.com", "eastmoney.com"],
            onProgress: options?.onImageProgress,
          },
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
