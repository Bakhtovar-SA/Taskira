// ADR-0035 — размеры частей motion (minify esbuild + gzip node:zlib по умолчанию, как bundle:check).
// React/ReactDOM — external: они уже в приложении, считаем только прирост от motion.
//   SPIKE_NODE_MODULES=/tmp/motion-spike/node_modules node scripts/motion-spike/size.mjs
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
const nm = process.env.SPIKE_NODE_MODULES ?? process.argv[2];
if (!nm) {
  console.error("задайте SPIKE_NODE_MODULES (см. run.mjs)");
  process.exit(2);
}
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cases = {
  "mini animate": `export { animate } from "motion/mini";`,
  "mini animate + spring": `export { animate } from "motion/mini"; export { spring } from "motion";`,
  "hybrid animate": `export { animate } from "motion";`,
  "hybrid animate + spring + stagger": `export { animate, spring, stagger } from "motion";`,
  "react m + LazyMotion (без фич)": `export { m, LazyMotion } from "motion/react";`,
  "react domAnimation (фичи)": `export { domAnimation } from "motion/react";`,
  "react domMax (фичи + layout)": `export { domMax } from "motion/react";`,
  "react m+LazyMotion+domAnimation+AnimatePresence": `export { m, LazyMotion, domAnimation, AnimatePresence, MotionConfig } from "motion/react";`,
  "react m+LazyMotion+domMax+AnimatePresence": `export { m, LazyMotion, domMax, AnimatePresence, MotionConfig } from "motion/react";`,
  "react motion (полный компонент)": `export { motion } from "motion/react";`,
  "react motion+AnimatePresence+LayoutGroup+MotionConfig": `export { motion, AnimatePresence, LayoutGroup, MotionConfig } from "motion/react";`,
};
const wrapper = fileURLToPath(new URL("./probes/motion-wrapper.mjs", import.meta.url));
cases["прототип обёртки (синхронная часть, без чанка)"] = `export * from ${JSON.stringify(wrapper)};`;
console.log("| что | min, KB | gzip, KB |\n|---|---|---|");
for (const [name, contents] of Object.entries(cases)) {
  const r = await build({ stdin: { contents, resolveDir: repoRoot, loader: "js" }, bundle: true, minify: true, format: "esm", write: false,
    nodePaths: [nm, `${repoRoot}/node_modules`], external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client", "./motion-engine.mjs"], define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", platform: "browser" });
  const code = r.outputFiles[0].contents;
  console.log(`| ${name} | ${(code.length/1024).toFixed(1)} | ${(gzipSync(code).length/1024).toFixed(1)} |`);
}
