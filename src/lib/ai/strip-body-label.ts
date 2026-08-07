/** Remove accidental「正文:」label from model output. */
export function stripBodyLabel(text: string) {
  return text
    .replace(/^((?:标题|摘要)[:：][^\n]*\n)+\s*正文[:：]\s*\n?/im, (block) =>
      block.replace(/\n\s*正文[:：]\s*\n?$/i, "\n"),
    )
    .replace(/^正文[:：]\s*\n?/im, "")
    .replace(/\n正文[:：]\s*\n/g, "\n")
    .replace(/^正文[:：]\s*(.+)$/im, "$1")
    .trim();
}
