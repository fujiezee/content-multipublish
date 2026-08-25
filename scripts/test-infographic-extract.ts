import { cardFromSection } from "../src/lib/ai/infographic";
import {
  eligibleInfographicSections,
  extractInfographicImgs,
  insertInfographicsIntoHtml,
  listArticleSections,
  mergeInfographicHtml,
  splitSentences,
  unwrapInfographicParagraphs,
} from "../src/lib/ai/infographic-insert";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function sentenceParagraphs(n: number, prefix = "方法") {
  return Array.from({ length: n }, (_, i) => {
    const no = i + 1;
    return `<p>${prefix}第${no}步要把问题写清楚，不能只丢一个词。</p>`;
  }).join("");
}

function main() {
  const twelve = sentenceParagraphs(12);
  const sections = listArticleSections(twelve);
  assert(
    sections.length >= 2 && sections.length <= 3,
    `12 句应按整节切开，不能 12 节：${sections.map((s) => s.id + ":" + s.sentences.length).join(",")}`,
  );
  assert(
    sections.every((s) => s.sentences.length >= 5 && s.sentences.length <= 7),
    `每节应是 5–7 句：${sections.map((s) => s.sentences.length).join(",")}`,
  );
  assert(
    eligibleInfographicSections(sections).length === sections.length,
    "没有旧图时，整节都应可配图",
  );
  console.log("PASS 12 句切成整节，不是一句一节");

  const first = sections[0];
  const card = cardFromSection(first, 0);
  assert(card?.items && card.items.length >= 5 && card.items.length <= 7, "卡片必须 5–7 条");
  assert(
    card?.items?.every((item) => /[。！？；]/.test(item) && item.length >= 16),
    `卡片条目必须是完整句子：${card?.items?.join(" | ")}`,
  );
  assert(card?.anchorText === first.anchorText, "锚点必须落在这一节最后一句");
  console.log("PASS 一节一张卡，5–7 条要点");

  const withImage = `${sentenceParagraphs(6, "旧")}<img src="/old.png" alt="旧图" data-infographic="1">${sentenceParagraphs(6, "新")}`;
  const mixed = listArticleSections(withImage);
  const illustrated = mixed.filter((s) => s.illustrated);
  const open = eligibleInfographicSections(mixed);
  assert(illustrated.length === 1, `旧图前的节应标已配图：${JSON.stringify(mixed.map((s) => [s.id, s.illustrated, s.sentences.length]))}`);
  assert(open.length === 1 && open[0].text.includes("新第"), "再生成只能抽尚未配图的后半节");
  console.log("PASS 已有图的节会排除，只留未配图整节");

  const placed = insertInfographicsIntoHtml(twelve, [
    {
      url: "/a.png",
      alt: "第一节",
      anchorText: first.anchorText,
      insertHint: card?.insertHint,
    },
  ]);
  const imgAt = placed.indexOf('src="/a.png"');
  const lastOfFirst = first.anchorText.slice(0, 12);
  const lastPos = placed.indexOf(lastOfFirst);
  assert(imgAt > lastPos && lastPos >= 0, "图必须插在该节最后一句后面");
  const beforeImg = placed.slice(0, imgAt);
  const firstSentenceHits = beforeImg.split("方法第1步").length - 1;
  const imgs = placed.match(/data-infographic/g) || [];
  assert(imgs.length === 1, `只能插一张，不能一句一张：${imgs.length}`);
  assert(
    /<img\b[^>]*data-infographic="1"[^>]*src="\/a\.png"/.test(placed) ||
      /<img\b[^>]*src="\/a\.png"[^>]*data-infographic="1"/.test(placed),
    "信息图必须是带 data-infographic 的独立 img，不能包进段落",
  );
  assert(firstSentenceHits === 1, "第一节开头仍在图前");
  console.log("PASS 插图在整节后，不会一句一张");

  const firstPlaced = insertInfographicsIntoHtml(twelve, [
    { url: "/a.png", alt: "第一节", anchorText: first.anchorText },
  ]);
  const secondPlaced = insertInfographicsIntoHtml(firstPlaced, [
    { url: "/a.png", alt: "第一节", anchorText: first.anchorText },
    { url: "/b.png", alt: "第二节", anchorText: sections[1]?.anchorText },
  ]);
  const secondImgs = extractInfographicImgs(secondPlaced);
  assert(
    secondImgs.length === 2 &&
      secondImgs.some((img) => img.url === "/a.png") &&
      secondImgs.some((img) => img.url === "/b.png"),
    `第二张应追加且不重复第一张：${secondImgs.map((img) => img.url).join(",")}`,
  );
  console.log("PASS 第二张追加时保留第一张，不重复插入");

  const wrapped =
    '<p><img src="/a.png" alt="第一节" data-infographic="1"></p><p>后文还在。</p>';
  const unwrapped = unwrapInfographicParagraphs(wrapped);
  assert(
    !/<p[^>]*>\s*<img\b[^>]*data-infographic/i.test(unwrapped),
    "信息图不能包在段落里交给编辑器",
  );
  assert(
    extractInfographicImgs(unwrapped).some((img) => img.url === "/a.png"),
    "拆段落后信息图还在",
  );
  const merged = mergeInfographicHtml(
    firstPlaced,
    insertInfographicsIntoHtml(twelve, [
      { url: "/b.png", alt: "第二节", anchorText: sections[1]?.anchorText },
    ]),
  );
  assert(
    extractInfographicImgs(merged).length === 2,
    `保存旧正文时不能丢掉另一张：${extractInfographicImgs(merged).map((img) => img.url).join(",")}`,
  );
  console.log("PASS 段落包裹可拆开，两张图合并不会丢");

  const stripped = twelve;
  const restored = insertInfographicsIntoHtml(stripped, [
    { url: "/a.png", alt: "第一节", anchorText: first.anchorText },
  ]);
  assert(extractInfographicImgs(restored).length === 1, "补插缺失的信息图");
  console.log("PASS 正文缺图时可按记录补回");

  const short = "<p>太短了。</p><p>还是短。</p>";
  assert(
    eligibleInfographicSections(listArticleSections(short)).length === 0,
    "不足 5 句的过渡段不能单独配图",
  );
  assert(
    splitSentences("先改对外说法再核对出处。再把官网和引用对上。最后才决定这一节要不要配图。")
      .length === 3,
    "按句切开",
  );
  console.log("PASS 短过渡段不配图");

  console.log("ALL INFOGRAPHIC EXTRACT TESTS PASSED");
}

main();
