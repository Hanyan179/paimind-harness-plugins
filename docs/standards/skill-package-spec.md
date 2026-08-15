# Skill 包规范

## 支持格式

- 单个 `SKILL.md`。
- `.zip`：必须且只能包含一个 `SKILL.md`；可带同一 Skill 根目录下的资源、示例和脚本。

`SKILL.md` 必须以 YAML frontmatter 开头，至少包含：

```yaml
---
name: evidence-review
description: Review evidence and produce concise findings.
when-to-use: Use when claims need source-backed validation.
---
```

`name` 仅允许小写字母、数字和连字符。目录名由 `name` 决定。

## 安全规则

- 禁止绝对路径、反斜杠路径、`..` 穿越、控制字符、加密条目和越界符号链接。
- 单文件或总体解压比超过安全阈值时拒绝。
- 根据实时可用磁盘空间判断；产品不声明固定文件或大小上限。
- 安装不执行包内脚本。脚本和可执行位会进入风险提示。
- 内容检查摘要必须与确认安装时一致。

## 生命周期

同名安装为更新。安装写入 PAIMind 管理清单，但 Harness 的文件系统发现仍是唯一运行来源。未带管理清单的本地 Skill 可展示，不允许由市场卸载。

## 推荐目录包

- 推荐目录包与本地上传使用同一内容检查、确认、原子安装和回滚实现。
- 第三方或改编内容必须随包包含适用的 `LICENSE.txt` 与 `NOTICE.txt`，并在目录元数据中声明来源和许可证。
- 目录 ID、版本和摘要只用于选择准确安装内容，不成为第二套 Skill 运行 ID。
- 页面可以显示来源与许可证，但不显示摘要、磁盘路径或内部构建信息。
