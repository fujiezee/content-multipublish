import type { Metadata } from "next";
import { HomeLanding } from "@/components/HomeLanding";
import { PRODUCT_HOW, PRODUCT_LINE, PRODUCT_NAME, SITE_BRAND } from "@/lib/billing/plans";

const SITE_TITLE = `点物 · ${PRODUCT_NAME}`;
const SITE_DESCRIPTION = `${SITE_TITLE}。${PRODUCT_HOW}。${PRODUCT_LINE}。覆盖豆包、DeepSeek，发完能看 AI 搜索排第几。`;

export const metadata: Metadata = {
  title: {
    absolute: SITE_TITLE,
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "点物",
    "AI智能内容营销系统",
    "GEO",
    "AI搜索优化",
    "内容营销",
    "AI写稿",
    "短视频",
    "多平台发布",
    "豆包",
    "DeepSeek",
    "查排名",
  ],
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "zh_CN",
    type: "website",
    siteName: SITE_BRAND,
  },
};

export default function HomePage() {
  return <HomeLanding />;
}
