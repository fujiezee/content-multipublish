import type { Metadata } from "next";
import { PlanPanel } from "@/components/PlanPanel";

export const metadata: Metadata = {
  title: "费用",
};

export default function PlanPage() {
  return <PlanPanel />;
}
