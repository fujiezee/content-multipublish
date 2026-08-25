import type { Metadata } from "next";
import { MentionPanel } from "@/components/MentionPanel";

export const metadata: Metadata = {
  title: "查排名",
};

export default function MentionsPage() {
  return <MentionPanel />;
}
