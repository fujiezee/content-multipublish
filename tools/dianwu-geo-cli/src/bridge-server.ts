import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RPC_TIMEOUT_MS,
  extractErrorMessage,
  getBridgeHost,
  getBridgePort,
  getBridgeToken,
  type BridgeMethod,
  type BridgeRequest,
  type BridgeResponse,
} from "./protocol.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

export type BridgeServerOptions = {
  host?: string;
  port?: number;
  token?: string;
  rpcTimeoutMs?: number;
};

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private extension: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private readonly host: string;
  private readonly port: number;
  private readonly token: string;
  private readonly rpcTimeoutMs: number;
  private extensionWaiters: Array<() => void> = [];

  constructor(options: BridgeServerOptions = {}) {
    this.host = options.host ?? getBridgeHost();
    this.port = options.port ?? getBridgePort();
    this.token = (options.token ?? getBridgeToken()).trim();
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  }

  get address(): string {
    return `ws://${this.host}:${this.port}`;
  }

  get hasExtension(): boolean {
    return !!this.extension && this.extension.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    if (this.wss) return;

    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ host: this.host, port: this.port });
      this.wss = wss;

      wss.once("listening", () => resolve());
      wss.once("error", (err) => reject(err));

      wss.on("connection", (ws, req) => {
        const url = new URL(req.url || "/", `http://${this.host}`);
        const token =
          url.searchParams.get("token") ||
          (req.headers["x-dianwu-geo-token"] as string | undefined) ||
          "";

        if (this.token && token !== this.token) {
          ws.close(1008, "invalid token");
          return;
        }

        if (this.extension && this.extension.readyState === WebSocket.OPEN) {
          try {
            this.extension.close(1000, "replaced by new extension connection");
          } catch {
            // ignore
          }
        }

        this.extension = ws;
        this.flushExtensionWaiters();

        ws.on("message", (data) => {
          this.onExtensionMessage(String(data));
        });

        ws.on("close", () => {
          if (this.extension === ws) {
            this.extension = null;
            this.rejectAllPending(new Error("扩展已断开连接"));
          }
        });

        ws.on("error", () => {
          // close handler cleans up
        });
      });
    });
  }

  async stop(): Promise<void> {
    this.rejectAllPending(new Error("桥接服务已关闭"));
    if (this.extension) {
      try {
        this.extension.close();
      } catch {
        // ignore
      }
      this.extension = null;
    }
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss?.close(() => resolve());
      });
      this.wss = null;
    }
  }

  async waitForExtension(
    timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  ): Promise<void> {
    if (this.hasExtension) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.extensionWaiters = this.extensionWaiters.filter((w) => w !== onReady);
        reject(
          new Error(
            `等待扩展连接超时（${Math.round(timeoutMs / 1000)}s）。请在 Chrome 打开「点物GEO」扩展，开启 MCP/同步桥接，并确认地址为 ${this.address}`,
          ),
        );
      }, timeoutMs);

      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.extensionWaiters.push(onReady);
    });
  }

  async call<T = unknown>(
    method: BridgeMethod | string,
    params?: Record<string, unknown>,
    timeoutMs = this.rpcTimeoutMs,
  ): Promise<T> {
    await this.waitForExtension();
    if (!this.extension || this.extension.readyState !== WebSocket.OPEN) {
      throw new Error("扩展未连接");
    }

    const id = randomUUID();
    const request: BridgeRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`扩展调用超时: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        this.extension!.send(JSON.stringify(request));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private flushExtensionWaiters() {
    const waiters = this.extensionWaiters.splice(0);
    for (const w of waiters) w();
  }

  private rejectAllPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private onExtensionMessage(raw: string) {
    let msg: BridgeResponse;
    try {
      msg = JSON.parse(raw) as BridgeResponse;
    } catch {
      return;
    }
    if (!msg?.id) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(extractErrorMessage(msg.error)));
      return;
    }
    pending.resolve(msg.result);
  }
}

let shared: BridgeServer | null = null;

/** Get or create a process-wide bridge (used by CLI auto-start + MCP). */
export function getSharedBridge(options?: BridgeServerOptions): BridgeServer {
  if (!shared) {
    shared = new BridgeServer(options);
  }
  return shared;
}

export async function ensureSharedBridgeStarted(
  options?: BridgeServerOptions,
): Promise<BridgeServer> {
  const bridge = getSharedBridge(options);
  await bridge.start();
  return bridge;
}
