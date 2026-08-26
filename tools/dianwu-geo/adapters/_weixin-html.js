const TAG_STYLES = {
  p: "color: rgb(51, 51, 51); font-size: 15px; line-height: 1.75em; margin: 1.12em 0;",
  h1: "font-weight: bold; font-size: 1.25em; line-height: 1.4em; margin: 1.2em 0 0.6em;",
  h2: "font-weight: bold; font-size: 1.125em; margin: 1.1em 0 0.5em;",
  h3: "font-weight: bold; font-size: 1.05em; margin: 1em 0 0.5em;",
  h4: "font-weight: bold; font-size: 1em; margin: 1em 0;",
  h5: "font-weight: bold; font-size: 1em; margin: 1em 0;",
  h6: "font-weight: bold; font-size: 1em; margin: 1em 0;",
  li: "color: rgb(51, 51, 51); font-size: 15px; line-height: 1.75em;",
  blockquote:
    "margin: 1em 40px; color: rgb(89, 89, 89); border-left: 4px solid #e5e5e5; padding-left: 12px;",
  pre: "white-space: pre; font-family: monospace; font-size: 13px; background: #f6f6f6; padding: 12px; overflow: auto;",
  code: "font-family: monospace; font-size: 0.92em;",
  em: "font-style: italic;",
  i: "font-style: italic;",
  strong: "font-weight: bolder;",
  b: "font-weight: bolder;",
  img: "max-width: 100%; height: auto; display: block; margin: 0.8em auto;",
  a: "color: #576b95;",
};

function mergeInlineStyle(openTag, extra) {
  if (!extra) return openTag;
  if (/\sstyle\s*=/i.test(openTag)) {
    return openTag.replace(
      /\sstyle\s*=\s*(["'])(.*?)\1/i,
      (_, q, prev) => ` style=${q}${prev}; ${extra}${q}`,
    );
  }
  return openTag.replace(/>$/, ` style="${extra}">`);
}

/** WeChat stores inline styles; class/CSS from the editor is dropped. */
export function styleWeixinHtml(html) {
  let out = String(html || "");
  out = out.replace(
    /<(p|h[1-6]|li|blockquote|pre|code|em|i|strong|b|img|a)(\s[^>]*)?>/gi,
    (full, name) => {
      const style = TAG_STYLES[name.toLowerCase()];
      return mergeInlineStyle(full, style || "");
    },
  );
  if (!/^<section[\s>]/i.test(out.trim())) {
    out = `<section style="margin-left: 6px; margin-right: 6px; line-height: 1.75em;">${out}</section>`;
  }
  return out;
}
