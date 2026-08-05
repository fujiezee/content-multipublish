import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "点物GEO 文章多平台同步助手",
  description: "本机多平台文章发布：Playwright 同步 + 点物GEO 扩展分发",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full antialiased">
        <Nav />
        <main className="shell py-8 pb-16">{children}</main>
      </body>
    </html>
  );
}
