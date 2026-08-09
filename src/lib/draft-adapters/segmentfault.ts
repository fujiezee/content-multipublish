import fs from "fs";
import path from "path";
import { createSessionFetch } from "@/lib/draft-adapters/cookie-jar";
import type {
  DraftAdapter,
  DraftAdapterArticle,
  DraftAuthResult,
  DraftPublishResult,
} from "@/lib/draft-adapters/types";
import { DATA_DIR } from "@/lib/paths";

const ORIGIN = "https://segmentfault.com";
const SKIP_IMAGE_HOSTS = ["segmentfault.com", "image-static.segmentfault.com"];

type SessionFetch = ReturnType<typeof createSessionFetch>;

async function getSessionToken(fetchFn: SessionFetch): Promise<string> {
  const response = await fetchFn(`${ORIGIN}/write`, {
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
  });
  const html = await response.text();

  const tokenMatch = html.match(
    /serverData":\s*\{\s*"Token"\s*:\s*"([^"]+)"/,
  );
  if (tokenMatch?.[1]) return tokenMatch[1];

  const markStr = "window.g_initialProps = ";
  const authIndex = html.indexOf(markStr);
  if (authIndex === -1) {
    throw new Error("获取 session token 失败（可能未登录）");
  }
  const endIndex = html.indexOf(";\n\t</script>", authIndex);
  if (endIndex === -1) {
    throw new Error("解析 session token 失败");
  }
  const configStr = html.substring(authIndex + markStr.length, endIndex);
  const config = JSON.parse(configStr) as {
    global?: { sessionInfo?: { key?: string } };
  };
  const token = config?.global?.sessionInfo?.key;
  if (!token) throw new Error("session token 为空");
  return token;
}

async function uploadImageBytes(
  fetchFn: SessionFetch,
  token: string,
  bytes: Buffer,
  filename: string,
): Promise<string> {
  const formData = new FormData();
  formData.append(
    "image",
    new Blob([new Uint8Array(bytes)]),
    filename || "image.png",
  );

  const response = await fetchFn(`${ORIGIN}/gateway/image`, {
    method: "POST",
    origin: ORIGIN,
    referer: `${ORIGIN}/write`,
    headers: { token },
    body: formData,
  });

  const text = await response.text();
  if (
    text === "Unauthorized" ||
    text.includes("禁言") ||
    text.includes("锁定")
  ) {
    throw new Error(text === "Unauthorized" ? "未授权" : text);
  }

  let res: unknown;
  try {
    res = JSON.parse(text);
  } catch {
    throw new Error(`图片上传失败: ${text.slice(0, 200)}`);
  }

  const imageUrl = parseImageUploadResult(res);
  if (!imageUrl) {
    throw new Error("图片上传失败：无返回地址");
  }
  return imageUrl;
}

function parseImageUploadResult(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  if ("result" in res && typeof (res as { result: unknown }).result === "string") {
    return (res as { result: string }).result;
  }
  if (Array.isArray(res)) {
    if (res[0] === 1) return null;
    if (typeof res[1] === "string") return res[1];
    if (res[2]) return `https://image-static.segmentfault.com/${res[2]}`;
  }
  return null;
}

function shouldSkipImage(src: string): boolean {
  return SKIP_IMAGE_HOSTS.some((h) => src.includes(h));
}

function resolveLocalPath(src: string): string | null {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return null;
  }
  // Cover / upload paths like /uploads/... or uploads/...
  const rel = src.replace(/^\//, "");
  const candidates = [
    path.join(DATA_DIR, rel),
    path.join(process.cwd(), "public", rel),
    path.join(process.cwd(), rel),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

async function uploadImageSrc(
  fetchFn: SessionFetch,
  token: string,
  src: string,
): Promise<string | null> {
  try {
    if (shouldSkipImage(src)) return src;

    const local = resolveLocalPath(src);
    if (local) {
      const bytes = fs.readFileSync(local);
      return await uploadImageBytes(
        fetchFn,
        token,
        bytes,
        path.basename(local),
      );
    }

    if (src.startsWith("http://") || src.startsWith("https://")) {
      const imageResponse = await fetch(src);
      if (!imageResponse.ok) return null;
      const buf = Buffer.from(await imageResponse.arrayBuffer());
      const name =
        path.basename(new URL(src).pathname) || "image.png";
      return await uploadImageBytes(fetchFn, token, buf, name);
    }
  } catch {
    // Keep original URL on failure
  }
  return null;
}

/** Rewrite markdown/html image srcs; failures keep original src. */
async function processImages(
  content: string,
  fetchFn: SessionFetch,
  token: string,
): Promise<string> {
  const mdImg = /!\[[^\]]*]\(([^)]+)\)/g;
  const htmlImg = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const urls = new Set<string>();

  for (const re of [mdImg, htmlImg]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) != null) {
      if (m[1]) urls.add(m[1].trim());
    }
  }

  let next = content;
  for (const src of urls) {
    const uploaded = await uploadImageSrc(fetchFn, token, src);
    if (uploaded && uploaded !== src) {
      next = next.split(src).join(uploaded);
    }
  }
  return next;
}

