/**
 * 小宇宙主播后台 — 下载音频/封面 + 打开创作页（填稿确认制）
 * https://podcaster.xiaoyuzhoufm.com/
 */
import { findCookieValue } from "./_cookie.js";
import { debuggerCommand, withDebugger } from "./_debugger.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const STUDIO = "https://podcaster.xiaoyuzhoufm.com/";
const DOMAINS = [
  "xiaoyuzhoufm.com",
  ".xiaoyuzhoufm.com",
  "podcaster.xiaoyuzhoufm.com",
  "www.xiaoyuzhoufm.com",
];

const FIND_AUDIO = `(() => {
  const pick = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return (
      inputs.find((el) => /audio\\/|\\.mp3|\\.wav|\\.m4a|\\.aac/i.test(el.accept || "")) ||
      inputs.find((el) => !/image\\/|video\\//i.test((el.accept || "").toLowerCase())) ||
      inputs[0] ||
      null
    );
  };
  const clickText = (re) => {
    const nodes = Array.from(
      document.querySelectorAll("a, button, span, div, li, [role='tab'], [role='button']"),
    );
    const hit = nodes.find((n) => {
      const t = (n.textContent || "").replace(/\\s+/g, "").trim();
      return re.test(t) && t.length < 28;
    });
    if (!hit) return false;
    hit.click();
    return true;
  };
  clickText(/^(创建单集|上传单集|新建单集|发布单集|上传音频|添加单集)$/);
  clickText(/创建单集|上传单集|上传音频|发布单集|添加单集|上传节目/);
  let input = pick();
  if (!input) {
    const zone = document.querySelector(
      '[class*="upload"], [class*="Upload"], [class*="drag"], [class*="Drag"]',
    );
    zone?.click();
    input = pick();
  }
  if (input) {
    try { input.click(); } catch (e) {}
    return input;
  }
  return null;
})()`;

const FIND_COVER = `(() => {
  const blob = (el) =>
    [
      el.accept || "",
      el.name || "",
      el.id || "",
      el.className || "",
      el.getAttribute("aria-label") || "",
      el.placeholder || "",
    ].join(" ");
  const pick = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return (
      inputs.find((el) => /image\\//i.test(el.accept || "")) ||
      inputs.find((el) => /cover|封面|artwork|thumb|poster|pic|img/i.test(blob(el))) ||
      null
    );
  };
  const clickText = (re) => {
    const nodes = Array.from(
      document.querySelectorAll("a, button, span, div, li, [role='tab'], [role='button']"),
    );
    const hit = nodes.find((n) => {
      const t = (n.textContent || "").replace(/\\s+/g, "").trim();
      return re.test(t) && t.length < 28;
    });
    if (!hit) return false;
    hit.click();
    return true;
  };
  clickText(/^(封面|上传封面|单集封面|更换封面|添加封面)$/);
  clickText(/上传封面|单集封面|更换封面|封面图/);
  let input = pick();
  if (!input) {
    const zone = Array.from(
      document.querySelectorAll('[class*="cover"], [class*="Cover"], [class*="artwork"]'),
    ).find((el) => el.offsetParent !== null);
    zone?.click();
    input = pick();
  }
  if (input) {
    try { input.click(); } catch (e) {}
    return input;
  }
  return null;
})()`;

function isStudioHref(url) {
  return /xiaoyuzhoufm\.com/i.test(url || "");
}

function isLoginHref(url) {
  return /login|signin|passport|oauth|sso|weixin.*login/i.test(url || "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitTabComplete(tabId, timeoutMs = 45_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, timeoutMs);
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    });
  });
}

async function hasSession() {
  const value = await findCookieValue(
    DOMAINS,
    /token|session|uid|jwt|auth|access|user|xz|id_token/i,
  );
  return Boolean(value && String(value).length > 6);
}

async function pageLooksLoggedIn(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const href = location.href || "";
        if (/login|signin|passport|oauth/i.test(href)) return false;
        const keys = Object.keys(localStorage || {});
        if (keys.some((k) => /token|jwt|auth|user|session|uid/i.test(k))) {
          return true;
        }
        const text = (document.body?.innerText || "").slice(0, 4000);
        if (/请先登录|微信登录|扫码登录|登录小宇宙/.test(text) && !/创建单集|我的节目|单集列表/.test(text)) {
          return false;
        }
        return /创建单集|我的节目|节目设置|单集|主播后台|上传音频/.test(text);
      },
    });
    return Boolean(results?.[0]?.result);
  } catch {
    return false;
  }
}

