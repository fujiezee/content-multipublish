import type { Metadata } from "next";
import { MediaDirectory } from "@/components/MediaDirectory";

export const metadata: Metadata = {
  title: "媒体",
  description: "黄页、媒体号、新闻网站等出处导航。方便打开官网查看。",
};

export default function MediaPage() {
  return <MediaDirectory />;
}
