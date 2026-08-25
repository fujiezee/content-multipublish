/**
 * 抖音视频 — 下载成片 + CDP 写入上传框（填稿确认制）
 *
 * 下载完成后必须继续：拦截文件选择框 / 按 iframe 取到 input，再用
 * DOM.setFileInputFiles 写入。创作者页普通脚本塞文件无效。
 */
import { getCookieValue } from "./_cookie.js";
import { debuggerCall, debuggerCommand, withDebugger } from "./_debugger.js";
import { watchFillConfirmTab } from "./_fill-confirm-watch.js";

const VIDEO_UPLOAD =
  "https://creator.douyin.com/creator-micro/content/upload";
const SESSION_NAMES = [
  "sessionid",
  "sessionid_ss",
  "sid_tt",
  "sid_ucp_v1",
  "sid_guard",
];

const TITLE_SEL = [
  'input[placeholder*="填写作品标题"]',
  'input[placeholder*="作品标题"]',
  'input[placeholder*="添加作品标题"]',
  'textarea[placeholder*="作品标题"]',
].join(",");

const INTRO_SEL = [
  'div.zone-container[contenteditable="true"]',
  'div.zone-container[contenteditable="plaintext-only"]',
  ".zone-container[contenteditable]",
  'textarea[placeholder*="作品简介"]',
  'textarea[placeholder*="添加作品简介"]',
  'textarea[placeholder*="填写作品简介"]',
  '[contenteditable="true"][data-placeholder*="简介"]',
  '[contenteditable="true"][placeholder*="简介"]',
  '[data-placeholder="添加作品简介"]',
  '[placeholder="添加作品简介"]',
].join(",");

const FIND_AND_CLICK = `(() => {
  const pick = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return (
      inputs.find((el) => /video\\/|\\.mp4|\\.mov|\\.webm/i.test(el.accept || "")) ||
      inputs.find((el) => !/image\\//i.test((el.accept || "").toLowerCase())) ||
      inputs[0] ||
      null
    );
  };
  const clickText = (re) => {
    const nodes = Array.from(
      document.querySelectorAll("a, button, span, div, li, [role='tab']"),
    );
    const hit = nodes.find((n) =>
      re.test((n.textContent || "").replace(/\\s+/g, "").trim()),
    );
    if (!hit) return false;
    hit.click();
    return true;
  };
  clickText(/^(发布视频|上传视频)$/);
  clickText(/^视频$/);
  let input = pick();
  if (!input) {
    const zone = document.querySelector('[class*="upload"], [class*="Upload"]');
    zone?.click();
    input = pick();
  }
  if (input) {
    try { input.click(); } catch (e) {}
    return input;
  }
  return null;
})()`;

function isVideoHref(url) {
  return /creator-micro\/content\/(upload|post\/video|publish)/i.test(url || "");
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

async function execFrames(tabId, func, args = [], world = "ISOLATED") {
  try {
    return (
      (await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world,
        func,
        args,
      })) || []
    );
  } catch (err) {
    console.warn("[dianwu-geo douyin-video] allFrames", err);
    try {
      return (
        (await chrome.scripting.executeScript({
          target: { tabId },
          world,
          func,
          args,
        })) || []
      );
    } catch (err2) {
      console.warn("[dianwu-geo douyin-video] mainFrame", err2);
      return [];
    }
  }
}

async function hasSessionCookie() {
  const urls = ["https://creator.douyin.com/", "https://www.douyin.com/"];
  const domains = [".douyin.com", "douyin.com", ".creator.douyin.com"];
  for (const name of SESSION_NAMES) {
    const value = await getCookieValue(null, domains, name, urls);
    if (value && String(value).length > 10) return true;
  }
  return false;
}

async function openUploadTab() {
  const tabs = await chrome.tabs.query({
    url: ["*://creator.douyin.com/*", "*://www.douyin.com/*"],
  });
  let tab =
    tabs.find((t) => isVideoHref(t.url || "")) ||
    tabs.find((t) => /creator-micro/i.test(t.url || "")) ||
    tabs[0] ||
    null;
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: VIDEO_UPLOAD, active: true });
  } else {
    await chrome.tabs.update(tab.id, { url: VIDEO_UPLOAD, active: true });
  }
  await waitTabComplete(tab.id);
  await sleep(2500);
  return tab;
}

function downloadsSearch(query) {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (items) => resolve(items || []));
  });
}