async function openStudioTab() {
  const tabs = await chrome.tabs.query({
    url: ["*://podcaster.xiaoyuzhoufm.com/*", "*://*.xiaoyuzhoufm.com/*"],
  });
  let tab =
    tabs.find((t) => /podcaster\.xiaoyuzhoufm\.com/i.test(t.url || "")) ||
    tabs[0] ||
    null;
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: STUDIO, active: true });
  } else {
    await chrome.tabs.update(tab.id, { url: STUDIO, active: true });
  }
  await waitTabComplete(tab.id);
  await sleep(2800);

  const after = await chrome.tabs.get(tab.id).catch(() => null);
  const href = after?.url || "";
  if (isLoginHref(href)) {
    throw new Error(
      "小宇宙未登录，请先在打开的标签登录主播后台，再回来点发布",
    );
  }
  return tab;
}

async function clickCreateEpisode(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        const nodes = Array.from(
          document.querySelectorAll(
            "a, button, span, div, li, [role='button'], [role='tab']",
          ),
        );
        const hit = nodes.find((n) => {
          const t = (n.textContent || "").replace(/\s+/g, "").trim();
          return (
            /^(创建单集|上传单集|新建单集|发布单集|上传音频|添加单集)$/.test(t) ||
            (/创建单集|上传单集|上传音频/.test(t) && t.length < 20)
          );
        });
        if (hit) {
          hit.click();
          return true;
        }
        const link = Array.from(document.querySelectorAll("a[href]")).find((a) =>
          /episode|upload|create|new/i.test(a.getAttribute("href") || ""),
        );
        if (link) {
          link.click();
          return true;
        }
        return false;
      },
    });
  } catch (err) {
    console.warn("[dianwu-geo xiaoyuzhou] entry click", err);
  }
}

function downloadsSearch(query) {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (items) => resolve(items || []));
  });
}

function guessExt(url, fallback = "mp3") {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".wav")) return "wav";
    if (path.endsWith(".m4a")) return "m4a";
    if (path.endsWith(".aac")) return "aac";
    if (path.endsWith(".ogg")) return "ogg";
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "jpg";
  } catch {
    // ignore
  }
  return fallback;
}

