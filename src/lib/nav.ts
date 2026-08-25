export const APP_NAV_GROUPS = [
  {
    id: "home",
    label: "工作台",
    items: [
      { href: "/dashboard", label: "总览", icon: "overview" },
      { href: "/plan", label: "费用", icon: "plan" },
      { href: "/api-hub", label: "API", icon: "api" },
      { href: "/settings", label: "工作区", icon: "workspace" },
    ],
  },
  {
    id: "factory",
    label: "内容工厂",
    items: [
      { href: "/corpus", label: "语料", icon: "corpus" },
      { href: "/keywords", label: "挖词", icon: "mine" },
      { href: "/writing", label: "写手", icon: "write" },
      { href: "/articles", label: "文章", icon: "article" },
      { href: "/podcasts", label: "播客", icon: "podcast" },
      { href: "/scripts", label: "剧本", icon: "script" },
      { href: "/characters", label: "角色", icon: "character" },
      { href: "/voices", label: "音色", icon: "voice" },
      { href: "/videos", label: "视频", icon: "video" },
      { href: "/music", label: "音乐", icon: "music" },
    ],
  },
  {
    id: "ship",
    label: "投放",
    items: [
      { href: "/accounts", label: "自有号", icon: "account" },
      { href: "/media", label: "媒体", icon: "media" },
      { href: "/paid", label: "付费", icon: "paid" },
      { href: "/ads", label: "营销", icon: "ads" },
      { href: "/jobs", label: "同步", icon: "sync" },
    ],
  },
  {
    id: "effect",
    label: "效果",
    items: [{ href: "/mentions", label: "查排名", icon: "mention" }],
  },
] as const;

export const APP_NAV_ADMIN = {
  id: "admin",
  label: "管理",
  items: [{ href: "/admin", label: "后台", icon: "admin" as const }],
} as const;

export type AppNavIcon =
  | (typeof APP_NAV_GROUPS)[number]["items"][number]["icon"]
  | (typeof APP_NAV_ADMIN)["items"][number]["icon"];

export const MARKETING_NAV = [
  { href: "#flow", label: "怎么用" },
  { href: "#capabilities", label: "能做什么" },
  { href: "#plans", label: "价格" },
] as const;

export function navActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
