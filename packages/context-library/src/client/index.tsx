import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  markHarnessClientStyle,
  contributePaimindExtension,
  type HarnessRemoteMountService,
  type PaimindClientContext,
} from "@hansen/harness-compat";
import { PaimindTemplateIcon } from "@hansen/harness-compat/client-icons";
import {
  PaimindProductSurfaceController,
  resolvePaimindProductCenterHost,
  installPaimindProductCenterHost,
  installPaimindProductSurfaceInteraction,
  type PaimindProductCenterHost,
} from "@hansen/harness-compat/client-surface";
import type { PaimindSidebarService } from "@hansen/better-sidebar-adapter";
import { CONTEXT_LIBRARY_CSS } from "./styles.js";
import TYPERT_REMOTE from "../remote.js";
import { ContextAdoption } from "./adoption.js";
import type { ContextResult } from "../contract.js";
import {
  ContextLibrarySection,
  ContextConnections,
  contextResult,
  type ContextRemoteApi,
} from "./section.js";
export {
  ContextLibrarySection,
  ContextConnections,
  contextResult,
  type ContextRemoteApi,
} from "./section.js";
export const name = "paimind-context-library-client";
export const inject = ["slots", "remote", "locale"];
const STYLE_ID = "paimind-context-library-style";
function ContextSessionPanel({
  api,
  sessionId,
  workspaceId,
}: {
  api: ContextRemoteApi;
  sessionId: string;
  workspaceId: string | undefined;
}): React.JSX.Element {
  const [effective, setEffective] = useState<ContextResult["effective"]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () => {
      void contextResult(api, { action: "effective", sessionId })
        .then((r) => {
          if (live) setEffective(r.effective);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, sessionId]);
  return (
    <section data-context-session>
      <h2>当前会话的资料</h2>
      {error && <p role="alert">{error}</p>}
      {effective?.length ? (
        effective.map((e) => (
          <article key={e.collection.id}>
            <strong>
              {e.collection.title} · {e.mode === "write" ? "读写" : "只读"}
            </strong>
            <p>{e.collection.description}</p>
            <small>
              授权来源：
              {e.sources
                .map(
                  (s) =>
                    ({ agent: "智能体", workspace: "工作区", session: "会话" })[
                      s.target.kind
                    ] +
                    "（" +
                    (s.mode === "write" ? "读写" : "只读") +
                    "）",
                )
                .join("、")}
            </small>
          </article>
        ))
      ) : (
        <p>当前会话没有连接资料。</p>
      )}
      <ContextConnections
        api={api}
        target={{ kind: "session", id: sessionId }}
      />
      {workspaceId && (
        <ContextConnections
          api={api}
          target={{ kind: "workspace", id: workspaceId }}
        />
      )}
    </section>
  );
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? (
      <p role="alert">资料库暂时不可用，请重新打开。</p>
    ) : (
      this.props.children
    );
  }
}

