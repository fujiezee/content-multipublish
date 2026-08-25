import { randomUUID } from "crypto";
import type {
  AiModelBadge,
  AiModelInput,
  AiModelRecord,
  AiModelUse,
  AiModelView,
  AiModality,
  ListAiModelsQuery,
} from "@/lib/ai/model-catalog/types";
import { AI_MODEL_BADGES } from "@/lib/ai/model-catalog/types";
import type Database from "better-sqlite3";

type Db = Database.Database;

function parseUses(raw: string): AiModelUse[] {
  try {
    const arr = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(arr)
      ? arr.filter((u): u is AiModelUse => typeof u === "string")
      : [];
  } catch {
    return [];
  }
}

function parseConfig(raw: string): AiModelView["config"] {
  try {
    const obj = JSON.parse(raw || "{}") as Record<string, unknown>;
    return obj as AiModelView["config"];
  } catch {
    return {};
  }
}

export function parseModelBadges(raw: unknown): AiModelBadge[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(AI_MODEL_BADGES.map((b) => b.id));
  const out: AiModelBadge[] = [];
  for (const item of raw) {
    if (typeof item === "string" && allowed.has(item as AiModelBadge)) {
      const badge = item as AiModelBadge;
      if (!out.includes(badge)) out.push(badge);
    }
  }
  return out;
}

function configWithBadges(
  config: AiModelView["config"],
  badges?: AiModelBadge[],
): AiModelView["config"] {
  const next = { ...config };
  if (badges !== undefined) {
    if (badges.length) next.badges = badges;
    else delete next.badges;
  }
  return next;
}

export function rowToView(
  row: AiModelRecord,
  ready: boolean,
): AiModelView {
  const config = parseConfig(row.config_json);
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    hint: row.hint,
    modality: row.modality,
    uses: parseUses(row.uses_json),
    provider: row.provider,
    providerModel: row.provider_model,
    config,
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order,
    costHint: row.cost_hint,
    fallbackSlug: row.fallback_slug,
    ready,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    badges: parseModelBadges(config.badges),
  };
}

export function migrateAiModelCatalog(database: Db) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ai_models (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        hint TEXT NOT NULL DEFAULT '',
        modality TEXT NOT NULL,
        uses_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL,
        provider_model TEXT NOT NULL DEFAULT '',
        config_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        cost_hint TEXT NOT NULL DEFAULT '',
        fallback_slug TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_models_modality
        ON ai_models(modality, enabled, sort_order);
    `);
  } catch (err) {
    console.warn("[db] migrate ai_models:", err);
  }
}

export function countAiModels(database: Db): number {
  const row = database
    .prepare("SELECT COUNT(*) AS c FROM ai_models")
    .get() as { c?: number };
  return Number(row?.c || 0);
}

export function listAiModelRows(
  database: Db,
  query: ListAiModelsQuery = {},
): AiModelRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.modality) {
    where.push("modality = ?");
    params.push(query.modality);
  }
  if (query.enabledOnly) {
    where.push("enabled = 1");
  }
  const sql = `SELECT * FROM ai_models
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY sort_order ASC, label ASC`;
  const rows = database.prepare(sql).all(...params) as AiModelRecord[];

  if (!query.use) return rows;
  return rows.filter((row) => {
    const uses = parseUses(row.uses_json);
    return uses.includes(query.use!);
  });
}

export function getAiModelRowBySlug(
  database: Db,
  slug: string,
): AiModelRecord | undefined {
  return database
    .prepare("SELECT * FROM ai_models WHERE slug = ?")
    .get(slug.trim()) as AiModelRecord | undefined;
}

export function getAiModelRowById(
  database: Db,
  id: string,
): AiModelRecord | undefined {
  return database
    .prepare("SELECT * FROM ai_models WHERE id = ?")
    .get(id) as AiModelRecord | undefined;
}

export function insertAiModelRow(database: Db, input: AiModelInput): AiModelRecord {
  const now = new Date().toISOString();
  const config = configWithBadges(input.config || {}, input.badges);
  const row: AiModelRecord = {
    id: randomUUID(),
    slug: input.slug.trim(),
    label: input.label.trim(),
    hint: (input.hint || "").trim(),
    modality: input.modality,
    uses_json: JSON.stringify(input.uses || []),
    provider: input.provider,
    provider_model: (input.providerModel || input.slug).trim(),
    config_json: JSON.stringify(config),
    enabled: input.enabled === false ? 0 : 1,
    sort_order: input.sortOrder ?? 0,
    cost_hint: (input.costHint || "").trim(),
    fallback_slug: (input.fallbackSlug || "").trim(),
    created_at: now,
    updated_at: now,
  };
  database
    .prepare(
      `INSERT INTO ai_models
       (id, slug, label, hint, modality, uses_json, provider, provider_model,
        config_json, enabled, sort_order, cost_hint, fallback_slug, created_at, updated_at)
       VALUES
       (@id, @slug, @label, @hint, @modality, @uses_json, @provider, @provider_model,
        @config_json, @enabled, @sort_order, @cost_hint, @fallback_slug, @created_at, @updated_at)`,
    )
    .run(row);
  return row;
}

export function updateAiModelRow(
  database: Db,
  id: string,
  patch: Partial<AiModelInput>,
): AiModelRecord | null {
  const existing = getAiModelRowById(database, id);
  if (!existing) return null;
  const baseConfig =
    patch.config !== undefined
      ? patch.config
      : parseConfig(existing.config_json);
  const nextConfig =
    patch.badges !== undefined || patch.config !== undefined
      ? configWithBadges(
          baseConfig,
          patch.badges !== undefined
            ? patch.badges
            : parseModelBadges(baseConfig.badges),
        )
      : null;
  const next: AiModelRecord = {
    ...existing,
    slug: patch.slug !== undefined ? patch.slug.trim() : existing.slug,
    label: patch.label !== undefined ? patch.label.trim() : existing.label,
    hint: patch.hint !== undefined ? patch.hint.trim() : existing.hint,
    modality: patch.modality ?? existing.modality,
    uses_json:
      patch.uses !== undefined
        ? JSON.stringify(patch.uses)
        : existing.uses_json,
    provider: patch.provider ?? existing.provider,
    provider_model:
      patch.providerModel !== undefined
        ? patch.providerModel.trim()
        : existing.provider_model,
    config_json:
      nextConfig !== null
        ? JSON.stringify(nextConfig)
        : existing.config_json,
    enabled:
      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    sort_order: patch.sortOrder ?? existing.sort_order,
    cost_hint:
      patch.costHint !== undefined ? patch.costHint.trim() : existing.cost_hint,
    fallback_slug:
      patch.fallbackSlug !== undefined
        ? patch.fallbackSlug.trim()
        : existing.fallback_slug,
    updated_at: new Date().toISOString(),
  };
  database
    .prepare(
      `UPDATE ai_models SET
        slug = @slug, label = @label, hint = @hint, modality = @modality,
        uses_json = @uses_json, provider = @provider, provider_model = @provider_model,
        config_json = @config_json, enabled = @enabled, sort_order = @sort_order,
        cost_hint = @cost_hint, fallback_slug = @fallback_slug, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({ ...next, id });
  return next;
}

export function deleteAiModelRow(database: Db, id: string): boolean {
  const result = database.prepare("DELETE FROM ai_models WHERE id = ?").run(id);
  return result.changes > 0;
}

export function slugTaken(
  database: Db,
  slug: string,
  exceptId?: string,
): boolean {
  const row = getAiModelRowBySlug(database, slug);
  if (!row) return false;
  if (exceptId && row.id === exceptId) return false;
  return true;
}
