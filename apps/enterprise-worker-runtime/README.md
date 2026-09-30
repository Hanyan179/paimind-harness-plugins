# Native enterprise runtime dependency carrier

Follows the [plugin authoring standard](../../docs/standards/plugin-authoring.md) for shipped package contents; this private deployment root is not a registered product plugin.

## Responsibility

Selects the pinned native Harness and the current PAIMind suite as the roots of a production-only deployment. Native Harness retains its own workspace, preset, session and execution ownership. The carrier does not define a second workbench or runtime implementation.

## Public entry points

No public package or API is published. The image build consumes this exact workspace identity through `pnpm deploy --prod --legacy`. Native startup uses the installed host's public bootstrap through `@paimind/harness-compat/managed-runtime`, not copied upstream source or the interactive CLI's writable configuration watcher.

## Dependencies

Exact native versions follow the [compatibility matrix](../../docs/compatibility/matrix.md). PAIMind plugins are reached through the existing suite's production graph. The enterprise server and its database driver are not dependencies of a user runtime cell.

The carrier directly declares `@paimind/harness-compat` because its deployment launcher consumes the managed-runtime export. The image owns the read-only profile; member data stays under the separate runtime data directory. Native startup success and ignored member config files do not establish RPC, tool or member authorization.

## Lifecycle and failure

This carrier grants no user admission and starts no service by itself. Missing packages, escaped links or an unresolved native composition must fail the image build. Signed admission, runtime lifecycle, quotas and member policy remain separate required boundaries.

## Published files

Private package metadata and this README only. Package-manager deployment adds the production dependency closure; source worktrees, local dependencies, credentials and user data are not copied into it.

## Verification

Production deployment, native composition resolution, actual boot, immutable final image, dual-user browser acceptance and merged acceptance are distinct gates. Deployment alone is not final-image or enterprise acceptance. See the [delivery goal](../../docs/plans/enterprise-haas-delivery.md) and [checkpoint](../../docs/checkpoints/enterprise-haas.md).
