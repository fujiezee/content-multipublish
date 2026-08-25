"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Article } from "@/lib/types";
import {
  PAID_AD_CATEGORIES,
  formatYuan,
  type PaidAdCategory,
  type PaidAdOrder,
  type PaidAdSku,
} from "@/lib/paid-ads";
import { useInfiniteList } from "@/components/useInfiniteList";

type Tab = "shop" | "orders";

const ORDER_LABEL: Record<PaidAdOrder["status"], string> = {
  pending: "待开户",
  accepted: "已开户",
  published: "投放中",
  failed: "失败",
  cancelled: "已取消",
};

const ORDER_BADGE: Record<PaidAdOrder["status"], string> = {
  pending: "badge-warn",
  accepted: "badge-run",
  published: "badge-ok",
  failed: "badge-danger",
  cancelled: "badge-muted",
};

function matchSku(sku: PaidAdSku, query: string) {
  if (!query) return true;
  const hay = `${sku.name} ${sku.site} ${sku.note} ${sku.cpcHint}`.toLowerCase();
  return hay.includes(query);
}

export function PaidAdsPanel() {
  const searchParams = useSearchParams();
  const presetArticle = searchParams.get("article") || "";
  const [tab, setTab] = useState<Tab>("shop");
  const [skus, setSkus] = useState<PaidAdSku[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [category, setCategory] = useState<PaidAdCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<string[]>([]);
  const [articleId, setArticleId] = useState(presetArticle);
  const [articleQuery, setArticleQuery] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const fetchOrders = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(
      `/api/paid-ads?limit=${limit}&offset=${offset}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载失败");
    if (offset === 0) {
      setSkus((data.skus as PaidAdSku[]) ?? []);
    }
    return {
      items: (data.orders as PaidAdOrder[]) ?? [],
      nextOffset: data.nextOffset ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items: orders,
    booting: ordersBooting,
    reload: reloadOrders,
    sentinel: ordersSentinel,
  } = useInfiniteList<PaidAdOrder>(fetchOrders);

  const loadArticles = useCallback(async () => {
    const arts = await fetch("/api/articles?limit=50&offset=0", {
      cache: "no-store",
    }).then((r) => r.json());
    const list = (arts.articles as Article[]) ?? [];
    setArticles(list);
    setArticleId((prev) => {
      if (prev && list.some((a) => a.id === prev)) return prev;
      if (presetArticle && list.some((a) => a.id === presetArticle)) {
        return presetArticle;
      }
      return prev;
    });
  }, [presetArticle]);

  useEffect(() => {
    void loadArticles().finally(() => setBootLoading(false));
  }, [loadArticles]);

  const loading = bootLoading || ordersBooting;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      skus.filter((sku) => {
        if (category !== "all" && sku.category !== category) return false;
        return matchSku(sku, q);
      }),
    [skus, category, q],
  );

  const picked = skus.filter((sku) => cart.includes(sku.id));
  const total = picked.reduce((sum, sku) => sum + sku.serviceYuan, 0);
  const dailyTotal = picked.reduce((sum, sku) => sum + sku.dailyYuan, 0);
  const selectedArticle = articles.find((a) => a.id === articleId) ?? null;
  const articleChoices = useMemo(() => {
    const needle = articleQuery.trim().toLowerCase();
    return [...articles]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .filter((a) => !needle || (a.title || "未命名文章").toLowerCase().includes(needle))
      .slice(0, 8);
  }, [articles, articleQuery]);

  function toggle(id: string) {
    setCart((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (!cart.length) {
      setMessage("请先勾选要投的平台");
      return;
    }
    if (!articleId && !landingUrl.trim() && !note.trim()) {
      setMessage("请选一篇文章，或留下落地页 / 投放说明");
      setCartOpen(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/paid-ads/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          articleId,
          landingUrl,
          skuIds: cart,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "下单失败");
      setCart([]);
      setNote("");
      setTab("orders");
      setMessage(
        `已提交 ${picked.length} 个平台，代投 ${formatYuan((data.order as PaidAdOrder).total_yuan)} / 月。平台消耗另付。`,
      );
      await reloadOrders();
      await loadArticles();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "下单失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paid-media">
      <header className="media-dir__head">
        <div>
          <h1>营销</h1>
          <p>
            帮忙投到百度、Google、抖音、快手等。卡片上的价是点物代投服务费 / 月。广告消耗付给平台，按建议日预算另充。
          </p>
        </div>
        <p className="media-dir__count">{skus.length} 个渠道</p>
      </header>

      <nav className="paid-media__tabs" aria-label="营销">
        <button
          type="button"
          className={tab === "shop" ? "paid-media__tab paid-media__tab--on" : "paid-media__tab"}
          onClick={() => setTab("shop")}
        >
          选渠道
        </button>
        <button
          type="button"
          className={tab === "orders" ? "paid-media__tab paid-media__tab--on" : "paid-media__tab"}
          onClick={() => setTab("orders")}
        >
          我的投放{orders.length ? `（${orders.length}）` : ""}
        </button>
      </nav>

      {message ? <p className="paid-media__msg">{message}</p> : null}

      {tab === "shop" ? (
        <div className="paid-media__shop">
          <div className="paid-media__catalog">
            <div className="paid-media__tools">
              <input
                className="field paid-media__search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜渠道，如 百度、抖音、Google"
                aria-label="搜索投放渠道"
              />
            </div>
            <nav className="media-dir__chips" aria-label="投放类型">
              <button
                type="button"
                className={category === "all" ? "media-dir__chip media-dir__chip--on" : "media-dir__chip"}
                onClick={() => setCategory("all")}
              >
                全部
                <span>{skus.filter((sku) => matchSku(sku, q)).length}</span>
              </button>
              {PAID_AD_CATEGORIES.map((cat) => {
                const n = skus.filter(
                  (sku) => sku.category === cat.id && matchSku(sku, q),
                ).length;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={
                      category === cat.id
                        ? "media-dir__chip media-dir__chip--on"
                        : "media-dir__chip"
                    }
                    onClick={() => setCategory(cat.id)}
                  >
                    {cat.label}
                    <span>{n}</span>
                  </button>
                );
              })}
            </nav>

            {loading ? (
              <p className="paid-cart__empty">正在加载渠道…</p>
            ) : filtered.length === 0 ? (
              <p className="dash-empty">
                没有符合条件的渠道。
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                  }}
                >
                  清除筛选
                </button>
              </p>
            ) : (
              <ul className="paid-media__grid">
                {filtered.map((sku) => {
                  const on = cart.includes(sku.id);
                  return (
                    <li
                      key={sku.id}
                      className={on ? "card paid-sku paid-sku--on" : "card paid-sku"}
                      onClick={() => toggle(sku.id)}
                    >
                      <div className="paid-sku__top">
                        <div>
                          <h2>{sku.name}</h2>
                          <p className="paid-sku__site">{sku.site}</p>
                        </div>
                        <strong>{formatYuan(sku.serviceYuan)}<span className="paid-ads__unit">/月</span></strong>
                      </div>
                      <p className="paid-sku__note">{sku.note}</p>
                      <p className="paid-sku__meta">
                        建议日消耗 {formatYuan(sku.dailyYuan)} · 首充约 {formatYuan(sku.rechargeYuan)} · {sku.days} 天内开户
                      </p>
                      <p className="paid-sku__tags">{sku.cpcHint}</p>
                      <div className="paid-sku__actions">
                        <span className={on ? "paid-sku__pick paid-sku__pick--on" : "paid-sku__pick"}>
                          {on ? "已加入" : "加入清单"}
                        </span>
                        <a
                          href={sku.href}
                          target="_blank"
                          rel="noreferrer"
                          className="paid-sku__own"
                          onClick={(e) => e.stopPropagation()}
                        >
                          看后台
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className={cartOpen ? "card paid-cart" : "card paid-cart paid-cart--collapsed"}>
            <button
              type="button"
              className="paid-cart__toggle"
              onClick={() => setCartOpen((v) => !v)}
            >
              <span>
                投放清单
                {picked.length ? ` · ${picked.length} 个` : ""}
              </span>
              <strong>{formatYuan(total)}</strong>
            </button>
            <div className="paid-cart__body">
              {picked.length ? (
                <ul>
                  {picked.map((sku) => (
                    <li key={sku.id}>
                      <span>{sku.name}</span>
                      <em>{formatYuan(sku.serviceYuan)}</em>
                      <button
                        type="button"
                        className="paid-cart__remove"
                        onClick={() => toggle(sku.id)}
                        aria-label={`去掉 ${sku.name}`}
                      >
                        去掉
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="paid-cart__empty">点卡片加入。可多选。</p>
              )}
              {picked.length ? (
                <p className="paid-cart__hint">
                  代投 {formatYuan(total)} / 月。建议每天再给平台 {formatYuan(dailyTotal)} 消耗。
                </p>
              ) : null}

              <label>
                <span>用哪一篇当素材（可选）</span>
                {selectedArticle ? (
                  <p className="paid-cart__picked">
                    <Link href={`/articles/${selectedArticle.id}`}>
                      {selectedArticle.title || "未命名文章"}
                    </Link>
                    <button
                      type="button"
                      className="paid-cart__remove"
                      onClick={() => setArticleId("")}
                    >
                      不绑文章
                    </button>
                  </p>
                ) : (
                  <p className="paid-cart__empty">可以不选，改填落地页。</p>
                )}
                {articles.length ? (
                  <>
                    <input
                      className="field"
                      value={articleQuery}
                      onChange={(e) => setArticleQuery(e.target.value)}
                      placeholder="搜文章标题"
                      aria-label="搜索要投放的文章"
                    />
                    <ul className="paid-cart__articles">
                      {articleChoices.map((article) => (
                        <li key={article.id}>
                          <button
                            type="button"
                            className={
                              article.id === articleId
                                ? "paid-cart__article paid-cart__article--on"
                                : "paid-cart__article"
                            }
                            onClick={() => {
                              setArticleId(article.id);
                              setArticleQuery("");
                            }}
                          >
                            {article.title || "未命名文章"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </label>
              <label>
                <span>落地页（可选）</span>
                <input
                  className="field"
                  value={landingUrl}
                  onChange={(e) => setLandingUrl(e.target.value)}
                  placeholder="https:// 官网、表单或商品页"
                />
              </label>
              <label>
                <span>投放说明</span>
                <input
                  className="field"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：投上海，要表单线索，预算先测两周"
                />
              </label>
              <div className="paid-cart__bar">
                <strong>代投 {formatYuan(total)} / 月</strong>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !picked.length}
                  onClick={() => void submit()}
                >
                  {busy
                    ? "提交中…"
                    : picked.length
                      ? `提交 ${picked.length} 个渠道`
                      : "提交投放"}
                </button>
              </div>
              <p className="paid-cart__hint">
                标价只含代投。开户资质、预存和每天消耗走平台，收款以后接。
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="paid-orders">
          {!orders.length ? (
            <p className="dash-empty">
              还没有投放单。
              <button type="button" className="btn btn-ghost" onClick={() => setTab("shop")}>
                去选渠道
              </button>
            </p>
          ) : (
            <>
            {orders.map((order) => (
              <article key={order.id} className="card paid-order">
                <div className="paid-order__head">
                  <div>
                    <h2>
                      {order.article_title ||
                        (order.landing_url ? "落地页投放" : "投放意向")}
                    </h2>
                    <p>
                      <span className={`badge ${ORDER_BADGE[order.status]}`}>
                        {ORDER_LABEL[order.status]}
                      </span>
                      <span>
                        代投 {formatYuan(order.total_yuan)} / 月 ·{" "}
                        {new Date(order.created_at).toLocaleString("zh-CN", { hour12: false })}
                      </span>
                    </p>
                  </div>
                  {order.article_id ? (
                    <Link href={`/articles/${order.article_id}`}>看稿</Link>
                  ) : null}
                </div>
                <ul>
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.sku_name}</span>
                      <span>{formatYuan(item.price_yuan)} / 月</span>
                      <span className={`badge ${ORDER_BADGE[item.status]}`}>
                        {ORDER_LABEL[item.status]}
                      </span>
                    </li>
                  ))}
                </ul>
                {order.landing_url ? (
                  <p className="paid-order__note">
                    落地页{" "}
                    <a href={order.landing_url} target="_blank" rel="noreferrer">
                      {order.landing_url}
                    </a>
                  </p>
                ) : null}
                {order.note ? <p className="paid-order__note">{order.note}</p> : null}
              </article>
            ))}
            {ordersSentinel}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
