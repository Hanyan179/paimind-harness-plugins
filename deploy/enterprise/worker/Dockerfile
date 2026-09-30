# syntax=docker/dockerfile:1.7

# Policy and actual source-install/build reports are intermediate targets.
# Runtime assembly, final-image labels and dual-cell admission must consume
# these receipts before a final Worker image can be accepted.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build-base
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/opt/paimind-enterprise-corepack-home
ENV PATH=$PNPM_HOME:$PATH
ENV PAIMIND_WORKER_BUILD_SOURCE_ROOT=/opt/paimind-enterprise-build-source \
  PAIMIND_WORKER_PNPM_STORE_ROOT=/opt/paimind-enterprise-pnpm-store \
  PAIMIND_WORKER_DEPLOY_ROOT=/runtime-deploy \
  PAIMIND_WORKER_ASSEMBLED_ROOT=/runtime \
  PAIMIND_WORKER_FINAL_ROOT=/opt/paimind
WORKDIR ${PAIMIND_WORKER_BUILD_SOURCE_ROOT}

# The toolchain producer may access the official package registry. Consumer
# policy verification below has no external network, no user-home mounts and
# no inherited host configuration. Node is pinned by platform image digest.
RUN install -d -o root -g root -m 0755 /pnpm "$COREPACK_HOME" "$PAIMIND_WORKER_PNPM_STORE_ROOT" \
  && corepack enable --install-directory /pnpm \
  && corepack prepare pnpm@11.7.0 --activate \
  && test "$(COREPACK_ENABLE_NETWORK=0 /pnpm/pnpm --version)" = "11.7.0" \
  && chmod -R a-w "$COREPACK_HOME" /usr/local/lib/node_modules/corepack \
  && chmod a-w /pnpm

FROM build-base AS pnpm-store-producer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY deploy/enterprise/worker/runtime/worker-build-root-contract.mjs ./deploy/enterprise/worker/runtime/worker-build-root-contract.mjs
COPY deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.mjs ./deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.mjs
COPY deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs
COPY deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.mjs ./deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.mjs
COPY deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs ./deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs
# Fetch the current frozen lockfile with the source's 1440-minute producer
# policy. No host cache, user config, lifecycle scripts or legacy image store.
RUN --network=none install -d -o root -g root -m 0700 /tmp/paimind-pnpm-producer-home \
  && node --input-type=module -e "import { spawnSync } from 'node:child_process'; import { createPnpmProducerFetchEnvironment } from './deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.mjs'; import { readPnpmEffectivePolicySurface } from './deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs'; process.stdout.write(JSON.stringify(readPnpmEffectivePolicySurface(spawnSync, process.cwd(), createPnpmProducerFetchEnvironment(), [], 1440)))" > /pnpm-producer-policy-preflight.json
RUN node ./deploy/enterprise/worker/runtime/run-pnpm-offline-store-fetch.mjs --report=/offline-store-fetch-retry.json
RUN --network=none node ./deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.mjs > /pnpm-project-registry-normalization.json \
  && chmod -R a-w "$PAIMIND_WORKER_PNPM_STORE_ROOT" \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" > /pnpm-offline-store-seal.json

FROM build-base AS pnpm-effective-policy-diagnostic
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY deploy/enterprise/worker/runtime/worker-build-root-contract.mjs ./deploy/enterprise/worker/runtime/worker-build-root-contract.mjs
COPY deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs ./deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs
COPY deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.mjs ./deploy/enterprise/worker/runtime/normalize-pnpm-project-registry.mjs
COPY deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs
COPY --from=pnpm-store-producer /pnpm-offline-store-seal.json /pnpm-offline-store-seal.json
COPY --from=pnpm-store-producer /pnpm-project-registry-normalization.json /pnpm-project-registry-normalization.json
# This is policy-probe consumption, not final application install/deploy proof.
RUN --network=none --mount=type=bind,from=pnpm-store-producer,source=/opt/paimind-enterprise-pnpm-store,target=/opt/paimind-enterprise-pnpm-store,readonly \
  node ./deploy/enterprise/worker/runtime/worker-build-root-contract.mjs --require=source,store \
    > /policy-root-contract.json \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" --expected-seal=/pnpm-offline-store-seal.json --require-read-only-mount > /pnpm-offline-store-policy-before.json \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-effective-policy.mjs > /pnpm-effective-policy.json \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" --expected-seal=/pnpm-offline-store-seal.json --require-read-only-mount > /pnpm-offline-store-policy-after.json \
  && test -s /pnpm-effective-policy.json

