/**
 * 抖音音乐 / 汽水 — 下载音频 + 打开投稿页（填稿确认制）
 *
 * 正确入口是 complete-publish，不是 /console/songs（那只是曲目列表）。
 * 汽水与抖音曲库同源：https://music.douyin.com/console/complete-publish
 */
import { getCookieValue } from "./_cookie.js";
import { debuggerCommand, withDebugger } from "./_debugger.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const MUSIC_PUBLISH = "https://music.douyin.com/console/complete-publish";
const SESSION_NAMES = [
  "sessionid",
  "sessionid_ss",
  "sid_tt",
  "sid_ucp_v1",
  "sid_guard",
];

const FIND_AUDIO = `(() => {
  const pick = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return (
      inputs.find((el) => /audio\\/|\\.mp3|\\.wav|\\.flac|\\.m4a/i.test(el.accept || "")) ||
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
      return re.test(t) && t.length < 24;
    });
    if (!hit) return false;
    hit.click();
    return true;
  };
  clickText(/^(音频投稿|发布全曲|发布歌曲|上传作品|投稿)$/);
  clickText(/音频投稿|发布全曲|上传音频|完整版/);
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
  clickText(/^(封面|上传封面|专辑封面|更换封面|添加封面)$/);
  clickText(/上传封面|专辑封面|更换封面|封面图|歌曲封面/);
  let input = pick();
  if (!input) {
    const zone = Array.from(
      document.querySelectorAll('[class*="cover"], [class*="Cover"], [class*="artwork"], [class*="poster"]'),
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

function isMusicHref(url) {
  return /music\.douyin\.com\/(console|studio)/i.test(url || "");
}

function isPublishHref(url) {
  return /music\.douyin\.com\/console\/(complete-publish|audio|upload|publish)/i.test(
    url || "",
  );
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

async function hasSessionCookie() {
  const urls = [
    "https://music.douyin.com/",
    "https://www.douyin.com/",
    "https://creator.douyin.com/",
  ];
  const domains = [".douyin.com", "douyin.com", ".music.douyin.com"];
  for (const name of SESSION_NAMES) {
    const value = await getCookieValue(null, domains, name, urls);
    if (value && String(value).length > 10) return true;
  }
  return false;
}

async function openPublishTab() {
  const tabs = await chrome.tabs.query({
    url: ["*://music.douyin.com/*"],
  });
  let tab =
    tabs.find((t) => isPublishHref(t.url || "")) ||
    tabs.find((t) => isMusicHref(t.url || "")) ||
    tabs[0] ||
    null;
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: MUSIC_PUBLISH, active: true });
  } else {
    await chrome.tabs.update(tab.id, { url: MUSIC_PUBLISH, active: true });
  }
  await waitTabComplete(tab.id);
  await sleep(2800);

  const after = await chrome.tabs.get(tab.id).catch(() => null);
  const href = after?.url || "";
  if (/passport|login|sso/i.test(href)) {
    throw new Error(
      "汽水/抖音音乐未登录，请先在打开的标签扫码登录，再回来点发布",
    );
  }
  // 若被踢回列表页，再点一次「音频投稿 / 发布」入口
  if (!isPublishHref(href) && /\/console\/songs/i.test(href)) {
    await clickPublishEntry(tab.id);
    await sleep(2000);
    await waitTabComplete(tab.id);
  }
  return tab;
}

async function clickPublishEntry(tabId) {
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
            /^(音频投稿|发布全曲|发布歌曲|上传作品)$/.test(t) ||
            t === "音频投稿" ||
            t.includes("发布全曲")
          );
        });
        if (hit) {
          hit.click();
          return true;
        }
        return false;
      },
    });
  } catch (err) {
    console.warn("[dianwu-geo douyin-music] entry click", err);
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
    if (path.endsWith(".flac")) return "flac";
    if (path.endsWith(".m4a")) return "m4a";
    if (path.endsWith(".ogg")) return "ogg";
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".gif")) return "gif";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "jpg";
  } catch {
    // ignore
  }
  return fallback;
}

async function downloadToMusicFolder(url, fallbackExt) {
  if (!chrome.downloads?.download) {
    throw new Error("扩展没有 downloads 权限，请重新加载点物扩展并允许下载");
  }
  const ext = guessExt(url, fallbackExt);
  const filename = `dw-music/${Date.now()}-${fallbackExt}.${ext}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false,
  });
  if (downloadId == null) {
    throw new Error(fallbackExt === "jpg" ? "下载封面失败" : "下载音频失败，请确认歌曲地址能打开");
  }
  const deadline = Date.now() + (fallbackExt === "jpg" ? 60_000 : 180_000);
  while (Date.now() < deadline) {
    const items = await downloadsSearch({ id: downloadId });
    const item = items[0];
    if (item?.state === "interrupted") {
      throw new Error(fallbackExt === "jpg" ? "下载封面被中断" : "下载音频被中断");
    }
    if (item?.state === "complete" && item.filename) {
      console.info("[dianwu-geo douyin-music] downloaded", item.filename);
      return item.filename;
    }
    await sleep(250);
  }
  throw new Error(fallbackExt === "jpg" ? "下载封面超时" : "下载音频超时");
}

