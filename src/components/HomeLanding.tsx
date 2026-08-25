import Link from "next/link";
import { HomeAuthLink } from "@/components/HomeAuthLink";
import { HomeProductSwitch } from "@/components/HomeProductSwitch";
import {
  BILLING_FOOTNOTE,
  FULFILLMENT_LANES,
  HOME_WALLET_PACKS,
  LICENSE_PLANS,
  PRODUCT_HOW,
  PRODUCT_LINE,
  PRODUCT_NAME,
  SITE_BRAND,
  USAGE_RATES,
  formatFen,
  formatYuan,
  walletCreditYuan,
  type LicensePlan,
} from "@/lib/billing/plans";

const ENGINES = [
  { name: "ChatGPT", region: "全球" },
  { name: "Gemini", region: "全球" },
  { name: "Claude", region: "全球" },
  { name: "Perplexity", region: "全球" },
  { name: "Grok", region: "全球" },
  { name: "豆包", region: "国内" },
  { name: "DeepSeek", region: "国内" },
  { name: "通义", region: "国内" },
  { name: "Kimi", region: "国内" },
  { name: "元宝", region: "国内" },
  { name: "文心", region: "国内" },
];

const MARKS = [
  { name: "品牌", hint: "别人问起时，答案里有你" },
  { name: "产品", hint: "别人问起时，能推荐到你" },
  { name: "成片", hint: "文章和视频都能做出来" },
  { name: "排名", hint: "能看到你排第几" },
];

const BELIEFS = [
  {
    name: "使命",
    title: "让人不受工具和寿命限制，一直能创造",
    hint: "机器人先把重复的事做完。人把时间拿去想、去做没做过的。人还在，创造就还在。",
  },
  {
    name: "愿景",
    title: "创造变成默认，局限变成例外",
    hint: "每个人身边有自己的机器人：会做事、会出场。人不用把一辈子耗在搬运和填表上。更远，生命本身也能拉长。那是方向，不是今天卖的东西。",
  },
];

const VALUES = [
  { name: "不局限", hint: "先问能不能做，不先问习不习惯。" },
  { name: "先创造", hint: "机器做完旧活。创造出来，才有人看见。" },
  { name: "你确认", hint: "机器动手，人不放手。" },
  { name: "可复测", hint: "做成没做成，要对得上。" },
  { name: "说得清", hint: "做成什么样，就说成什么样。" },
];

const SYSTEM = [
  {
    title: "写文章",
    body: "按你的资料写成文章，一篇能改成几个平台的版本。",
  },
  {
    title: "做视频",
    body: "同一篇文章能做成视频。你看过再用。",
  },
  {
    title: "自动发布",
    body: "做好了，能自动发到各平台。",
  },
  {
    title: "查排名",
    body: "能看到你在 ChatGPT、豆包、DeepSeek 里排第几。",
  },
];

const CAPABILITIES = [
  {
    kind: "写文章",
    hint: "网上能搜到你，AI 能提到你",
    items: ["按你的资料写", "一篇能改成几个平台的版本", "需要图，一起出"],
  },
  {
    kind: "做视频",
    hint: "短视频里也有你",
    items: ["同一篇能出播客、写成剧本", "再做成视频和歌曲", "你看完再决定用不用"],
  },
  {
    kind: "发出去",
    hint: "发出去，别人才问得到你",
    items: ["文章和视频都能发", "能自动发到各平台", "能看到你排第几"],
  },
];

const WHO = [
  {
    role: "自己做品牌的人",
    body: "希望别人搜到你，问 AI 时也能提到你。",
  },
  {
    role: "内容和市场小组",
    body: "一篇文章要发图文，还要出一条视频。",
  },
];

function planPrice(plan: LicensePlan) {
  if (plan.monthlyYuan === 0) {
    return { main: "免费", unit: "", sub: "先写一篇试试" };
  }
  if (plan.monthlyYuan == null) {
    return {
      main: "面议",
      unit: "",
      sub: plan.fromYuan ? `从 ${formatYuan(plan.fromYuan)} / 月` : "按你们的用量谈",
    };
  }
  return {
    main: formatYuan(plan.monthlyYuan),
    unit: "/ 月",
    sub: `年付 ${formatYuan(plan.yearlyYuan ?? 0)}，相当于 10 个月的价钱`,
  };
}

