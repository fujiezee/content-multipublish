/**
 * Local Playwright agent: pair with the website, then claim and run jobs.
 *
 *   npm run agent -- --pair ABCD-EFGH
 *   npm run agent -- --url https://dianwu.tech --pair ABCD-EFGH
 *   npm run agent
 */

import fs from "fs";
import path from "path";
import { DATA_DIR, ensureDataDirs } from "@/lib/paths";
import { executePlaywrightPublish } from "@/lib/queue/publisher";
import type { PlatformId, PublishContent, PublishJob } from "@/lib/types";

type AgentConfig = {
  url: string;
  token: string;
};

const CONFIG_PATH = path.join(DATA_DIR, "agent.json");

function parseArgs(argv: string[]) {
  const out: { pair?: string; url?: string; token?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--pair" && next) {
      out.pair = next;
      i++;
    } else if (a === "--url" && next) {
      out.url = next.replace(/\/$/, "");
      i++;
    } else if (a === "--token" && next) {
      out.token = next;
      i++;
    }
  }
  return out;
}

function readConfig(): AgentConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as AgentConfig;
    if (parsed?.url && parsed?.token) return parsed;
  } catch {
    // missing
  }
  return null;
}

function writeConfig(cfg: AgentConfig) {
  ensureDataDirs();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

async function api(
  cfg: AgentConfig,
  method: string,
  pathname: string,
  body?: unknown,
) {
  const res = await fetch(`${cfg.url}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
    );
  }
  return data;
}

async function redeem(url: string, code: string): Promise<AgentConfig> {
  const res = await fetch(`${url}/api/agent/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.error || "配对失败");
  }
  const cfg = { url, token: data.token };
  writeConfig(cfg);
  console.info(`[dianwu-agent] 已配对 ${url}，Token 写在 ${CONFIG_PATH}`);
  return cfg;
}

async function heartbeat(cfg: AgentConfig) {
  await api(cfg, "GET", "/api/agent/heartbeat");
}

async function claimAndRun(cfg: AgentConfig) {
  const data = (await api(cfg, "GET", "/api/agent/claim")) as {
    job?: PublishJob | null;
    content?: PublishContent;
    error?: string;
  };
  if (!data.job) return false;
  if (data.error || !data.content) {
    await api(cfg, "PATCH", `/api/jobs/${data.job.id}`, {
      status: "failed",
      error: data.error || "领取任务后没有正文",
    });
    return true;
  }
  const platform = data.job.platform as PlatformId;
  console.info(`[dianwu-agent] 领取 ${platform} ${data.job.id.slice(0, 8)}…`);
  const outcome = await executePlaywrightPublish(platform, data.content, {
    onOutcome: (next) => api(cfg, "PATCH", `/api/jobs/${data.job.id}`, next),
  });
  await api(cfg, "PATCH", `/api/jobs/${data.job.id}`, outcome);
  console.info(
    `[dianwu-agent] ${platform} → ${outcome.status}${
      outcome.error ? ` (${outcome.error})` : ""
    }`,
  );
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url =
    args.url ||
    process.env.DIANWU_AGENT_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3000";
  const envToken = args.token || process.env.DIANWU_AGENT_TOKEN || "";

  let cfg = readConfig();
  if (args.pair) {
    cfg = await redeem(url, args.pair);
  } else if (envToken) {
    cfg = { url, token: envToken };
    writeConfig(cfg);
  } else if (cfg && args.url) {
    cfg = { ...cfg, url };
    writeConfig(cfg);
  }

  if (!cfg?.token) {
    console.error(
      "未配对。在网站设置里生成配对码后运行：\n  npm run agent -- --pair ABCD-EFGH",
    );
    process.exit(1);
  }

  console.info(`[dianwu-agent] 连接 ${cfg.url}，等待 Playwright 任务…`);
  await heartbeat(cfg);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let lastBeat = Date.now();
  while (!stopping) {
    try {
      if (Date.now() - lastBeat > 15_000) {
        await heartbeat(cfg);
        lastBeat = Date.now();
      }
      const did = await claimAndRun(cfg);
      if (!did) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[dianwu-agent] ${msg}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

void main();