async function downloadVideo(url) {
  if (!chrome.downloads?.download) {
    throw new Error("扩展没有 downloads 权限，请重新加载点物扩展并允许下载");
  }
  const filename = `dw-douyin/${Date.now()}.mp4`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false,
  });
  if (downloadId == null) {
    throw new Error("下载成片失败，请确认成片地址能打开");
  }
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const items = await downloadsSearch({ id: downloadId });
    const item = items[0];
    if (item?.state === "interrupted") {
      throw new Error("下载成片被中断");
    }
    if (item?.state === "complete" && item.filename) {
      console.info("[dianwu-geo douyin-video] downloaded", item.filename);
      return item.filename;
    }
    await sleep(250);
  }
  throw new Error("下载成片超时");
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

async function evaluateInput(debuggee, contextId) {
  const params = {
    expression: FIND_AND_CLICK,
    userGesture: true,
    returnByValue: false,
  };
  if (contextId) params.contextId = contextId;
  return debuggerCommand(debuggee, "Runtime.evaluate", params);
}

async function setFilesOnDebuggee(debuggee, filePath) {
  await debuggerCommand(debuggee, "Page.enable").catch(() => undefined);
  await debuggerCommand(debuggee, "Runtime.enable").catch(() => undefined);
  await debuggerCommand(debuggee, "DOM.enable").catch(() => undefined);

  let chooser = null;
  const onEvent = (source, method, params) => {
    const sameTab = debuggee.tabId && source.tabId === debuggee.tabId;
    const sameTarget = debuggee.targetId && source.targetId === debuggee.targetId;
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
      let contextId;
      if (frame.id) {
        try {
          const world = await debuggerCommand(debuggee, "Page.createIsolatedWorld", {
            frameId: frame.id,
            grantUniveralAccess: true,
            worldName: `dwgeo-file-${Date.now()}`,
          });
          contextId = world?.executionContextId;
        } catch (err) {
          console.warn("[dianwu-geo douyin-video] world", frame.id, err);
        }
      }
      const evalRes = await evaluateInput(debuggee, contextId).catch((err) => {
        console.warn("[dianwu-geo douyin-video] eval", err);
        return null;
      });
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
    throw new Error("调试器没找到上传框");
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
  }
}

async function setFileViaDebugger(tabId, filePath) {
  const errors = [];
  try {
    const result = await withDebugger(tabId, (target) =>
      setFilesOnDebuggee(target, filePath),
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
      const result = await setFilesOnDebuggee(debuggee, filePath);
      if (result?.ok) return result;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    } finally {
      await chrome.debugger.detach(debuggee).catch(() => undefined);
    }
  }
  throw new Error(errors.filter(Boolean).join("；") || "没有把成片写进上传框");
}

async function waitUploadReady(tabId, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await execFrames(
      tabId,
      (titleSel) => {
        const title = document.querySelector(titleSel);
        const box = title?.getBoundingClientRect?.();
        const visible = !!(box && box.height > 8 && box.width > 8);
        const text = document.body?.innerText || "";
        const fail = /上传失败|格式不支持|文件过大/.test(text);
        return { ready: visible, fail, href: location.href };
      },
      [TITLE_SEL],
    );
    if (rows.some((row) => row?.result?.fail)) {
      return { ok: false, error: "视频上传失败。请在打开的窗口里核对后重试" };
    }
    const ready = rows.find((row) => row?.result?.ready);
    if (ready?.result) return { ok: true, href: ready.result.href };
    await sleep(800);
  }
  return {
    ok: false,
    error: "视频还没传完。请在打开的窗口里核对后点发布",
  };
}

