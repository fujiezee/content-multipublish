/**
 * OpenAI 兼容层：/v1/models、/v1/chat/completions
 */
import {
  gatewayListModels,
  gatewayTextComplete,
  gatewayTextStream,
  parseGatewayMessages,
} from "@/lib/ai/gateway";

export function openaiCompatBase(publicBase: string) {
  return `${publicBase.replace(/\/$/, "")}/v1`;
}

export function listOpenAiModels() {
  const created = Math.floor(Date.now() / 1000);
  return {
    object: "list" as const,
    data: gatewayListModels({ modality: "text", readyOnly: true }).map((m) => ({
      id: m.slug,
      object: "model" as const,
      created,
      owned_by: m.provider || "dianwu",
    })),
  };
}

export function parseOpenAiChatBody(body: unknown) {
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const model =
    typeof record.model === "string" ? record.model.trim() : "";
  const messages = parseGatewayMessages(record.messages);
  const stream = record.stream === true;
  const temperature =
    typeof record.temperature === "number" ? record.temperature : undefined;
  const maxTokens =
    typeof record.max_tokens === "number"
      ? record.max_tokens
      : typeof record.maxTokens === "number"
        ? record.maxTokens
        : undefined;
  return { model, messages, stream, temperature, maxTokens };
}

function chatId() {
  return `chatcmpl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function openAiChatComplete(input: {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
}) {
  const text = await gatewayTextComplete(input.model, input.messages, {
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  });
  const id = chatId();
  const created = Math.floor(Date.now() / 1000);
  return {
    id,
    object: "chat.completion" as const,
    created,
    model: input.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: text },
        finish_reason: "stop" as const,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

export async function* openAiChatStreamChunks(input: {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}) {
  const id = chatId();
  const created = Math.floor(Date.now() / 1000);
  const base = {
    id,
    object: "chat.completion.chunk" as const,
    created,
    model: input.model,
  };

  yield {
    ...base,
    choices: [
      {
        index: 0,
        delta: { role: "assistant" as const, content: "" },
        finish_reason: null,
      },
    ],
  };

  let finishReason = "stop";
  for await (const chunk of gatewayTextStream(input.model, input.messages, {
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    signal: input.signal,
  })) {
    if (chunk.type === "content" && chunk.text) {
      yield {
        ...base,
        choices: [
          {
            index: 0,
            delta: { content: chunk.text },
            finish_reason: null,
          },
        ],
      };
    } else if (chunk.type === "finish") {
      finishReason = chunk.reason || "stop";
    }
  }

  yield {
    ...base,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
}