interface SurfaceProps {
  readonly api: ContextRemoteApi;
  readonly controller: PaimindProductSurfaceController;
}
function ContextTrigger({
  controller,
  wide,
}: {
  readonly controller: PaimindProductSurfaceController;
  readonly wide: boolean;
}): React.JSX.Element {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return (
    <button
      data-paimind-product-trigger="context-library"
      data-paimind-navigation-label="资料"
      data-paimind-navigation-description="管理可复用的资料文件"
      data-paimind-navigation-group="能力与工具"
      data-wide={wide}
      aria-label="打开资料库"
      aria-expanded={state.open}
      aria-current={state.open ? "page" : undefined}
      onClick={(event) => {
        controller.toggle(event.currentTarget);
      }}
    >
      <PaimindTemplateIcon size={wide ? 16 : 18} />
      {wide && <span>资料库</span>}
    </button>
  );
}
function ContextSurface(props: SurfaceProps): ReactNode {
  const state = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  );
  return state.open ? <MountedContextSurface {...props} /> : null;
}
function MountedContextSurface({ api, controller }: SurfaceProps): ReactNode {
  const [host, setHost] = useState<Readonly<PaimindProductCenterHost> | null>(
    null,
  );
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const target = resolvePaimindProductCenterHost();
    const release =
      target === null ? null : installPaimindProductCenterHost(target);
    if (!target || !release) {
      controller.close(false);
      return;
    }
    setHost(target);
    return release;
  }, [controller]);
  useEffect(() => {
    if (host && root.current)
      return installPaimindProductSurfaceInteraction(root.current, controller);
  }, [host, controller]);
  return host === null
    ? null
    : createPortal(
        <main
          ref={root}
          data-paimind-product-surface="context-library"
          aria-label="资料库"
        >
          <ContextLibrarySection
            api={api}
            blockClose={() => controller.blockClose()}
            close={() => {
              controller.close();
            }}
          />
        </main>,
        host.mount,
      );
}
interface ContextClientContext extends PaimindClientContext {
  readonly paimindSidebar: PaimindSidebarService;
  readonly remote: HarnessRemoteMountService & {
    readonly paimindContextLibrary?: ContextRemoteApi;
  };
  inject(
    services: readonly string[],
    install: (scope: ContextClientContext) => void,
    label?: string,
  ): PromiseLike<unknown> & { dispose(): Promise<void> };
}
export async function apply(
  ctx: ContextClientContext,
): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      CONTEXT_LIBRARY_CSS +
      ".cl-adoption{width:min(560px,90vw);max-height:85vh;overflow:auto;padding:28px;border:1px solid var(--dsw-alias-border-l1,#d7dbe4);border-radius:16px;background:var(--dsw-alias-bg-layer-2,white);color:var(--dsw-alias-label-primary,#242833);font:14px/1.6 system-ui}.cl-adoption::backdrop{background:#0006}.cl-adoption>button{display:block;margin:20px 0 0 auto;padding:10px 16px;border:0;border-radius:8px;background:#5d63c7;color:white;font:inherit;cursor:pointer}.cl-adoption>button:disabled{opacity:.5}";
    markHarnessClientStyle(style, "@hansen/context-library");
    document.head.append(style);
    return () => {
      style.remove();
    };
  }, "paimind-context-library: style");
  const mounted = ctx.inject(
    [...inject, "remote.paimindContextLibrary"],
    (scope) => {
      const api = scope.remote.paimindContextLibrary;
      if (!api) throw new Error("Context Library Remote did not mount");
      const controller = new PaimindProductSurfaceController("context-library");
      scope.effect(() => {
        const extension = scope.inject(["paimindSidebar"], (sidebar) => {
          sidebar.effect(
            () =>
              sidebar.paimindSidebar.registerTab({
                id: "paimind:context-library",
                titleZh: "资料",
                titleEn: "Context",
                order: 50,
                render: (tab) => (
                  <ContextSessionPanel
                    api={api}
                    sessionId={tab.sessionId}
                    workspaceId={tab.workspaceId}
                  />
                ),
              }),
            "context-library: session panel",
          );
        });
        return () => {
          void extension.dispose();
        };
      }, "context-library: optional sidebar");
      scope.slots.inject("paimind.agent.resources", () =>
        scope.slots.register(
          {
            name: "paimind.agent.resources",
            id: "paimind-context-connections",
            order: 10,
            inject: () => ({ api }),
          },
          (props: { api: ContextRemoteApi; agentId: string }) => (
            <ContextConnections
              api={props.api}
              target={{ kind: "agent", id: props.agentId }}
            />
          ),
        ),
      );
      scope.effect(
        () => () => {
          controller.dispose();
        },
        "paimind-context-library: surface lifecycle",
      );
      contributePaimindExtension(scope.slots, {
        id: "paimind:context-library",
        packageName: "@hansen/context-library",
        nameZh: "资料库",
        nameEn: "Context Library",
        descriptionZh: "整理资料文件，查看资料被谁使用。",
        descriptionEn: "Organize reusable files and see where they are used.",
        category: "skills-tools",
        surface: "shell",
        maturity: "technical-preview",
        order: 35,
      });
      scope.slots.inject("sidebar.footer.action", () =>
        scope.slots.register(
          {
            name: "sidebar.footer.action",
            id: "paimind-context-library-trigger",
            order: -10,
            label: () => "资料库",
            inject: () => ({ controller }),
          },
          (props: {
            readonly wide: boolean;
            readonly controller: PaimindProductSurfaceController;
          }) => <ContextTrigger {...props} />,
        ),
      );
      scope.slots.inject("shell.overlay", () =>
        scope.slots.register(
          {
            name: "shell.overlay",
            id: "paimind-context-library-surface",
            order: 12,
            inject: () => ({ api, controller }),
          },
          (props: SurfaceProps) => (
            <Boundary>
              <ContextSurface {...props} />
              <ContextAdoption api={props.api} />
            </Boundary>
          ),
        ),
      );
      scope.slots.inject("settings.section", () =>
        scope.slots.register(
          {
            name: "settings.section",
            id: "paimind-context-library",
            order: 35,
            label: () => "资料库",
            inject: () => ({ api }),
          },
          (props) => (
            <Boundary>
              <ContextLibrarySection
                {...(props as { api: ContextRemoteApi })}
                close={() => {
                  controller.close();
                }}
              />
            </Boundary>
          ),
        ),
      );
    },
  );
  try {
    await mounted;
  } catch (error) {
    await disposeRemote();
    throw error;
  }
  return async () => {
    await mounted.dispose();
    await disposeRemote();
  };
}
