"use client";

import Link from "next/link";
import { API_PUBLIC_BASE } from "@/lib/billing/markup";

const BASE = `${API_PUBLIC_BASE}/v1`;
const GW = `${API_PUBLIC_BASE}/api/gateway/v1`;
const MODELS = `${API_PUBLIC_BASE}/api/models`;

export function ApiDocsPanel() {
  return (
    <div className="api-docs space-y-6">
      <header className="api-hub__hero">
        <p className="api-hub__kicker">
          <Link href="/api-hub">API</Link>
          {" / "}
          调用文档
        </p>
        <h1>模型调用说明</h1>
        <p>
          密钥用{" "}
          <code className="api-hub__code">dwapi_…</code>
          。文本可用 OpenAI 兼容基址{" "}
          <code className="api-hub__code">{BASE}</code>
          ；图片与网关文本走{" "}
          <code className="api-hub__code">{GW}</code>
          。
        </p>
      </header>

      <nav className="api-docs__toc card">
        <a href="#auth">鉴权</a>
        <a href="#models">选模型</a>
        <a href="#text">文本</a>
        <a href="#image">图片</a>
        <a href="#video">视频目录</a>
        <a href="#billing">计费</a>
      </nav>

      <section id="auth" className="card api-docs__block">
        <h2>鉴权</h2>
        <pre className="api-hub__sample">
{`Authorization: Bearer dwapi_你的密钥`}
        </pre>
        <p className="text-sm text-[var(--muted)]">
          在{" "}
          <Link href="/api-hub" className="underline">
            API
          </Link>{" "}
          页生成密钥。下列接口都要带这个头。
        </p>
      </section>

      <section id="models" className="card api-docs__block">
        <h2>选模型</h2>
        <p className="text-sm text-[var(--muted)]">
          先查目录拿 <code className="api-hub__code">slug</code>
          ，再填到各接口的 <code className="api-hub__code">model</code>。
          可用 <code className="api-hub__code">modality</code> 过滤：
          <code className="api-hub__code">text</code> /
          <code className="api-hub__code">image</code> /
          <code className="api-hub__code">video</code>。
        </p>
        <pre className="api-hub__sample">
{`curl "${MODELS}" -H "Authorization: Bearer dwapi_xxx"

curl "${MODELS}?modality=text"  -H "Authorization: Bearer dwapi_xxx"
curl "${MODELS}?modality=image" -H "Authorization: Bearer dwapi_xxx"
curl "${MODELS}?modality=video" -H "Authorization: Bearer dwapi_xxx"`}
        </pre>
        <p className="text-sm text-[var(--muted)]">
          返回里的 <code className="api-hub__code">pricing.sell</code>{" "}
          已是你当前充值档位的售价。OpenAI 兼容另有{" "}
          <code className="api-hub__code">GET {BASE}/models</code>
          （文本）。
        </p>
      </section>

      <section id="text" className="card api-docs__block">
        <h2>文本模型</h2>
        <p className="text-sm text-[var(--muted)]">
          <strong>modality=text</strong>。推荐 OpenAI 兼容；也可用网关一次性 /
          流式。按入/出 token 扣钱包；余额不足返回 402。
        </p>

        <h3>OpenAI 兼容（推荐）</h3>
        <p className="text-sm text-[var(--muted)]">
          <code className="api-hub__code">POST {BASE}/chat/completions</code>
          。字段：
          <code className="api-hub__code">model</code>、
          <code className="api-hub__code">messages</code>、
          <code className="api-hub__code">stream</code>、
          <code className="api-hub__code">temperature</code>、
          <code className="api-hub__code">max_tokens</code>。
        </p>
        <pre className="api-hub__sample">
{`curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer dwapi_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role":"user","content":"你好"}]
  }'`}
        </pre>
        <pre className="api-hub__sample">
{`from openai import OpenAI
client = OpenAI(api_key="dwapi_xxx", base_url="${BASE}")
r = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "你好"}],
)
print(r.choices[0].message.content)`}
        </pre>

        <h3>网关一次性</h3>
        <p className="text-sm text-[var(--muted)]">
          <code className="api-hub__code">POST {GW}/text/complete</code>
        </p>
        <pre className="api-hub__sample">
{`curl ${GW}/text/complete \\
  -H "Authorization: Bearer dwapi_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role":"user","content":"写一句标题"}]
  }'`}
        </pre>

        <h3>网关流式（NDJSON）</h3>
        <p className="text-sm text-[var(--muted)]">
          <code className="api-hub__code">POST {GW}/text/stream</code>
          。每行一个 JSON：
          <code className="api-hub__code">meta</code> /
          <code className="api-hub__code">content</code> /
          <code className="api-hub__code">done</code> /
          <code className="api-hub__code">error</code>。
        </p>
        <pre className="api-hub__sample">
{`curl -N ${GW}/text/stream \\
  -H "Authorization: Bearer dwapi_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role":"user","content":"解释一下 GEO"}]
  }'`}
        </pre>
      </section>

      <section id="image" className="card api-docs__block">
        <h2>图片模型</h2>
        <p className="text-sm text-[var(--muted)]">
          <strong>modality=image</strong>。
          <code className="api-hub__code">POST {GW}/image/generate</code>
          。计费：配图配额 1 张，超额按模型单价扣钱包。
        </p>
        <p className="text-sm text-[var(--muted)]">
          字段：
          <code className="api-hub__code">model</code>（slug，如{" "}
          <code className="api-hub__code">seedream-5.0</code>）、
          <code className="api-hub__code">prompt</code>、
          可选 <code className="api-hub__code">aspectRatio</code>（如{" "}
          <code className="api-hub__code">1:1</code> /
          <code className="api-hub__code">16:9</code> /
          <code className="api-hub__code">3:4</code>）。
        </p>
        <pre className="api-hub__sample">
{`curl ${GW}/image/generate \\
  -H "Authorization: Bearer dwapi_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "seedream-5.0",
    "prompt": "专辑封面，暖色近景，无文字",
    "aspectRatio": "1:1"
  }'`}
        </pre>
        <p className="text-sm text-[var(--muted)]">
          成功返回 <code className="api-hub__code">url</code> /
          <code className="api-hub__code">path</code> /
          <code className="api-hub__code">slug</code>。
        </p>
      </section>

      <section id="video" className="card api-docs__block">
        <h2>视频目录</h2>
        <p className="text-sm text-[var(--muted)]">
          <strong>modality=video</strong>。可查询模型与可用 preset（含分辨率组合
          id）。
        </p>
        <pre className="api-hub__sample">
{`curl ${GW}/video/presets \\
  -H "Authorization: Bearer dwapi_xxx"

curl "${MODELS}?modality=video" \\
  -H "Authorization: Bearer dwapi_xxx"`}
        </pre>
      </section>

      <section id="billing" className="card api-docs__block">
        <h2>计费与错误</h2>
        <ul className="api-docs__list text-sm text-[var(--muted)]">
          <li>
            售价 = 官网刊例 × 充值档位（标准 ×1.5 / 进阶 ×1.3 / 优选 ×1.1）。
          </li>
          <li>文本：按 token 扣钱包。</li>
          <li>图片：配图配额，超额按模型扣钱包。</li>
          <li>
            余额 / 配额不足：HTTP <code className="api-hub__code">402</code>，
            <code className="api-hub__code">code: &quot;quota&quot;</code>。去{" "}
            <Link href="/plan#recharge" className="underline">
              充值
            </Link>
            。
          </li>
        </ul>
      </section>

      <p className="text-sm text-[var(--muted)]">
        总览：
        <code className="api-hub__code">GET {GW}</code>
        。模型价目与密钥管理见{" "}
        <Link href="/api-hub" className="underline">
          API
        </Link>
        。
      </p>
    </div>
  );
}
