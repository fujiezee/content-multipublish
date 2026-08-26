#!/bin/bash
# 点物 GEO：OpenNext Worker（dianwu-geo-app）+ Pages 反代（dianwu-geo，挂 dianwu.tech）
# 图床上传/读取走 cdn.dianwu.ai
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f /Users/morgan/dianwu/.env ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  source /Users/morgan/dianwu/.env
  set +a
  # 点物仓库的 AI Key 是代理站的，不能覆盖本项目 .env.local
  unset DEEPSEEK_API_KEY DEEPSEEK_BASE_URL OPENAI_API_KEY OPENAI_BASE_URL ARK_API_KEY
fi

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "缺少 CLOUDFLARE_API_TOKEN"
  exit 1
fi

# wrangler 4.95+ 在交互环境会卡在 skills 提示
export CI=1

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-4bdb28422653f9ac6aee3868f8ef3962}"
WORKER="dianwu-geo-app"
PAGES="dianwu-geo"

echo "打包浏览器扩展..."
npx tsx scripts/pack-extension.ts

echo "构建 OpenNext..."
rm -rf .open-next
rm -f .next/lock
CLOUDFLARE=1 CF_BUILD=1 npx opennextjs-cloudflare build

echo "部署 Worker ${WORKER}..."
cp node_modules/sql.js/dist/sql-wasm.wasm cf/sql-wasm.wasm
OPEN_NEXT_DEPLOY=true npx wrangler deploy

echo "部署媒体 CDN Worker dianwu-cdn..."
npx wrangler deploy --config cf/cdn-wrangler.jsonc

put_secret() {
  local key=$1
  local val=${2:-}
  if [ -z "$val" ]; then return 0; fi
  if ! printf '%s' "$val" | npx wrangler secret put "$key"; then
    echo "警告：密钥 ${key} 这次没写上，沿用 Worker 上已有的值。"
  fi
}

put_cdn_secret() {
  local key=$1
  local val=${2:-}
  if [ -z "$val" ]; then return 0; fi
  if ! printf '%s' "$val" | npx wrangler secret put "$key" --config cf/cdn-wrangler.jsonc; then
    echo "警告：CDN 密钥 ${key} 这次没写上，沿用 Worker 上已有的值。"
  fi
}

echo "同步 Worker 密钥..."
put_secret PUBLIC_MEDIA_TOKEN "${PUBLIC_MEDIA_TOKEN:-}"
put_secret DEEPSEEK_API_KEY "${DEEPSEEK_API_KEY:-}"
put_secret OPENAI_API_KEY "${OPENAI_API_KEY:-}"
put_secret ARK_API_KEY "${ARK_API_KEY:-}"
put_secret DOUBAO_TTS_API_KEY "${DOUBAO_TTS_API_KEY:-}"
put_secret ANTHROPIC_API_KEY "${ANTHROPIC_API_KEY:-}"
put_secret DASHSCOPE_API_KEY "${DASHSCOPE_API_KEY:-${QWEN_API_KEY:-}}"
put_secret SUNO_API_KEY "${SUNO_API_KEY:-}"
put_secret CLOUDFLARE_AI_TOKEN "${CLOUDFLARE_AI_TOKEN:-}"
put_secret CURSOR_API_KEY "${CURSOR_API_KEY:-}"
put_secret STRIPE_SECRET_KEY "${STRIPE_SECRET_KEY:-}"
put_secret STRIPE_PUBLISHABLE_KEY "${STRIPE_PUBLISHABLE_KEY:-}"
put_secret DIANWU_DIRECTORY_SECRET "${DIANWU_DIRECTORY_SECRET:-}"
put_secret RESEND_API_KEY "${RESEND_API_KEY:-}"
echo "同步 CDN 上传密钥..."
put_cdn_secret UPLOAD_TOKEN "${PUBLIC_MEDIA_TOKEN:-}"

echo "组装 Pages 反代..."
rm -rf cf-dist
mkdir -p cf-dist
cat > cf-dist/_worker.js <<'JS'
export default {
  async fetch(request, env) {
    return env.GEO.fetch(request);
  },
};
JS
cat > cf-dist/_routes.json <<'JSON'
{
  "version": 1,
  "include": ["/*"],
  "exclude": []
}
JSON
# Pages 静态头兜底（主流量仍走 Worker；Worker 里也会强制改 Cache-Control）
cat > cf-dist/_headers <<'HEADERS'
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS

echo "绑定 Pages → Worker..."
project_url="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PAGES}"
curl -sS --retry 3 "$project_url" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -o /tmp/dianwu-geo-pages.json
python3 - <<'PY'
import json
data = json.loads(open("/tmp/dianwu-geo-pages.json").read(), strict=False)
if not data.get("success"):
    raise SystemExit(data.get("errors"))
plain = {
    "CLOUDFLARE": "1",
    "AUTH_REQUIRED": "true",
    "DIANWU_CLOUD": "1",
    "SITE_URL": "https://dianwu.tech",
}
configs = data["result"].get("deployment_configs") or {}
for env in ("preview", "production"):
    cfg = dict(configs.get(env) or {})
    cfg["compatibility_date"] = "2026-08-18"
    cfg["compatibility_flags"] = ["nodejs_compat"]
    cfg["services"] = {"GEO": {"service": "dianwu-geo-app"}}
    env_vars = dict(cfg.get("env_vars") or {})
    for key, value in plain.items():
        current = env_vars.get(key) or {}
        if current.get("type") == "secret_text":
            continue
        env_vars[key] = {"type": "plain_text", "value": value}
    cfg["env_vars"] = env_vars
    configs[env] = cfg
json.dump({"deployment_configs": configs}, open("/tmp/dianwu-geo-pages-patch.json", "w"))
PY
res=$(curl -sS --retry 3 -X PATCH "$project_url" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/dianwu-geo-pages-patch.json)
if ! echo "$res" | python3 -c "import json,sys; d=json.loads(sys.stdin.read(), strict=False); sys.exit(0 if d.get('success') else 1)"; then
  echo "警告：Pages 绑定这次没写成，沿用已有绑定。"
fi

echo "部署 Pages 反代 ${PAGES}..."
npx wrangler pages deploy cf-dist --project-name="$PAGES" --branch main --commit-dirty=true

echo "完成 Worker ${WORKER} + Pages https://${PAGES}.pages.dev"
