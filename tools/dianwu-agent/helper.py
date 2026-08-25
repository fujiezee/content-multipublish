#!/usr/bin/env python3
"""点物助手：配对网站，领取同步任务，打开后台并复制稿。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent
PAIR_PATH = ROOT / "pair.json"
AGENT_PATH = ROOT / "agent.json"
PLATFORMS_PATH = ROOT / "platforms.json"


def say(msg: str) -> None:
    print(msg, flush=True)


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def request(url: str, method: str = "GET", token: str = "", body: Optional[dict] = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
        raise RuntimeError(parsed.get("error") or f"HTTP {err.code}") from err


def copy_text(text: str) -> None:
    payload = text.encode("utf-8")
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=payload, check=False)
        return
    if sys.platform == "win32":
        subprocess.run(["clip"], input=payload, check=False)
        return
    subprocess.run(["xclip", "-selection", "clipboard"], input=payload, check=False)


def open_url(url: str) -> None:
    if not url:
        return
    if sys.platform == "darwin":
        subprocess.run(["open", url], check=False)
    elif sys.platform == "win32":
        os.startfile(url)  # type: ignore[attr-defined]
    else:
        subprocess.run(["xdg-open", url], check=False)


def strip_html(html: str) -> str:
    out = []
    i = 0
    while i < len(html):
        if html[i] == "<":
            j = html.find(">", i)
            i = j + 1 if j >= 0 else len(html)
            continue
        out.append(html[i])
        i += 1
    return "".join(out).replace("&nbsp;", " ").strip()


def pair_if_needed(cfg: dict) -> dict:
    pair = load_json(PAIR_PATH)
    url = str(pair.get("url") or cfg.get("url") or "").rstrip("/")
    code = str(pair.get("code") or "").strip()
    if cfg.get("url") and cfg.get("token") and not code:
        return cfg
    if not url or not code:
        if cfg.get("url") and cfg.get("token"):
            return cfg
        raise RuntimeError("没有配对码。请回到网站重新下载助手。")
    say("正在连接网站…")
    data = request(f"{url}/api/agent/redeem", "POST", body={"code": code})
    token = str(data.get("token") or "")
    if not token:
        raise RuntimeError("配对失败，请回到网站重新下载助手。")
    next_cfg = {"url": url, "token": token}
    save_json(AGENT_PATH, next_cfg)
    pair.pop("code", None)
    pair["url"] = url
    save_json(PAIR_PATH, pair)
    say("已连上。")
    return next_cfg


def handle_job(cfg: dict, payload: dict) -> None:
    job = payload.get("job") or {}
    content = payload.get("content") or {}
    job_id = str(job.get("id") or "")
    platform = str(job.get("platform") or "")
    if payload.get("error") or not content:
        request(
            f"{cfg['url']}/api/jobs/{job_id}",
            "PATCH",
            cfg["token"],
            {"status": "failed", "error": payload.get("error") or "没有正文"},
        )
        return
    title = str(content.get("title") or "")
    body = str(content.get("bodyText") or strip_html(str(content.get("bodyHtml") or "")))
    text = f"{title}\n\n{body}".strip()
    copy_text(text)
    draft = ROOT / "这篇稿.txt"
    draft.write_text(text + "\n", encoding="utf-8")
    urls = load_json(PLATFORMS_PATH)
    open_url(str(urls.get(platform) or ""))
    say(f"已打开 {platform}，稿在剪贴板里，也写在 这篇稿.txt")
    request(
        f"{cfg['url']}/api/jobs/{job_id}",
        "PATCH",
        cfg["token"],
        {
            "status": "filled_awaiting_publish",
            "error": "稿已复制，在打开的窗口里粘贴后点发布",
        },
    )


def main() -> int:
    try:
        cfg = pair_if_needed(load_json(AGENT_PATH))
    except Exception as err:
        say(str(err))
        time.sleep(8)
        return 1
    say(f"已连接 {cfg['url']}")
    say("助手开着。回到网站点同步。不要关这个窗口。")
    last_beat = 0.0
    while True:
        try:
            now = time.time()
            if now - last_beat > 15:
                request(f"{cfg['url']}/api/agent/heartbeat", "GET", cfg["token"])
                last_beat = now
            data = request(f"{cfg['url']}/api/agent/claim", "GET", cfg["token"])
            if data.get("job"):
                handle_job(cfg, data)
            else:
                time.sleep(3)
        except KeyboardInterrupt:
            say("已退出。")
            return 0
        except Exception as err:
            say(str(err))
            time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
