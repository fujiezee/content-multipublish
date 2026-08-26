import {
  deleteAiModelRow,
  getAiModelRowById,
  getAiModelRowBySlug,
  insertAiModelRow,
  listAiModelRows,
  rowToView,
  slugTaken,
  updateAiModelRow,
  migrateAiModelCatalog,
} from "@/lib/db/model-catalog";
import type {
  AiModelConfig,
  AiModelInput,
  AiModelUse,
  AiModelView,
  ListAiModelsQuery,
} from "@/lib/ai/model-catalog/types";
import { providerChannelReady } from "@/lib/ai/gateway/providers";
import { DEFAULT_AI_MODEL_SEED } from "@/lib/ai/model-catalog/seed";
import { cfStrengthHint } from "@/lib/ai/model-catalog/cloudflare-seed";
import {
  costHintFromOfficial,
  lookupOfficialPricing,
} from "@/lib/ai/model-catalog/ark-prices";
import { isBillableOfficialPricing } from "@/lib/ai/model-catalog/pricing";
import { shouldSkipSyncImport, isDatedSnapshotId, isHardRetiredModelId } from "@/lib/ai/model-catalog/discontinued";
import type Database from "better-sqlite3";

type Db = Database.Database;

function withReady(row: Parameters<typeof rowToView>[0]): AiModelView {
  const view = rowToView(row, providerChannelReady(row.provider));
  if (!view.hint.trim()) {
    view.hint =
      view.provider === "cloudflare"
        ? cfStrengthHint({
            name: view.providerModel || view.slug,
            task: view.modality,
          })
        : fallbackStrengthHint(row);
  }
  return view;
}

/** 供 migrate 调用 */
export function seedAiModelCatalog(database: Db) {
  migrateAiModelCatalog(database);
  for (const item of DEFAULT_AI_MODEL_SEED) {
    if (getAiModelRowBySlug(database, item.slug)) continue;
    insertAiModelRow(database, item);
  }
  ensureDefaultModelBadges(database);
  ensureUserFacingModelCopy(database);
  ensureMusicPublishDurationModels(database);
  ensureReviewUseOnTextModels(database);
}

/** 已有文本写稿/剧本模型补上人话审核用途，前台才能单独选审核模型 */
function ensureReviewUseOnTextModels(database: Db) {
  for (const row of listAiModelRows(database)) {
    if (row.modality !== "text") continue;
    let uses: AiModelUse[] = [];
    try {
      const parsed = JSON.parse(row.uses_json) as unknown;
      uses = Array.isArray(parsed)
        ? parsed.filter((item): item is AiModelUse => typeof item === "string")
        : [];
    } catch {
      continue;
    }
    if (!uses.includes("copywriting") && !uses.includes("script")) continue;
    if (uses.includes("review")) continue;
    updateAiModelRow(database, row.id, { uses: [...uses, "review"] });
  }
}

/** 汽水上架至少 1 分钟：打开 V5.5（可指定时长），并刷新出歌说明 */
function ensureMusicPublishDurationModels(database: Db) {
  const v55 = getAiModelRowBySlug(database, "suno-v5-5");
  if (v55) {
    updateAiModelRow(database, v55.id, {
      enabled: true,
      hint: "可指定时长（约 90 秒）· 汽水上架更稳",
    });
  }
  const v5 = getAiModelRowBySlug(database, "suno-v5");
  if (v5 && (!v5.hint || /最长约|点悟配乐默认/.test(v5.hint))) {
    updateAiModelRow(database, v5.id, {
      hint: "默认 · 完整成曲约 90 秒起（汽水至少 1 分钟）",
    });
  }
}

/** 已有库若还没打过推荐标记，补一批默认推荐，不覆盖人工改过的 */
function ensureDefaultModelBadges(database: Db) {
  const defaults: Record<string, AiModelInput["badges"]> = {
    "deepseek-reasoner": ["recommended"],
    "deepseek-chat": ["recommended"],
    "claude-sonnet-5": ["hot", "recommended"],
    "gpt-5.6": ["hot"],
    "gpt-5.6-luna": ["new"],
    "glm-5.2": ["new"],
    "qwen3-max": ["hot"],
    "suno-v5-5": ["recommended"],
    "suno-v5": ["recommended"],
  };
  for (const [slug, badges] of Object.entries(defaults)) {
    const row = getAiModelRowBySlug(database, slug);
    if (!row) continue;
    const view = withReady(row);
    if (view.badges.length) continue;
    updateAiModelRow(database, row.id, { badges });
  }
}

