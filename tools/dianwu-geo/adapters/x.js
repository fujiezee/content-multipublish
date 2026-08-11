/**
 * X (Twitter) — 扩展同步
 *
 * 登录：auth_token + ct0
 * 写入：优先在已打开的 x.com 标签页内发 GraphQL CreateTweet（可带上页面 transaction-id）；
 *       失败再尝试 SW 直连。X 无中文号那种草稿箱，成功即为发帖。
 */
import { getCookieValue } from "./_cookie.js";

const BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

/** fallback queryId — drifts; page scrape preferred */
const FALLBACK_CREATE_TWEET_ID = "7TKRKCPuAGsmYde0CudbVg";

const CREATE_TWEET_FEATURES = {
  articles_preview_enabled: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  creator_subscriptions_quote_tweet_preview_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  posts_with_replies_disabled_backend: false,
  premium_content_api_read_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_grok_analysis_button_from_backend: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_jetfuel_frame: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  rweb_video_screen_enabled: false,
  standardized_nudges_misinfo: true,
  tweet_awards_web_tipping_enabled: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
  view_counts_everywhere_api_enabled: true,
};

/**
 * @param {new (...args: unknown[]) => import('../types').PlatformAdapterLike} BaseAdapter
 */
export function createXAdapter(BaseAdapter) {
  return class XAdapter extends BaseAdapter {
    meta = {
      id: "x",
      name: "X",
      icon: "https://abs.twimg.com/favicons/twitter.3.ico",
      homepage: "https://x.com/compose/post",
      capabilities: ["article", "draft"],
    };

    /** @type {{ userId: string; username: string; avatar?: string } | null} */
    account = null;

    htmlToText(html) {
      return String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n")
        .replace(/<li>/gi, "• ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    buildTweetText(title, html) {
      const body = this.htmlToText(html);
      const t = String(title || "").trim();
      let text = t ? `${t}\n\n${body}` : body;
      // note_tweet / long posts: keep generous limit; hard cap for safety
      if (text.length > 25000) text = `${text.slice(0, 24900)}\n…`;
      return text;
    }

    async getTokens() {
      const authToken = await getCookieValue(
        this.runtime,
        [".x.com", "x.com", ".twitter.com", "twitter.com"],
        "auth_token",
        ["https://x.com/", "https://twitter.com/"],
      );
      const ct0 = await getCookieValue(
        this.runtime,
        [".x.com", "x.com", ".twitter.com", "twitter.com"],
        "ct0",
        ["https://x.com/", "https://twitter.com/"],
      );
      if (!authToken || !ct0) {
        throw new Error("未检测到 X 登录（需要 auth_token 与 ct0），请先在 Chrome 打开 x.com 登录");
      }
      return { authToken, ct0 };
    }

    apiHeaders(ct0) {
      return {
        Authorization: BEARER,
        "Content-Type": "application/json",
        "X-Csrf-Token": ct0,
        "X-Twitter-Auth-Type": "OAuth2Session",
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "en",
        Accept: "*/*",
        Referer: "https://x.com/",
        Origin: "https://x.com",
      };
    }

    async checkAuth() {
      try {
        const { ct0 } = await this.getTokens();
        const response = await this.runtime.fetch(
          "https://api.x.com/1.1/account/verify_credentials.json",
          {
            credentials: "include",
            headers: this.apiHeaders(ct0),
          },
        );
        if (!response.ok) {
          return { isAuthenticated: false, error: "未登录或会话已过期" };
        }
        const data = await response.json();
        if (!data?.id_str && !data?.id) {
          return { isAuthenticated: false, error: "未登录" };
        }
        this.account = {
          userId: String(data.id_str || data.id),
          username: data.screen_name || data.name || String(data.id_str),
          avatar: data.profile_image_url_https || data.profile_image_url,
        };
        return {
          isAuthenticated: true,
          userId: this.account.userId,
          username: this.account.username,
          avatar: this.account.avatar,
        };
      } catch (error) {
        return {
          isAuthenticated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    waitTabComplete(tabId, timeoutMs = 20_000) {
      return new Promise((resolve) => {
        const onUpdated = (id, info) => {
          if (id !== tabId) return;
          if (info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId, (tab) => {
          if (tab?.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        });
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }, timeoutMs);
      });
    }

    async resolveCreateTweetQueryId() {
      try {
        const html = await (
          await this.runtime.fetch("https://x.com/", {
            credentials: "include",
            headers: { Accept: "text/html" },
          })
        ).text();
        const scriptUrls = [
          ...html.matchAll(
            /src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"]+\.js)"/g,
          ),
        ].map((m) => m[1]);
        for (const url of scriptUrls.slice(0, 12)) {
          try {
            const js = await (await this.runtime.fetch(url)).text();
            const m = js.match(
              /queryId:"([A-Za-z0-9_-]+)",operationName:"CreateTweet"/,
            );
            if (m?.[1]) return m[1];
            const m2 = js.match(
              /operationName:"CreateTweet",[^}]*queryId:"([A-Za-z0-9_-]+)"/,
            );
            if (m2?.[1]) return m2[1];
          } catch {
            // next
          }
        }
      } catch {
        // ignore
      }
      return FALLBACK_CREATE_TWEET_ID;
    }

    extractStatus(data) {
      const result =
        data?.data?.create_tweet?.tweet_results?.result ||
        data?.data?.CreateTweet?.tweet_results?.result;
      const legacy = result?.legacy || result?.tweet?.legacy;
      const id = legacy?.id_str || result?.rest_id;
      const user =
        result?.core?.user_results?.result?.legacy?.screen_name ||
        this.account?.username;
      if (!id) return null;
      return {
        postId: String(id),
        postUrl: user
          ? `https://x.com/${user}/status/${id}`
          : `https://x.com/i/status/${id}`,
      };
    }

    async createTweetViaFetch(text, queryId, ct0) {
      const path = `/i/api/graphql/${queryId}/CreateTweet`;
      const body = {
        variables: {
          tweet_text: text,
          dark_request: false,
          media: { media_entities: [], possibly_sensitive: false },
          semantic_annotation_ids: [],
          ...(text.length > 280
            ? {
                /* long-form: client may ignore if not entitled */
              }
            : {}),
        },
        features: CREATE_TWEET_FEATURES,
        queryId,
      };
      const response = await this.runtime.fetch(`https://x.com${path}`, {
        method: "POST",
        credentials: "include",
        headers: this.apiHeaders(ct0),
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
      const extracted = data ? this.extractStatus(data) : null;
      if (extracted) return { ok: true, ...extracted };
      const err =
        data?.errors?.[0]?.message ||
        data?.errors?.[0]?.extensions?.name ||
        (response.ok ? "CreateTweet 无结果" : `HTTP ${response.status}`) ||
        raw.slice(0, 160);
      return { ok: false, error: err };
    }

    async createTweetInTab(text, queryId) {
      if (
        typeof chrome === "undefined" ||
        !chrome.tabs?.query ||
        !chrome.scripting?.executeScript
      ) {
        return { ok: false, error: "无 tabs/scripting 权限" };
      }

      let createdId = null;
      try {
        const tabs = await chrome.tabs.query({
          url: ["*://x.com/*", "*://twitter.com/*"],
        });
        let tab = tabs[0];
        if (!tab?.id) {
          tab = await chrome.tabs.create({
            url: "https://x.com/home",
            active: false,
          });
          createdId = tab.id;
          await this.waitTabComplete(tab.id);
          await new Promise((r) => setTimeout(r, 1200));
        }

        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (payload) => {
            const { text, queryId, bearer, features } = payload;
            const ct0 = document.cookie.match(/(?:^|; )ct0=([^;]+)/)?.[1];
            if (!ct0) return { ok: false, error: "页面无 ct0" };
            const path = `/i/api/graphql/${queryId}/CreateTweet`;
            const headers = {
              Authorization: bearer,
              "Content-Type": "application/json",
              "X-Csrf-Token": decodeURIComponent(ct0),
              "X-Twitter-Auth-Type": "OAuth2Session",
              "X-Twitter-Active-User": "yes",
              Accept: "*/*",
            };
            // best-effort transaction id if page exposes generator
            try {
              const gen =
                window.__SCRIPTS_LOADED__ ||
                window.__NEXT_DATA__ ||
                null;
              void gen;
            } catch {
              // ignore
            }
            const res = await fetch(`https://x.com${path}`, {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({
                variables: {
                  tweet_text: text,
                  dark_request: false,
                  media: { media_entities: [], possibly_sensitive: false },
                  semantic_annotation_ids: [],
                },
                features,
                queryId,
              }),
            });
            const data = await res.json().catch(() => null);
            const result =
              data?.data?.create_tweet?.tweet_results?.result ||
              data?.data?.CreateTweet?.tweet_results?.result;
            const legacy = result?.legacy || result?.tweet?.legacy;
            const id = legacy?.id_str || result?.rest_id;
            const user =
              result?.core?.user_results?.result?.legacy?.screen_name;
            if (id) {
              return {
                ok: true,
                postId: String(id),
                postUrl: user
                  ? `https://x.com/${user}/status/${id}`
                  : `https://x.com/i/status/${id}`,
              };
            }
            return {
              ok: false,
              error:
                data?.errors?.[0]?.message ||
                `HTTP ${res.status}` ||
                "CreateTweet 失败",
            };
          },
          args: [
            {
              text,
              queryId,
              bearer: BEARER,
              features: CREATE_TWEET_FEATURES,
            },
          ],
        });

        return result || { ok: false, error: "标签页执行无结果" };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (createdId != null) {
          chrome.tabs.remove(createdId).catch(() => undefined);
        }
      }
    }

    async publish(article, options) {
      try {
        const auth = await this.checkAuth();
        if (!auth.isAuthenticated) throw new Error(auth.error || "未登录 X");

        const { ct0 } = await this.getTokens();
        const title = String(article.title || "").trim().slice(0, 100);
        const html = article.html || article.markdown || "";
        const text = this.buildTweetText(title, html);
        if (!text) throw new Error("正文为空");

        const queryId = await this.resolveCreateTweetQueryId();

        // Prefer page-context (cookies + fewer bot checks)
        let result = await this.createTweetInTab(text, queryId);
        if (!result.ok) {
          result = await this.createTweetViaFetch(text, queryId, ct0);
        }

        if (!result.ok) {
          throw new Error(
            result.error ||
              "发帖失败（可能需要 x-client-transaction-id；请先打开 x.com 再同步，或改用本机自动）",
          );
        }

        return this.createResult(true, {
          postId: result.postId,
          postUrl: result.postUrl,
          // X 同步即发帖，非草稿箱
          draftOnly: false,
          message: "已发到 X（无独立草稿箱）",
        });
      } catch (error) {
        return this.createResult(false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}
