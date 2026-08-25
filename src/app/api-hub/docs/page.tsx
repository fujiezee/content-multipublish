import type { Metadata } from "next";
import { ApiDocsPanel } from "@/components/ApiDocsPanel";

export const metadata: Metadata = {
  title: "API 文档",
};

export default function ApiDocsPage() {
  return <ApiDocsPanel />;
}
