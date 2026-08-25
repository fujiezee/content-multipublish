import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmailScreen } from "@/components/VerifyEmailScreen";

export const metadata: Metadata = {
  title: "激活邮箱",
};

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyEmailScreen />
    </Suspense>
  );
}