export function createSegmentfaultDraftAdapter(): DraftAdapter {
  return {
    id: "segmentfault",

    async checkAuth(): Promise<DraftAuthResult> {
      try {
        const fetchFn = createSessionFetch("segmentfault");
        const response = await fetchFn(`${ORIGIN}/user/settings`, {
          origin: ORIGIN,
          referer: `${ORIGIN}/`,
        });
        const html = await response.text();
        const userLinkMatch = html.match(/href="\/u\/([^"]+)"/);
        if (!userLinkMatch) {
          return { isAuthenticated: false, error: "未登录" };
        }
        return {
          isAuthenticated: true,
          userId: userLinkMatch[1],
          username: userLinkMatch[1],
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async publishDraft(
      article: DraftAdapterArticle,
    ): Promise<DraftPublishResult> {
      try {
        const fetchFn = createSessionFetch("segmentfault");
        const token = await getSessionToken(fetchFn);

        let content = article.markdown || article.html || "";
        content = await processImages(content, fetchFn, token);

        const response = await fetchFn(`${ORIGIN}/gateway/draft`, {
          method: "POST",
          origin: ORIGIN,
          referer: `${ORIGIN}/write`,
          headers: {
            "Content-Type": "application/json",
            token,
            accept: "*/*",
          },
          body: JSON.stringify({
            title: article.title,
            tags: [],
            text: content,
            object_id: "",
            type: "article",
          }),
        });

        const text = await response.text();
        if (
          text === "Unauthorized" ||
          text.includes("禁言") ||
          text.includes("锁定")
        ) {
          return {
            success: false,
            error: text === "Unauthorized" ? "未授权" : text,
          };
        }

        let res: unknown;
        try {
          res = JSON.parse(text);
        } catch {
          return { success: false, error: `发布失败: ${text.slice(0, 200)}` };
        }

        if (Array.isArray(res)) {
          if (res[0] === 1) {
            return { success: false, error: String(res[1] || "发布失败") };
          }
          const data = res[1] as { id?: string } | undefined;
          if (data?.id) {
            return {
              success: true,
              postId: data.id,
              postUrl: `${ORIGIN}/write?draftId=${data.id}`,
            };
          }
        }

        const obj = res as {
          id?: string;
          message?: string;
          msg?: string;
          error?: string;
          errMsg?: string;
        };
        if (!obj.id) {
          return {
            success: false,
            error:
              obj.message ||
              obj.msg ||
              obj.error ||
              obj.errMsg ||
              JSON.stringify(res),
          };
        }

        return {
          success: true,
          postId: obj.id,
          postUrl: `${ORIGIN}/write?draftId=${obj.id}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
