import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ContextAdoption } from "../src/client/adoption.js";
import type { ContextRemoteApi } from "../src/client/section.js";
import type {
  ContextInput,
  ContextMount,
  ContextResult,
} from "../src/contract.js";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
});
afterEach(cleanup);
const collection = {
  id: "c",
  owner: "local",
  title: "产品资料",
  description: "",
  revision: 1,
  updatedAt: 0,
};
function fixture() {
  let mounts: ContextMount[] = [];
  let release = () => {};
  const request = vi.fn(async (input: ContextInput) => {
    let value: ContextResult = {};
    if (input.action === "targets")
      value = {
        targets: [
          {
            target: { kind: "workspace", id: "native-workspace" },
            title: "新工作区",
          },
        ],
      };
    if (input.action === "collections") value = { collections: [collection] };
    if (input.action === "mounts") value = { mounts };
    if (input.action === "setMount") {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      mounts = [
        {
          id: "m",
          collectionId: "c",
          target: input.target!,
          mode: input.mode!,
          revision: 1,
        },
      ];
    }
    return { ok: true as const, value };
  });
  return {
    api: { request } satisfies ContextRemoteApi,
    request,
    release: () => release(),
  };
}
function adopted(id = "native-workspace") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent("paimind:workspace-adopted", {
        detail: { workspaceId: id, sessionId: "native-session" },
      }),
    );
  });
}
it("keeps adoption unconnected until the user chooses a grant and saves only against the real workspace", async () => {
  const f = fixture();
  render(<ContextAdoption api={f.api} />);
  adopted();
  const select = await screen.findByRole("combobox", {
    name: "产品资料的访问权限",
  });
  expect(select).toHaveValue("none");
  expect(
    f.request.mock.calls.some(([input]) => input.action === "setMount"),
  ).toBe(false);
  fireEvent.change(select, { target: { value: "read" } });
  expect(
    await screen.findByRole("button", { name: "正在保存连接…" }),
  ).toBeDisabled();
  await act(async () => {
    f.release();
  });
  await waitFor(() => expect(select).toHaveValue("read"));
  expect(f.request).toHaveBeenCalledWith({
    action: "setMount",
    target: { kind: "workspace", id: "native-workspace" },
    collectionId: "c",
    mode: "read",
    expectedRevision: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "完成，继续工作" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("does not offer connections for an unregistered identity and removes its listener on disposal", async () => {
  const f = fixture();
  const view = render(<ContextAdoption api={f.api} />);
  adopted("forged-workspace");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "新工作区暂不可用",
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(f.request).toHaveBeenCalledTimes(1);
  view.unmount();
  adopted();
  expect(f.request).toHaveBeenCalledTimes(1);
});
