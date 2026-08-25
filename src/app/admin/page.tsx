import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";

export const metadata: Metadata = {
  title: "后台",
};

export default function AdminPage() {
  return <AdminShell />;
}
