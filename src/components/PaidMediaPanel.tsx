"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Article } from "@/lib/types";
import {
  PAID_MEDIA_CATEGORIES,
  formatYuan,
  type PaidMediaCategory,
  type PaidMediaSku,
  type PaidOrder,
} from "@/lib/paid-media";
import { useInfiniteList } from "@/components/useInfiniteList";

type Tab = "shop" | "orders";
type SortKey = "default" | "price" | "hours";

const ORDER_LABEL: Record<PaidOrder["status"], string> = {
  pending: "待履约",
  accepted: "已接单",
  published: "已出稿",
  failed: "失败",
  cancelled: "已取消",
};

const ORDER_BADGE: Record<PaidOrder["status"], string> = {
  pending: "badge-warn",
  accepted: "badge-run",
  published: "badge-ok",
  failed: "badge-danger",
  cancelled: "badge-muted",
};

function matchSku(sku: PaidMediaSku, query: string) {
  if (!query) return true;
  const hay = `${sku.name} ${sku.site} ${sku.note} ${sku.aiTags.join(" ")}`.toLowerCase();
  return hay.includes(query);
}

export function PaidMediaPanel() {
  const searchParams = useSearchParams();
  const presetArticle = searchParams.get("article") || "";
  const [tab, setTab] = useState<Tab>("shop");
  const [skus, setSkus] = useState<PaidMediaSku[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [category, setCategory] = useState<PaidMediaCategory | "all">("all");
  const [newsOnly, setNewsOnly] = useState(false);
  const [geoOnly, setGeoOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [cart, setCart] = useState<string[]>([]);
  const [articleId, setArticleId] = useState(presetArticle);
  const [articleQuery, setArticleQuery] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const fetchOrders = useCallback(async (offset: number, limit: number) => {
    const res = await fetch(
      `/api/paid-media?limit=${limit}&offset=${offset}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "加载失败");
    if (offset === 0) {
      setSkus((data.skus as PaidMediaSku[]) ?? []);
    }
    return {
      items: (data.orders as PaidOrder[]) ?? [],
      nextOffset: data.nextOffset ?? null,
      hasMore: Boolean(data.hasMore),
    };
  }, []);

  const {
    items: orders,
    booting: ordersBooting,
    reload: reloadOrders,
    sentinel: ordersSentinel,
  } = useInfiniteList<PaidOrder>(fetchOrders);

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
      return list[0]?.id || "";
    });
  }, [presetArticle]);

  useEffect(() => {
    void loadArticles().finally(() => setBootLoading(false));
  }, [loadArticles]);

  const loading = bootLoading || ordersBooting;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const rows = skus.filter((sku) => {
      if (category !== "all" && sku.category !== category) return false;
      if (newsOnly && !sku.newsSource) return false;
      if (geoOnly && !sku.geo) return false;
      return matchSku(sku, q);
    });
    if (sort === "price") {
      return [...rows].sort((a, b) => a.priceYuan - b.priceYuan);
    }
    if (sort === "hours") {
      return [...rows].sort((a, b) => a.hours - b.hours);
    }
    return rows;
  }, [skus, category, newsOnly, geoOnly, q, sort]);

  const picked = skus.filter((sku) => cart.includes(sku.id));
  const total = picked.reduce((sum, sku) => sum + sku.priceYuan, 0);
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
    if (!articleId) {
      setMessage("请先选一篇要发的文章");
      setCartOpen(true);
      return;
    }
    if (!cart.length) {
      setMessage("请先勾选媒体");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/paid-media/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, skuIds: cart, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "下单失败");
      setCart([]);
      setNote("");
      setTab("orders");
      setMessage(
        `已提交 ${picked.length} 家，合计 ${formatYuan((data.order as PaidOrder).total_yuan)}。出稿后回填链接。`,
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
          <h1>付费</h1>
          <p>
            选稿、勾媒体、下单。点物代发，出稿回填链接。只想看官网去
            <Link href="/media">媒体</Link>
            。
          </p>
        </div>
        <p className="media-dir__count">{skus.length} 个可代发</p>
      </header>

      <nav className="paid-media__tabs" aria-label="付费">
        <button
          type="button"
          className={tab === "shop" ? "paid-media__tab paid-media__tab--on" : "paid-media__tab"}
          onClick={() => setTab("shop")}
        >
          选媒体
        </button>
        <button
          type="button"
          className={tab === "orders" ? "paid-media__tab paid-media__tab--on" : "paid-media__tab"}
          onClick={() => setTab("orders")}
        >
          我的订单{orders.length ? `（${orders.length}）` : ""}
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
                placeholder="搜媒体名、站点，如 人民网、知乎"
                aria-label="搜索媒体"
              />
              <div className="paid-media__sort" role="group" aria-label="排序">
                {(
                  [
                    ["default", "默认"],
                    ["price", "价格"],
                    ["hours", "出稿快"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={sort === key ? "paid-media__sort-btn paid-media__sort-btn--on" : "paid-media__sort-btn"}
                    onClick={() => setSort(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <nav className="media-dir__chips" aria-label="媒体类型">
              <button
                type="button"
                className={category === "all" ? "media-dir__chip media-dir__chip--on" : "media-dir__chip"}
                onClick={() => setCategory("all")}
              >
                全部
                <span>{skus.filter((sku) => matchSku(sku, q)).length}</span>
              </button>
              {PAID_MEDIA_CATEGORIES.map((cat) => {
                const n = skus.filter(
                  (sku) =>
                    sku.category === cat.id &&
                    matchSku(sku, q) &&
                    (!newsOnly || sku.newsSource) &&
                    (!geoOnly || sku.geo),
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
            <nav className="paid-media__filters" aria-label="能力筛选">
              <button
                type="button"
                className={newsOnly ? "media-dir__chip media-dir__chip--on" : "media-dir__chip"}
                onClick={() => setNewsOnly((v) => !v)}
              >
                新闻源
              </button>
              <button
                type="button"
                className={geoOnly ? "media-dir__chip media-dir__chip--on" : "media-dir__chip"}
                onClick={() => setGeoOnly((v) => !v)}
              >
                可发 GEO
              </button>
            </nav>

            {loading ? (
              <p className="paid-cart__empty">正在加载货架…</p>
            ) : filtered.length === 0 ? (
              <p className="dash-empty">
                没有符合条件的媒体。
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setNewsOnly(false);
                    setGeoOnly(false);
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
                          <strong>{formatYuan(sku.priceYuan)}</strong>
                        </div>
                        <p className="paid-sku__note">{sku.note}</p>
                        <p className="paid-sku__meta">
                          约 {sku.hours} 小时
                          {sku.newsSource ? " · 新闻源" : ""}
                          {sku.geo ? " · GEO" : ""}
                        </p>
                        {sku.aiTags.length ? (
                          <p className="paid-sku__tags">{sku.aiTags.join(" · ")}</p>
                        ) : null}
                        <div className="paid-sku__actions">
                          <span className={on ? "paid-sku__pick paid-sku__pick--on" : "paid-sku__pick"}>
                            {on ? "已加入" : "加入清单"}
                          </span>
                          {sku.ownPlatformId ? (
                            <Link
                              href="/accounts"
                              className="paid-sku__own"
                              onClick={(e) => e.stopPropagation()}
                            >
                              有号可自己发
                            </Link>
                          ) : (
                            <a
                              href={sku.href}
                              target="_blank"
                              rel="noreferrer"
                              className="paid-sku__own"
                              onClick={(e) => e.stopPropagation()}
                            >
                              看官网
                            </a>
                          )}
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
                代发清单
                {picked.length ? ` · ${picked.length} 家` : ""}
              </span>
              <strong>{formatYuan(total)}</strong>
            </button>
            <div className="paid-cart__body">
              {picked.length ? (
                <ul>
                  {picked.map((sku) => (
                    <li key={sku.id}>
                      <span>{sku.name}</span>
                      <em>{formatYuan(sku.priceYuan)}</em>
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
                <p className="paid-cart__empty">点卡片加入，可多选。</p>
              )}

              <label>
                <span>用哪一篇</span>
                {selectedArticle ? (
                  <p className="paid-cart__picked">
                    <Link href={`/articles/${selectedArticle.id}`}>
                      {selectedArticle.title || "未命名文章"}
                    </Link>
                  </p>
                ) : (
                  <p className="paid-cart__empty">
                    还没有文章。
                    <Link href="/writing">去写一篇</Link>
                  </p>
                )}
                {articles.length > 1 ? (
                  <>
                    <input
                      className="field"
                      value={articleQuery}
                      onChange={(e) => setArticleQuery(e.target.value)}
                      placeholder="换一篇，搜标题"
                      aria-label="搜索要发布的文章"
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
                <span>备注（选发时间、署名等）</span>
                <input
                  className="field"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：工作日上午发，带公司署名"
                />
              </label>
              <div className="paid-cart__bar">
                <strong>合计 {formatYuan(total)}</strong>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !picked.length || !articleId}
                  onClick={() => void submit()}
                >
                  {busy
                    ? "提交中…"
                    : picked.length
                      ? `提交 ${picked.length} 家`
                      : "提交代发订单"}
                </button>
              </div>
              <p className="paid-cart__hint">本机先记账。收款以后接，现在下单即进入待履约。</p>
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="paid-orders">
          {!orders.length ? (
            <p className="dash-empty">
              还没有代发订单。
              <button type="button" className="btn btn-ghost" onClick={() => setTab("shop")}>
                去选媒体
              </button>
            </p>
          ) : (
            <>
            {orders.map((order) => (
              <article key={order.id} className="card paid-order">
                <div className="paid-order__head">
                  <div>
                    <h2>{order.article_title}</h2>
                    <p>
                      <span className={`badge ${ORDER_BADGE[order.status]}`}>
                        {ORDER_LABEL[order.status]}
                      </span>
                      <span>
                        {formatYuan(order.total_yuan)} ·{" "}
                        {new Date(order.created_at).toLocaleString("zh-CN", { hour12: false })}
                      </span>
                    </p>
                  </div>
                  <Link href={`/articles/${order.article_id}`}>看稿</Link>
                </div>
                <ul>
                  {order.items.map((item) => (
                    <li key={item.id}>
                      <span>{item.sku_name}</span>
                      <span>{formatYuan(item.price_yuan)}</span>
                      <span className={`badge ${ORDER_BADGE[item.status]}`}>
                        {ORDER_LABEL[item.status]}
                      </span>
                      {item.result_url ? (
                        <a href={item.result_url} target="_blank" rel="noreferrer">
                          出稿链接
                        </a>
                      ) : (
                        <span className="paid-order__wait">待出稿</span>
                      )}
                    </li>
                  ))}
                </ul>
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
