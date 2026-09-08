# 文件系统 MCP 端到端验收

2026-09-08，本地 `main` 已合入品牌设置与通用 MCP 草稿测试，代码提交 `7b39812`。两个原产品集成分支的提交均已在主线中；本轮不包含企业线，未推送或发布。

合并检查：128 个测试文件、720 项测试通过；类型、构建、包身份、接口快照、包内容、导出、框架与文档检查通过。首次全量并发时技能安装器的目录分页测试触发 5 秒超时，单文件复跑 26 项通过，限制 4 个测试进程后全量通过。未修改该测试或功能代码。真实宿主组合安装、启动、移除、恢复检查已在本轮功能验收通过。

## 对象与范围

选用 [MCP 官方参考仓库的文件系统服务](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)，独立安装固定版本 `@modelcontextprotocol/server-filesystem@2026.8.31`，未加入产品依赖或修改宿主源码。

- 运行实例：`http://localhost:3080/`，唯一本地主线工作目录。
- 连接：`本地文件夹 · MCP 端到端验收 0908`，ID `36f1a39909c14f78b253f18bfe84abd4`。
- 来源程序：`/Users/hansen/.local/share/paimind-mcp-tests/filesystem-2026.8.31/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js`。
- 唯一允许目录：`/Users/hansen/Documents/PAIMind-workspace/mcp-filesystem-e2e/2026-09-08`。
- 助手：`本地文件夹验收助手 0908`，原生预设 `0908-fe886d`，配置版本 `v1-6ea10e6ecddff71d`，只绑定此连接，无业务技能。
- 数据：新生成的三条合成样例订单与随机核验标记；目录外另建无敏感内容的拒绝测试文件。未读写真实业务文件。

## 实际结果

1. 从通用“添加连接 → 本地程序”填写上述程序和目录；保存前测试成功，发现 14 个工具。随后保存连接，在新助手草稿中显式选择并保存。
2. 从助手“开始对话”入口运行真实原生会话 `session-69cd1f72-6f57-47f2-9d9c-b6ddae2e2a5b`。20:11 第一轮依次执行允许目录查询、读取 `input.json`、写入 `result.json`、回读结果、尝试读取目录外合成文件。
3. 宿主原生轨迹记录五次 `mcp__paimind_18db6585a3de6fdb17f4__*` 调用：`list_allowed_directories`、`read_text_file`、`write_file`、`read_text_file`、`read_text_file`。前四次成功；最后一次返回 `Access denied - path outside allowed directories`。没有原生文件、终端、代码或飞书替代调用。
4. 独立读取磁盘校验：订单分项金额 48063、21000、31160 分，总金额 100223 分；输出的 `test_id`、随机标记、逐项金额及总额全部与输入/独立计算一致。输入文件未改变。
5. 浏览器刷新后保留同一对话和助手。20:13 第二轮再次执行新的 MCP `read_text_file` 调用，读取既有 `result.json` 成功；两轮原生终态均为 `completed`。已查看真实浏览器画面。

核验文件摘要：

- `input.json` SHA-256：`8aac8ed7249cfb8cbbf419be4c67418c9fc02d6c9e7e538578554c1cf57e4927`
- `result.json` SHA-256：`be5ef997d9ec7a9b952d9ba59f50527e34741232ebee77a4029a75d10c2b1f66`

## 保留与限制

原有三条连接的完整配置、ID 与版本和验收前一致；既有智能体预设及备份文件内容未变。智能体中心状态文件增加本次助手会话绑定与验证记录。测试连接、助手、样例和结果保留以便用户继续查看；未设为默认助手。

正常对话的 MCP 文件读写、回读与目录拒绝边界已通过。新建助手后立即切换编辑页“测试对话”，两次出现“创建真实空白对话超时”；完成正常会话并刷新，再次打开编辑页仍可复现。因此本报告不把正常对话成功当作该专用测试入口已通过。该问题发生在原生空白测试会话准备阶段，握手与实际 MCP 工具链路已有独立成功证据。

本轮没有用真实文件读写结果替代企业权限、所有 MCP 服务或生产环境验收；未测试其他提供方或远程授权。
