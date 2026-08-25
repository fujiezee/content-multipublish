import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_LOGIN_URLS } from "@/lib/platform-login";

export const AGENT_HELPER_FILES = [
  "先看这个.txt",
  "打开点物助手.command",
  "打开点物助手.bat",
  "helper.py",
  "start.cjs",
] as const;

export function writeAgentHelperFolder(
  dest: string,
  input: { url: string; code: string },
) {
  const source = join(process.cwd(), "tools/dianwu-agent");
  mkdirSync(dest, { recursive: true });
  for (const name of AGENT_HELPER_FILES) {
    copyFileSync(join(source, name), join(dest, name));
  }
  writeFileSync(
    join(dest, "pair.json"),
    `${JSON.stringify({ url: input.url, code: input.code }, null, 2)}\n`,
  );
  writeFileSync(
    join(dest, "platforms.json"),
    `${JSON.stringify(PLATFORM_LOGIN_URLS, null, 2)}\n`,
  );
}