function boxCenter(model) {
  const q = model?.content || model?.border;
  if (!Array.isArray(q) || q.length < 8) return null;
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/**
 * Runs in the page. Douyin intro is `div.zone-container[contenteditable]`,
 * not a placeholder span.
 */
function fillMetaInPage(title, description, titleSel, introSel) {
  const placeholder = (text) => {
    const t = String(text || "").replace(/\s+/g, "").trim();
    return (
      !t ||
      /^(添加作品简介|填写作品简介|作品简介|添加作品描述|简介|添加作品标题|填写作品标题|作品标题|标题)$/.test(
        t,
      )
    );
  };
  const deepQuery = (sel) => {
    const walk = (root) => {
      const hit = root.querySelector?.(sel);
      if (hit) return hit;
      const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const node of nodes) {
        if (node.shadowRoot) {
          const inner = walk(node.shadowRoot);
          if (inner) return inner;
        }
      }
      return null;
    };
    return walk(document);
  };
  const setNativeValue = (el, value) => {
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
  const pickIntro = () => {
    const hint = Array.from(document.querySelectorAll("span, div, p, label")).find(
      (n) => {
        const t = (n.textContent || "").replace(/\s+/g, "").trim();
        return t === "添加作品简介" || t === "填写作品简介";
      },
    );
    hint?.click();
    return (
      deepQuery(introSel) ||
      document.querySelector(introSel) ||
      document.querySelector(
        'div.zone-container[contenteditable="true"], .zone-container[contenteditable]',
      ) ||
      null
    );
  };
  const insertIntro = (el, value) => {
    el.scrollIntoView({ block: "center" });
    el.focus();
    el.click();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, value);
      return !placeholder(el.value);
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    let ok = false;
    if (typeof document.execCommand === "function") {
      document.execCommand("selectAll", false, undefined);
      ok = document.execCommand("insertText", false, value);
    }
    if (!ok || placeholder(el.innerText)) {
      el.textContent = value;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value,
        }),
      );
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return !placeholder(el.innerText || el.textContent);
  };

  let titled = false;
  let intro = false;
  if (title) {
    const titleEl = deepQuery(titleSel) || document.querySelector(titleSel);
    if (titleEl) {
      const current = (titleEl.value || titleEl.innerText || "").trim();
      if (!placeholder(current) && current.length >= 2) titled = true;
      else {
        setNativeValue(titleEl, title);
        titled = !placeholder(titleEl.value || titleEl.innerText);
      }
    }
  }
  if (description) {
    const introEl = pickIntro();
    if (introEl) {
      const current = (introEl.value || introEl.innerText || "").trim();
      intro = !placeholder(current) ? true : insertIntro(introEl, description);
    }
  }
  return { ok: titled || intro, titled, intro, href: location.href };
}

const PICK_INTRO_NODE = `(() => {
  const hint = Array.from(document.querySelectorAll("span, div, p, label")).find((n) => {
    const t = (n.textContent || "").replace(/\\s+/g, "").trim();
    return t === "添加作品简介" || t === "填写作品简介";
  });
  hint?.click();
  const el =
    document.querySelector(${JSON.stringify(INTRO_SEL)}) ||
    document.querySelector(
      'div.zone-container[contenteditable="true"], .zone-container[contenteditable]',
    );
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  el.focus();
  el.click();
  return el;
})()`;

async function evaluateInContext(debuggee, contextId, expression) {
  const params = {
    expression,
    userGesture: true,
    returnByValue: true,
  };
  if (contextId) params.contextId = contextId;
  const res = await debuggerCommand(debuggee, "Runtime.evaluate", params);
  if (res?.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        "页面脚本失败",
    );
  }
  return res?.result?.value;
}

async function typeIntroOnDebuggee(debuggee, description) {
  await debuggerCommand(debuggee, "Page.enable").catch(() => undefined);
  await debuggerCommand(debuggee, "Runtime.enable").catch(() => undefined);
  await debuggerCommand(debuggee, "DOM.enable").catch(() => undefined);
  const tree = await debuggerCommand(debuggee, "Page.getFrameTree").catch(
    () => null,
  );
  const frames = flattenFrames(tree?.frameTree);
  const jobs = frames.length ? frames : [{ id: null }];
  for (const frame of jobs) {
    let contextId;
    if (frame.id) {
      try {
        const world = await debuggerCommand(debuggee, "Page.createIsolatedWorld", {
          frameId: frame.id,
          grantUniveralAccess: true,
          worldName: `dwgeo-intro-${Date.now()}`,
        });
        contextId = world?.executionContextId;
      } catch {
        continue;
      }
    }
    const params = {
      expression: PICK_INTRO_NODE,
      userGesture: true,
      returnByValue: false,
    };
    if (contextId) params.contextId = contextId;
    const evalRes = await debuggerCommand(debuggee, "Runtime.evaluate", params).catch(
      () => null,
    );
    const objectId = evalRes?.result?.objectId;
    if (!objectId || evalRes?.result?.subtype === "null") continue;

    await debuggerCommand(debuggee, "DOM.focus", { objectId }).catch(() => undefined);
    const box = await debuggerCommand(debuggee, "DOM.getBoxModel", {
      objectId,
    }).catch(() => null);
    const pt = boxCenter(box?.model);
    if (pt) {
      await debuggerCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: pt.x,
        y: pt.y,
        button: "left",
        clickCount: 1,
      }).catch(() => undefined);
      await debuggerCommand(debuggee, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: pt.x,
        y: pt.y,
        button: "left",
        clickCount: 1,
      }).catch(() => undefined);
    }
    await sleep(150);
    await evaluateInContext(debuggee, contextId, `document.execCommand("selectAll")`).catch(
      () => undefined,
    );
    await debuggerCommand(debuggee, "Input.insertText", { text: description });
    const check = await evaluateInContext(
      debuggee,
      contextId,
      `(() => {
        const el = document.querySelector(${JSON.stringify(INTRO_SEL)});
        const t = (el?.innerText || el?.value || "").trim();
        const compact = t.replace(/\\s+/g, "");
        return {
          ok: !!(t && !/^(添加作品简介|填写作品简介|作品简介|添加作品描述|简介)$/.test(compact)),
          preview: t.slice(0, 24),
        };
      })()`,
    ).catch(() => null);
    if (check?.ok) return check;
  }
  return { ok: false };
}

