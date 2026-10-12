import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react({ jsxImportSource: "#secure-jsx" }), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // These primitives already load with the shell. One shared chunk compresses
        // their repeated JSX better; screen and overlay imports remain lazy.
        codeSplitting: { groups: [
          { name: "ui-core", test: /[\\/]src[\\/](?:icons\.tsx|ui\.tsx|cssVars\.ts|workflowStatus\.ts|components[\\/](?:BrandMark|UserAvatar|WorkspaceControls|settings[\\/]parts)\.tsx|ds[\\/](?:Button|Display|Field|Overlay|floating|DatePicker|dateParse)\.tsx?)$/ },
          // Issue editing, creation and their shared controls already load together;
          // without pulling either surface into the shell or increasing the budget.
          { name: "issue-forms", includeDependenciesRecursively: false, test: /[\\/]src[\\/]components[\\/](?:IssueModal|CreateIssueModal|AssigneePicker|DeleteIssueDialog|BulkBar)\.tsx$/ },
          // Time views share date controls and related markup. Keep this family lazy,
          // but compress their similar markup together instead of tiny chunks.
          { name: "time-views", includeDependenciesRecursively: false, test: /[\\/]src[\\/]components[\\/](?:CalendarView|RoadmapView|TimelineView|TimeCanvas)\.tsx$/ },
          // Recurring rules and their editor form one lazy feature; compress their
          // shared markup together while keeping the family out of the shell.
          { name: "recurring-views", includeDependenciesRecursively: false, test: /[\\/]src[\\/]components[\\/]settings[\\/](?:ProjectRecurring|RecurringRuleForm)\.tsx$/ },
          { name: "integration-views", includeDependenciesRecursively: false, test: /[\\/]src[\\/]components[\\/]settings[\\/](?:ProjectIntegrations|WebhookDeliveries)\.tsx$/ },
        ] },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    hmr: {
      port: Number(process.env.PLAYWRIGHT_PORT || 3000),
    },
    // Тот же same-origin контракт, что в production nginx. Благодаря этому
    // VITE_API_URL не требуется ни для dev, ни для переносимого release image.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
