import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";
import { PRODUCT_NAME, SITE_BRAND } from "@/lib/billing/plans";
import "./globals.css";

const SITE_TITLE = `点物 · ${PRODUCT_NAME}`;

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_BRAND}`,
  },
  description:
    "点物 · AI智能内容营销系统。写文章、做视频，拿去发。别人问起你时，答案里有你。覆盖豆包、DeepSeek，发完能看 AI 搜索排第几。",
  applicationName: SITE_BRAND,
  icons: {
    icon: [{ url: "/file.svg", type: "image/svg+xml" }],
    shortcut: "/file.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full antialiased" suppressHydrationWarning>
        <ServiceWorkerCleanup />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
