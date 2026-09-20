import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { IssueListPageMeta } from "../dist/contract.js";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "../../src/api/generated-contracts.ts");

function typeOf(schema) {
  const kind = schema._def.typeName;
  if (kind === "ZodString") return "string";
  if (kind === "ZodNumber") return "number";
  if (kind === "ZodBoolean") return "boolean";
  if (kind === "ZodNullable") return `${typeOf(schema._def.innerType)} | null`;
  if (kind === "ZodOptional") return typeOf(schema._def.innerType);
  throw new Error(`Unsupported Zod node in client contract generator: ${kind}`);
}

function interfaceFrom(name, schema) {
  const fields = Object.entries(schema.shape).map(([field, value]) => {
    const optional = value._def.typeName === "ZodOptional";
    return `  ${field}${optional ? "?" : ""}: ${typeOf(value)};`;
  });
  return `export interface ${name} {\n${fields.join("\n")}\n}`;
}

const generated = `// Generated from server/src/contract.ts. Do not edit by hand.\n\n${interfaceFrom("IssueListPageMeta", IssueListPageMeta)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write("Client API contracts are stale. Run: cd server && npm run contracts:generate\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, generated);
}