FROM scratch AS pnpm-effective-policy-report
COPY --from=pnpm-store-producer /offline-store-fetch-retry.json /offline-store-fetch-retry.json
COPY --from=pnpm-store-producer /pnpm-producer-policy-preflight.json /pnpm-producer-policy-preflight.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-effective-policy.json /pnpm-effective-policy.json
COPY --from=pnpm-effective-policy-diagnostic /policy-root-contract.json /policy-root-contract.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-project-registry-normalization.json /pnpm-project-registry-normalization.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-offline-store-seal.json /pnpm-offline-store-seal.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-offline-store-policy-before.json /pnpm-offline-store-policy-before.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-offline-store-policy-after.json /pnpm-offline-store-policy-after.json

FROM build-base AS build-toolchain
# Only this build stage contains native compilation tools, never the runtime.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ cmake \
  && node -e "if (require('/opt/paimind-enterprise-corepack-home/v1/pnpm/11.7.0/dist/node_modules/node-gyp/package.json').version !== '12.4.0') process.exit(1)"

FROM build-toolchain AS worker-source-build
ARG PAIMIND_SOURCE_BUILD_RUN
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY examples ./examples
COPY scripts ./scripts
COPY deploy/enterprise/worker/runtime ./deploy/enterprise/worker/runtime
COPY --from=pnpm-store-producer /pnpm-offline-store-seal.json /pnpm-offline-store-seal.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-effective-policy.json /pnpm-effective-policy.json
COPY --from=pnpm-effective-policy-diagnostic /pnpm-offline-store-policy-after.json /source-policy-store-receipt.json
RUN --network=none \
  --mount=type=bind,from=pnpm-store-producer,source=/opt/paimind-enterprise-pnpm-store,target=/opt/paimind-enterprise-pnpm-store,readonly \
  --mount=type=bind,from=build-base,source=/usr/local/include/node,target=/usr/local/include/node,readonly \
  test -n "$PAIMIND_SOURCE_BUILD_RUN" \
  && node ./deploy/enterprise/worker/runtime/worker-build-root-contract.mjs --require=source,store > /source-build-root-contract.json \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" --expected-seal=/pnpm-offline-store-seal.json --require-read-only-mount > /source-install-store-before.json \
  && cmp /source-policy-store-receipt.json /source-install-store-before.json \
  && install -d -o root -g root -m 0700 /tmp/paimind-source-install-home /tmp/paimind-source-install-tmp /tmp/paimind-source-install-node-gyp \
  && export HOME=/tmp/paimind-source-install-home TMPDIR=/tmp/paimind-source-install-tmp CI=true NO_COLOR=1 COREPACK_ENABLE_NETWORK=0 \
    pnpm_config_cache_dir="$PAIMIND_WORKER_PNPM_STORE_ROOT/.cache/pnpm" pnpm_config_minimum_release_age=0 \
    npm_config_nodedir=/usr/local npm_config_devdir=/tmp/paimind-source-install-node-gyp \
  && node ./deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs > /source-install-environment-before.json \
  && node ./deploy/enterprise/worker/runtime/verify-node-gyp-local-headers.mjs /usr/local 24.19.0 linux arm64 137 0 0 > /source-install-headers-before.json \
  && node --input-type=module -e "import { spawnSync } from 'node:child_process'; import { INSTALL_ARGS } from './deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs'; const result = spawnSync('/pnpm/pnpm', [...INSTALL_ARGS, 'install', '--offline', '--frozen-lockfile'], { stdio: 'inherit', env: process.env }); if (result.status !== 0 || result.signal !== null || result.error) process.exit(1)" \
  && node ./deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs > /source-install-environment-after.json \
  && cmp /source-install-environment-before.json /source-install-environment-after.json \
  && node ./deploy/enterprise/worker/runtime/verify-node-gyp-local-headers.mjs /usr/local 24.19.0 linux arm64 137 0 0 > /source-install-headers-after.json \
  && cmp /source-install-headers-before.json /source-install-headers-after.json \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" --expected-seal=/pnpm-offline-store-seal.json --require-read-only-mount > /source-install-store-after.json \
  && cmp /source-install-store-before.json /source-install-store-after.json
