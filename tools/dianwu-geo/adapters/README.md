# 扩展额外平台适配器

内置打包（`assets/index.ts-ZvOctxVj.js`）含 13 个平台。本目录用于按上游 [Wechatsync v2](https://github.com/wechatsync/Wechatsync/tree/v2) 模式追加平台，无需重编整个扩展。

## 示例：思否 `segmentfault`

1. `adapters/segmentfault.js` — 适配器源码（参考上游 `packages/core/src/adapters/platforms/segmentfault.ts`）
2. `register-extra-adapters.js` — 启动时注册
3. `rules/segmentfault.json` — Chrome 声明式网络请求（修正 Origin/Referer）

## 新增一个平台

1. 从上游复制或编写 `adapters/<id>.js`，导出 `createXxxAdapter(BaseAdapter)`
2. 在 `register-extra-adapters.js` 的 `extras` 数组里加入
3. 如需 DNR，添加 `rules/<id>.json` 并在 `manifest.json` 的 `declarative_net_request.rule_resources` 注册
4. `chrome://extensions` 重新加载扩展

## 验证

1. 在 Chrome 登录 [segmentfault.com](https://segmentfault.com)
2. 打开扩展弹窗 → 点刷新 → 应出现 **思否**（第 14 个格子）
3. 从编辑器「手动多平台同步」传入文章后勾选思否同步
