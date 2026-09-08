# 智能体与 Skill 插件开发指南

## 运行与构建

```bash
pnpm install --frozen-lockfile
pnpm --filter @hansen/skill-market typecheck
pnpm --filter @hansen/agent-builder typecheck
pnpm --filter @hansen/agent-market typecheck
pnpm run build
```

正式组合继续使用 `@hansen/skill-market`、`@hansen/agent-market` 和无界面的 `@hansen/agent-builder`。不要新增 Agent 或 Skill 运行注册表，也不要修改 DeepSeek Harness 上游源码。

## Skill 开发

按 [`../standards/skill-package-spec.md`](../standards/skill-package-spec.md) 准备文件并从技能市场本地导入。安装后打开真实会话，确认发现列表出现该名称，再用 `/${name}` 发送真实请求。

PAIMind 内置推荐 Skill 的来源、适配范围与验收方法见 [`official-skill-catalog.md`](official-skill-catalog.md)。推荐内容与本地导入共用同一安全检查和原子安装器。

## 智能体开发

业务配置从智能体中心写入。高级插件组合通过智能体中心的“高级配置”进入 Harness 原生 Agent Preset 页面维护。创建后点击“开始对话”，检查会话头部预设，再发送已预填的中性问题。

## 禁止事项

- 不在浏览器读写 Host 路径。
- 不用 `localStorage` 保存运行配置或配置版本。
- 不把 Preset ID、哈希、目录和会话 ID 暴露为业务字段。
- 不热更新正在运行的旧会话。