async function downloadToFolder(url, fallbackExt) {
  if (!chrome.downloads?.download) {
    throw new Error("扩展没有 downloads 权限，请重新加载点物扩展并允许下载");
  }
  const ext = guessExt(url, fallbackExt);
  const filename = `dw-podcast/${Date.now()}-${fallbackExt}.${ext}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false,
  });
  if (downloadId == null) {
    throw new Error(fallbackExt === "jpg" ? "下载封面失败" : "下载音频失败，请确认播客地址能打开");
  }
  const deadline = Date.now() + (fallbackExt === "jpg" ? 60_000 : 180_000);
  while (Date.now() < deadline) {
    const items = await downloadsSearch({ id: downloadId });
    const item = items[0];
    if (item?.state === "interrupted") {
      throw new Error(fallbackExt === "jpg" ? "下载封面被中断" : "下载音频被中断");
    }
    if (item?.state === "complete" && item.filename) {
      console.info("[dianwu-geo xiaoyuzhou] downloaded", item.filename);
      return item.filename;
    }
    await sleep(250);
  }
  throw new Error(fallbackExt === "jpg" ? "下载封面超时" : "下载音频超时");
}

function flattenFrames(tree, acc = []) {
  if (!tree?.frame) return acc;
  acc.push(tree.frame);
  for (const child of tree.childFrames || []) flattenFrames(child, acc);
  return acc;
}

function debuggerTargets() {
  return new Promise((resolve) => {
    chrome.debugger.getTargets((list) => resolve(list || []));
  });
}

async function evaluateInput(debuggee, contextId, expression) {
  const params = {
    expression,
    userGesture: true,
    returnByValue: false,
  };
  if (contextId) params.contextId = contextId;
  return debuggerCommand(debuggee, "Runtime.evaluate", params);
}

async function setFilesOnDebuggee(debuggee, filePath, findExpr) {
  await debuggerCommand(debuggee, "Page.enable").catch(() => undefined);
  await debuggerCommand(debuggee, "Runtime.enable").catch(() => undefined);
  await debuggerCommand(debuggee, "DOM.enable").catch(() => undefined);

  let chooser = null;
  const onEvent = (source, method, params) => {
    const sameTab = debuggee.tabId && source.tabId === debuggee.tabId;
    const sameTarget =
      debuggee.targetId && source.targetId === debuggee.targetId;
    if (!sameTab && !sameTarget) return;
    if (method === "Page.fileChooserOpened") chooser = params;
  };
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await debuggerCommand(debuggee, "Page.setInterceptFileChooserDialog", {
      enabled: true,
    }).catch(() => undefined);

    const tree = await debuggerCommand(debuggee, "Page.getFrameTree").catch(
      () => null,
    );
    const frames = flattenFrames(tree?.frameTree);
    const jobs = frames.length ? frames : [{ id: null }];

    for (const frame of jobs) {
      let contextId = null;
      if (frame.id) {
        try {
          const created = await debuggerCommand(
            debuggee,
            "Page.createIsolatedWorld",
            {
              frameId: frame.id,
              worldName: "dianwu-xyz-upload",
            },
          );
          contextId = created?.executionContextId;
        } catch {
          // ignore
        }
      }
      const evalRes = await evaluateInput(debuggee, contextId, findExpr).catch(
        () => null,
      );
      for (let i = 0; i < 8 && !chooser; i += 1) await sleep(150);
      if (chooser?.backendNodeId) {
        await debuggerCommand(debuggee, "DOM.setFileInputFiles", {
          backendNodeId: chooser.backendNodeId,
          files: [filePath],
        });
        return { ok: true, via: "chooser" };
      }
      const objectId = evalRes?.result?.objectId;
      if (objectId) {
        await debuggerCommand(debuggee, "DOM.setFileInputFiles", {
          objectId,
          files: [filePath],
        });
        return { ok: true, via: "objectId" };
      }
    }
    throw new Error("主播后台没找到上传框");
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    await debuggerCommand(debuggee, "Page.setInterceptFileChooserDialog", {
      enabled: false,
    }).catch(() => undefined);
  }
}

async function setFileViaDebugger(tabId, filePath, findExpr = FIND_AUDIO) {
  const errors = [];
  try {
    const result = await withDebugger(tabId, (target) =>
      setFilesOnDebuggee(target, filePath, findExpr),
    );
    if (result?.ok) return result;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const targets = await debuggerTargets();
  const extras = targets.filter(
    (row) =>
      row?.id &&
      row.tabId === tabId &&
      row.type &&
      row.type !== "worker" &&
      row.type !== "service_worker",
  );
  for (const row of extras) {
    const debuggee = { targetId: row.id };
    try {
      await chrome.debugger.attach(debuggee, "1.3");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already attached/i.test(msg)) {
        errors.push(msg);
        continue;
      }
    }
    try {
      const result = await setFilesOnDebuggee(debuggee, filePath, findExpr);
      if (result?.ok) return result;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      await chrome.debugger.detach(debuggee).catch(() => undefined);
    }
  }
  throw new Error(errors.filter(Boolean).join("；") || "没有把文件写进上传框");
}

async function fillEpisodeMeta(tabId, title, shownotes) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: (episodeTitle, notes) => {
        const setNative = (el, value) => {
          if (el.isContentEditable) {
            el.focus();
            el.textContent = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return;
          }
          const proto =
            el.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc?.set) desc.set.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const blob = (el) =>
          [
            el.placeholder || "",
            el.getAttribute("aria-label") || "",
            el.name || "",
            el.id || "",
          ].join(" ");

        let titled = false;
        if (episodeTitle) {
          const inputs = Array.from(
            document.querySelectorAll("input, textarea"),
          ).filter((n) => n.type !== "file" && n.type !== "hidden");
          const el =
            inputs.find((n) => /标题|单集名|节目名|title/i.test(blob(n))) ||
            inputs.find((n) => n.offsetParent !== null) ||
            null;
          if (el) {
            setNative(el, episodeTitle);
            titled = true;
          }
        }

        let noted = false;
        if (notes) {
          const areas = Array.from(
            document.querySelectorAll("textarea, [contenteditable='true']"),
          );
          const el =
            areas.find((n) =>
              /简介|描述|shownote|show.?note|单集介绍|介绍/i.test(blob(n)),
            ) ||
            areas.find((n) => n.tagName === "TEXTAREA" && n.offsetParent !== null) ||
            areas.find((n) => n.isContentEditable) ||
            null;
          if (el) {
            setNative(el, notes);
            noted = true;
          }
        }
        return { titled, noted };
      },
      args: [title || "", shownotes || ""],
    });
    return (
      results?.find((row) => row?.result?.titled || row?.result?.noted)
        ?.result || { titled: false, noted: false }
    );
  } catch (err) {
    console.warn("[dianwu-geo xiaoyuzhou] meta", err);
    return { titled: false, noted: false };
  }
}

/**
 * @param {{
 *   audioUrl: string,
 *   coverUrl?: string,
 *   title?: string,
 *   shownotes?: string,
 * }} input
 */
export async function publishXiaoyuzhouPodcastViaExtension(input) {
  const audioUrl = String(input?.audioUrl || "").trim();
  if (!audioUrl) throw new Error("缺少音频地址");
  if (!/^https?:\/\//i.test(audioUrl)) {
    throw new Error("音频需要公网或本机绝对地址，请刷新后重试");
  }
  const coverUrl = String(input?.coverUrl || "").trim();
  const title = String(input.title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const shownotes = String(input.shownotes || "").trim().slice(0, 4000);

  if (typeof chrome === "undefined" || !chrome.tabs?.create) {
    throw new Error("扩展没有标签页权限，请重新加载点物扩展");
  }

  console.info("[dianwu-geo xiaoyuzhou] fill", {
    title,
    audioUrl: audioUrl.slice(0, 80),
    coverUrl: coverUrl.slice(0, 80),
  });

  const coverPromise =
    coverUrl && /^https?:\/\//i.test(coverUrl)
      ? downloadToFolder(coverUrl, "jpg").catch((err) => {
          console.warn("[dianwu-geo xiaoyuzhou] cover download", err);
          return "";
        })
      : Promise.resolve("");
  const filePath = await downloadToFolder(audioUrl, "mp3");
  const coverPath = await coverPromise;
  const tab = await openStudioTab();
  if (!tab?.id) throw new Error("打不开小宇宙主播后台");

  const logged = (await hasSession()) || (await pageLooksLoggedIn(tab.id));
  if (!logged) {
    throw new Error(
      "未登录小宇宙主播后台，请先在打开的标签登录 https://podcaster.xiaoyuzhoufm.com/ ，再回来点发布",
    );
  }

  await sleep(1200);
  await clickCreateEpisode(tab.id);
  await sleep(1800);

  let injected = null;
  try {
    injected = await setFileViaDebugger(tab.id, filePath, FIND_AUDIO);
    console.info("[dianwu-geo xiaoyuzhou] setFiles", injected);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    watchFillConfirmTab({
      tabId: tab.id,
      platform: "xiaoyuzhou",
      isEditorUrl: isStudioHref,
    });
    const coverHint = coverPath
      ? "封面已下到本机（Downloads/dw-podcast），请一并上传。"
      : "";
    return {
      success: true,
      postUrl: STUDIO,
      draftOnly: true,
      awaitingUserPublish: true,
      outcome: "filled_awaiting_publish",
      platform: "xiaoyuzhou",
      message: `音频已下载到本机（Downloads/dw-podcast）。请在打开的小宇宙主播后台上传该文件，标题填「${title || "未命名单集"}」后点发布。${coverHint}${message}`,
    };
  }

  await sleep(1600);
  let coverOk = false;
  if (coverPath) {
    try {
      const coverInjected = await setFileViaDebugger(
        tab.id,
        coverPath,
        FIND_COVER,
      );
      coverOk = Boolean(coverInjected?.ok);
      console.info("[dianwu-geo xiaoyuzhou] setCover", coverInjected);
    } catch (err) {
      console.warn("[dianwu-geo xiaoyuzhou] cover", err);
    }
  }

  await sleep(800);
  await fillEpisodeMeta(tab.id, title, shownotes);

  watchFillConfirmTab({
    tabId: tab.id,
    platform: "xiaoyuzhou",
    isEditorUrl: isStudioHref,
  });

  const coverMsg = coverPath
    ? coverOk
      ? "封面已写入。"
      : "封面已下到本机，若后台没带上请手动选那张图。"
    : "";

  return {
    success: true,
    postUrl: STUDIO,
    draftOnly: true,
    awaitingUserPublish: true,
    outcome: "filled_awaiting_publish",
    platform: "xiaoyuzhou",
    message: `已打开小宇宙主播后台并尝试写入音频${coverMsg ? `，${coverMsg}` : "。"}请在打开的标签核对标题和简介后点发布。Chrome 若闪过「正在调试」是正常的。`,
  };
}