function hintLooksLikeProxyChannel(hint: string): boolean {
  const t = hint.trim();
  if (!t) return false;
  if (t === "代理" || t.startsWith("代理 ·") || t.startsWith("代理·")) return true;
  return t.includes("经代理站");
}

function hintLooksLikeChannelTag(hint: string): boolean {
  const t = hint.trim();
  if (!t) return false;
  if (hintLooksLikeProxyChannel(t)) return true;
  return /^(Workers AI|Cloudflare|百炼 MaaS|火山方舟)( · |·|$)/i.test(t);
}

function hintLooksWeak(hint: string): boolean {
  const t = hint.trim();
  if (!t) return true;
  if (hintLooksLikeChannelTag(t)) return true;
  if (/占位|同步导入|带日期档|预览档|方舟文生图/.test(t)) return true;
  return /^(通用|通用稳|快|出图|出视频|配音|长文|代码向|中文稳)$/.test(t);
}

function rewriteProxyCostHint(cost: string): string {
  const t = cost.trim();
  if (!t || !t.includes("代理")) return t;
  if (t === "代理") return "";
  if (t === "代理贵") return "较贵";
  if (t === "代理便宜") return "便宜";
  return t.replace(/^代理( · |·)?/, "").replace(/代理/g, "").trim();
}

function fallbackStrengthHint(row: { modality: string; uses_json: string }): string {
  let uses: string[] = [];
  try {
    const parsed = JSON.parse(row.uses_json || "[]") as unknown;
    uses = Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  } catch {
    uses = [];
  }
  if (row.modality === "image") return "按提示出图，画风好控";
  if (row.modality === "audio") return "配音自然";
  if (row.modality === "video") return "按提示出短视频";
  if (row.modality === "music") return "能出短曲子";
  if (uses.includes("script")) return "适合写剧本";
  if (uses.includes("shot")) return "适合分镜";
  if (uses.includes("copywriting")) return "适合写稿";
  return "通用能力均衡";
}

function rewriteChannelHint(
  row: { slug: string; hint: string; modality: string; uses_json: string; provider: string; provider_model: string },
  seed?: { hint?: string },
): string {
  if (seed?.hint && !hintLooksLikeChannelTag(seed.hint)) return seed.hint.trim();
  if (row.provider === "cloudflare") {
    return cfStrengthHint({
      name: row.provider_model || row.slug,
      task: row.modality,
    });
  }
  return fallbackStrengthHint(row);
}

/** 前台说明写优势。种子用精选文案；Cloudflare 同步项按任务重写，避免串台。 */
function ensureUserFacingModelCopy(database: Db) {
  const seedBySlug = new Map(DEFAULT_AI_MODEL_SEED.map((item) => [item.slug, item]));
  for (const row of listAiModelRows(database)) {
    const seed = seedBySlug.get(row.slug);
    const patch: { hint?: string; costHint?: string } = {};
    if (!row.hint.trim()) {
      patch.hint = rewriteChannelHint(row, seed);
    } else if (seed?.hint?.trim() && row.hint !== seed.hint) {
      patch.hint = seed.hint.trim();
    } else if (!seed && row.provider === "cloudflare") {
      const next = cfStrengthHint({
        name: row.provider_model || row.slug,
        task: row.modality,
      });
      if (next && next !== row.hint) patch.hint = next;
    } else if (hintLooksWeak(row.hint)) {
      patch.hint = rewriteChannelHint(row, seed);
    }
    if (row.cost_hint.includes("代理")) {
      const fromSeed = seed?.costHint && !seed.costHint.includes("代理") ? seed.costHint : "";
      patch.costHint = fromSeed || rewriteProxyCostHint(row.cost_hint);
    }
    if (Object.keys(patch).length) updateAiModelRow(database, row.id, patch);
  }
}

