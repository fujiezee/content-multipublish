import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "文章编辑",
    template: "%s · 文章编辑",
  },
  description: "本机多平台文章发布：Playwright 同步 + 点物GEO 扩展分发",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full antialiased" suppressHydrationWarning>
        <Nav />
        <main className="shell py-8 pb-16">{children}</main>
      </body>
    </html>
  );
}
