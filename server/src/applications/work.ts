/** Existing URLs stay stable. This is the work application's project API boundary. */
export const workApplication = {
  id: "work",
  projectResources: [
    "issues", "workflow", "issue-templates", "recurring", "custom-fields",
    "sprints", "saved-views", "process-templates", "process-runs",
    "automation-rules", "plans", "roadmap", "milestones", "dependencies", "overview",
  ],
  globalResources: ["dashboards", "admin/demo-project"],
  modules: ["processes", "planning"],
} as const;
