# 提案主分支与完整画布验收

- 本地原始 `main` 从 `a9187d2` 合并到 `b20f6a7`，后续全屏裁切修复为 `8bbe4f6`。未推送远端。
- `3080` 使用固定仓库目录及原 `.dsh-home`，保留会话、工作区与用户配置。
- 历史 GenUI 专用预设中的局部加载标识与全局 `genui` 冲突。局部标识改为 `genui-agent-scoped`，保持插件名称与 `agent-only` 配置；备份保存在 `/tmp/proposal-merge-preserved-20260908/genui-agent.cordis.yml`。
- 放大控制为纯图标，保留可访问名称与悬停说明。放大工作台使用浏览器顶层弹出层，避免宿主侧栏的变换与裁切，保留同一 iframe 的临时编辑状态。

## 实际浏览器验收

2026-09-08 17:43 新建空白会话「准备完整提案演示」，只发送「帮我做一份完整的提案演示。」。

依次确认 Walmart Kids Crafts、Kids Crafts、Growth & investment ask、Playful Storybook 和完整双分析内容。用途切换时右侧解释发生对应变化。风格选择持久化为 `playful-storybook` / `storybook-cutpaper`。

新产物位于工作区的 `proposal-demo/walmart-review-20260908/deck/walmart-kids-crafts-growth-investment.bento.html`，共 25 页。校验报告为 `valid: true`、104/104 引用已解析、源哈希已验证、事实值未改变。

实际打开产物，逐页翻到第 25 页。放大工作台边界为 x=0、y=0、宽约 2578、高约 1486；主幻灯片约 2352×1323，四边均在视口内。缩放按钮无可见文字且包含 SVG 图标。

编辑模式实际修改第 2 页标题为 `Kids Crafts — A Bright Growth Opportunity`，随后切换溯源仍保留临时修改。点击 `$5.2M` 打开业务来源，显示原值 5,151,512.58、`walmart.fineline.data-result.json`、源哈希和 FY2025 WK31–WK52 范围。技术溯源可打开，部分上游计算元数据未登记；未将缺失字段表述为已完成。

## 检查与限制

- 合并后完整构建通过；709 项测试通过，1 项大目录测试在并发运行中超时，其所在文件单独重跑 26 项全通过。
- 合并后的打包、接口快照、严格包检查、外部类型消费者、示例、框架及文档门禁通过。
- 顶层画布修复后构建及 11 项定向测试通过。
- 后续其他任务同步修改品牌等文件，产生品牌运行时哈希差异；这些修改不属于本次提交，不覆写或纳入本次验收结论。
- 18:02 再次从空白会话使用同一句提示词，完成全部五项确认，新生成 `proposal-demo/walmart-kids-crafts-investment-20260908c/deck/walmart-kids-crafts-investment.bento.html`。文件复核为 25 页、`playful-storybook` / `storybook-cutpaper`、104/104 引用通过。实际展示了全屏、标题编辑、业务和技术溯源。
- ScreenCaptureKit 窗口录制成功落盘，2560×1440、748.58 秒。但逐分钟抽帧发现同一 Chrome 窗口被其他页面切换占用，后半段含无关页面；该视频不合格，不作为交付。完整录屏仍未完成。
