import { randomBytes } from "crypto";

type SocketHandle = {
  send: (data: string) => void;
  close: () => void;
  onMessage: (cb: (data: string) => void) => void;
  onClose: (cb: () => void) => void;
  onError: (cb: (err: Error) => void) => void;
};

function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function connectRealtimeSocket(
  url: string,
  apiKey: string,
): Promise<SocketHandle> {
  const httpsUrl = url.replace(/^wss:/i, "https:");
  try {
    const res = await fetch(httpsUrl, {
      headers: {
        Upgrade: "websocket",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const ws = (res as unknown as { webSocket?: WebSocket & { accept?: () => void } }).webSocket;
    if (ws && typeof ws.accept === "function") {
      ws.accept();
      return {
        send: (data) => ws.send(data),
        close: () => ws.close(),
        onMessage: (cb) => {
          ws.addEventListener("message", (event) => {
            cb(typeof event.data === "string" ? event.data : String(event.data));
          });
        },
        onClose: (cb) => ws.addEventListener("close", () => cb()),
        onError: (cb) =>
          ws.addEventListener("error", () => cb(new Error("配音通道中断"))),
      };
    }
  } catch {
    /* Node 没有 Worker 的 client websocket，走 ws */
  }

  const { default: WS } = await import("ws");
  const socket = new WS(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (err) =>
      reject(err instanceof Error ? err : new Error("配音通道连不上")),
    );
  });
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onMessage: (cb) => {
      socket.on("message", (raw) => cb(String(raw)));
    },
    onClose: (cb) => {
      socket.on("close", () => cb());
    },
    onError: (cb) => {
      socket.on("error", (err) =>
        cb(err instanceof Error ? err : new Error("配音通道中断")),
      );
    },
  };
}

export async function synthesizeQwenRealtime(input: {
  apiKey: string;
  model: string;
  voice: string;
  text: string;
}): Promise<Buffer> {
  const model = input.model.trim() || "qwen3-tts-vc-realtime-2026-01-15";
  const url = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
  const ws = await connectRealtimeSocket(url, input.apiKey);
  const chunks: Buffer[] = [];
  let settled = false;
  let ready = false;

  const eventId = () => `event_${randomBytes(8).toString("hex")}`;
  const send = (payload: Record<string, unknown>) => {
    ws.send(JSON.stringify({ event_id: eventId(), ...payload }));
  };

  const done = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error("实时配音超时"));
    }, 25_000);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else {
        const pcm = Buffer.concat(chunks);
        if (pcm.length < 64) reject(new Error("实时配音没有返回音频"));
        else resolve(pcmToWav(pcm));
      }
    };

    ws.onError((err) => finish(err));
    ws.onClose(() => {
      if (!settled) finish(new Error("配音通道被关掉"));
    });
    ws.onMessage((raw) => {
      let event: Record<string, unknown> = {};
      try {
        event = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(event.type || "");
      if (type === "error") {
        const err = event.error as { message?: string } | undefined;
        finish(new Error(err?.message || "实时配音失败"));
        return;
      }
      if (type === "session.created") {
        send({
          type: "session.update",
          session: {
            voice: input.voice,
            mode: "commit",
            language_type: "Chinese",
            response_format: "pcm",
            sample_rate: 24000,
          },
        });
        return;
      }
      if (type === "session.updated") {
        if (ready) return;
        ready = true;
        send({ type: "input_text_buffer.append", text: input.text });
        send({ type: "input_text_buffer.commit" });
        return;
      }
      if (type === "response.audio.delta") {
        const delta = String(event.delta || "");
        if (delta) chunks.push(Buffer.from(delta, "base64"));
        return;
      }
      if (type === "response.done" || type === "session.finished") {
        send({ type: "session.finish" });
        finish();
      }
    });
  });

  return done;
}

export function isRealtimeTtsModel(model?: string): boolean {
  return /realtime/i.test(model || "");
}
