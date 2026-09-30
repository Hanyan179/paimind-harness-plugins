// check:fast runs test:build. Reuse the canonical verifier suites here so
// worker safety checks are not limited to an optional enterprise command.
// These unit contracts do not count as Linux build or final-image acceptance.
import '../../deploy/enterprise/worker/runtime/worker-build-root-contract.spec.mjs'
import '../../deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.spec.mjs'
import '../../deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.spec.mjs'
import '../../deploy/enterprise/worker/runtime/verify-pnpm-offline-store.spec.mjs'
import '../../deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.spec.mjs'
import '../../deploy/enterprise/worker/runtime/verify-node-gyp-local-headers.spec.mjs'
import '../../deploy/enterprise/worker/runtime/prepare-native-storage.spec.mjs'
import '../../deploy/enterprise/worker/runtime/prepared-storage.spec.mjs'
import '../../deploy/enterprise/worker/runtime/active-storage.spec.mjs'
import '../../deploy/enterprise/worker/runtime/recover-native-storage.spec.mjs'