RUN --network=none test -n "$PAIMIND_SOURCE_BUILD_RUN" \
  && node ./scripts/build.mjs \
  && node ./deploy/enterprise/worker/runtime/verify-worker-source-build.mjs > /worker-source-build.json

FROM pnpm-effective-policy-report AS worker-source-build-report
COPY --from=worker-source-build /pnpm-offline-store-seal.json /source-consumed-store-seal.json
COPY --from=worker-source-build /source-policy-store-receipt.json /source-policy-store-receipt.json
COPY --from=worker-source-build /source-build-root-contract.json /source-build-root-contract.json
COPY --from=worker-source-build /source-install-store-before.json /source-install-store-before.json
COPY --from=worker-source-build /source-install-store-after.json /source-install-store-after.json
COPY --from=worker-source-build /source-install-environment-before.json /source-install-environment-before.json
COPY --from=worker-source-build /source-install-environment-after.json /source-install-environment-after.json
COPY --from=worker-source-build /source-install-headers-before.json /source-install-headers-before.json
COPY --from=worker-source-build /source-install-headers-after.json /source-install-headers-after.json
COPY --from=worker-source-build /worker-source-build.json /worker-source-build.json

FROM worker-source-build AS worker-deployment
RUN --network=none \
  --mount=type=bind,from=pnpm-store-producer,source=/opt/paimind-enterprise-pnpm-store,target=/opt/paimind-enterprise-pnpm-store,readonly \
  --mount=type=bind,from=build-base,source=/usr/local/include/node,target=/usr/local/include/node,readonly \
  test -n "$PAIMIND_SOURCE_BUILD_RUN" \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" --expected-seal=/pnpm-offline-store-seal.json --require-read-only-mount > /source-deploy-store-before.json \
  && install -d -o root -g root -m 0700 /tmp/paimind-source-deploy-home /tmp/paimind-source-deploy-tmp /tmp/paimind-source-deploy-node-gyp \
  && export HOME=/tmp/paimind-source-deploy-home TMPDIR=/tmp/paimind-source-deploy-tmp CI=true NO_COLOR=1 COREPACK_ENABLE_NETWORK=0 \
    pnpm_config_cache_dir="$PAIMIND_WORKER_PNPM_STORE_ROOT/.cache/pnpm" pnpm_config_minimum_release_age=0 \
    npm_config_nodedir=/usr/local npm_config_devdir=/tmp/paimind-source-deploy-node-gyp \
  && node ./deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs --deploy > /source-deploy-environment-before.json \
  && node ./deploy/enterprise/worker/runtime/verify-node-gyp-local-headers.mjs /usr/local 24.19.0 linux arm64 137 0 0 > /source-deploy-headers-before.json \
  && node --input-type=module -e "import { spawnSync } from 'node:child_process'; import { DEPLOY_ARGS } from './deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs'; const result = spawnSync('/pnpm/pnpm', DEPLOY_ARGS, { stdio: 'inherit', env: process.env }); if (result.status !== 0 || result.signal !== null || result.error) process.exit(1)" \
  && node ./deploy/enterprise/worker/runtime/verify-offline-consumer-environment.mjs --deploy > /source-deploy-environment-after.json \
  && cmp /source-deploy-environment-before.json /source-deploy-environment-after.json \
  && node ./deploy/enterprise/worker/runtime/verify-node-gyp-local-headers.mjs /usr/local 24.19.0 linux arm64 137 0 0 > /source-deploy-headers-after.json \
  && cmp /source-deploy-headers-before.json /source-deploy-headers-after.json \
  && cmp /source-install-headers-before.json /source-deploy-headers-before.json \
  && node ./deploy/enterprise/worker/runtime/verify-pnpm-offline-store.mjs "$PAIMIND_WORKER_PNPM_STORE_ROOT" --expected-seal=/pnpm-offline-store-seal.json --require-read-only-mount > /source-deploy-store-after.json \
  && cmp /source-deploy-store-before.json /source-deploy-store-after.json
