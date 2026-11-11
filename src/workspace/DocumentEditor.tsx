import { Disclosure } from "./shared";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { TaskReference } from "./TaskReference";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Image from "@tiptap/extension-image";
import UniqueID from "@tiptap/extension-unique-id";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { API_BASE } from "../api";
import { useWorkspace, Button, Dialog, Input, ErrorNotice } from "./shared";
import type {
  Document,
  DocumentFile,
} from "../../server/src/workspaceContract";
import { workspaceApi } from "./api";

type Props = {
  document: Document;
  editable: boolean;
  files: DocumentFile[];
  onSelection: (text: string, blockId: string | null) => void;
  onPersist: () => void;
  onEditor: (editor: Editor | null) => void;
};
export default function DocumentEditor(props: Props) {
  const { document, editable } = props;
  const { projectId, data, c } = useWorkspace();
  const [session, setSession] = useState<{
      provider: HocuspocusProvider;
      ydoc: Y.Doc;
    } | null>(null),
    [connected, setConnected] = useState(false),
    [sessionReadOnly, setSessionReadOnly] = useState(false),
    [synced, setSynced] = useState(false),
    [saved, setSaved] = useState(false),
    [failure, setFailure] = useState(false),
    [peers, setPeers] = useState(0);
  const callbacks = useRef(props);
  callbacks.current = props;
  const editSequence = useRef(0);
  const persistRequest = useRef<() => void>(() => {});
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const [dirtyState, setDirtyState] = useState(false);
  useEffect(() => {
    let alive = true;
    const ydoc = new Y.Doc();
    const requests = new Map<string, number>();
    editSequence.current = 0;
    dirty.current = false;
    setDirtyState(false);
    setSynced(false);
    setFailure(false);
    setSaved(false);
    const wsUrl = new URL(
      `/api/projects/${projectId}/documents/${document.id}/collaboration`,
      API_BASE || window.location.origin,
    );
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("generation", String(document.generation));
    const provider = new HocuspocusProvider({
      url: wsUrl.toString(),
      name: `${projectId}:${document.id}:${document.generation}`,
      document: ydoc,
      token: "cookie",
      onStatus: ({ status }) => {
        if (alive) setConnected(status === "connected");
      },
      onAuthenticated: ({ scope }) => {
        if (alive) setSessionReadOnly(scope === "readonly");
      },
      onSynced: () => {
        if (!alive) return;
        setSynced(true);
        if (!callbacks.current.editable) setSaved(true);
        else persistRequest.current();
      },
      onAuthenticationFailed: () => {
        if (alive) {
          setFailure(true);
          setConnected(false);
          callbacks.current.onPersist();
        }
      },
      onStateless: ({ payload }) => {
        try {
          const ack = JSON.parse(payload) as {
            type: string;
            requestId?: string;
          };
          if (ack.type === "readonly") {
            setSessionReadOnly(true);
            setFailure(true);
            return;
          }
          if (
            ack.type !== "persisted" ||
            !ack.requestId ||
            !requests.has(ack.requestId)
          )
            return;
          const sequence = requests.get(ack.requestId)!;
          requests.delete(ack.requestId);
          if (alive && sequence === editSequence.current) {
            dirty.current = false;
            setDirtyState(false);
            setSaved(true);
            callbacks.current.onPersist();
          }
        } catch {
          /* Ignore unrelated stateless messages. */
        }
      },
    });
    persistRequest.current = () => {
      if (!alive || !callbacks.current.editable) return;
      const requestId = crypto.randomUUID();
      requests.clear();
      requests.set(requestId, editSequence.current);
      provider.flushPendingUpdates();
      provider.sendStateless(JSON.stringify({ type: "persist", requestId }));
    };
    const peerChange = () => {
      if (alive) setPeers(provider.awareness?.getStates().size ?? 0);
    };
    provider.awareness?.on("change", peerChange);
    setSession({ provider, ydoc });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      alive = false;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistRequest.current = () => {};
      provider.awareness?.off("change", peerChange);
      provider.destroy();
      ydoc.destroy();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [projectId, document.id, document.generation, data.currentUserId]);
  return (
    <div className="workspace-editor-shell">
      <div className="workspace-save-status" role="status" aria-live="polite">
        {failure
          ? c.restored
          : !connected
            ? c.offline
            : dirtyState
              ? c.saving
              : saved
                ? c.saved
                : c.connecting}
        {peers > 1 ? ` · ${peers}` : ""}
      </div>
      {dirtyState && (!connected || sessionReadOnly) && (
        <p role="alert" className="workspace-muted">
          {c.unsaved}
        </p>
      )}
      {failure && (
        <Button onClick={() => window.location.reload()}>{c.refresh}</Button>
      )}
      {session && synced && (
        <RichEditor
          {...props}
          session={session}
          editable={editable && !failure && !sessionReadOnly}
          onChange={() => {
            editSequence.current++;
            dirty.current = true;
            setDirtyState(true);
            setSaved(false);
            if (persistTimer.current) clearTimeout(persistTimer.current);
            persistTimer.current = setTimeout(
              () => persistRequest.current(),
              500,
            );
          }}
        />
      )}
      {!synced && !failure && (
        <p className="workspace-empty" role="status">
          {c.connecting}
        </p>
      )}
    </div>
  );
}
function RichEditor({
  document,
  editable,
  files,
  session,
  onSelection,
  onEditor,
  onChange,
}: Props & {
  session: { provider: HocuspocusProvider; ydoc: Y.Doc };
  onChange: () => void;
}) {
  const { data, c, projectId } = useWorkspace();
  const [linkOpen, setLinkOpen] = useState(false),
    [url, setUrl] = useState(""),
    [linkError, setLinkError] = useState<string | null>(null);
  const selection = useRef(onSelection);
  selection.current = onSelection;
  const changed = useRef(onChange);
  changed.current = onChange;
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
        }),
        Table.extend({
          renderHTML({ HTMLAttributes }) {
            const { style, ...safe } = HTMLAttributes;
            return ["table", safe, ["tbody", 0]];
          },
        }).configure({ resizable: false }),
        TaskReference,
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({ allowBase64: false }),
        UniqueID.extend({
          addGlobalAttributes() {
            return [
              {
                types: this.options.types as string[],
                attributes: {
                  blockId: {
                    default: null,
                    parseHTML: (element) =>
                      element.getAttribute("data-block-id"),
                    renderHTML: (attrs) =>
                      attrs.blockId
                        ? {
                            "data-block-id": attrs.blockId,
                            id: `block-${attrs.blockId}`,
                          }
                        : {},
                  },
                },
              },
            ];
          },
        }).configure({
          attributeName: "blockId",
          types: [
            "heading",
            "paragraph",
            "blockquote",
            "codeBlock",
            "table",
            "bulletList",
            "orderedList",
          ],
        }),
        Collaboration.configure({ document: session.ydoc }),
        CollaborationCaret.configure({
          provider: session.provider,
          user: {
            name:
              data.users.find((u) => u.id === data.currentUserId)?.name ?? "",
            color: "currentColor",
          },
          render: (user) => {
            const caret = window.document.createElement("span");
            caret.className = "workspace-caret";
            const label = window.document.createElement("span");
            label.className = "workspace-caret-label";
            label.textContent = String(user.name).slice(0, 80);
            caret.append(label);
            return caret;
          },
          selectionRender: () => ({ class: "workspace-selection" }),
        }),
      ],
      onUpdate: () => changed.current(),
      onSelectionUpdate: ({ editor: ed }) => {
        const { from, to, $from } = ed.state.selection;
        let blockId: string | null = null;
        for (let depth = $from.depth; depth > 0; depth--)
          if ($from.node(depth).attrs.blockId) {
            blockId = $from.node(depth).attrs.blockId;
            break;
          }
        selection.current(ed.state.doc.textBetween(from, to, "\n"), blockId);
      },
    },
    [document.id, document.generation],
  );
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  useEffect(() => {
    onEditor(editor);
    if (editor && window.location.hash.startsWith("#block-")) {
      const target = window.document.getElementById(
        decodeURIComponent(window.location.hash.slice(1)),
      );
      target?.scrollIntoView({ block: "center" });
    }
    return () => onEditor(null);
  }, [editor]);
  if (!editor) return null;
  const toolbar = [
    {
      label: c.bold,
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      label: c.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      label: c.heading,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading"),
    },
    {
      label: c.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      label: c.numberedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive("orderedList"),
    },
    {
      label: c.table,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
      active: editor.isActive("table"),
    },
  ];
  return (
    <div className="workspace-editor">
      {editable && (
        <div
          className="workspace-editor-toolbar"
          role="group"
          aria-label={c.edit}
        >
          {toolbar.map((b) => (
            <Button
              key={b.label}
              size="sm"
              variant="ghost"
              aria-pressed={b.active}
              onClick={b.run}
            >
              {b.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setUrl("");
              setLinkOpen(true);
            }}
          >
            {c.link}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().undo().run()}
          >
            {c.undo}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editor.chain().focus().redo().run()}
          >
            {c.redo}
          </Button>
        </div>
      )}
      <EditorContent editor={editor} aria-label={document.title} />
      {editable &&
        files.filter((f) => f.contentType.startsWith("image/")).length > 0 && (
          <Disclosure className="workspace-section" title={c.image}>
            {files
              .filter((f) => f.contentType.startsWith("image/"))
              .map((f) => (
                <Button
                  key={f.id}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .setImage({
                        src: workspaceApi.fileUrl(projectId, document.id, f.id),
                        alt: f.filename,
                      })
                      .run()
                  }
                >
                  {f.filename}
                </Button>
              ))}
          </Disclosure>
        )}
      <Dialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={c.link}
        footer={
          <Button
            onClick={() => {
              let valid = false;
              try {
                valid = ["http:", "https:", "mailto:"].includes(
                  new URL(url, window.location.origin).protocol,
                );
              } catch {
                valid = false;
              }
              if (!valid) {
                setLinkError(c.error);
                return;
              }
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href: url })
                .run();
              setLinkOpen(false);
            }}
          >
            {c.save}
          </Button>
        }
      >
        <Input
          label={c.link}
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setLinkError(null);
          }}
        />
        <ErrorNotice message={linkError} />
      </Dialog>
    </div>
  );
}
