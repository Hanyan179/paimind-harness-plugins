---
name: skill-creator
description: Design or revise concise DeepSeek Harness Skill packages with clear triggers, progressive disclosure, and reusable resources. Use when a user asks to create, structure, improve, or validate a Harness SKILL.md package.
---

# Skill Creator

Build the smallest reusable Skill that solves the requested workflow.

1. Confirm concrete trigger examples and the expected result.
2. Choose a lowercase, hyphenated name under 64 characters.
3. Create exactly one `SKILL.md` with YAML frontmatter containing `name` and `description`; add `when-to-use` when it improves Harness discovery.
4. Put only essential instructions in `SKILL.md`. Add `scripts/`, `references/`, or `assets/` only when they reduce repeated work.
5. Keep references one level deep and link them directly from `SKILL.md`.
6. Use imperative instructions and remove setup notes, changelogs, and placeholder files.
7. Validate that the package contains one Skill root, no unsafe paths, and no hidden runtime dependency.

Return the proposed package tree and complete `SKILL.md`. Do not install it without explicit user confirmation through the PAIMind Skill Market.
