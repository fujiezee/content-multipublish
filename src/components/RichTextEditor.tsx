"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import { cleanPastedHtml } from "@/lib/content/paste";
import {
  containsMarkdownTable,
  markdownToHtml,
} from "@/lib/content/markdown";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

export type RichTextEditorHandle = {
  insertImage: (src: string, alt?: string) => void;
  focus: () => void;
  getHTML: () => string;
  flushChange: () => string;
};

function ToolbarButton({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
        active
          ? "bg-[var(--accent)] text-[#f5faf8]"
          : "text-[var(--ink)] hover:bg-[var(--bg-deep)]"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(
  function RichTextEditor(
    { value, onChange, placeholder = "开始写作…" },
    ref,
  ) {
    const lastEmitted = useRef(value);
    const editorRef = useRef<Editor | null>(null);
    const onChangeRef = useRef(onChange);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    onChangeRef.current = onChange;

    const emitChange = (html: string, immediate = false) => {
      lastEmitted.current = html;
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      if (immediate) {
        onChangeRef.current(html);
        return;
      }
      // Large AI drafts re-render the whole article page; batch parent updates.
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        onChangeRef.current(html);
      }, 160);
    };

    useEffect(() => {
      return () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
      };
    }, []);

    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Underline,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        Placeholder.configure({ placeholder }),
        Image.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              "data-infographic": {
                default: null,
                parseHTML: (element) =>
                  element.getAttribute("data-infographic"),
                renderHTML: (attributes) =>
                  attributes["data-infographic"]
                    ? { "data-infographic": attributes["data-infographic"] }
                    : {},
              },
              "data-article-cover": {
                default: null,
                parseHTML: (element) =>
                  element.getAttribute("data-article-cover"),
                renderHTML: (attributes) =>
                  attributes["data-article-cover"]
                    ? { "data-article-cover": attributes["data-article-cover"] }
                    : {},
              },
              "data-corpus-asset": {
                default: null,
                parseHTML: (element) =>
                  element.getAttribute("data-corpus-asset"),
                renderHTML: (attributes) =>
                  attributes["data-corpus-asset"]
                    ? { "data-corpus-asset": attributes["data-corpus-asset"] }
                    : {},
              },
              style: {
                default: null,
                parseHTML: (element) => element.getAttribute("style"),
                renderHTML: (attributes) =>
                  attributes.style ? { style: attributes.style } : {},
              },
            };
          },
        }).configure({
          allowBase64: true,
          inline: false,
        }),
        TableKit.configure({
          table: { resizable: true },
        }),
      ],
      content: value || "",
      editorProps: {
        attributes: {
          class:
            "rich-editor tiptap min-h-[380px] px-4 py-3 outline-none focus:outline-none",
        },
        transformPastedHTML(html) {
          return cleanPastedHtml(html);
        },
        handlePaste(_view, event) {
          const clipboard = event.clipboardData;
          if (!clipboard) return false;

          const ed = editorRef.current;
          if (!ed) return false;

          const html = clipboard.getData("text/html");
          const text = clipboard.getData("text/plain");

          if (html?.trim()) {
            event.preventDefault();
            ed.commands.insertContent(cleanPastedHtml(html), {
              parseOptions: { preserveWhitespace: "full" },
            });
            return true;
          }

          if (text?.trim() && containsMarkdownTable(text)) {
            event.preventDefault();
            ed.commands.insertContent(markdownToHtml(text), {
              parseOptions: { preserveWhitespace: "full" },
            });
            return true;
          }

          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        emitChange(ed.getHTML(), false);
      },
    });

    useEffect(() => {
      editorRef.current = editor;
    }, [editor]);

    useEffect(() => {
      if (!editor) return;
      if ((value || "") === lastEmitted.current) return;
      editor.commands.setContent(value || "", { emitUpdate: false });
      lastEmitted.current = value || "";
    }, [editor, value]);

    useImperativeHandle(
      ref,
      () => ({
        insertImage(src: string, alt?: string) {
          const ed = editorRef.current;
          if (!ed) return;
          ed.chain()
            .focus()
            .setImage({ src, alt: alt || undefined })
            .run();
        },
        focus() {
          editorRef.current?.chain().focus().run();
        },
        getHTML() {
          return editorRef.current?.getHTML() ?? lastEmitted.current ?? "";
        },
        flushChange() {
          const html = editorRef.current?.getHTML() ?? lastEmitted.current ?? "";
          emitChange(html, true);
          return html;
        },
      }),
      [],
    );

    async function uploadImage(file: File) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (data.url) {
        editorRef.current?.chain().focus().setImage({ src: data.url }).run();
      }
    }

    if (!editor) {
      return (
        <div className="field min-h-[420px] text-[var(--muted)]">
          编辑器加载中…
        </div>
      );
    }

    return (
      <div className="overflow-hidden rounded-[12px] border border-[var(--line)] bg-[#fffdf9]">
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-2 py-1.5">
          <ToolbarButton
            title="加粗"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            title="斜体"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            title="下划线"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <span className="underline">U</span>
          </ToolbarButton>
          <ToolbarButton
            title="删除线"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <s>S</s>
          </ToolbarButton>
          <label
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-[var(--bg-deep)]"
            title="文字颜色"
          >
            <span>A</span>
            <input
              type="color"
              className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
              onInput={(e) =>
                editor
                  .chain()
                  .focus()
                  .setColor((e.target as HTMLInputElement).value)
                  .run()
              }
            />
          </label>
          <ToolbarButton
            title="清除颜色"
            onClick={() => editor.chain().focus().unsetColor().run()}
          >
            无色
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <ToolbarButton
            title="一级标题"
            active={editor.isActive("heading", { level: 1 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            title="二级标题"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            title="三级标题"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            H3
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <ToolbarButton
            title="无序列表"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            • 列表
          </ToolbarButton>
          <ToolbarButton
            title="有序列表"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1. 列表
          </ToolbarButton>
          <ToolbarButton
            title="引用"
            active={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            引用
          </ToolbarButton>
          <ToolbarButton
            title="分割线"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            —
          </ToolbarButton>
          <ToolbarButton
            title="插入表格"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            表格
          </ToolbarButton>
          {editor.isActive("table") && (
            <>
              <ToolbarButton
                title="删除表格"
                onClick={() => editor.chain().focus().deleteTable().run()}
              >
                删表
              </ToolbarButton>
              <ToolbarButton
                title="在下方插入行"
                onClick={() => editor.chain().focus().addRowAfter().run()}
              >
                +行
              </ToolbarButton>
              <ToolbarButton
                title="在右侧插入列"
                onClick={() => editor.chain().focus().addColumnAfter().run()}
              >
                +列
              </ToolbarButton>
            </>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <ToolbarButton
            title="插入链接"
            active={editor.isActive("link")}
            onClick={() => {
              const prev = editor.getAttributes("link").href as
                | string
                | undefined;
              const url = window.prompt("链接地址", prev || "https://");
              if (url === null) return;
              if (url === "") {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                return;
              }
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url })
                .run();
            }}
          >
            链接
          </ToolbarButton>
          <label className="cursor-pointer rounded-md px-2.5 py-1 text-sm hover:bg-[var(--bg-deep)]">
            图片
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
                e.target.value = "";
              }}
            />
          </label>
          <ToolbarButton
            title="清除格式"
            onClick={() =>
              editor
                .chain()
                .focus()
                .unsetAllMarks()
                .unsetColor()
                .clearNodes()
                .run()
            }
          >
            清除
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} />
      </div>
    );
  },
);
