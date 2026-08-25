import { chatCompletion, streamChatCompletion } from "@/lib/ai/deepseek";

export type DistilledWriter = {
  name: string;
  hint: string;
  instruction: string;
};

const MIN_INSTRUCTION = 1200;
const MAX_INSTRUCTION = 16000;

function distillModel(): string {
  return (
    process.env.DEEPSEEK_REASONING_MODEL?.trim() ||
    process.env.DEEPSEEK_STREAM_MODEL?.trim() ||
    "deepseek-reasoner"
  );
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] || raw).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function lineValue(raw: string, keys: string[]): string {
  for (const key of keys) {
    const match = raw.match(new RegExp(`^${key}[:：]\\s*(.+)$`, "im"));
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

function stripMeta(raw: string): string {
  return raw
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^名称[:：].+$/im, "")
    .replace(/^name[:：].+$/im, "")
    .replace(/^标签[:：].+$/im, "")
    .replace(/^hint[:：].+$/im, "")
    .replace(/^提示词[:：]\s*/im, "")
    .replace(/^instruction[:：]\s*/im, "")
    .trim();
}

function parseDistilled(raw: string, seed: string): DistilledWriter {
  const json = extractJsonObject(raw);
  if (json) {
    const name =
      (typeof json.name === "string" && json.name.trim()) || seed.slice(0, 16);
    const hint =
      (typeof json.hint === "string" && json.hint.trim()) || "自定义写手";
    const instruction =
      typeof json.instruction === "string" ? json.instruction.trim() : "";
    if (instruction.length >= MIN_INSTRUCTION) {
      return {
        name: name.slice(0, 16),
        hint: hint.slice(0, 24),
        instruction: instruction.slice(0, MAX_INSTRUCTION),
      };
    }
  }

  const name =
    lineValue(raw, ["名称", "name"]) || seed.slice(0, 16);
  const hint = lineValue(raw, ["标签", "hint"]) || "自定义写手";
  const marked = raw.split(/^(?:提示词|instruction)[:：]\s*$/im)[1];
  const instruction = (marked ? marked.trim() : stripMeta(raw)).slice(
    0,
    MAX_INSTRUCTION,
  );
  return {
    name: name.slice(0, 16),
    hint: hint.slice(0, 24),
    instruction,
  };
}

function fallbackInstruction(seed: string): string {
  const who = seed.trim().slice(0, 32) || "这位写手";
  return `你是「${who}」风格写手 Agent。只学公开表达的气质、节奏和判断方式，必须用中文输出。
写稿时读完本提示词后直接输出正文，禁止把下面栏目在思考里再过一遍。

# 身份
- 你是文案执笔，不是${who}本人，不要自称是${who}，不要用第一人称冒充。
- 不要编造${who}的语录、访谈、生平、公司数据或客户案例。
- 气质学对方，事实必须来自用户给的语料。语料没有的品牌、数字、案例一律不写。

# 怎么想
- 先拆到第一性：这件事的物理/商业约束是什么，再谈包装。
- 先给判断，再给理由。不要先客套再绕到观点。
- 能用工程或生意语言说清的，不用鸡汤。

# 开篇
任选一类钩子，必须具体：
1) 原则断言：一句话说破约束；
2) 反常识：大家以为 X，真正卡点是 Y；
3) 代价：不做的后果，落在一件真事上；
4) 范围：先说这文不解决什么，再进入正题。

# 节奏
- 短句为主，单句可成段。一层意思一段。
- 少形容词，多动词和约束条件。
- 排版留白，少 emoji，少感叹号堆叠。

# 用词
- 可用：约束、路径、迭代、代价、窗口、第一性、做成。
- 禁用：赋能、助力、全面升级、闭环生态、抓手、颗粒度（空用时）。

# 结构
判断 → 拆约束 → 给路径（3 步以内）→ 收束成一句可执行的下一步。
标题要具体、有判断，不要公文题。

# 收束
- 给下一步动作，不要「值得关注」「一起加油」。
- 最后一句回扣开篇判断。

# 禁止
- 硬广催单、限时折扣、加微留资。
- 编造语料里没有的公司名、官网、数据、客户。`;
}

const DISTILL_SYSTEM = `你是写手 Agent 蒸馏器。用户给一个人物或风格种子，你要写出一份以后每次写文都会整段注入的系统提示词。

不要写人物传记，不要抄语录，不要编造生平、采访或数据。只蒸馏公开表达里可观察的写法。

必须写完整。instruction 是给另一个文案模型用的完整系统提示词，不是摘要，不是 8 条要点。中文正文不少于 1500 字，建议 1800–2800 字。宁可写满，不要收成提纲。

按下面栏目写满，每栏都要有可执行细则（句式、正反例、禁用词），不要空口号：

1) 身份与边界：学气质、不扮演本人、不编语录
2) 思考方式：对方怎么下判断、先想什么后想什么
3) 开篇钩子：至少 4 类，每类给 2 个可套用的中文句式（不要真语录）
4) 句子与段落：长短、断句、一段几句、何时单句成段
5) 用词表：至少 12 个可用词/说法 + 至少 12 个禁用套话
6) 结构模板：长文 / 短帖 / 产品说明 各写一套「开头-中段-收束」
7) 标题习惯：怎么起题，给 4 个题型，并写反面（什么题不要起）
8) 修辞招式：类比、反问、原则句、删削、列表等，各写怎么用、什么时候不用
9) 情感与态度：锋利到什么程度，幽默怎么用，对读者的关系
10) 事实锁：品牌/数据/案例只许用语料；配图只许用语料给定 URL，禁止编造 /public/ 或占位图
11) 自检清单：给执笔者心里过的 8–10 条。必须写明：写稿时不要在思考过程里逐条输出核对，读完气质直接写正文。
12) 风格样例：写 2 段「像这样就对」和 1 段「像这样就不对」的示范正文（主题自拟，不要冒充原话）

提示词开头第二句必须是：「写稿时读完本提示词后直接输出正文，禁止把下面栏目在思考里再过一遍。」

输出格式严格如下，不要 JSON，不要代码块围栏：
名称: （2–12字）
标签: （12字以内气质）
提示词:
（从这里开始是完整系统提示词，第一句必须是「你是「名字」风格写手 Agent。…必须用中文输出。」然后按上面 12 栏写满。）`;

export type DistillStreamEvent =
  | { type: "meta"; model: string }
  | { type: "thinking"; delta: string }
  | { type: "content"; delta: string }
  | { type: "status"; message: string }
  | { type: "done"; result: DistilledWriter };

function normalizeSeed(seed: string): string {
  const who = seed.replace(/\s+/g, " ").trim();
  if (who.length < 2) {
    throw new Error("写个名字或一句话，比如司马生");
  }
  if (who.length > 80) {
    throw new Error("写手短一点，80 字以内");
  }
  return who;
}

function distillMessages(who: string) {
  return [
    { role: "system" as const, content: DISTILL_SYSTEM },
    {
      role: "user" as const,
      content: `要蒸馏的写手：${who}
name 尽量用用户说的名字（中文优先）。
提示词必须完整可直接当系统提示词用，不要缩成要点列表。`,
    },
  ];
}

function finishDistill(raw: string, who: string): DistilledWriter {
  const out = parseDistilled(raw, who);
  if (out.instruction.length < 200) {
    return {
      name: out.name || who.slice(0, 16),
      hint: out.hint || "自定义写手",
      instruction: fallbackInstruction(who),
    };
  }
  return out;
}

export async function* streamDistillWriterAgent(
  seed: string,
  options?: { signal?: AbortSignal },
): AsyncGenerator<DistillStreamEvent> {
  const who = normalizeSeed(seed);
  const model = distillModel();
  yield { type: "meta", model };

  const messages = distillMessages(who);
  let raw = "";
  for await (const chunk of streamChatCompletion(messages, {
    model,
    temperature: 0.4,
    maxTokens: 8192,
    timeoutMs: 180_000,
    signal: options?.signal,
  })) {
    if (chunk.type === "thinking") {
      yield { type: "thinking", delta: chunk.text };
    } else if (chunk.type === "content") {
      raw += chunk.text;
      yield { type: "content", delta: chunk.text };
    }
  }

  let out = parseDistilled(raw, who);
  if (out.instruction.length < MIN_INSTRUCTION) {
    yield { type: "status", message: "提示词还是提纲，正在按栏目写满…" };
    yield { type: "content", delta: "\n\n——补全——\n\n" };
    let more = "";
    for await (const chunk of streamChatCompletion(
      [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            "上一版太短，只是提纲。按 12 个栏目把提示词写满，至少 1500 字。从「名称:」重新输出完整三块，不要解释。",
        },
      ],
      {
        model,
        temperature: 0.35,
        maxTokens: 8192,
        timeoutMs: 180_000,
        signal: options?.signal,
      },
    )) {
      if (chunk.type === "thinking") {
        yield { type: "thinking", delta: chunk.text };
      } else if (chunk.type === "content") {
        more += chunk.text;
        yield { type: "content", delta: chunk.text };
      }
    }
    if (more.trim()) raw = more;
    out = parseDistilled(raw, who);
  }

  yield { type: "done", result: finishDistill(raw, who) };
}

export async function distillWriterAgent(seed: string): Promise<DistilledWriter> {
  const who = normalizeSeed(seed);
  const messages = distillMessages(who);
  let raw = await chatCompletion(messages, {
    model: distillModel(),
    temperature: 0.4,
    maxTokens: 8192,
    timeoutMs: 180_000,
  });
  let out = parseDistilled(raw, who);
  if (out.instruction.length < MIN_INSTRUCTION) {
    raw = await chatCompletion(
      [
        ...messages,
        { role: "assistant" as const, content: raw },
        {
          role: "user" as const,
          content:
            "上一版太短，只是提纲。按 12 个栏目把提示词写满，至少 1500 字。从「名称:」重新输出完整三块，不要解释。",
        },
      ],
      {
        model: distillModel(),
        temperature: 0.35,
        maxTokens: 8192,
        timeoutMs: 180_000,
      },
    );
    out = parseDistilled(raw, who);
  }
  return finishDistill(raw, who);
}