RUN --network=none test -n "$PAIMIND_SOURCE_BUILD_RUN" \
  && node ./deploy/enterprise/worker/runtime/worker-build-root-contract.mjs --require=source,deploy > /source-deploy-root-contract.json \
  && node ./deploy/enterprise/worker/runtime/verify-worker-deployment.mjs > /worker-deployment.json

FROM worker-source-build-report AS worker-deployment-report
COPY --from=worker-deployment /source-deploy-root-contract.json /source-deploy-root-contract.json
COPY --from=worker-deployment /source-deploy-store-before.json /source-deploy-store-before.json
COPY --from=worker-deployment /source-deploy-store-after.json /source-deploy-store-after.json
COPY --from=worker-deployment /source-deploy-environment-before.json /source-deploy-environment-before.json
COPY --from=worker-deployment /source-deploy-environment-after.json /source-deploy-environment-after.json
COPY --from=worker-deployment /source-deploy-headers-before.json /source-deploy-headers-before.json
COPY --from=worker-deployment /source-deploy-headers-after.json /source-deploy-headers-after.json
COPY --from=worker-deployment /worker-deployment.json /worker-deployment.json

FROM worker-deployment AS worker-runtime
RUN --network=none node ./deploy/enterprise/worker/runtime/prepare-worker-runtime.mjs > /worker-runtime.json

FROM worker-deployment-report AS worker-runtime-report
COPY --from=worker-runtime /worker-runtime.json /worker-runtime.json

FROM build-toolchain AS worker-execution-tools
WORKDIR /build
# Fixed official source, no setuid build. The producer alone may use the
# network; the downloaded bytes are checked before extraction or compilation.
RUN apt-get update && apt-get install --yes --no-install-recommends meson ninja-build pkg-config libcap-dev curl xz-utils ca-certificates \
  && curl --fail --location --header 'Accept: application/octet-stream' \
    https://api.github.com/repos/containers/bubblewrap/releases/assets/403245431 --output bubblewrap.tar.xz \
  && printf '%s  %s\n' 69abc30005d2186baf7737feacd8da35633b93cf5af38838ecff17c5f8e924f6 bubblewrap.tar.xz | sha256sum --check - \
  && tar -xf bubblewrap.tar.xz \
  && meson setup build bubblewrap-0.11.2 --prefix=/usr/local -Dsupport_setuid=false -Dselinux=disabled -Dman=disabled -Dtests=false -Dbash_completion=disabled -Dzsh_completion=disabled \
  && ninja -C build && test "$(build/bwrap --version)" = 'bubblewrap 0.11.2'
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/execution-launch.c /build/execution-launch.c
RUN --network=none gcc -std=c11 -Wall -Wextra -Werror -Wformat=2 -Wconversion -Wshadow -O2 \
  -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now -o /build/execution-launch /build/execution-launch.c

