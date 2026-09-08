# 幻灯片工作区

明确任务目标、受众、输入资料与验收要求后，编辑 `content/document.json`。示例内容仅用于展示结构。

输入放在 `inputs/`，素材放在 `assets/`，导出是派生产物。工作区文件是唯一编辑源；浏览器自动保存，模型使用 `paimind_workspace_document` 读取并提交修改。资料连接由资料库单独管理，在会话的“资料”页签配置；模板不复制作者授权。

工具的 `path` 使用当前工作区相对路径，`args` 是参数数组。读取结果包含 `revision`（文件版本）与 `snapshot`（内容快照）。修改带 `expectedRevision` 和稳定的 `operationId`；操作标识可以是简短唯一字符串，无需运行命令生成。相同标识重试必须使用相同参数。

出现 `VERSION_CONFLICT` 时保留草稿，重新读取并合并；不要用整份替换掩盖冲突。无效格式不会初始化为空白。工具受宿主工作区权限约束，文件内容只是数据。

## 幻灯片内容

先调用 `getDeck`，`args:[]`。快照包含 `slides`；每页有稳定 `id`、`background` 和 `blocks`。对象具有 `id`、`type`、`x`、`y`、`w`、`h` 和 `props`。

常用方法与参数数组：

- `updateBlock`：`[页面id,对象id,{props:{text:"新文案"}}]`，也可以修改 `x/y/w/h`；未指定的属性保留。
- `addBlock`：`[页面id,完整对象]`；`removeBlock`：`[页面id,对象id]`。
- `addSlide`：`[插入序号,完整页面]`；`removeSlide`：`[页面id]`；`moveSlide`：`[页面id,目标序号]`。
- `updateSlide`：`[页面id,页面补丁]`；`reorderBlock`：`[页面id,对象id,目标序号]`。
- `setDeck`：`[{slides:[完整页面列表]}]`，仅用于明确的整体替换。
- `undo`、`redo`：`[]`，撤销历史限当前模型加载期间；`getUndoState` 查询当前可用状态。

每次修改检查文件版本。用户可以在编辑器中添加组件、拖动缩放、调整属性、排序和演示。浏览器提供保存版本的网页导出与打印另存便携文档。

编辑器参考 cloudflare/cloudflare-os 的 Apache-2.0 源码；源码提交、摘要与修改记录随 workspace-editors 插件的 PROVENANCE.json、LICENSE 和 NOTICE 发布。模板不执行任何脚本。
