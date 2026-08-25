/** Cloudflare build stub — real Playwright stays local-only. */
function unavailable(): never {
  throw new Error("云端发稿请用点物助手，本机浏览器自动化不可用");
}

export const chromium = {
  launch: unavailable,
};

export type Browser = {
  isConnected(): boolean;
  newContext(opts?: unknown): Promise<BrowserContext>;
  close(): Promise<void>;
};

export type BrowserContext = {
  newPage(): Promise<Page>;
  storageState(opts?: unknown): Promise<unknown>;
  close(): Promise<void>;
};

export type Page = {
  isClosed(): boolean;
  locator(selector: string): {
    first(): {
      count(): Promise<number>;
      isVisible(): Promise<boolean>;
      waitFor(opts?: unknown): Promise<void>;
      click(opts?: unknown): Promise<void>;
      fill(value: string): Promise<void>;
    };
  };
  screenshot(opts?: unknown): Promise<Buffer>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(fn: unknown, arg?: unknown): Promise<unknown>;
};

export type Cookie = Record<string, unknown>;
export type Frame = Page;
export type Response = { url(): string };

export default { chromium };
