import type { Metadata } from "next";
import { DashboardPanel } from "@/components/DashboardPanel";

export const metadata: Metadata = {
  title: "总览",
};

export default function DashboardPage() {
  return <DashboardPanel />;
}
