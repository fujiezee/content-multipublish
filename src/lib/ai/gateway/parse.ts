export type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const ROLES = new Set<GatewayMessage["role"]>(["system", "user", "assistant"]);

export function parseGatewayMessages(raw: unknown): GatewayMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: GatewayMessage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const role = (row as { role?: string }).role;
    const content = (row as { content?: string }).content;
    if (!ROLES.has(role as GatewayMessage["role"])) continue;
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({ role: role as GatewayMessage["role"], content: content.trim() });
  }
  return out;
}

export function parseGatewayTextBody(body: unknown) {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const modelSlug =
    typeof record.model === "string"
      ? record.model.trim()
      : typeof record.modelSlug === "string"
        ? record.modelSlug.trim()
        : "";
  const messages = parseGatewayMessages(record.messages);
  const temperature =
    typeof record.temperature === "number" ? record.temperature : undefined;
  const maxTokens =
    typeof record.maxTokens === "number"
      ? record.maxTokens
      : typeof record.max_tokens === "number"
        ? record.max_tokens
        : undefined;
  const timeoutMs =
    typeof record.timeoutMs === "number"
      ? record.timeoutMs
      : typeof record.timeout_ms === "number"
        ? record.timeout_ms
        : undefined;
  return { modelSlug, messages, temperature, maxTokens, timeoutMs };
}

export function parseGatewayImageBody(body: unknown) {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const modelSlug =
    typeof record.model === "string"
      ? record.model.trim()
      : typeof record.modelSlug === "string"
        ? record.modelSlug.trim()
        : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  const aspectRatio =
    typeof record.aspectRatio === "string"
      ? record.aspectRatio.trim()
      : typeof record.aspect_ratio === "string"
        ? record.aspect_ratio.trim()
        : undefined;
  return { modelSlug, prompt, aspectRatio };
}
