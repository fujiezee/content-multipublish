import { ArticleEditorClient } from "./ArticleEditorClient";

type Props = { params: Promise<{ id: string }> };

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  return <ArticleEditorClient id={id} />;
}
