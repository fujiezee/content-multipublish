# 点物GEO 扩展分发与协议

面向可售卖部署：买家安装 Chrome 扩展，用自己的浏览器登录各平台；云端只负责写稿、任务与公网图床。

## 安装方式

### A. 开发者 / 私有交付（当前默认）

1. Chrome 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择仓库内 `tools/dianwu-geo`
4. 确认版本 ≥ **2.6.0**（小红书填稿确认制 + 协议 1200）

### B. Chrome Web Store（上架后）

- 打包 zip（勿含 `.git` / 密钥）
- 商店页安装；SaaS 后台提示最低版本号
- `externally_connectable` 需包含你的 SaaS 域名（见 `manifest.json`）

### C. 企业强制安装

- 用 Google Workspace / MDM 策略强制扩展 ID
- 仍建议走商店签名包，避免每次更新手动重载

## SaaS 绑定

1. Web：`/settings` → 登录或本地模式 → **生成扩展 Token**
2. 扩展：`chrome.storage.local` 写入：

```js
chrome.storage.local.set({
  saasBaseUrl: "https://your-saas.example",
  saasToken: "dwext_...",
});
```

3. 握手：`POST {saasBaseUrl}/api/extension/handshake`

```json
{
  "extensionVersion": "2.6.0",
  "protocolVersion": 1200,
  "token": "dwext_..."
}
```

服务端返回 `compatible` / `bound` / `workspaceId`。协议号低于 `minProtocolVersion`（当前 1200）时提示升级扩展。

## 平台能力（产品承诺）

| 模式 | 状态码 | 代表平台 |
|------|--------|----------|
| 真草稿 | `draft_ok` | 知乎、简书、多数资讯号 |
| 填稿待发 | `filled_awaiting_publish` | **小红书**、抖音等 |
| 已发布 | `published` | 扩展自动点发布成功时 |

小红书**不**承诺无人值守自动发布；扩展只填稿，用户确认后点「发布」。

## 版本纪律

- `manifest.json` → `version`（Chrome 显示）
- `inject-api.js` → `versionNumber`（页面桥协议，与 handshake 对齐）
- 变更记入 `CHANGELOG.md`

改适配器 / 桥接后必须 bump，见 `.cursor/rules/dianwu-geo-version.mdc`。