/** 从代理站 /models 拉取并补种缺失项；不覆盖已有配置 */
export async function syncProxyModelsIntoCatalog(database: Db): Promise<{
  fetched: number;
  inserted: number;
  skipped: number;
  priced?: number;
}> {
  migrateAiModelCatalog(database);
  // 先保证精选种子在
  seedAiModelCatalog(database);
  const { fetchProxyModelIds, proxyModelIdToInput } = await import(
    "@/lib/ai/model-catalog/proxy-seed"
  );
  const ids = await fetchProxyModelIds();
  let inserted = 0;
  let skipped = 0;
  for (const id of ids) {
    if (shouldSkipSyncImport(id, "proxy")) {
      skipped += 1;
      continue;
    }
    if (getAiModelRowBySlug(database, id)) {
      skipped += 1;
      continue;
    }
    const input = proxyModelIdToInput(id);
    if (!input) {
      skipped += 1;
      continue;
    }
    insertAiModelRow(database, input);
    inserted += 1;
  }
  const priced = syncOfficialPricingIntoCatalog(database);
  return {
    fetched: ids.length,
    inserted,
    skipped: skipped + priced.skipped,
    priced: priced.priced,
  };
}

/** 从阿里云百炼 MaaS /models 拉取并补种 */
export async function syncQwenModelsIntoCatalog(database: Db): Promise<{
  fetched: number;
  inserted: number;
  skipped: number;
  priced?: number;
}> {
  migrateAiModelCatalog(database);
  seedAiModelCatalog(database);
  const { fetchQwenModelIds, qwenModelIdToInput } = await import(
    "@/lib/ai/model-catalog/qwen-seed"
  );
  const ids = await fetchQwenModelIds();
  let inserted = 0;
  let skipped = 0;
  for (const id of ids) {
    if (shouldSkipSyncImport(id, "qwen")) {
      skipped += 1;
      continue;
    }
    const input = qwenModelIdToInput(id);
    if (!input) {
      skipped += 1;
      continue;
    }
    if (getAiModelRowBySlug(database, input.slug)) {
      skipped += 1;
      continue;
    }
    insertAiModelRow(database, input);
    inserted += 1;
  }
  const priced = syncOfficialPricingIntoCatalog(database);
  return {
    fetched: ids.length,
    inserted,
    skipped: skipped + priced.skipped,
    priced: priced.priced,
  };
}

/** 从 Cursor API /v1/models 拉取并补种 Composer / Grok 等 */
export async function syncCursorModelsIntoCatalog(database: Db): Promise<{
  fetched: number;
  inserted: number;
  skipped: number;
  priced?: number;
}> {
  migrateAiModelCatalog(database);
  seedAiModelCatalog(database);
  const { fetchCursorModelIds, cursorModelIdToInput } = await import(
    "@/lib/ai/model-catalog/cursor-seed"
  );
  const ids = await fetchCursorModelIds();
  let inserted = 0;
  let skipped = 0;
  for (const id of ids) {
    if (shouldSkipSyncImport(id, "cursor")) {
      skipped += 1;
      continue;
    }
    const input = cursorModelIdToInput(id);
    if (!input) {
      skipped += 1;
      continue;
    }
    if (getAiModelRowBySlug(database, input.slug)) {
      skipped += 1;
      continue;
    }
    insertAiModelRow(database, input);
    inserted += 1;
  }
  const pricedAfter = syncOfficialPricingIntoCatalog(database);
  return {
    fetched: ids.length,
    inserted,
    skipped: skipped + pricedAfter.skipped,
    priced: pricedAfter.priced,
  };
}

