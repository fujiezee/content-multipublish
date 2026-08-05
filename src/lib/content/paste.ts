/**
 * Clean clipboard HTML from Word / 飞书 / 微信 / Google Docs so TipTap
 * keeps bold, italic, links, lists, headings and colors.
 */
export function cleanPastedHtml(html: string): string {
  if (!html.trim()) return html;

  // Prefer body fragment when full documents are pasted
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let fragment = bodyMatch ? bodyMatch[1] : html;

  // Drop Word / Office conditional comments and junk
  fragment = fragment
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(meta|link|xml|style|script|o:p)[^>]*>/gi, "")
    .replace(/<\/?w:[^>]*>/gi, "")
    .replace(/<\/?m:[^>]*>/gi, "");

  if (typeof DOMParser === "undefined") {
    return normalizeInlineTags(fragment);
  }

  const doc = new DOMParser().parseFromString(
    `<div id="__paste_root">${fragment}</div>`,
    "text/html",
  );
  const root = doc.getElementById("__paste_root");
  if (!root) return normalizeInlineTags(fragment);

  // Remove scripts/styles/comments left in tree
  root.querySelectorAll("script, style, meta, link, xml").forEach((el) => el.remove());

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toProcess: Element[] = [];
  while (walker.nextNode()) {
    toProcess.push(walker.currentNode as Element);
  }

  for (const el of toProcess) {
    const tag = el.tagName.toLowerCase();

    // Convert presentational tags / styles into semantic marks TipTap understands
    const style = el.getAttribute("style") || "";
    const weight = /font-weight\s*:\s*(bold|[5-9]00)/i.test(style);
    const italic = /font-style\s*:\s*italic/i.test(style);
    const underline = /text-decoration[^;]*underline/i.test(style);
    const strike = /text-decoration[^;]*line-through/i.test(style);
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    const bgMatch = style.match(
      /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i,
    );

    if (tag === "b" || tag === "strong" || weight) {
      wrapContents(el, "strong", doc);
    }
    if (tag === "i" || tag === "em" || italic) {
      wrapContents(el, "em", doc);
    }
    if (tag === "u" || underline) {
      wrapContents(el, "u", doc);
    }
    if (tag === "s" || tag === "strike" || tag === "del" || strike) {
      wrapContents(el, "s", doc);
    }

    if (colorMatch) {
      const color = normalizeColor(colorMatch[1]);
      if (color) {
        const span = doc.createElement("span");
        span.setAttribute("style", `color: ${color}`);
        moveChildren(el, span);
        el.appendChild(span);
      }
    }

    if (bgMatch) {
      const bg = normalizeColor(bgMatch[1]);
      if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
        const mark = doc.createElement("mark");
        mark.setAttribute("data-color", bg);
        mark.style.backgroundColor = bg;
        moveChildren(el, mark);
        el.appendChild(mark);
      }
    }

    // Headings: map h1 -> h2 for our schema
    if (tag === "h1") {
      const h2 = doc.createElement("h2");
      moveChildren(el, h2);
      el.replaceWith(h2);
      continue;
    }

    // Lists from Word sometimes use p + mso-list
    if (tag === "p" && /mso-list/i.test(style)) {
      // leave as paragraph; TipTap may still keep bold marks inside
    }

    // Strip class/id but keep href/src/alt/style(color only later via marks)
    if (!["a", "img"].includes(tag)) {
      el.removeAttribute("class");
      el.removeAttribute("id");
    }

    // Keep only useful attributes
    if (tag === "a") {
      const href = el.getAttribute("href");
      [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
      if (href) el.setAttribute("href", href);
    } else if (tag === "img") {
      const src = el.getAttribute("src");
      const alt = el.getAttribute("alt") || "";
      [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
      if (src) {
        el.setAttribute("src", src);
        el.setAttribute("alt", alt);
      } else {
        el.remove();
      }
    } else if (tag === "span") {
      // If span only carried styles we already converted, unwrap empty-attr spans later
      const keepStyle = el.getAttribute("style");
      [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
      if (keepStyle && /color\s*:/i.test(keepStyle)) {
        const color = keepStyle.match(/color\s*:\s*([^;]+)/i)?.[1];
        const c = color ? normalizeColor(color) : null;
        if (c) el.setAttribute("style", `color: ${c}`);
      }
    } else {
      el.removeAttribute("style");
    }
  }

  // Unwrap useless spans without attributes
  root.querySelectorAll("span").forEach((span) => {
    if (!span.attributes.length) {
      span.replaceWith(...Array.from(span.childNodes));
    }
  });

  // Convert divs to paragraphs when they look like blocks of text
  root.querySelectorAll("div").forEach((div) => {
    const hasBlock = div.querySelector(
      "p, h1, h2, h3, h4, ul, ol, table, blockquote, pre",
    );
    if (!hasBlock) {
      const p = doc.createElement("p");
      moveChildren(div, p);
      div.replaceWith(p);
    } else {
      div.replaceWith(...Array.from(div.childNodes));
    }
  });

  return root.innerHTML;
}

function wrapContents(el: Element, tagName: string, doc: Document) {
  // Avoid double-wrapping if already that tag
  if (el.tagName.toLowerCase() === tagName) return;
  if (
    el.childNodes.length === 1 &&
    el.firstChild instanceof Element &&
    (el.firstChild as Element).tagName.toLowerCase() === tagName
  ) {
    return;
  }
  const wrapper = doc.createElement(tagName);
  moveChildren(el, wrapper);
  el.appendChild(wrapper);
}

function moveChildren(from: Element, to: Element) {
  while (from.firstChild) to.appendChild(from.firstChild);
}

function normalizeColor(raw: string): string | null {
  const value = raw.trim().replace(/!important/gi, "").trim();
  if (!value || /^windowtext$/i.test(value)) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
  if (/^rgb(a)?\(/i.test(value)) return value;
  if (/^[a-z]+$/i.test(value)) return value;
  return null;
}

function normalizeInlineTags(html: string) {
  return html
    .replace(/<b(\s|>)/gi, "<strong$1")
    .replace(/<\/b>/gi, "</strong>")
    .replace(/<i(\s|>)/gi, "<em$1")
    .replace(/<\/i>/gi, "</em>");
}
