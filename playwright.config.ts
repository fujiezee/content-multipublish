import { defineConfig } from "playwright/test";

export default defineConfig({
  timeout: 120_000,
  use: {
    headless: false,
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  },
});