function quotaItems(plan: LicensePlan) {
  const q = plan.quotas;
  return [
    q.seats === "custom" ? "几个人用再谈" : `${q.seats} 人用`,
    q.articles === "unlimited" ? "写文章够用" : `能写 ${q.articles} 篇文章`,
    q.infographics === "custom" ? "配图再谈" : `能出 ${q.infographics} 张图`,
    q.mentions === "custom" ? "查排名再谈" : `能查 ${q.mentions} 次排名`,
    q.videoSeconds === 0
      ? "先不含做视频"
      : q.videoSeconds === "custom"
        ? "做视频再谈"
        : `能做 ${q.videoSeconds} 秒视频`,
  ];
}

export function HomeLanding() {
  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-wrap home-hero__intro">
          <p className="home-kicker">点物 · {PRODUCT_NAME}</p>
          <h1 className="home-headline">{PRODUCT_LINE}</h1>
          <p className="home-purpose">让每一件好产品，被世界看见。</p>
          <p className="home-sub">{PRODUCT_HOW}</p>
          <div className="home-actions">
            <HomeAuthLink href="/writing" className="btn home-actions__primary">
              免费试试
            </HomeAuthLink>
            <a href="#system" className="home-actions__ghost">
              看看能做什么
            </a>
          </div>
          <p className="home-hero__note">先免费写一篇试试</p>
        </div>
      </section>

      <section className="home-engines" aria-label="覆盖引擎">
        <div className="home-wrap home-engines__row">
          <p>别人常问这些 AI</p>
          <ul>
            {ENGINES.map((e) => (
              <li key={e.name}>
                {e.name}
                <span>{e.region}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-marks-band" aria-label="能得到什么">
        <ol className="home-wrap home-marks">
          {MARKS.map((item, index) => (
            <li key={item.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.name}</strong>
              <p>{item.hint}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-band" id="mission" aria-labelledby="home-mission-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <p className="home-eyebrow">点物要去的地方</p>
            <h2 id="home-mission-title">让人一直能创造</h2>
            <p>鼓励人创新、创造，不要先给自己画框。时间够用，创造才停得晚。</p>
          </div>
          <ol className="home-marks home-marks--2">
            {BELIEFS.map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <strong>{item.title}</strong>
                <p>{item.hint}</p>
              </li>
            ))}
          </ol>
          <ol className="home-marks home-marks--5">
            {VALUES.map((item, index) => (
              <li key={item.name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.name}</strong>
                <p>{item.hint}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-band home-band--paper" id="system" aria-labelledby="home-sys-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <p className="home-eyebrow">能力</p>
            <h2 id="home-sys-title">能做什么</h2>
            <p>写文章，做视频，自动发布，查排名。</p>
          </div>
          <ol className="home-outcomes">
            {SYSTEM.map((item, index) => (
              <li key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-band" id="flow" aria-labelledby="home-flow-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <p className="home-eyebrow">路径</p>
            <h2 id="home-flow-title">怎么用</h2>
            <p>
              从
              <Link href="/writing">写文章</Link>
              开始。
            </p>
          </div>
          <HomeProductSwitch />
        </div>
      </section>

      <section className="home-band home-band--paper" id="capabilities" aria-labelledby="home-cap-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <p className="home-eyebrow">能力</p>
            <h2 id="home-cap-title">你能得到什么</h2>
            <p>别人问起时，答案里有你。还能看到排第几。</p>
          </div>
          <ul className="home-cover">
            {CAPABILITIES.map((col) => (
              <li key={col.kind}>
                <p className="home-cover__kind">{col.kind}</p>
                <p className="home-cover__hint">{col.hint}</p>
                <ul>
                  {col.items.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-band" id="who" aria-labelledby="home-who-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <p className="home-eyebrow">对象</p>
            <h2 id="home-who-title">适合谁</h2>
            <p>适合自己做内容的人。</p>
          </div>
          <ul className="home-who">
            {WHO.map((item) => (
              <li key={item.role}>
                <h3>{item.role}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-band home-band--paper" id="plans" aria-labelledby="home-plans-title">
        <div className="home-wrap">
          <div className="home-section-head">
            <p className="home-eyebrow">方案</p>
            <h2 id="home-plans-title">选一个方案，不够再充</h2>
            <p>买的不是接口。买的是能写、能拍、能发、能看到排名。小白用，也能做出专家那一套。</p>
          </div>

          <p className="home-layer-label">方案</p>
          <ul className="home-plans__list">
            {LICENSE_PLANS.map((plan) => {
              const price = planPrice(plan);
              return (
                <li
                  key={plan.id}
                  className={plan.featured ? "home-plan home-plan--featured" : "home-plan"}
                >
                  {plan.featured ? <p className="home-plan__flag">一个人就能做完</p> : null}
                  <h3>{plan.name}</h3>
                  <p className="home-plan__for">{plan.forWho}</p>
                  <p className="home-plan__amount">
                    <strong>{price.main}</strong>
                    {price.unit ? <span>{price.unit}</span> : null}
                  </p>
                  <p className="home-plan__year">{price.sub}</p>
                  <ul className="home-plan__points">
                    {quotaItems(plan).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                    {plan.points.slice(0, 3).map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  <HomeAuthLink href={plan.ctaHref} className="btn home-plan__cta">
                    {plan.ctaLabel}
                  </HomeAuthLink>
                </li>
              );
            })}
          </ul>

          <p className="home-layer-label">不够用再充余额</p>
          <p className="home-packs-rate">
            配图 {formatFen(USAGE_RATES.images.fen)}/张 · 视频{" "}
            {formatFen(USAGE_RATES.videoSeconds.fen)}/秒 · 查排名{" "}
            {formatFen(USAGE_RATES.mentions.fen)}/次。充得越多送得越多。
          </p>
          <ul className="home-packs">
            {HOME_WALLET_PACKS.map((pack) => {
              return (
                <li key={pack.id}>
                  <span>充 {formatYuan(pack.payYuan)}</span>
                  <strong>到账 {formatYuan(walletCreditYuan(pack))}</strong>
                  <em>{pack.bonusPct > 0 ? `送${pack.bonusPct}%` : "无折扣"}</em>
                </li>
              );
            })}
          </ul>

          <p className="home-layer-label">找人发、投广告，另算</p>
          <ul className="home-fulfill">
            {FULFILLMENT_LANES.map((lane) => (
              <li key={lane.id}>
                <Link href={lane.href}>
                  <h3>{lane.name}</h3>
                  <p>{lane.body}</p>
                  <span>看价格</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="home-plans__note">{BILLING_FOOTNOTE}</p>
        </div>
      </section>

      <section className="home-close" aria-labelledby="home-close-title">
        <div className="home-wrap home-close__inner">
          <h2 id="home-close-title">让你的品牌被世界看到</h2>
          <p>先创造，才有人看见。先免费写一篇试试。</p>
          <HomeAuthLink href="/writing" className="btn home-actions__primary">
            免费试试
          </HomeAuthLink>
        </div>
      </section>

      <footer className="home-foot">
        <div className="home-wrap home-foot__grid">
          <div>
            <p className="home-foot__brand">{SITE_BRAND}</p>
            <p>
              {PRODUCT_NAME}。{PRODUCT_LINE}
            </p>
          </div>
          <div>
            <p>做内容</p>
            <Link href="/writing">写文章</Link>
            <Link href="/scripts">写剧本</Link>
            <Link href="/videos">做视频</Link>
          </div>
          <div>
            <p>怎么用</p>
            <a href="#mission">点物要去的地方</a>
            <a href="#flow">路径</a>
            <Link href="/mentions">查排名</Link>
          </div>
          <div>
            <p>收费</p>
            <a href="#plans">套餐</a>
            <Link href="/settings">装扩展</Link>
            <a href="https://dianwu.ai" target="_blank" rel="noreferrer">
              dianwu.ai
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