async function downloadAudio(url) {
  return downloadToMusicFolder(url, "mp3");
}

async function downloadCover(url) {
  return downloadToMusicFolder(url, "jpg");
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
              worldName: "dianwu-music-upload",
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
    throw new Error("投稿页没找到上传框");
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

async function fillPublishMeta(tabId, title, lyrics) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: (songTitle, songLyrics) => {
        const setNative = (el, value) => {
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
        const clickText = (re) => {
          const nodes = Array.from(
            document.querySelectorAll(
              "label, span, div, button, [role='radio'], [role='option']",
            ),
          );
          const hit = nodes.find((n) =>
            re.test((n.textContent || "").replace(/\s+/g, "").trim()),
          );
          hit?.click();
          return Boolean(hit);
        };
        // AI 创作声明 / 原创
        clickText(/^(是|AI创作|使用AI)$/);
        clickText(/Suno/);
        clickText(/^(原创|原创作品)$/);

        let titled = false;
        if (songTitle) {
          const inputs = Array.from(
            document.querySelectorAll(
              'input[placeholder*="歌名"], input[placeholder*="标题"], input[placeholder*="作品名"], input[placeholder*="歌曲名"], textarea[placeholder*="歌名"]',
            ),
          );
          const el =
            inputs.find((n) => n.offsetParent !== null) || inputs[0] || null;
          if (el) {
            setNative(el, songTitle);
            titled = true;
          }
        }

        let lyriced = false;
        if (songLyrics) {
          const areas = Array.from(
            document.querySelectorAll(
              'textarea[placeholder*="歌词"], textarea[placeholder*="lyric" i], textarea',
            ),
          );
          const el =
            areas.find((n) =>
              /歌词|lyric/i.test(
                `${n.placeholder || ""}${n.getAttribute("aria-label") || ""}`,
              ),
            ) ||
            areas.find((n) => n.offsetParent !== null) ||
            null;
          if (el) {
            setNative(el, songLyrics);
            lyriced = true;
          }
        }
        return { titled, lyriced };
      },
      args: [title || "", lyrics || ""],
    });
    return (
      results?.find((row) => row?.result?.titled || row?.result?.lyriced)
        ?.result || { titled: false, lyriced: false }
    );
  } catch (err) {
    console.warn("[dianwu-geo douyin-music] meta", err);
    return { titled: false, lyriced: false };
  }
}

/**
 * @param {{
 *   audioUrl: string,
 *   coverUrl?: string,
 *   title?: string,
 *   lyrics?: string,
 *   platform?: string,
 * }} input
 */
