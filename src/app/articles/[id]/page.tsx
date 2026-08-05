import { ArticleEditor } from "@/components/ArticleEditor";

type Props = { params: Promise<{ id: string }> };

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  return <ArticleEditor id={id} />;
}