/** 从 Cloudflare 统一目录 + Workers AI /models/search 拉取并补种 */
export async function syncCloudflareModelsIntoCatalog(database: Db): Promise<{
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}> {
  migrateAiModelCatalog(database);
  seedAiModelCatalog(database);
  const { fetchCloudflareAiModels, cloudflareModelToInput } = await import(
    "@/lib/ai/model-catalog/cloudflare-seed"
  );
  const rows = await fetchCloudflareAiModels();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const input = cloudflareModelToInput(row);
    if (!input) {
      skipped += 1;
      continue;
    }
    const existing = getAiModelRowBySlug(database, input.slug);
    if (!existing) {
      insertAiModelRow(database, input);
      inserted += 1;
      continue;
    }
    let config: AiModelConfig = {};
    try {
      config = JSON.parse(existing.config_json || "{}") as AiModelConfig;
    } catch {
      config = {};
    }
    if (config.pricing?.source === "manual") {
      skipped += 1;
      continue;
    }
    updateAiModelRow(database, existing.id, {
      config: { ...config, pricing: input.config?.pricing },
      costHint: input.costHint || existing.cost_hint,
      modality: input.modality,
      uses: input.uses,
      hint: input.hint,
      badges: input.badges,
    });
    updated += 1;
  }
  return { fetched: rows.length, inserted, updated, skipped };
}

/** 从火山方舟 /models 拉取并补种；匹配刊例的行写 pricing */
export async function syncArkModelsIntoCatalog(database: Db): Promise<{
  fetched: number;
  inserted: number;
  priced: number;
  skipped: number;
  warning?: string;
}> {
  migrateAiModelCatalog(database);
  seedAiModelCatalog(database);
  const {
    fetchArkModelIds,
    arkModelIdToInput,
    lookupArkOfficialPricing,
    costHintFromOfficial,
  } = await import("@/lib/ai/model-catalog/ark-seed");

  let ids: string[] = [];
  let warning: string | undefined;
  try {
    ids = await fetchArkModelIds();
  } catch (err) {
    const message = err instanceof Error ? err.message : "拉取失败";
    // 无 Key 时仍回填已有方舟模型刊例，不整单失败
    if (/未配置|ARK_API_KEY/i.test(message)) {
      warning = message;
      ids = [];
    } else {
      throw err;
    }
  }

  let inserted = 0;
  let skipped = 0;
  let priced = 0;
  const seen = new Set<string>();

  for (const id of ids) {
    if (shouldSkipSyncImport(id, "ark")) {
      skipped += 1;
      continue;
    }
    const input = arkModelIdToInput(id);
    if (!input) {
      skipped += 1;
      continue;
    }
    seen.add(input.slug);
    const existing = getAiModelRowBySlug(database, input.slug);
    if (!existing) {
      insertAiModelRow(database, input);
      inserted += 1;
      if (input.config?.pricing) priced += 1;
      continue;
    }
    const pricing = lookupArkOfficialPricing(existing.slug, existing.provider_model, id);
    if (!pricing) {
      skipped += 1;
      continue;
    }
    let config: AiModelConfig = {};
    try {
      config = JSON.parse(existing.config_json || "{}") as AiModelConfig;
    } catch {
      config = {};
    }
    if (config.pricing?.source === "manual") {
      skipped += 1;
      continue;
    }
    const nextPricing = { ...pricing, syncedAt: new Date().toISOString() };
    const hint = costHintFromOfficial(nextPricing);
    updateAiModelRow(database, existing.id, {
      config: { ...config, pricing: nextPricing },
      costHint: hint || existing.cost_hint,
    });
    priced += 1;
  }

  // 全目录按刊例表回填（含方舟 seed、DeepSeek、千问、代理、Suno）
  const all = syncOfficialPricingIntoCatalog(database);

  return {
    fetched: ids.length,
    inserted,
    priced: all.priced,
    skipped: skipped + all.skipped,
    warning,
  };
}