export async function publishDouyinMusicViaExtension(input) {
  const audioUrl = String(input?.audioUrl || "").trim();
  if (!audioUrl) throw new Error("缺少音频地址");
  if (!/^https?:\/\//i.test(audioUrl)) {
    throw new Error("音频需要公网或本机绝对地址，请刷新后重试");
  }
  const coverUrl = String(input?.coverUrl || "").trim();

  if (!(await hasSessionCookie())) {
    throw new Error(
      "未登录抖音音乐，请先在 Chrome 打开 https://music.douyin.com/console/ 扫码登录",
    );
  }
  if (typeof chrome === "undefined" || !chrome.tabs?.create) {
    throw new Error("扩展没有标签页权限，请重新加载点物扩展");
  }

  const title = String(input.title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  const lyrics = String(input.lyrics || "").trim().slice(0, 2000);
  const platform = String(input.platform || "qishui");
  const where = platform === "douyin" ? "抖音音乐" : "汽水";

  console.info("[dianwu-geo douyin-music] fill", {
    title,
    platform,
    audioUrl: audioUrl.slice(0, 80),
    coverUrl: coverUrl.slice(0, 80),
  });

  const coverPromise =
    coverUrl && /^https?:\/\//i.test(coverUrl)
      ? downloadCover(coverUrl).catch((err) => {
          console.warn("[dianwu-geo douyin-music] cover download", err);
          return "";
        })
      : Promise.resolve("");
  const filePath = await downloadAudio(audioUrl);
  const coverPath = await coverPromise;
  const tab = await openPublishTab();
  if (!tab?.id) throw new Error("打不开音乐投稿页");

  // 等投稿表单渲染
  await sleep(1500);
  await clickPublishEntry(tab.id);
  await sleep(1200);

  let injected = null;
  try {
    injected = await setFileViaDebugger(tab.id, filePath, FIND_AUDIO);
    console.info("[dianwu-geo douyin-music] setFiles", injected);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    watchFillConfirmTab({
      tabId: tab.id,
      platform: `music_${platform}`,
      isEditorUrl: isMusicHref,
    });
    const coverHint = coverPath
      ? `封面已下到本机（Downloads/dw-music），请一并上传。`
      : "";
    return {
      success: true,
      postUrl: MUSIC_PUBLISH,
      draftOnly: true,
      awaitingUserPublish: true,
      outcome: "filled_awaiting_publish",
      platform: `music_${platform}`,
      message: `音频已下载到本机（Downloads/dw-music）。请在打开的${where}投稿页上传该文件，歌名填「${title || "未名曲"}」后提交。${coverHint}${message}`,
    };
  }

  await sleep(1800);
  let coverOk = false;
  if (coverPath) {
    try {
      const coverInjected = await setFileViaDebugger(
        tab.id,
        coverPath,
        FIND_COVER,
      );
      coverOk = Boolean(coverInjected?.ok);
      console.info("[dianwu-geo douyin-music] setCover", coverInjected);
    } catch (err) {
      console.warn("[dianwu-geo douyin-music] cover", err);
    }
  }

  await sleep(800);
  await fillPublishMeta(tab.id, title, lyrics);

  watchFillConfirmTab({
    tabId: tab.id,
    platform: `music_${platform}`,
    isEditorUrl: isMusicHref,
  });

  const coverMsg = coverPath
    ? coverOk
      ? "封面已写入。"
      : "封面已下到本机，若投稿页没带上请手动选那张图。"
    : "";

  return {
    success: true,
    postUrl: MUSIC_PUBLISH,
    draftOnly: true,
    awaitingUserPublish: true,
    outcome: "filled_awaiting_publish",
    platform: `music_${platform}`,
    message: `已打开${where}投稿页并尝试写入音频${coverMsg ? `，${coverMsg}` : "。"}请在打开的标签核对歌名等信息后提交。Chrome 若闪过「正在调试」是正常的。`,
  };
}
