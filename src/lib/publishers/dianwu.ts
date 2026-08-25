import type { PlatformPublisher } from "@/lib/publishers/types";

export const dianwuPublisher: PlatformPublisher = {
  id: "dianwu",
  name: "点物目录",
  loginUrl: "https://dianwu.ai/directory",
  editorUrl: "https://dianwu.ai/directory",
  async isLoggedIn() {
    return false;
  },
  async publish() {
    throw new Error("点物目录请走 API 推送，不要开本机浏览器");
  },
};
