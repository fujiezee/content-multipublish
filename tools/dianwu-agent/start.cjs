#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PAIR_PATH = path.join(ROOT, "pair.json");
const AGENT_PATH = path.join(ROOT, "agent.json");
const PLATFORMS_PATH = path.join(ROOT, "platforms.json");

function say(msg) {
  console.log(msg);
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function request(url, method, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  }
  return data;
}

function copyText(text) {
  const plat = os.platform();
  if (plat === "darwin") {
    const child = spawn("pbcopy");
    child.stdin.end(text);
    return;
  }
  if (plat === "win32") {
    const child = spawn("clip", { shell: true });
    child.stdin.end(text);
    return;
  }
  const child = spawn("xclip", ["-selection", "clipboard"]);
  child.stdin.end(text);
}

function openUrl(url) {
  if (!url) return;
  const plat = os.platform();
  if (plat === "darwin") spawn("open", [url]);
  else if (plat === "win32") spawn("cmd", ["/c", "start", "", url], { shell: true });
  else spawn("xdg-open", [url]);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function pairIfNeeded(cfg) {
  const pair = loadJson(PAIR_PATH);
  const url = String(pair.url || cfg.url || "").replace(/\/$/, "");
  const code = String(pair.code || "").trim();
  if (cfg.url && cfg.token && !code) return cfg;
  if (!url || !code) {
    if (cfg.url && cfg.token) return cfg;
    throw new Error("没有配对码。请回到网站重新下载助手。");
  }
  say("正在连接网站…");
  const data = await request(`${url}/api/agent/redeem`, "POST", "", { code });
  if (!data.token) throw new Error("配对失败，请回到网站重新下载助手。");
  const next = { url, token: data.token };
  saveJson(AGENT_PATH, next);
  delete pair.code;
  pair.url = url;
  saveJson(PAIR_PATH, pair);
  say("已连上。");
  return next;
}

async function handleJob(cfg, payload) {
  const job = payload.job || {};
  const content = payload.content || {};
  if (payload.error || !content) {
    await request(`${cfg.url}/api/jobs/${job.id}`, "PATCH", cfg.token, {
      status: "failed",
      error: payload.error || "没有正文",
    });
    return;
  }
  const title = String(content.title || "");
  const body = String(content.bodyText || stripHtml(content.bodyHtml));
  const text = `${title}\n\n${body}`.trim();
  copyText(text);
  fs.writeFileSync(path.join(ROOT, "这篇稿.txt"), `${text}\n`, "utf8");
  const urls = loadJson(PLATFORMS_PATH);
  openUrl(String(urls[job.platform] || ""));
  say(`已打开 ${job.platform}，稿在剪贴板里，也写在 这篇稿.txt`);
  await request(`${cfg.url}/api/jobs/${job.id}`, "PATCH", cfg.token, {
    status: "filled_awaiting_publish",
    error: "稿已复制，在打开的窗口里粘贴后点发布",
  });
}

async function main() {
  let cfg;
  try {
    cfg = await pairIfNeeded(loadJson(AGENT_PATH));
  } catch (err) {
    say(err instanceof Error ? err.message : String(err));
    await new Promise((r) => setTimeout(r, 8000));
    process.exit(1);
  }
  say(`已连接 ${cfg.url}`);
  say("助手开着。回到网站点同步。不要关这个窗口。");
  let lastBeat = 0;
  while (true) {
    try {
      const now = Date.now();
      if (now - lastBeat > 15_000) {
        await request(`${cfg.url}/api/agent/heartbeat`, "GET", cfg.token);
        lastBeat = now;
      }
      const data = await request(`${cfg.url}/api/agent/claim`, "GET", cfg.token);
      if (data.job) await handleJob(cfg, data);
      else await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

void main();
