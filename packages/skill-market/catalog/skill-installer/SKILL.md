---
name: skill-installer
description: Inspect and prepare public Skill packages for safe installation through the PAIMind Skill Market. Use when a user asks how to install, update, or import a Skill from a public repository or local package into DeepSeek Harness.
---

# Skill Installer

Guide installation through the PAIMind Skill Market; never write directly to the Harness Skill directory.

1. Identify the public repository path or local `.zip`/`SKILL.md` package.
2. Explain the expected Skill root and required `SKILL.md` metadata.
3. Ask the user to open **设置 → 技能市场** and choose **本地导入**, or select a recommended Skill.
4. Require the platform inspection result before confirmation: name, description, file count, expanded size, scripts, executable files, and warnings.
5. Install only after explicit confirmation. Let the market perform atomic placement, rollback, and recoverable uninstall.
6. Verify installation in **已安装**, then open a compatible conversation and confirm Harness reports the Skill as available.

Reject absolute paths, path traversal, symlinks escaping the package, encrypted archives, and abnormal compression. Do not execute package scripts during installation.
