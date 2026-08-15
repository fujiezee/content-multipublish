import { ScriptWorkspace } from "@/components/ScriptWorkspace";

type Props = { params: Promise<{ articleId: string }> };

export default async function ScriptPage({ params }: Props) {
  const { articleId } = await params;
  return <ScriptWorkspace articleId={articleId} />;
}
