type ArkAuth = { apiKey: string; baseUrl: string };

type Json = Record<string, unknown>;

let ingestMode: "unknown" | "file" | "none" = "unknown";

function pickUrl(json: Json | null): string {
  if (!json) return "";
  const result = json.Result && typeof json.Result === "object" ? (json.Result as Json) : null;
  const data = json.data && typeof json.data === "object" ? (json.data as Json) : null;
  const raw = json.url || json.URL || result?.URL || result?.url || data?.url || data?.URL;
  return typeof raw === "string" ? raw.trim() : "";
}

function isPublicHttps(url: string): boolean {
  return /^https:\/\//i.test(url) && !/127\.0\.0\.1|localhost/i.test(url);
}

async function ingestAsFile(
  config: ArkAuth,
  url: string,
): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 64) return null;
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append(
    "file",
    new File([new Uint8Array(bytes)], "still.jpg", { type: "image/jpeg" }),
  );
  const uploaded = await fetch(`${config.baseUrl}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await uploaded.text();
  let json: Json = {};
  try {
    json = JSON.parse(raw) as Json;
  } catch {
    return null;
  }
  if (!uploaded.ok) return null;
  const hosted = pickUrl(json);
  return isPublicHttps(hosted) ? hosted : null;
}

/** Only return a public https URL Ark can fetch. Never asset:// or file_id://. */
export async function toArkTrustedStill(
  config: ArkAuth,
  url: string,
): Promise<string | null> {
  if (ingestMode === "none") return null;
  const file = await ingestAsFile(config, url).catch(() => null);
  if (file) {
    ingestMode = "file";
    return file;
  }
  ingestMode = "none";
  return null;
}
