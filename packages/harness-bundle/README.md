# `@paimind/harness-bundle`

The ordered PAIMind configuration layer installed after the Harness Web bundle. Feature plugins remain separate packages; the profile installs them beside this bundle so the patch can resolve each row from the profile root.

The bundle pins `dsh-better-sidebar@0.12.2` exactly. Only `@paimind/better-sidebar-adapter` crosses its client service boundary; feature packages consume the PAIMind adapter contract. Better Sidebar 0.12.x moved Office viewers out of core, so the bundle also pins the technical provider `@huanlin/dsh-plugin-better-sidebar-plugin-office@0.1.0`. The external Office package owns its own Harness Bundle row and must activate after `dsh-better-sidebar`; PAIMind does not copy its loader patch. It supplies PPTX/XLSX viewing only and does not become a PAIMind product category or domain owner.

The PAIMind product shell loads `@paimind/platform-scheduler` as its only
Scheduled Tasks product and runtime, together with the Harness, HTTP and
Feishu-bot Adapter services. The old opt-in Harness Session-reminder packages
`@deepseek-ai/dsh-schedule` and `@deepseek-ai/dsh-time-context` are not selected
by this Bundle. Business action plugins register executable actions through the
platform services; the Bundle does not add business fields or business pages.

The former `@paimind/scheduler` Session-local management facade remains a
buildable compatibility package but is no longer selected by this Bundle, so
users do not see two competing scheduling products. Platform API/SDK packages
remain separately deployable developer contracts and are not mounted as
browser-facing Bundle rows.
