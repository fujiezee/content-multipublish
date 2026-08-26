<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

This repo is 点物 GEO (`dianwu.tech`). Cloud agents clone GitHub; they do not see a laptop's uncommitted files, `.env.local`, or `data/`.

Verify with `npm run typecheck`. Optional unit-style scripts: `npx tsx scripts/test-provider-balance.ts`, `npx tsx scripts/test-infographic-extract.ts`, `node scripts/test-weixin-style.mjs`. Do not run `npm run deploy` or `wrangler` unless the user explicitly asks. Do not commit `.env*`, `data/`, or secrets.

Local `npm install` downloads Playwright Chromium via `postinstall`. Cloud install skips that (`--ignore-scripts` + rebuild `better-sqlite3`). Chrome extension flows, logged-in publishing, and Playwright browser tests stay on a laptop.

Secrets belong in the Cloud Agents dashboard, not the repo. Copy names from `.env.example`. Production keys already live on the Cloudflare Worker; cloud agents usually do not need them to edit code.
