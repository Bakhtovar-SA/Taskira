export type IssueTypeId = "story" | "task" | "bug" | "epic";
export type PriorityId = "highest" | "high" | "medium" | "low" | "lowest";
export type StatusCategory = "todo" | "inprogress" | "done";

export interface User {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
}

export interface Status {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface Transition {
  id: string;
  from: string;
  to: string;
}

export interface Workflow {
  statuses: Status[];
  transitions: Transition[];
}

export interface CommentT {
  id: string;
  authorId: string;
  body: string;
  ts: number;
}

export interface Activity {
  id: string;
  authorId: string;
  issueId: string;
  ts: number;
  text: string;
}

export interface Issue {
  id: string;
  key: string;
  title: string;
  description: string;
  typeId: IssueTypeId;
  statusId: string;
  priorityId: PriorityId;
  assigneeId: string | null;
  reporterId: string;
  epicId: string | null;
  labels: string[];
  points: number | null;
  sprintId: string | null;
  color?: string;
  tStart?: number;
  tSpan?: number;
  comments: CommentT[];
  activity: Activity[];
  createdAt: number;
  updatedAt: number;
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  status: "active" | "future" | "completed";
  startDate: string;
  endDate: string;
}

export interface Project {
  key: string;
  name: string;
  description: string;
}

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

export interface Data {
  project: Project;
  users: User[];
  currentUserId: string;
  issues: Issue[];
  sprints: Sprint[];
  workflow: Workflow;
  seq: number;
}

export type ViewId = "board" | "backlog" | "timeline" | "workflow";

export const ISSUE_TYPES: Record<IssueTypeId, { name: string }> = {
  story: { name: "История" },
  task: { name: "Задача" },
  bug: { name: "Баг" },
  epic: { name: "Эпик" },
};

export const PRIORITIES: Record<PriorityId, { name: string }> = {
  highest: { name: "Высший" },
  high: { name: "Высокий" },
  medium: { name: "Средний" },
  low: { name: "Низкий" },
  lowest: { name: "Низший" },
};

export const PRIORITY_ORDER: PriorityId[] = ["highest", "high", "medium", "low", "lowest"];
export const TYPE_ORDER: IssueTypeId[] = ["story", "task", "bug", "epic"];
