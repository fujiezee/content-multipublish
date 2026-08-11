/**
 * When the popup syncs multiple platforms, rewrite SYNC_ARTICLE into
 * per-family batches using dwgeoFamilyVariants (stashed from the editor).
 *
 * Must preserve chrome.runtime.sendMessage Promise + callback semantics:
 * popup does `const f = await chrome.runtime.sendMessage(...)` then `f.results`.
 */
(function () {
  const PLATFORM_TO_FAMILY = {
    csdn: "tech",
    juejin: "tech",
    cnblogs: "tech",
    cto51: "tech",
    segmentfault: "tech",
    oschina: "tech",
    imooc: "tech",
    yuque: "tech",
    toutiao: "media",
    baijiahao: "media",
    sohu: "media",
    dayu: "media",
    yidian: "media",
    netease: "media",
    qiehao: "media",
    dafeng: "media",
    kuaichuan: "media",
    sinakandian: "media",
    dongfang: "media",
    btime: "media",
    peoplehao: "media",
    xinhuahao: "media",
    zhongqing: "media",
    zhihu: "knowledge",
    douban: "knowledge",
    jianshu: "knowledge",
    woshipm: "knowledge",
    bilibili: "knowledge",
    weibo: "social",
    xiaohongshu: "social",
    douyin: "social",
    x: "social",
    smzdm: "social",
    weixin: "wechat",
    tencentcloud: "cloud",
    aliyun: "cloud",
    huaweicloud: "cloud",
    xueqiu: "finance",
    eastmoney: "finance",
    sohufocus: "finance",
  };

  function familyOf(platform) {
    return PLATFORM_TO_FAMILY[String(platform || "").toLowerCase()] || "knowledge";
  }

  function pickArticle(variant, fallback) {
    const content =
      (variant && (variant.content || variant.html)) ||
      (fallback && (fallback.content || fallback.html)) ||
      "";
    return {
      ...(fallback || {}),
      title: (variant && variant.title) || (fallback && fallback.title) || "",
      content,
      html: content,
      markdown:
        (variant && variant.markdown) || (fallback && fallback.markdown) || "",
      cover:
        (variant && (variant.cover || variant.thumb)) ||
        (fallback && (fallback.cover || fallback.thumb)) ||
        undefined,
    };
  }

  function hasVariantBody(variant) {
    return Boolean(
      variant && String(variant.content || variant.html || "").trim(),
    );
  }

  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);

  /** Promise-based send that always resolves (never leaves await hanging). */
  function sendRouted(payload) {
    return new Promise((resolve) => {
      try {
        orig({ type: "SYNC_ARTICLE", payload }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({
              results: [],
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(
            resp && typeof resp === "object"
              ? resp
              : { results: [], error: "扩展无响应" },
          );
        });
      } catch (err) {
        resolve({
          results: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async function routeFamilySync(message) {
    const platforms = Array.isArray(message.payload?.platforms)
      ? message.payload.platforms
      : [];
    const baseArticle = message.payload?.article || {};

    let variants = {};
    try {
      const data = await chrome.storage.local.get([
        "dwgeoFamilyVariants",
        "pendingArticle",
      ]);
      variants =
        data.dwgeoFamilyVariants ||
        data.pendingArticle?.familyVariants ||
        {};
    } catch {
      variants = {};
    }

    const groups = new Map();
    for (const platform of platforms) {
      const family = familyOf(platform);
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push(platform);
    }

    const usable = [...groups.keys()].filter((f) =>
      hasVariantBody(variants[f]),
    );

    // No family variants → single routed call (same article for all).
    if (!usable.length) {
      return sendRouted({ ...message.payload, _familyRouted: true });
    }

    const allResults = [];
    let hardError = null;
    const entries = [...groups.entries()];

    for (let i = 0; i < entries.length; i += 1) {
      const [, plats] = entries[i];
      const family = entries[i][0];
      const article = pickArticle(variants[family], baseArticle);
      const resp = await sendRouted({
        ...message.payload,
        article,
        platforms: plats,
        _familyRouted: true,
        skipHistory: i < entries.length - 1,
      });

      if (resp?.error && !hardError) hardError = String(resp.error);
      if (Array.isArray(resp?.results) && resp.results.length) {
        allResults.push(...resp.results);
      } else if (resp?.error) {
        for (const p of plats) {
          allResults.push({
            platform: p,
            success: false,
            error: String(resp.error),
          });
        }
      } else {
        // SW returned something without results — synthesize placeholders
        // so the popup never crashes on undefined.results
        for (const p of plats) {
          allResults.push({
            platform: p,
            success: false,
            error: "未返回同步结果",
          });
        }
      }
    }

    console.info(
      "[dianwu-geo] family-routed sync groups:",
      [...groups.keys()],
      "results:",
      allResults.length,
    );

    return {
      results: allResults,
      ...(hardError && !allResults.some((r) => r.success)
        ? { error: hardError }
        : {}),
    };
  }

  chrome.runtime.sendMessage = function patchedSendMessage(message, arg2, arg3) {
    const cb =
      typeof arg2 === "function"
        ? arg2
        : typeof arg3 === "function"
          ? arg3
          : null;

    if (
      message &&
      typeof message === "object" &&
      message.type === "SYNC_ARTICLE" &&
      !message.payload?._familyRouted
    ) {
      const promise = routeFamilySync(message).catch((err) => ({
        results: [],
        error: err instanceof Error ? err.message : String(err),
      }));

      if (cb) {
        promise.then((resp) => {
          try {
            cb(resp);
          } catch (e) {
            console.warn("[dianwu-geo] sync callback error:", e);
          }
        });
      }
      // Chrome MV3: await sendMessage() uses the returned Promise.
      return promise;
    }

    return orig.apply(chrome.runtime, arguments);
  };

  console.info("[dianwu-geo] popup-family-sync intercept ready");
})();
