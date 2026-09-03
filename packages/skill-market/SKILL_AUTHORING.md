---
name: paimind-skill-authoring
description: Create a new Business Skill and hand an unsaved draft to the PAIMind Skill Center for review. Use when the user asks to create, write, or design a new Skill.
---

# PAIMind Skill authoring

Create the smallest reusable Business Skill that solves the requested workflow. The Skill Center owns review and persistence; Harness owns discovery and execution after Save.

1. Preserve the user's requested product, scope, and authorization. Do not turn one example or preference into a universal rule.
2. Infer realistic use cases, concrete trigger examples, and the expected result from the conversation. Ask one focused question only when a missing answer would materially change the Skill.
3. Choose a lowercase, hyphenated name under 64 characters.
4. Write a concise, discriminating description that states both what the Skill does and when it should be loaded.
5. Put only useful, non-obvious guidance in the body. Match detail to actual risk, keep ordinary choices flexible, and avoid repeating platform rules already enforced elsewhere.
6. Keep the initial `SKILL.md` self-contained. If the workflow genuinely needs scripts, references, assets, or UI metadata, tell the user those resources still need to be added in the package editor; do not create placeholders or claim they already exist.
7. Before handoff, remove TODO markers, setup notes, changelog text, credentials, unavailable dependencies, and unsupported claims. Check that the instructions are complete enough to act on and that every mentioned resource or Tool is real.
8. Call `paimind_skill_prepare_create` once with the complete name, description, and instructions. This creates an unsaved draft and opens the Skill Center review workspace; it never installs or saves automatically.

Existing Business Skills are revised from the Skill Center's Installed view. This conversational create Tool does not overwrite an installed package.

Do not write directly into Harness Skill directories. Do not claim the Skill exists until the user has reviewed and saved it in the Skill Center.
