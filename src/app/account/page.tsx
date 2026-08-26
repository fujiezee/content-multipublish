import type { Metadata } from "next";
import { AccountPanel } from "@/components/AccountPanel";

export const metadata: Metadata = {
  title: "账号",
};

export default function AccountPage() {
  return <AccountPanel />;
}
