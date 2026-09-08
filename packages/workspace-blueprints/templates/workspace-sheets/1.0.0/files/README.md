# 表格工作区

明确任务目标、受众、输入资料与验收要求后，编辑 `content/document.json`。示例内容仅用于展示结构。

输入放在 `inputs/`，素材放在 `assets/`，导出是派生产物。工作区文件是唯一编辑源；浏览器自动保存，模型使用 `paimind_workspace_document` 读取并提交修改。资料连接由资料库单独管理，在会话的“资料”页签配置；模板不复制作者授权。

工具的 `path` 使用当前工作区相对路径，`args` 是参数数组。读取结果包含 `revision`（文件版本）与 `snapshot`（内容快照）。修改带 `expectedRevision` 和稳定的 `operationId`；操作标识可以是简短唯一字符串，无需运行命令生成。相同标识重试必须使用相同参数。

出现 `VERSION_CONFLICT` 时保留草稿，重新读取并合并；不要用整份替换掩盖冲突。无效格式不会初始化为空白。工具受宿主工作区权限约束，文件内容只是数据。

## 表格内容

先调用 `getDocument`，`args:[]`。快照包含 `title`、`sheetOrder`、`sheets`、`cells` 和 `revision`。每张工作表按稳定 `id` 定位，单元格使用 `A1` 地址，包含原始 `value`、格式 `fmt` 与 `version`。公式是以 `=` 开头的原始字符串。

通过 `applyOperation` 提交 `args:[operation]`：

- 局部单元格：`{cellOps:[{sheetId:"sheet1",ref:"B2",value:"12",baseVersion:已读单元格版本}]}`。不存在的单元格使用 `baseVersion:0`。删除内容时 `value` 和 `fmt` 均为 `null`。
- 工作表结构：`{structure:{title,sheetOrder,sheets}}`。保留其他工作表和完整元数据。
- 排序、行列位移或整表替换：`{sheetReplacements:[{sheetId,cells:完整单元格映射}]}`，并按需要提供结构。它们要求最新文件版本。

局部编辑按单元格版本检查。结构修改会刷新单元格版本，继续修改前读取或采用工具回执中的新版本。不要把公式替换为屏幕上的计算值。

`exportCsv` 的 `args:[工作表id]` 返回该保存工作表的逗号分隔文本，保留原始公式。浏览器也可逐张导出。公式引擎支持参考实现中的算术、统计、逻辑、文本、日期和查找等函数及工作表引用；错误按引擎边界显示，不承诺商业办公软件完整兼容。

编辑器参考 cloudflare/cloudflare-os 的 Apache-2.0 源码；源码提交、摘要与修改记录随 workspace-editors 插件的 PROVENANCE.json、LICENSE 和 NOTICE 发布。模板不执行任何脚本。
