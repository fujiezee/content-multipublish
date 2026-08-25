import type { Metadata } from "next";
import { ApiHubPanel } from "@/components/ApiHubPanel";

export const metadata: Metadata = {
  title: "API",
};

export default function ApiHubPage() {
  return <ApiHubPanel />;
}
