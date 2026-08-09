import fs from "fs";
import {
  openContext,
  saveSession,
  waitForManualLogin,
} from "@/lib/publishers/browser";
import { getPublisher } from "@/lib/publishers";
import { upsertSession } from "@/lib/db";
import { sessionPath } from "@/lib/paths";
import type { PlatformId } from "@/lib/types";

const connecting = new Set<PlatformId>();

export async function connectPlatform(platform: PlatformId) {
  if (connecting.has(platform)) {
    throw new Error("该平台正在连接中，请在已打开的浏览器窗口完成登录");
  }
  connecting.add(platform);
  const publisher = getPublisher(platform);
  let context;
  try {
    // Fresh context, no prior session — avoid polluted cookies
    const opened = await openContext(platform, {
      headless: false,
      useSession: false,
    });
    context = opened.context;
    const page = await context.newPage();
    await page.goto(publisher.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const ok = await waitForManualLogin(page, async (p) => {
      if (!(await publisher.isLoggedIn(p))) return false;

      // JianShu / SPA platforms: after QR login land on homepage —
      // open writer and require editor chrome before accepting session.
      if (platform === "jianshu") {
        const url = p.url();
        if (!/writer/i.test(url)) {
          await p.goto(publisher.editorUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          }).catch(() => undefined);
          await p.waitForTimeout(2000);
        }
        // Must still look logged-in on writer (not bounced to sign_in)
        if (/sign_in|sign_up/i.test(p.url())) return false;
        const create = p.locator("text=新建文章");
        const publish = p.locator("text=发布文章");
        const hasUi =
          ((await create.count()) > 0 &&
            (await create.first().isVisible().catch(() => false))) ||
          ((await publish.count()) > 0 &&
            (await publish.first().isVisible().catch(() => false)));
        if (!hasUi) return false;
      }

      // CSDN: land on editor and require title/publish chrome
      if (platform === "csdn") {
        const url = p.url();
        if (!/mp_blog\/creation\/editor|editor\.csdn\.net/i.test(url)) {
          await p
            .goto(publisher.editorUrl, {
              waitUntil: "domcontentloaded",
              timeout: 45_000,
            })
            .catch(() => undefined);
          await p.waitForTimeout(2000);
        }
        if (/passport\.csdn\.net\/login/i.test(p.url())) return false;
        const title = p.locator(
          'input[placeholder*="请输入文章标题"], input[placeholder*="文章标题"]',
        );
        const publish = p.locator('button:has-text("发布文章"), button:has-text("发布")');
        const hasUi =
          ((await title.count()) > 0 &&
            (await title.first().isVisible().catch(() => false))) ||
          ((await publish.count()) > 0 &&
            (await publish.first().isVisible().catch(() => false)));
        if (!hasUi) return false;
      }

      // 头条号：进入图文发布页并确认编辑器已出
      if (platform === "toutiao") {
        const url = p.url();
        if (!/profile_v4\/graphic\/publish/i.test(url)) {
          await p
            .goto(publisher.editorUrl, {
              waitUntil: "domcontentloaded",
              timeout: 45_000,
            })
            .catch(() => undefined);
          await p.waitForTimeout(2000);
        }
        if (/auth\/page\/login|passport|sso/i.test(p.url())) return false;
        const title = p.locator(
          'textarea[placeholder*="标题"], textarea[placeholder*="2"]',
        );
        const body = p.locator(".ProseMirror");
        const hasUi =
          ((await title.count()) > 0 &&
            (await title.first().isVisible().catch(() => false))) ||
          ((await body.count()) > 0 &&
            (await body.first().isVisible().catch(() => false)));
        if (!hasUi) return false;
      }

      // 抖音创作者：未登录也会有 passport_csrf_token / odin_tt，且首页 URL 含 creator
      // 必须等到真正的 sessionid，且登录二维码消失，再进图文发布页确认
      if (platform === "douyin") {
        if (!(await publisher.isLoggedIn(p))) return false;
        if (
          !/creator-micro\/content\/post\/image|content\/post\/image/i.test(
            p.url(),
          )
        ) {
          await p
            .goto(publisher.editorUrl, {
              waitUntil: "domcontentloaded",
              timeout: 45_000,
            })
            .catch(() => undefined);
          await p.waitForTimeout(2500);
        }
        if (!(await publisher.isLoggedIn(p))) return false;
        if (/passport|sso\.|\/login\b/i.test(p.url())) return false;
        return true;
      }

      // 掘金 / 微信等：连接后打开编辑页确认未掉登录
      if (
        platform === "juejin" ||
        platform === "weixin" ||
        platform === "cnblogs" ||
        platform === "segmentfault" ||
        platform === "bilibili" ||
        platform === "xiaohongshu" ||
        platform === "x"
      ) {
        const url = p.url();
        if (
          platform === "juejin" &&
          !/editor\/drafts/i.test(url)
        ) {
          await p
            .goto(publisher.editorUrl, {
              waitUntil: "domcontentloaded",
              timeout: 45_000,
            })
            .catch(() => undefined);
          await p.waitForTimeout(2000);
        }
        if (
          platform === "xiaohongshu" &&
          !/publish|post\/image|creator/i.test(url)
        ) {
          await p
            .goto(publisher.editorUrl, {
              waitUntil: "domcontentloaded",
              timeout: 45_000,
            })
            .catch(() => undefined);
          await p.waitForTimeout(2000);
        }
        if (platform === "weixin") {
          if (/loginpage|login\?/i.test(p.url())) return false;
          if (
            (await p.getByText("微信扫一扫").count()) > 0 &&
            !/[?&]token=\d+/i.test(p.url())
          ) {
            return false;
          }
          // Require tokenized home/editor URL — cookies alone are not enough
          if (!/[?&]token=\d+/i.test(p.url())) {
            await p
              .goto("https://mp.weixin.qq.com/", {
                waitUntil: "domcontentloaded",
                timeout: 45_000,
              })
              .catch(() => undefined);
            await p.waitForTimeout(2500);
          }
          if (!/[?&]token=\d+/i.test(p.url())) return false;
          if (!(await publisher.isLoggedIn(p))) return false;
          return true;
        }

        // 大鱼号：首页/游客也有 cna 等 cookie，必须进写稿页且无扫码门
        if (platform === "dayu") {
          if (
            (await p
              .getByText(/扫码登录|请使用UC浏览器扫码|正在生成二维码/)
              .count()) > 0
          ) {
            return false;
          }
          if (!/#\/article\/write|article\/write/i.test(p.url())) {
            await p
              .goto(publisher.editorUrl, {
                waitUntil: "domcontentloaded",
                timeout: 45_000,
              })
              .catch(() => undefined);
            await p.waitForTimeout(2500);
          }
          if (
            (await p
              .getByText(/扫码登录|请使用UC浏览器扫码|正在生成二维码/)
              .count()) > 0
          ) {
            return false;
          }
          const title = p.locator(
            'textarea[placeholder*="标题"], input[placeholder*="标题"], input[placeholder*="请输入标题"]',
          );
          const hasEditor =
            (await title.count()) > 0 &&
            (await title.first().isVisible().catch(() => false));
          if (!hasEditor) return false;
          if (!(await publisher.isLoggedIn(p))) return false;
          return true;
        }
        if (
          /\/login|signin|passport|loginpage|i\/flow\/login/i.test(p.url()) &&
          platform !== "weixin"
        ) {
          return false;
        }
      }

      return true;
    });

    if (!ok) {
      await context.close();
      upsertSession(platform, { status: "disconnected" });
      throw new Error("登录超时（5 分钟），请在弹出的窗口完成登录后等待自动确认");
    }

    // Strengthen cookies on editor, then persist
    await page
      .goto(publisher.editorUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(2000);

    if (
      !(await publisher.isLoggedIn(page)) ||
      /sign_in|sign_up|passport\.csdn\.net\/login|auth\/page\/login/i.test(
        page.url(),
      ) ||
      (platform === "douyin" && /passport|sso\./i.test(page.url()))
    ) {
      await context.close();
      upsertSession(platform, { status: "disconnected" });
      throw new Error("登录态未生效（可能未完成验证）。请重试连接并完成扫码/验证码");
    }

    const storage = await saveSession(platform, context);

    // Sanity: session file must exist and contain cookies
    if (!fs.existsSync(storage)) {
      throw new Error("会话文件写入失败，请重试");
    }
    try {
      const raw = JSON.parse(fs.readFileSync(storage, "utf8")) as {
        cookies?: { name: string }[];
      };
      if (!raw.cookies?.length) {
        throw new Error("会话里没有 Cookie，登录可能未完成");
      }
      if (platform === "jianshu") {
        const names = new Set(raw.cookies.map((c) => c.name));
        if (!names.has("remember_user_token") && !names.has("_m7e_session")) {
          throw new Error(
            "未拿到简书登录 Cookie（remember_user_token）。请确认已登录成功后再等几秒",
          );
        }
      }
      if (platform === "csdn") {
        const names = new Set(raw.cookies.map((c) => c.name));
        if (
          !names.has("UserName") &&
          !names.has("UserToken") &&
          !names.has("UserInfo") &&
          !names.has("c_token")
        ) {
          throw new Error(
            "未拿到 CSDN 登录 Cookie。请确认已登录成功并进入创作中心后再等几秒",
          );
        }
      }
      if (platform === "toutiao") {
        const names = [...raw.cookies.map((c) => c.name)];
        const ok = names.some((n) =>
          /sessionid|sid_tt|uid_tt|toutiao_sso_user/i.test(n),
        );
        if (!ok) {
          throw new Error(
            "未拿到头条号登录 Cookie。请确认已登录成功并进入图文发布页后再等几秒",
          );
        }
      }
      if (platform === "douyin") {
        const names = new Set(raw.cookies.map((c) => c.name));
        if (
          !names.has("sessionid") &&
          !names.has("sessionid_ss") &&
          !names.has("sid_guard") &&
          !names.has("sid_tt")
        ) {
          throw new Error(
            "未拿到抖音登录 Cookie（sessionid）。请扫码完成登录后再等几秒，不要只停留在登录二维码页",
          );
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("简书")) throw e;
      if (e instanceof Error && e.message.includes("Cookie")) throw e;
      if (e instanceof Error && e.message.includes("头条")) throw e;
      if (e instanceof Error && e.message.includes("抖音")) throw e;
      // parse errors — still keep file if present
    }

    let displayName: string | null = null;
    try {
      displayName = await page.evaluate(() => {
        const el =
          document.querySelector('[class*="name"]') ||
          document.querySelector(".AppHeader-userInfo") ||
          document.querySelector(".username") ||
          document.querySelector('a[href*="/u/"]');
        return el?.textContent?.trim()?.slice(0, 40) || null;
      });
    } catch {
      displayName = null;
    }

    upsertSession(platform, {
      storage_path: storage,
      display_name: displayName,
      connected_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      status: "connected",
    });

    await context.close();
    return { platform, status: "connected" as const, displayName };
  } catch (err) {
    if (context) await context.close().catch(() => undefined);
    // Clean partial session on failure
    const file = sessionPath(platform);
    if (
      fs.existsSync(file) &&
      (platform === "jianshu" || platform === "csdn" || platform === "toutiao")
    ) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
          cookies?: { name: string }[];
        };
        const names = new Set((raw.cookies ?? []).map((c) => c.name));
        if (platform === "jianshu") {
          if (!names.has("remember_user_token") && !names.has("_m7e_session")) {
            fs.unlinkSync(file);
          }
        }
        if (platform === "csdn") {
          if (
            !names.has("UserName") &&
            !names.has("UserToken") &&
            !names.has("UserInfo") &&
            !names.has("c_token")
          ) {
            fs.unlinkSync(file);
          }
        }
        if (platform === "toutiao") {
          const ok = [...names].some((n) =>
            /sessionid|sid_tt|uid_tt|toutiao_sso_user/i.test(n),
          );
          if (!ok) fs.unlinkSync(file);
        }
      } catch {
        fs.unlinkSync(file);
      }
    }
    throw err;
  } finally {
    connecting.delete(platform);
  }
}