# A real native boot candidate, never an admitted enterprise Worker image.
# No control-plane process, credential, user volume, or build toolchain is copied.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS worker-runtime-candidate
ARG PAIMIND_CANDIDATE_SOURCE_DIGEST
ARG PAIMIND_CANDIDATE_POLICY_DIGEST
ARG PAIMIND_CANDIDATE_TREE_DIGEST
LABEL io.paimind.acceptance="native-runtime-candidate-not-admitted" \
  io.paimind.source-digest="$PAIMIND_CANDIDATE_SOURCE_DIGEST" \
  io.paimind.policy-digest="$PAIMIND_CANDIDATE_POLICY_DIGEST" \
  io.paimind.runtime-tree-digest="$PAIMIND_CANDIDATE_TREE_DIGEST"
RUN apt-get update && apt-get install --yes --no-install-recommends libcap2
RUN --network=none groupadd --gid 10001 paimind-runtime \
  && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /var/lib/paimind/home --shell /usr/sbin/nologin paimind-runtime \
  && install -d -o 10001 -g 10001 -m 0700 /var/lib/paimind
COPY --from=worker-runtime --chown=0:0 /runtime-deploy /opt/paimind
COPY --from=worker-runtime --chown=0:0 --chmod=0444 /worker-runtime.json /usr/share/paimind/worker-runtime.json
COPY --from=worker-runtime --chown=0:0 --chmod=0444 /pnpm-effective-policy.json /usr/share/paimind/pnpm-effective-policy.json
# The host's frozen context is private (umask 077). That privacy must not make
# image code unreadable to the fixed non-root runtime user; no secrets live here.
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/start-native-runtime.mjs /usr/local/lib/paimind/start-native-runtime.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/native-ingress.mjs /usr/local/lib/paimind/native-ingress.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/native-control.mjs /usr/local/lib/paimind/native-control.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/member-tool-policy.mjs /usr/local/lib/paimind/member-tool-policy.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/boot-native-runtime.mjs /usr/local/lib/paimind/boot-native-runtime.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/prepare-native-storage.mjs /usr/local/lib/paimind/prepare-native-storage.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/prepared-storage.mjs deploy/enterprise/worker/runtime/run-prepared-runtime.mjs deploy/enterprise/worker/runtime/confine-execution.mjs /usr/local/lib/paimind/
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/active-storage.mjs /usr/local/lib/paimind/
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/storage-lock.mjs /usr/local/lib/paimind/
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/recover-native-storage.mjs /usr/local/lib/paimind/
COPY --from=worker-execution-tools --chown=0:0 --chmod=0555 /build/build/bwrap /usr/local/bin/bwrap
COPY --from=worker-execution-tools --chown=0:0 --chmod=0555 /build/execution-launch /usr/local/libexec/paimind-execution-launch
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/managed-profile/ /usr/share/paimind/managed/profiles/web/
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/verify-worker-deployment.mjs /usr/local/lib/paimind/verify-worker-deployment.mjs
COPY --chown=0:0 --chmod=0444 deploy/enterprise/worker/runtime/worker-build-root-contract.mjs /usr/local/lib/paimind/worker-build-root-contract.mjs
# COPY --chmod also affects newly created parent directories in the current
# builder. Files stay read-only, but their exact parent directories must be
# searchable by the non-root runtime user. Do this after all support COPYs.
RUN --network=none chmod 0555 /usr/local/lib/paimind /usr/share/paimind \
    /usr/share/paimind/managed /usr/share/paimind/managed/profiles /usr/share/paimind/managed/profiles/web \
  && ln -s /opt/paimind/node_modules /usr/share/paimind/managed/profiles/web/node_modules \
  && ln -s /opt/paimind/profiles/node_modules /usr/share/paimind/managed/profiles/node_modules
ENV NODE_ENV=production HOME=/var/lib/paimind/home DSH_HOME=/var/lib/paimind/dsh-home \
  PATH=/usr/local/bin:/usr/bin:/bin
USER 10001:10001
WORKDIR /var/lib/paimind
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/node", "/usr/local/lib/paimind/start-native-runtime.mjs"]
