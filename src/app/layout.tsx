import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "内容分发",
  description: "一文多发：微博 · 百家号 · 知乎",
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
