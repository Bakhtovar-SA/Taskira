import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useEffect } from "react";
import { issuesApi } from "../api";
import { useStore } from "../store";
import { useResource } from "./hooks";
import { useWorkspace } from "./shared";

function Reference({ node }: NodeViewProps) {
  const { projectId, c, data } = useWorkspace();
  const { openIssue } = useStore();
  const id = String(node.attrs.issueId);
  const issue = useResource(
    (signal) => issuesApi.get(projectId, id, signal),
    [projectId, id],
  );
  useEffect(() => {
    const timer = setInterval(issue.reload, 20000);
    return () => clearInterval(timer);
  }, [issue.reload]);
  const status = data.workflow.statuses.find(
    (s) => s.id === issue.data?.statusId,
  );
  return (
    <NodeViewWrapper
      as="span"
      className="workspace-task-reference"
      data-taskira-issue={id}
      contentEditable={false}
    >
      <button
        type="button"
        onClick={() => openIssue(id, "panel")}
        title={issue.data?.title ?? c.issue}
      >
        {String(node.attrs.label)}
        {status ? ` · ${status.name}` : issue.error ? ` · ${c.error}` : ""}
      </button>
    </NodeViewWrapper>
  );
}
export const TaskReference = Node.create({
  name: "taskReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { issueId: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-taskira-issue]",
        getAttrs: (element) => ({
          issueId: element.getAttribute("data-taskira-issue"),
          label: element.textContent,
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-taskira-issue": node.attrs.issueId,
      }),
      String(node.attrs.label),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(Reference);
  },
});
