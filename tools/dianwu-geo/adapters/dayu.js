/**
 * 大鱼号 — Wechatsync v1 dayu.js 移植（dashboard/save-draft + ns 图床）
 */

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

    parseGlobalConfig(html) {
      const mark = "var globalConfig = ";
      const authIndex = html.indexOf(mark);
      if (authIndex === -1) return null;
      const endIndex = html.indexOf("var G = {", authIndex);
      if (endIndex === -1) return null;
      const raw = html.substring(authIndex + mark.length, endIndex).trim();
      try {
        // page embeds a JS object literal
        return new Function(`return (${raw})`)();
      } catch {
        return null;
      }
    }

    async ensureAccount() {
      if (this.account) return this.account;
      const response = await this.runtime.fetch(
        "https://mp.dayu.com/dashboard/index",
        { credentials: "include" },
      );
      const html = await response.text();
      const pageConfig = this.parseGlobalConfig(html);
      if (!pageConfig?.utoken || !pageConfig?.wmid) {
        throw new Error("大鱼号未登录或登录已过期");
      }
      const avatar = pageConfig.wmAvator || "";
      this.account = {
        utoken: pageConfig.utoken,
        uploadSign: pageConfig.nsImageUploadSign || "",
        uid: String(pageConfig.wmid),
        title: pageConfig.weMediaName || "",
        avatar: !avatar
          ? undefined
          : avatar.startsWith("http")
            ? avatar
            : `https://${avatar.replace(/^\/+/, "")}`,
      };
      return this.account;
    }

    async checkAuth() {
      try {
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
