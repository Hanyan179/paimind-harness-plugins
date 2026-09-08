import { useEffect, useRef, useState } from "react";
import type { HarnessRemoteResult } from "@hansen/harness-compat";
import type {
  ContextCollection,
  ContextEntry,
  ContextInput,
  ContextMount,
  ContextRead,
  ContextResult,
  ContextTarget,
} from "../contract.js";
export interface ContextRemoteApi {
  request(input: ContextInput): Promise<HarnessRemoteResult<ContextResult>>;
}
export async function contextResult(
  api: ContextRemoteApi,
  input: ContextInput,
): Promise<ContextResult> {
  const r = await api.request(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const op = () => crypto.randomUUID();
const label = (target: ContextTarget) =>
  ({ agent: "智能体", workspace: "工作区", session: "会话" })[target.kind];
export function ContextConnections({
  api,
  target,
  onPendingChange,
}: {
  api: ContextRemoteApi;
  target: ContextTarget;
  onPendingChange?: (pending: boolean) => void;
}): React.JSX.Element {
  const [collections, setCollections] = useState<ContextCollection[]>([]),
    [mounts, setMounts] = useState<ContextMount[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    onPendingChange?.(busy);
  }, [busy, onPendingChange]);
  const load = async () => {
    const [c, m] = await Promise.all([
      contextResult(api, { action: "collections" }),
      contextResult(api, { action: "mounts", target }),
    ]);
    setCollections(c.collections ?? []);
    setMounts(m.mounts ?? []);
  };
  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [target.kind, target.id]);
  const change = async (c: ContextCollection, value: string) => {
    setBusy(true);
    setError("");
    try {
      const current = mounts.find((m) => m.collectionId === c.id);
      if (value === "none" && current)
        await contextResult(api, {
          action: "removeMount",
          mountId: current.id,
          expectedRevision: current.revision,
        });
      else if (value !== "none")
        await contextResult(api, {
          action: "setMount",
          target,
          collectionId: c.id,
          mode: value === "write" ? "write" : "read",
          expectedRevision: current?.revision ?? null,
        });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-context-connections>
      <h3>{label(target)}的资料连接</h3>
      <p>连接保持引用。读写允许修改文件；其他连接的授权仍然有效。</p>
      {error && <p role="alert">{error}</p>}
      {collections.length === 0 ? (
        <p>还没有资料夹，请先在资料库中创建。</p>
      ) : (
        collections.map((c) => (
          <label className="cl-connection" key={c.id}>
            <span>{c.title}</span>
            <select
              aria-label={`${c.title}的访问权限`}
              disabled={busy}
              value={
                mounts.find((m) => m.collectionId === c.id)?.mode ?? "none"
              }
              onChange={(e) => {
                void change(c, e.target.value);
              }}
            >
              <option value="none">未连接</option>
              <option value="read">只读</option>
              <option value="write">读写</option>
            </select>
          </label>
        ))
      )}
    </section>
  );
}
export function ContextLibrarySection({
  api,
  close,
  initialTarget,
  blockClose,
}: {
  api: ContextRemoteApi;
  close: () => void;
  initialTarget?: ContextTarget | undefined;
  blockClose?: () => () => void;
}): React.JSX.Element {
  const [collections, setCollections] = useState<ContextCollection[]>([]),
    [selected, setSelected] = useState(""),
    [path, setPath] = useState(""),
    [entries, setEntries] = useState<ContextEntry[]>([]),
    [document, setDocument] = useState<ContextRead | null>(null),
    [draft, setDraft] = useState(""),
    [fileDescription, setFileDescription] = useState(""),
    [draftRevision, setDraftRevision] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [newName, setNewName] = useState(""),
    [description, setDescription] = useState(""),
    [targets, setTargets] = useState<NonNullable<ContextResult["targets"]>>([]),
    [target, setTarget] = useState<ContextTarget | undefined>(initialTarget),
    [mounts, setMounts] = useState<ContextMount[]>([]),
    [recycle, setRecycle] = useState(false);
  const [promptState, setPromptState] = useState<{
    title: string;
    value: string;
  } | null>(null);
  const promptResolve = useRef<((value: string | null) => void) | null>(null);
  const prompt = (title: string, value = "") =>
    new Promise<string | null>((resolve) => {
      promptResolve.current = resolve;
      setPromptState({ title, value });
    });
  const finishPrompt = (value: string | null) => {
    promptResolve.current?.(value);
    promptResolve.current = null;
    setPromptState(null);
  };
  const upload = useRef<HTMLInputElement>(null),
    folderUpload = useRef<HTMLInputElement>(null);
  const dirty =
    document !== null &&
    (draft !== document.content ||
      fileDescription !== document.entry.description);
  const draftKey = (filePath: string) =>
    "paimind-library-draft:" + selected + ":" + filePath;
  const remember = (content: string, desc: string) => {
    if (!document) return;
    try {
      sessionStorage.setItem(
        draftKey(document.entry.path),
        JSON.stringify({
          content,
          description: desc,
          revision: draftRevision ?? document.entry.revision,
        }),
      );
    } catch {
      setError("浏览器无法暂存草稿，请保持页面开启并保存。");
    }
  };
  const forget = () => {
    if (document) sessionStorage.removeItem(draftKey(document.entry.path));
  };
  useEffect(() => {
    if (dirty) return blockClose?.();
  }, [dirty, blockClose]);
  useEffect(
    () => () => {
      promptResolve.current?.(null);
    },
    [],
  );
  const request = (input: ContextInput) => contextResult(api, input);
  const load = async () => {
    const c = await request({ action: "collections" });
    setCollections(c.collections ?? []);
    if (selected) {
      const [e, m] = await Promise.all([
        request({
          action: recycle ? "recycle" : "list",
          collectionId: selected,
          path: recycle ? "" : path,
        }),
        request({ action: "mounts", collectionId: selected }),
      ]);
      setEntries(e.entries ?? []);
      setMounts(m.mounts ?? []);
    }
  };
  const act = async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [selected, path, recycle]);
  useEffect(() => {
    void request({ action: "targets" })
      .then((r) => setTargets(r.targets ?? []))
      .catch((e) => setError(String(e)));
  }, []);
  const canLeave = () => {
    if (dirty) {
      setError("请先保存修改，或点击放弃当前编辑。");
      return false;
    }
    return true;
  };
  const read = async (entry: ContextEntry) => {
    if (!canLeave()) return;
    if (entry.kind === "directory") {
      setDocument(null);
      setPath(entry.path);
      return;
    }
    const r = await request({
      action: "read",
      collectionId: selected,
      path: entry.path,
    });
    setDocument(r.document ?? null);
    setDraft(r.document?.content ?? "");
    setFileDescription(r.document?.entry.description ?? "");
    setDraftRevision(r.document?.entry.revision ?? null);
    if (r.document?.encoding === "utf8" && r.document.nextOffset === null) {
      try {
        const saved = sessionStorage.getItem(draftKey(entry.path));
        if (saved) {
          const d = JSON.parse(saved) as {
            content: string;
            description: string;
            revision: string;
          };
          if (
            d.content === r.document.content &&
            d.description === r.document.entry.description
          )
            sessionStorage.removeItem(draftKey(entry.path));
          else {
            setDraft(d.content);
            setFileDescription(d.description);
            setDraftRevision(d.revision);
            setNotice("已恢复未提交草稿。保存时仍检查草稿读取时的文件版本。");
          }
        }
      } catch {
        setError("未提交草稿无法读取；已保留浏览器记录。");
      }
    }
  };
  const fileBytes = async (entry: ContextEntry) => {
    const pieces: Uint8Array[] = [];
    let offset = 0;
    let revision: string | null = null;
    do {
      const r = (
        await request({
          action: "read",
          collectionId: selected,
          path: entry.path,
          offset,
          limit: 65536,
        })
      ).document!;
      if (revision !== null && revision !== r.entry.revision)
        throw new Error("VERSION_CONFLICT: 下载期间文件已变化，请重试");
      revision = r.entry.revision;
      pieces.push(
        r.encoding === "base64"
          ? Uint8Array.from(atob(r.content), (c) => c.charCodeAt(0))
          : new TextEncoder().encode(r.content),
      );
      if (r.nextOffset === null) break;
      offset = r.nextOffset;
    } while (true);
    return new Blob(pieces as BlobPart[], { type: entry.contentType });
  };
  const download = async (entry: ContextEntry) => {
    const blob = await fileBytes(entry);
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = entry.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files || !canLeave()) return;
    await act(async () => {
      for (const file of Array.from(files)) {
        const relative = file.webkitRelativePath || file.name;
        const destination = path ? `${path}/${relative}` : relative;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        let expectedRevision: string | null = null;
        try {
          expectedRevision = (
            await request({
              action: "read",
              collectionId: selected,
              path: destination,
              limit: 1,
            })
          ).document!.entry.revision;
        } catch (e) {
          if (!String(e).includes("ENOENT")) throw e;
        }
        if (expectedRevision !== null) {
          const answer = await prompt(
            "覆盖已存在文件？输入“覆盖”以保存 " + destination,
          );
          if (answer !== "覆盖") continue;
        }
        await request({
          action: "write",
          collectionId: selected,
          path: destination,
          content: btoa(binary),
          encoding: "base64",
          expectedRevision,
          operationId: op(),
        });
      }
      setNotice("文件已上传");
    });
  };
  const current = collections.find((c) => c.id === selected);
  return (
    <section data-context-library data-paimind-ui-scope>
      <header className="cl-header">
        <div>
          <small>上下文与文件</small>
          <h2>资料库</h2>
          <p>整理长期资料，并按需要连接给智能体、工作区或会话。</p>
        </div>
        <button
          onClick={() => {
            if (canLeave()) close();
          }}
        >
          关闭
        </button>
      </header>
      {error && (
        <p className="cl-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="cl-columns">
        <aside>
          <h3>资料夹</h3>
          <div className="cl-create">
            <input
              aria-label="资料夹名称"
              placeholder="新资料夹名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              disabled={busy || !newName.trim()}
              onClick={() => {
                if (!canLeave()) return;
                void act(async () => {
                  const r = await request({
                    action: "createCollection",
                    title: newName,
                    description,
                  });
                  setNewName("");
                  setDescription("");
                  setSelected(r.collection!.id);
                  setPath("");
                  setDocument(null);
                });
              }}
            >
              新建
            </button>
          </div>
          <input
            aria-label="资料夹用途说明"
            placeholder="用途说明（可选）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {collections.map((c) => (
            <button
              className="cl-folder"
              aria-current={selected === c.id ? "page" : undefined}
              key={c.id}
              onClick={() => {
                if (canLeave()) {
                  setSelected(c.id);
                  setPath("");
                  setDocument(null);
                  setRecycle(false);
                }
              }}
            >
              <strong>{c.title}</strong>
              <small>{c.description || "暂无用途说明"}</small>
            </button>
          ))}
          <hr />
          <h3>连接位置</h3>
          <select
            aria-label="配置连接位置"
            value={target ? `${target.kind}:${target.id}` : ""}
            onChange={(e) =>
              setTarget(
                targets.find(
                  (t) => `${t.target.kind}:${t.target.id}` === e.target.value,
                )?.target,
              )
            }
          >
            <option value="">选择智能体、工作区或会话</option>
            {targets.map((t) => (
              <option
                key={`${t.target.kind}:${t.target.id}`}
                value={`${t.target.kind}:${t.target.id}`}
              >
                {label(t.target)} · {t.title}
              </option>
            ))}
          </select>
          {target && <ContextConnections api={api} target={target} />}
        </aside>
        <main>
          {current ? (
            <>
              <div className="cl-toolbar">
                <h3>{current.title}</h3>
                <button
                  disabled={busy}
                  onClick={async () => {
                    const title = await prompt("资料夹名称", current.title);
                    if (title !== null) {
                      const desc = await prompt(
                        "资料夹用途说明",
                        current.description,
                      );
                      if (desc !== null)
                        void act(async () => {
                          await request({
                            action: "updateCollection",
                            collectionId: selected,
                            title,
                            description: desc,
                            expectedRevision: current.revision,
                          });
                        });
                    }
                  }}
                >
                  资料夹设置
                </button>
                <button
                  onClick={() => {
                    if (canLeave()) {
                      setRecycle(!recycle);
                      setDocument(null);
                    }
                  }}
                >
                  {recycle ? "返回文件" : "回收区"}
                </button>
              </div>
              <p>{current.description}</p>
              {!recycle && (
                <>
                  <div className="cl-toolbar">
                    <button
                      disabled={busy}
                      onClick={() => upload.current?.click()}
                    >
                      上传文件
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => folderUpload.current?.click()}
                    >
                      上传文件夹
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        const name = await prompt("文件夹名称");
                        if (name)
                          void act(async () => {
                            await request({
                              action: "mkdir",
                              collectionId: selected,
                              path: path ? `${path}/${name}` : name,
                              operationId: op(),
                            });
                          });
                      }}
                    >
                      新建文件夹
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        const name = await prompt("文件名称", "未命名.md");
                        if (name)
                          void act(async () => {
                            await request({
                              action: "write",
                              collectionId: selected,
                              path: path ? `${path}/${name}` : name,
                              content: "",
                              expectedRevision: null,
                              operationId: op(),
                            });
                          });
                      }}
                    >
                      新建文件
                    </button>
                  </div>
                  <input
                    hidden
                    type="file"
                    multiple
                    ref={upload}
                    onChange={(e) => {
                      void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <input
                    hidden
                    type="file"
                    multiple
                    ref={folderUpload}
                    {...{ webkitdirectory: "" }}
                    onChange={(e) => {
                      void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <form
                    className="cl-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        const r = await request({
                          action: "search",
                          collectionId: selected,
                          query,
                        });
                        setNotice(
                          (r.hits ?? [])
                            .map((h) => `${h.path} — ${h.snippet}`)
                            .join("\n") || "没有匹配资料",
                        );
                      });
                    }}
                  >
                    <input
                      aria-label="搜索资料正文"
                      placeholder="搜索名称、说明或文本正文"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button disabled={busy || !query}>搜索</button>
                  </form>
                </>
              )}
              <div className="cl-toolbar">
                <button
                  disabled={!path || busy}
                  onClick={() => {
                    if (canLeave()) {
                      setPath(path.split("/").slice(0, -1).join("/"));
                      setDocument(null);
                    }
                  }}
                >
                  上一级
                </button>
                <span>{recycle ? "回收区" : path || "全部文件"}</span>
              </div>
              <div className="cl-files">
                {entries.length === 0 ? (
                  <p>此目录还没有文件。</p>
                ) : (
                  entries.map((entry) => (
                    <div className="cl-row" key={entry.path}>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (!recycle) void act(() => read(entry));
                        }}
                      >
                        <span>{entry.kind === "directory" ? "▸" : "◻"}</span>{" "}
                        {entry.name}
                      </button>
                      <small>
                        {entry.kind === "directory"
                          ? "文件夹"
                          : `${entry.bytes.toLocaleString()} 字节`}
                      </small>
                      {recycle ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            void act(async () => {
                              await request({
                                action: "restore",
                                collectionId: selected,
                                path: entry.path,
                                operationId: op(),
                              });
                            });
                          }}
                        >
                          恢复
                        </button>
                      ) : (
                        <>
                          {entry.kind !== "directory" && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                void act(() => download(entry));
                              }}
                            >
                              下载
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={async () => {
                              if (!canLeave()) return;
                              const toPath = await prompt(
                                "新的相对路径",
                                entry.path,
                              );
                              if (toPath && toPath !== entry.path)
                                void act(async () => {
                                  await request({
                                    action: "move",
                                    collectionId: selected,
                                    path: entry.path,
                                    toPath,
                                    expectedRevision: entry.revision,
                                    operationId: op(),
                                  });
                                  setDocument(null);
                                });
                            }}
                          >
                            移动
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (!canLeave()) return;
                              void act(async () => {
                                await request({
                                  action: "trash",
                                  collectionId: selected,
                                  path: entry.path,
                                  expectedRevision: entry.revision,
                                  operationId: op(),
                                });
                                setDocument(null);
                              });
                            }}
                          >
                            回收
                          </button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
              {document && (
                <section className="cl-editor">
                  <h3>{document.entry.path}</h3>
                  {dirty && (
                    <button
                      onClick={() => {
                        forget();
                        setDraft(document.content);
                        setFileDescription(document.entry.description);
                        setDraftRevision(document.entry.revision);
                        setError("");
                      }}
                    >
                      放弃当前编辑
                    </button>
                  )}
                  {document.encoding === "utf8" ? (
                    <>
                      <input
                        aria-label="文件说明"
                        value={fileDescription}
                        onChange={(e) => {
                          setFileDescription(e.target.value);
                          remember(draft, e.target.value);
                        }}
                        disabled={document.nextOffset !== null}
                      />
                      <textarea
                        aria-label="资料正文"
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          remember(e.target.value, fileDescription);
                        }}
                        disabled={document.nextOffset !== null}
                      />
                      {document.nextOffset !== null ? (
                        <p>大文件显示部分内容，请下载后编辑并重新上传。</p>
                      ) : (
                        <button
                          disabled={busy || !dirty}
                          onClick={() => {
                            void act(async () => {
                              await request({
                                action: "write",
                                collectionId: selected,
                                path: document.entry.path,
                                content: draft,
                                description: fileDescription,
                                expectedRevision: draftRevision,
                                operationId: op(),
                              });
                              const updated = (
                                await request({
                                  action: "read",
                                  collectionId: selected,
                                  path: document.entry.path,
                                })
                              ).document!;
                              forget();
                              setDocument(updated);
                              setDraft(updated.content);
                              setFileDescription(updated.entry.description);
                              setDraftRevision(updated.entry.revision);
                              setNotice("已保存");
                            });
                          }}
                        >
                          保存修改
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p>二进制资料已保存，未自动提取正文。</p>
                      {document.entry.contentType.startsWith("image/") &&
                        document.nextOffset === null && (
                          <img
                            alt={document.entry.name}
                            src={`data:${document.entry.contentType};base64,${document.content}`}
                          />
                        )}
                      <button
                        onClick={() => {
                          void act(() => download(document.entry));
                        }}
                      >
                        下载文件
                      </button>
                    </>
                  )}
                </section>
              )}
              <footer>
                <h3>使用位置</h3>
                {mounts.length ? (
                  mounts.map((m) => (
                    <p key={m.id}>
                      {label(m.target)} ·{" "}
                      {targets.find(
                        (t) =>
                          t.target.id === m.target.id &&
                          t.target.kind === m.target.kind,
                      )?.title ?? m.target.id}{" "}
                      · {m.mode === "write" ? "读写" : "只读"}
                    </p>
                  ))
                ) : (
                  <p>尚未连接，模型不会自动读取此资料夹。</p>
                )}
              </footer>
            </>
          ) : (
            <div className="cl-empty">
              <h2>先整理一份资料</h2>
              <p>创建资料夹，上传文件，再配置访问位置和权限。</p>
            </div>
          )}
        </main>
      </div>
      {promptState && (
        <div className="cl-modal-backdrop">
          <form
            role="dialog"
            aria-modal="true"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                finishPrompt(null);
              }
            }}
            aria-label={promptState.title}
            className="cl-modal"
            onSubmit={(e) => {
              e.preventDefault();
              finishPrompt(promptState.value);
            }}
          >
            <h3>{promptState.title}</h3>
            <input
              autoFocus
              aria-label={promptState.title}
              value={promptState.value}
              onChange={(e) =>
                setPromptState({ ...promptState, value: e.target.value })
              }
            />
            <div className="cl-toolbar">
              <button type="button" onClick={() => finishPrompt(null)}>
                取消
              </button>
              <button type="submit">确定</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
