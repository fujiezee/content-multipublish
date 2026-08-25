import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipFolder } from "../src/lib/zip-folder";

const root = join(process.cwd(), "tools/dianwu-geo");
if (!existsSync(join(root, "manifest.json"))) {
  throw new Error("找不到 tools/dianwu-geo/manifest.json");
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
  version?: string;
};
const version = manifest.version || "dev";
const outDir = join(process.cwd(), "public");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "dianwu-geo.zip");
writeFileSync(out, zipFolder(root));
console.log(`packed ${out} (v${version})`);
