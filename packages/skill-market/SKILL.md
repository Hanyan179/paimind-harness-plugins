---
name: paimind-skill-installation
description: Inspect and install a public GitHub Skill into the PAIMind Skill Center, then optionally attach it to the current managed Agent. Use when the user asks to import, install, update, or bind a Skill from GitHub.
---

# PAIMind Skill installation

Use PAIMind's managed installer. Do not clone repositories, run package scripts, or write directly into Harness Skill directories.

This is a system workflow for managing Business Skills. Installed packages belong to PAIMind Skill Center and are not promoted into the Harness Global Skill catalog.

## Install from GitHub

1. Call `paimind_skill_inspect_github` with the public GitHub repository URL. Pass `ref` and `subdirectory` only when the user supplied them or the URL identifies them.
2. Summarize the inspected Skill name, install/update operation, source, warnings, runtime requirements, and digest. Ask for confirmation before installation.
3. After confirmation, call `paimind_skill_install` with the exact `upload_id` and `digest` returned by inspection.
4. Report the installed Skill and whether it was installed or updated.

Installation only makes the Business Skill eligible in Skill Center. It does not add the Skill to the current Session, make it a default for ordinary conversations, or attach it to any Agent. Never tell the user that an installed Skill is now available in every conversation. To use it, the user must explicitly select it for the current conversation, enable it as an ordinary-conversation default in Skill Center, or bind it to a managed Agent.

## Optional Agent binding

After installation, call `paimind_agent_skill_binding` with `operation: "status"` and the installed `skill_name` when that Tool is available.

- If the current Session is not bound to a PAIMind-managed Agent, finish after installation and state that the Skill is installed but not selected for the current Session.
- If it is bound, ask whether to attach the Skill to that Agent.
- Call `paimind_agent_skill_binding` with `operation: "bind"` only after an explicit yes.
- Explain that binding changes the Agent configuration for new conversations and is re-resolved before the next turn of an active Agent Session; it never rewrites existing messages.

When this Skill was loaded from `paimind-agent-authoring`, return the installed Business Skill name to that workflow so it can be selected in the unsaved Agent draft. Do not bind an unrelated existing Agent merely because an authoring conversation is active.

Never bind a Skill without confirmation. Never present a downloaded package as safe merely because inspection succeeded; surface all warnings.
