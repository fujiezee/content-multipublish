/**
 * chrome.debugger (CDP) helpers.
 * Attach → Runtime.evaluate in the page world → detach.
 * Chrome shows a brief “正在调试此浏览器” bar while attached.
 */

function formatDebuggerError(err) {
  const raw = err instanceof Error ? err.message : String(err || "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.message) {
      return String(parsed.message);
    }
  } catch {
    // not JSON
  }
  const jsonInMsg = raw.match(/\{[\s\S]*"message"\s*:\s*"([^"]+)"/);
  if (jsonInMsg?.[1]) return jsonInMsg[1];
  return raw;
}

export function isBenignDebuggerError(message) {
  const s = String(message || "").toLowerCase();
  return (
    s.includes("-32000") ||
    s.includes("cannot attach to the target") ||
    s.includes("debugger is already attached") ||
    s.includes("another debugger") ||
    s.includes("detached while handling") ||
    s.includes("target closed")
  );
}

/**
 * @param {number} tabId
 * @param {(target: { tabId: number }) => Promise<unknown>} fn
 */
export async function withDebugger(tabId, fn) {
  if (typeof chrome === "undefined" || !chrome.debugger?.attach) {
    throw new Error("扩展没有 debugger 权限，请重新加载点物扩展");
  }
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (err) {
    const msg = formatDebuggerError(err);
    if (/already attached/i.test(msg)) {
      await chrome.debugger.detach(target).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 120));
      try {
        await chrome.debugger.attach(target, "1.3");
      } catch (retryErr) {
        throw new Error(`无法调试这个标签：${formatDebuggerError(retryErr)}`);
      }
    } else {
      throw new Error(`无法调试这个标签：${msg}`);
    }
  }
  try {
    return await fn(target);
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

/**
 * @param {{ tabId: number }} target
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 */
export async function debuggerCommand(target, method, params = {}) {
  try {
    const res = await chrome.debugger.sendCommand(target, method, params);
    return res;
  } catch (err) {
    const msg = formatDebuggerError(err);
    throw new Error(msg);
  }
}

/**
 * Run a function in the page (same JS world as the site).
 * @param {{ tabId: number }} target
 * @param {(...args: unknown[]) => unknown} fn
 * @param {unknown[]} [args]
 * @param {{ awaitPromise?: boolean }} [opts]
 */
export async function debuggerCall(target, fn, args = [], opts = {}) {
  const awaitPromise = opts.awaitPromise !== false;
  const expression = `(() => {
    const __fn = ${fn.toString()};
    const __args = ${JSON.stringify(args)};
    return __fn(...__args);
  })()`;
  const res = await debuggerCommand(target, "Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (res?.exceptionDetails) {
    const d = res.exceptionDetails;
    const text =
      d.exception?.description ||
      d.text ||
      d.exception?.value ||
      "页面脚本失败";
    throw new Error(String(text));
  }
  return res?.result?.value;
}
