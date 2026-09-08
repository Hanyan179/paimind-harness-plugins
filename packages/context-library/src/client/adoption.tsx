import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ContextConnections,
  contextResult,
  type ContextRemoteApi,
} from "./section.js";

/** Optional, source-owned setup after the host has created a real workspace. */
export function ContextAdoption({
  api,
}: {
  api: ContextRemoteApi;
}): React.JSX.Element | null {
  const [workspaceId, setWorkspaceId] = useState("");
  useEffect(() => {
    const adopted = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (
        id &&
        typeof id === "object" &&
        "workspaceId" in id &&
        typeof id.workspaceId === "string" &&
        id.workspaceId.length <= 200
      )
        setWorkspaceId(id.workspaceId);
    };
    window.addEventListener("paimind:workspace-adopted", adopted);
    return () =>
      window.removeEventListener("paimind:workspace-adopted", adopted);
  }, []);
  return workspaceId ? (
    <Setup
      key={workspaceId}
      api={api}
      workspaceId={workspaceId}
      close={() => setWorkspaceId("")}
    />
  ) : null;
}

function Setup({
  api,
  workspaceId,
  close,
}: {
  api: ContextRemoteApi;
  workspaceId: string;
  close: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    void contextResult(api, { action: "targets" })
      .then((result) => {
        if (!live) return;
        const target = result.targets?.find(
          (item) =>
            item.target.kind === "workspace" && item.target.id === workspaceId,
        );
        if (!target)
          throw new Error(
            "新工作区暂不可用；稍后可以从会话的资料页签配置连接。",
          );
        setTitle(target.title);
      })
      .catch((reason) => {
        if (live) setError(String(reason));
      });
    return () => {
      live = false;
    };
  }, [api, workspaceId]);
  return createPortal(
    <dialog
      ref={dialog}
      className="cl-adoption"
      aria-labelledby="cl-adoption-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
    >
      <h2 id="cl-adoption-title">连接工作区资料（可选）</h2>
      <p>新工作区已创建。选择本次工作需要的资料及权限，也可以直接开始。</p>
      {error && <p role="alert">{error}</p>}
      {title ? (
        <>
          <p style={{ overflowWrap: "anywhere" }}>{title}</p>
          <ContextConnections
            api={api}
            target={{ kind: "workspace", id: workspaceId }}
            onPendingChange={setBusy}
          />
        </>
      ) : (
        !error && <p role="status">正在确认工作区…</p>
      )}
      <p>
        选择后立即保存，可随时在会话的“资料”页签调整；模板不会携带这些授权。
      </p>
      <button type="button" disabled={busy} onClick={close}>
        {busy ? "正在保存连接…" : "完成，继续工作"}
      </button>
    </dialog>,
    document.body,
  );
}