export async function checkPlatformSession(platform: PlatformId) {
  const stateFile = sessionPath(platform);
  if (!fs.existsSync(stateFile)) {
    upsertSession(platform, {
      status: "disconnected",
      last_checked_at: new Date().toISOString(),
    });
    return { platform, status: "disconnected" as const };
  }

  const publisher = getPublisher(platform);
  const { context } = await openContext(platform, {
    headless: true,
    useSession: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(publisher.editorUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2000);
    let loggedIn =
      (await publisher.isLoggedIn(page)) &&
      !/sign_in|sign_up|passport\.csdn\.net\/login|auth\/page\/login/i.test(
        page.url(),
      );
    // WeChat: require tokenized URL — stale cookies look "logged in" otherwise
    if (platform === "weixin") {
      loggedIn =
        loggedIn &&
        /[?&]token=\d+/i.test(page.url()) &&
        (await page.getByText("微信扫一扫").count()) === 0;
    }
    const status = loggedIn ? ("connected" as const) : ("expired" as const);
    upsertSession(platform, {
      status,
      last_checked_at: new Date().toISOString(),
    });
    return { platform, status };
  } finally {
    await context.close();
  }
}

export function disconnectPlatform(platform: PlatformId) {
  const file = sessionPath(platform);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  upsertSession(platform, {
    status: "disconnected",
    display_name: null,
    connected_at: null,
    last_checked_at: new Date().toISOString(),
  });
}
