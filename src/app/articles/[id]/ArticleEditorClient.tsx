"use client";

import dynamic from "next/dynamic";
import { ArticleEditorSkeleton } from "@/components/ArticleEditorSkeleton";

const ArticleEditor = dynamic(
  () =>
    import("@/components/ArticleEditor").then((mod) => ({
      default: mod.ArticleEditor,
    })),
  {
    ssr: false,
    loading: () => <ArticleEditorSkeleton />,
  },
);

export function ArticleEditorClient({ id }: { id: string }) {
  return <ArticleEditor id={id} />;
}