async function fillMetaViaScript(tabId, title, description) {
  const rows = await execFrames(
    tabId,
    fillMetaInPage,
    [title, description, TITLE_SEL, INTRO_SEL],
    "MAIN",
  );
  return (
    rows.find((row) => row?.result?.intro)?.result ||
    rows.find((row) => row?.result)?.result ||
    null
  );
}

async function fillMeta(tabId, title, description) {
  const viaScript = await fillMetaViaScript(tabId, title, description);
  if (viaScript?.intro) return viaScript;
  if (!description) return viaScript || { ok: false, intro: false };

  return withDebugger(tabId, async (target) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const viaPage = await debuggerCall(
        target,
        fillMetaInPage,
        [title, description, TITLE_SEL, INTRO_SEL],
      ).catch((err) => {
        console.warn("[dianwu-geo douyin-video] page fill", err);
        return null;
      });
      if (viaPage?.intro) return viaPage;
      const typed = await typeIntroOnDebuggee(target, description);
      if (typed?.ok) {
        console.info("[dianwu-geo douyin-video] intro typed", typed.preview);
        return {
          ok: true,
          intro: true,
          titled: Boolean(viaPage?.titled || viaScript?.titled),
        };
      }
      await sleep(600);
    }
    return viaScript || { ok: false, intro: false, titled: false };
  });
}

/**
 * @param {{
 *   videoUrl: string,
 *   title?: string,
 *   description?: string,
 * }} input
 */
export async function publishDouyinShortVideoViaExtension(input) {
  const videoUrl = String(input?.videoUrl || "").trim();
  if (!videoUrl) throw new Error("缺少成片地址");
  if (!/^https?:\/\//i.test(videoUrl)) {
    throw new Error("成片需要公网或本机绝对地址，请刷新后重试");
  }

  if (!(await hasSessionCookie())) {
    throw new Error("未登录抖音，请先在 Chrome 打开 https://creator.douyin.com/ 扫码登录");
  }
  if (typeof chrome === "undefined" || !chrome.tabs?.create) {
    throw new Error("扩展没有标签页权限，请重新加载点物扩展");
  }

  const title = String(input.title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
  const description = String(input.description || input.title || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n")
    .trim()
    .slice(0, 300);
  console.info("[dianwu-geo douyin-video] fill", {
    title,
    intro: description.slice(0, 40),
    introLen: description.length,
  });

  const tab = await openUploadTab();
  if (!tab?.id) throw new Error("打不开抖音上传页");
  const filePath = await downloadVideo(videoUrl);
  console.info("[dianwu-geo douyin-video] inject", filePath);

  try {
    const injected = await setFileViaDebugger(tab.id, filePath);
    console.info("[dianwu-geo douyin-video] setFiles", injected);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `成片已下载，但没写进上传框：${message}`,
      postUrl: VIDEO_UPLOAD,
      draftOnly: true,
    };
  }

  const ready = await waitUploadReady(tab.id);
  if (!ready.ok) {
    return {
      success: false,
      error: ready.error,
      postUrl: VIDEO_UPLOAD,
      draftOnly: true,
      awaitingUserPublish: true,
    };
  }

  await sleep(1200);
  const meta = await fillMeta(tab.id, title, description).catch((err) => {
    console.warn("[dianwu-geo douyin-video] meta", err);
    return { ok: false, intro: false };
  });
  if (!meta?.intro && description) {
    console.warn("[dianwu-geo douyin-video] intro not filled");
  }

  watchFillConfirmTab({
    tabId: tab.id,
    platform: "douyin_video",
    isEditorUrl: isVideoHref,
  });

  return {
    success: true,
    postUrl: ready.href || VIDEO_UPLOAD,
    draftOnly: true,
    awaitingUserPublish: true,
    outcome: "filled_awaiting_publish",
    platform: "douyin_video",
    message:
      "视频已传到抖音。请在打开的标签核对后点「发布」。Chrome 若闪过「正在调试」是正常的。",
  };
}
