import {
  processAndAssertImages,
} from "./_images.js";
/**
 * 简书 — 基于 Wechatsync v1 jianshu driver（author/notes + 七牛图床）
 */

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createJianshuAdapter(BaseAdapter) {
  return class JianshuAdapter extends BaseAdapter {
    meta = {
      id: "jianshu",
      name: "简书",
      icon: "https://www.jianshu.com/favicon.ico",
      homepage: "https://www.jianshu.com/writer#/",
      capabilities: ["article", "draft", "image_upload"],
    };

    /** @type {number | null} */
    notebookId = null;

    /** @type {Record<string, number>} */
    noteVersions = {};

    async checkAuth() {
      try {
        const response = await this.runtime.fetch(
          "https://www.jianshu.com/settings/basic.json",
          { credentials: "include", headers: { accept: "application/json" } },
        );
        if (!response.ok) {
          return { isAuthenticated: false, error: "未登录" };
        }
        const res = await response.json();
        const data = res?.data;
        if (!data?.nickname) {
          return { isAuthenticated: false, error: "未登录" };
        }
        const uid =
          (typeof data.avatar === "string" &&
            data.avatar.split("/")[5]) ||
          data.nickname;
        return {
          isAuthenticated: true,
          userId: String(uid),
          username: data.nickname,
          avatar: data.avatar,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async getDefaultNotebookId() {
      if (this.notebookId != null) return this.notebookId;
      const response = await this.runtime.fetch(
        "https://www.jianshu.com/author/notebooks",
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(`获取文集失败: ${response.status}`);
      }
      const notebooks = await response.json();
      if (!Array.isArray(notebooks) || !notebooks.length) {
        throw new Error("没有可用文集，请先在简书创建文集");
      }
      this.notebookId = notebooks[0].id;
      return this.notebookId;
    }

    async resolveAutosaveControl(noteId, notebookId) {
      const key = String(noteId);
      if (this.noteVersions[key] != null) {
        this.noteVersions[key] += 1;
        return this.noteVersions[key];
      }

      const response = await this.runtime.fetch(
        `https://www.jianshu.com/author/notebooks/${notebookId}/notes`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(`获取笔记版本失败: ${response.status}`);
      }
      const notes = await response.json();
      const current = (Array.isArray(notes) ? notes : []).find(
        (n) => String(n.id) === key,
      );
      const base =
        typeof current?.autosave_control === "number"
          ? current.autosave_control
          : 0;
      this.noteVersions[key] = base + 1;
      return this.noteVersions[key];
    }

    async uploadImageByUrl(src) {
      // Prefer remote fetch (simpler); fall back to Qiniu token upload.
      try {
        let url = src;
        if (url.includes("xitu.io") && url.includes("webp")) {
          url = url.replace(/webp/g, "png");
        }
        const fetchRes = await this.runtime.fetch(
          "https://www.jianshu.com/upload_images/fetch",
          {
            method: "POST",
            credentials: "include",
            headers: {
              accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url }),
          },
        );
        const text = await fetchRes.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        const imageUrl = data?.url || data?.[0]?.url;
        if (fetchRes.ok && imageUrl) return { url: imageUrl };
      } catch {
        // fall through to Qiniu
      }

      const imageResponse = await this.runtime.fetch(src);
      if (!imageResponse.ok) throw new Error(`图片下载失败: ${src}`);
      const blob = await imageResponse.blob();
      const filename = `${Date.now()}.png`;

      const tokenRes = await this.runtime.fetch(
        `https://www.jianshu.com/upload_images/token.json?filename=${filename}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      const tokenData = await tokenRes.json();
      if (!tokenData?.token || !tokenData?.key) {
        throw new Error("获取简书上传 token 失败");
      }

      const formData = new FormData();
      formData.append("token", tokenData.token);
      formData.append("key", tokenData.key);
      formData.append("x:protocol", "https");
      formData.append("file", blob, filename);

      const uploadRes = await this.runtime.fetch("https://upload.qiniup.com/", {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (!uploadData?.url) {
        throw new Error("简书图片上传失败");
      }
      return { url: uploadData.url };
    }

    async publish(article, options) {
      try {
        const notebookId = await this.getDefaultNotebookId();
        const title = String(article.title || "").slice(0, 80);

        const createRes = await this.runtime.fetch(
          "https://www.jianshu.com/author/notes",
          {
            method: "POST",
            credentials: "include",
            headers: {
              accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              at_bottom: false,
              notebook_id: notebookId,
              title,
            }),
          },
        );
        const createText = await createRes.text();
        let created;
        try {
          created = JSON.parse(createText);
        } catch {
          throw new Error(
            `创建草稿失败: ${createText.substring(0, 120) || createRes.status}`,
          );
        }
        if (!createRes.ok || !created?.id) {
          throw new Error(
            created?.error ||
              created?.message ||
              `创建草稿失败: ${createRes.status}`,
          );
        }

        const noteId = created.id;
        if (typeof created.autosave_control === "number") {
          this.noteVersions[String(noteId)] = created.autosave_control;
        }

        let content = article.html || article.markdown || "";
        content = await processAndAssertImages(
          this,
          content,
          (src) => this.uploadImageByUrl(src),
          {skipPatterns: [
              "jianshu.com",
              "jianshu.io",
              "upload-images.jianshu.io",
            ],
            onProgress: options?.onImageProgress,
            platformName: "简书",
          },
        );

        const autosaveControl = await this.resolveAutosaveControl(
          noteId,
          notebookId,
        );
        const saveRes = await this.runtime.fetch(
          `https://www.jianshu.com/author/notes/${noteId}`,
          {
            method: "PUT",
            credentials: "include",
            headers: {
              accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: noteId,
              title,
              content,
              autosave_control: autosaveControl,
            }),
          },
        );
        const saveText = await saveRes.text();
        if (!saveRes.ok) {
          throw new Error(
            `保存草稿失败: ${saveRes.status} - ${saveText.substring(0, 160)}`,
          );
        }

        return this.createResult(true, {
          postId: String(noteId),
          postUrl: `https://www.jianshu.com/writer#/notebooks/${notebookId}/notes/${noteId}`,
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
