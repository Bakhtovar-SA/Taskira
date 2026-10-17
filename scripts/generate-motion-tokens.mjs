// CSS and JS share the installed motion spring generator and the runtime MOTION registry.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { motionRegistry, propertyName } from "./motion-lib.mjs";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { spring, generateLinearEasing } = require("motion");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function renderMotionTokens(directory = root) {
  const file = join(directory, "src/styles/tokens.css");
  const source = ts.createSourceFile("motion.ts", readFileSync(join(directory, "src/motion.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const registry = motionRegistry(source);
  const options = registry.object(registry.fields.get("spring")?.initializer);
  if (source.parseDiagnostics.length || !registry.root || !options) throw new Error("MOTION.spring must be a static object");
  const values = {};
  for (const prop of options.properties) {
    const name = ts.isPropertyAssignment(prop) && propertyName(prop.name);
    const value = name && registry.numeric(prop.initializer);
    if (!["visualDuration", "bounce"].includes(name) || !Number.isFinite(value) || name in values) throw new Error("MOTION.spring requires explicit numeric visualDuration and bounce only");
    values[name] = value;
  }
  if (!(values.visualDuration > 0) || !(values.bounce >= 0 && values.bounce <= 1)) throw new Error("Invalid MOTION.spring parameters");
  // NativeAnimation uses this same public serializer for function easing.
  const generated = spring.applyToOptions(values);
  if (!(generated.duration > 0 && generated.duration <= 500)) throw new Error("MOTION.spring must settle within 500ms");
  const easing = generateLinearEasing(generated.ease, generated.duration);
  const current = readFileSync(file, "utf8");
  const declaration = /--ease-spring:[^;]*;/g;
  if ([...current.matchAll(declaration)].length !== 1) throw new Error("Expected exactly one --ease-spring declaration");
  const expected = current.replace(declaration, "--ease-spring: " + easing + ";");
  return { file, current, expected, changed: current !== expected };
}

function selfTest() {
  const directory = mkdtempSync(join(tmpdir(), "taskira-motion-tokens-"));
  try {
    mkdirSync(join(directory, "src/styles"), { recursive: true });
    const source = 'export const MOTION = { spring: { visualDuration: 0.3, bounce: 0.15 } } as const;';
    const motionFile = join(directory, "src/motion.ts");
    const cssFile = join(directory, "src/styles/tokens.css");
    writeFileSync(motionFile, source);
    writeFileSync(cssFile, ':root { --ease-spring: linear(0, 1); --other: 100ms; }\n');
    const initial = renderMotionTokens(directory);
    assert.equal(initial.changed, true);
    assert.match(initial.expected, /--other: 100ms/);
    writeFileSync(cssFile, initial.expected);
    assert.equal(renderMotionTokens(directory).changed, false);
    writeFileSync(motionFile, source.replace('bounce: 0.15', 'bounce: 0.1'));
    assert.equal(renderMotionTokens(directory).changed, true);
    writeFileSync(motionFile, source.replace('bounce: 0.15', 'bounce: unknown()'));
    assert.throws(() => renderMotionTokens(directory), /explicit numeric/);
    writeFileSync(motionFile, source.replace('spring:', 'other:'));
    assert.throws(() => renderMotionTokens(directory), /static object/);
    writeFileSync(motionFile, source);
    writeFileSync(cssFile, initial.expected + '--ease-spring: linear(0, 1);');
    assert.throws(() => renderMotionTokens(directory), /exactly one/);
    console.log("motion tokens self-test: roundtrip, drift, registry mutations and duplicate token pass");
  } finally {
    // Only the exact private mkdtemp directory created above is removed.
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes("--self-test")) selfTest();
    else {
      const result = renderMotionTokens();
      if (process.argv.includes("--check")) {
        if (result.changed) { console.error("--ease-spring is stale; run npm run motion:tokens"); process.exitCode = 1; }
        else console.log("motion tokens: --ease-spring matches MOTION.spring");
      } else {
        if (result.changed) writeFileSync(result.file, result.expected);
        console.log("motion tokens: --ease-spring generated from MOTION.spring");
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
