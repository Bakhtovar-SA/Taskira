import { readFileSync, writeFileSync } from "node:fs";
const html = new URL(
  "../docs/design/taskira-next/reference.html",
  import.meta.url,
);
const tokens = readFileSync(
  new URL("../src/styles/tokens.css", import.meta.url),
  "utf8",
);
const source = readFileSync(html, "utf8");
const updated = source.replace(
  /\/\* TASKIRA TOKENS BEGIN \*\/[\s\S]*?\/\* TASKIRA TOKENS END \*\//,
  `/* TASKIRA TOKENS BEGIN */\n${tokens}\n/* TASKIRA TOKENS END */`,
);
if (process.argv.includes("--check")) {
  if (source !== updated)
    throw new Error("Run node scripts/sync-workspace-reference.mjs");
} else writeFileSync(html, updated);