/** 按刊例表回填目录里所有模型的官方价（不拉上游列表） */
export function syncOfficialPricingIntoCatalog(database: Db): {
  priced: number;
  skipped: number;
  total: number;
  disabled: number;
} {
  migrateAiModelCatalog(database);
  seedAiModelCatalog(database);

  let priced = 0;
  let skipped = 0;
  let disabled = 0;
  const rows = listAiModelRows(database, { enabledOnly: false });
  for (const row of rows) {
    // DeepSeek 旧上游名 → V4（slug 仍兼容）
    if (
      row.provider === "deepseek" &&
      row.slug === "deepseek-chat" &&
      (row.provider_model === "deepseek-chat" || !row.provider_model)
    ) {
      updateAiModelRow(database, row.id, { providerModel: "deepseek-v4-flash" });
      row.provider_model = "deepseek-v4-flash";
    }
    if (
      row.provider === "deepseek" &&
      row.slug === "deepseek-reasoner" &&
      (row.provider_model === "deepseek-reasoner" || !row.provider_model)
    ) {
      updateAiModelRow(database, row.id, { providerModel: "deepseek-v4-pro" });
      row.provider_model = "deepseek-v4-pro";
    }

    // 上游已退役：自动停用且不写刊例（站内 deepseek-* 映射 slug 除外）
    const retire =
      row.provider !== "deepseek" &&
      ([row.slug, row.provider_model].some(
        (id) =>
          Boolean(id) &&
          (isHardRetiredModelId(id) ||
            ((row.provider === "gemini" || row.provider === "qwen") &&
              isDatedSnapshotId(id))),
      ));
    if (retire) {
      if (row.enabled) {
        updateAiModelRow(database, row.id, { enabled: false });
        disabled += 1;
      }
      skipped += 1;
      continue;
    }

    let config: AiModelConfig = {};
    try {
      config = JSON.parse(row.config_json || "{}") as AiModelConfig;
    } catch {
      config = {};
    }
    const lookup = lookupOfficialPricing(row.slug, row.provider_model);
    const keepStored =
      config.pricing?.source === "manual" ||
      config.pricing?.source === "cloudflare";
    const pricing = keepStored ? config.pricing : lookup;
    if (!isBillableOfficialPricing(pricing)) {
      if (row.enabled) {
        updateAiModelRow(database, row.id, { enabled: false });
        disabled += 1;
      }
      skipped += 1;
      continue;
    }
    // 手工价 / Cloudflare 刊例不覆盖
    if (keepStored) {
      skipped += 1;
      continue;
    }
    const nextPricing = { ...pricing, syncedAt: new Date().toISOString() };
    updateAiModelRow(database, row.id, {
      config: { ...config, pricing: nextPricing },
      costHint: costHintFromOfficial(nextPricing) || row.cost_hint,
    });
    priced += 1;
  }
  return { priced, skipped, total: rows.length, disabled };
}

export function listCatalogModels(
  database: Db,
  query: ListAiModelsQuery = {},
): AiModelView[] {
  seedAiModelCatalog(database);
  return listAiModelRows(database, query).map(withReady);
}

export function getCatalogModelBySlug(
  database: Db,
  slug: string,
): AiModelView | undefined {
  const row = getAiModelRowBySlug(database, slug);
  return row ? withReady(row) : undefined;
}

export function getCatalogModelById(
  database: Db,
  id: string,
): AiModelView | undefined {
  const row = getAiModelRowById(database, id);
  return row ? withReady(row) : undefined;
}

export function createCatalogModel(
  database: Db,
  input: AiModelInput,
): AiModelView {
  if (slugTaken(database, input.slug)) {
    throw new Error("slug 已存在");
  }
  return withReady(insertAiModelRow(database, input));
}

export function updateCatalogModel(
  database: Db,
  id: string,
  patch: Partial<AiModelInput>,
): AiModelView | null {
  if (patch.slug && slugTaken(database, patch.slug, id)) {
    throw new Error("slug 已存在");
  }
  const row = updateAiModelRow(database, id, patch);
  return row ? withReady(row) : null;
}

export function removeCatalogModel(database: Db, id: string): boolean {
  return deleteAiModelRow(database, id);
}

export function requireCatalogModel(
  database: Db,
  slug: string,
  modality?: AiModelView["modality"],
): AiModelView {
  const model = getCatalogModelBySlug(database, slug);
  if (!model) {
    throw new Error(`未知模型：${slug}`);
  }
  if (!model.enabled) {
    throw new Error(`模型已停用：${model.label}`);
  }
  if (modality && model.modality !== modality) {
    throw new Error(`${model.label} 不是 ${modality} 模型`);
  }
  if (!model.ready) {
    throw new Error(`「${model.label}」通道未配置密钥`);
  }
  return model;
}
