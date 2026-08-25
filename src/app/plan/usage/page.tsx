import type { Metadata } from "next";
import { UsagePanel } from "@/components/UsagePanel";

export const metadata: Metadata = {
  title: "消耗记录",
};

export default function PlanUsagePage() {
  return <UsagePanel />;
}
