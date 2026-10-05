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
          { name: "ui-core", test: /[\\/]src[\\/](?:icons\.tsx|ui\.tsx|cssVars\.ts|workflowStatus\.ts|ds[\\/](?:Button|Display|Field|Overlay|floating)\.tsx?)$/ },
          // Both time views share the scale and canvas. Keep this family lazy,
          // but compress their similar markup together instead of tiny chunks.
          { name: "time-views", includeDependenciesRecursively: false, test: /[\\/]src[\\/]components[\\/](?:RoadmapView|TimelineView|TimeCanvas)\.tsx$/ },
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
