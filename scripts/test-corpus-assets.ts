import {
  formatCorpusAssetsBlock,
  insertCorpusAssetsIntoHtml,
  parseCorpusAssets,
} from "../src/lib/corpus-assets";
import type { CorpusItem } from "../src/lib/types";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const parsed = parseCorpusAssets([
  { url: "/api/uploads/a.jpg", caption: "后台待发货列表", kind: "screenshot" },
  { url: "", caption: "空图" },
]);
assert(parsed.length === 1, "empty url dropped");
assert(parsed[0].caption === "后台待发货列表", "caption kept");

const item: CorpusItem = {
  id: "c1",
  title: "发货后台",
  category: "product",
  tags: "",
  content: "超时单会标红",
  assets: parsed,
  created_at: "",
  updated_at: "",
};

const md = formatCorpusAssetsBlock(item, "markdown");
assert(md.includes("![后台待发货列表](/api/uploads/a.jpg)"), "markdown url");

const html = insertCorpusAssetsIntoHtml(
  "<p>仓库里超时单会标红，运营要先处理。</p><p>结尾。</p>",
  [item],
);
assert(html.includes('src="/api/uploads/a.jpg"'), "image inserted");
assert(html.includes("后台待发货列表"), "caption inserted");
assert(
  html.indexOf("/api/uploads/a.jpg") < html.indexOf("结尾"),
  "placed near matching paragraph",
);

const already = insertCorpusAssetsIntoHtml(
  '<p>已有<img src="/api/uploads/a.jpg" alt="x"></p>',
  [item],
);
assert(
  already.split("/api/uploads/a.jpg").length === 2,
  "do not duplicate existing url",
);

console.log("ok");
