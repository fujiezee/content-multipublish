import { styleWeixinHtml } from "../tools/dianwu-geo/adapters/_weixin-html.js";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function main() {
  const raw =
    "<h2>小节</h2><p>正文<strong>加粗</strong>。</p><img src=\"https://cdn.dianwu.ai/files/a.png\" alt=\"图\">";
  const out = styleWeixinHtml(raw);
  assert(/<section style=/.test(out), "应包一层公众号 section");
  assert(/<h2[^>]*style="[^"]*font-weight: bold/.test(out), "标题要带字重");
  assert(/<p[^>]*style="[^"]*font-size: 15px/.test(out), "段落要带字号行高");
  assert(/<strong[^>]*style="[^"]*font-weight/.test(out), "加粗不能丢样式");
  assert(/<img[^>]*style="[^"]*max-width: 100%/.test(out), "图片要自适应");
  const again = styleWeixinHtml(out);
  assert(
    (again.match(/<section /g) || []).length === 1,
    "不要套两层 section",
  );
  console.log("PASS weixin html keeps inline styles");
}

main();
