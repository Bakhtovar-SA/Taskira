// Shared parsing for motion:check and the animation inventory (Track O A-07).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");

function* walk(dir, re) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path, re);
    else if (re.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name)) yield path;
  }
}

/** Split only outside parentheses, including calc(), var(), and easing functions. */
function splitCss(value, separator = ",") {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (depth === 0 && (separator === " " ? /\s/.test(value[i]) : value[i] === separator)) {
      if (i > start) parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (start < value.length) parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}
const propertyName = (node) => node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : undefined;
const exported = (node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const animateCall = (node) => ts.isCallExpression(node) && ((ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "animate") || (ts.isElementAccessExpression(node.expression) && propertyName(node.expression.argumentExpression) === "animate"));


export function readMotionCss(root) {
  const rules = [], keyframes = new Map(), keyframeLocations = new Map();
  for (const file of walk(join(root, "src"), /\.css$/)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (rel === "src/styles/tokens.css") continue;
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
    const lineStarts = [0];
    for (let index = 0; index < css.length; index++) if (css[index] === "\n") lineStarts.push(index + 1);
    const lineAt = (offset) => {
      let low = 0, high = lineStarts.length;
      while (low < high) { const mid = (low + high) >>> 1; if (lineStarts[mid] <= offset) low = mid + 1; else high = mid; }
      return low;
    };
    const walkBlock = (text, reduced = false, offset = 0) => {
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf("{", i);
        if (open < 0) break;
        const prefix = text.slice(i, open);
        const head = prefix.trim();
        const line = lineAt(offset + i + Math.max(0, prefix.search(/\S/)));
        let depth = 1, j = open + 1;
        while (j < text.length && depth) { depth += text[j] === "{" ? 1 : text[j] === "}" ? -1 : 0; j++; }
        const body = text.slice(open + 1, j - 1);
        if (/^@(?:-webkit-)?keyframes\b/.test(head)) {
          const name = head.split(/\s+/)[1];
          keyframes.set(name, body);
          keyframeLocations.set(name, { file: rel, line });
        }
        else if (/^@(media|layer|supports|container|starting-style)\b/.test(head)) walkBlock(body, reduced || /prefers-reduced-motion:\s*reduce/.test(head), offset + open + 1);
        else if (!head.startsWith("@")) rules.push({ file: rel, line, selectors: splitCss(head), body, reduced });
        i = j;
      }
    };
    walkBlock(css);
  }
  return { rules, keyframes, keyframeLocations };
}

export function motionConstants(source) {
  const constants = new Map();
  for (const statement of source.statements) if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
  }
  const numeric = (node, seen = new Set()) => {
    node = unwrap(node);
    if (!node) return;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) return numeric(constants.get(node.text), new Set([...seen, node.text]));
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = node.getText(source);
      if (seen.has(key)) return;
      return numeric(propertyValue(node, seen), new Set([...seen, key]));
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const value = numeric(node.operand, seen);
      if (value !== undefined && node.operator === ts.SyntaxKind.MinusToken) return -value;
      if (value !== undefined && node.operator === ts.SyntaxKind.PlusToken) return value;
    }
    if (ts.isBinaryExpression(node)) {
      const left = numeric(node.left, seen), right = numeric(node.right, seen);
      if (left === undefined || right === undefined) return;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return left + right;
        case ts.SyntaxKind.MinusToken: return left - right;
        case ts.SyntaxKind.AsteriskToken: return left * right;
        case ts.SyntaxKind.SlashToken: return left / right;
      }
    }
  };
  const object = (node, seen = new Set()) => {
    node = unwrap(node);
    if (node && ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) return object(constants.get(node.text), new Set([...seen, node.text]));
    if (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const key = node.getText(source);
      if (seen.has(key)) return;
      return object(propertyValue(node, seen), new Set([...seen, key]));
    }
    return node && ts.isObjectLiteralExpression(node) ? node : undefined;
  };
  const propertyValue = (node, seen) => {
    const parent = object(node.expression, seen);
    const name = ts.isPropertyAccessExpression(node) ? node.name.text : propertyName(node.argumentExpression);
    const prop = parent?.properties.find(item => ts.isPropertyAssignment(item) && propertyName(item.name) === name);
    return prop?.initializer;
  };
  return { numeric, object, constant: (name) => constants.get(name) };
}

export { walk, splitCss, propertyName, exported, unwrap, animateCall };


/** Parse the one runtime registry without importing or evaluating the application module. */
export function motionRegistry(source) {
  const constants = motionConstants(source);
  const root = constants.object(constants.constant("MOTION"));
  const fields = new Map();
  if (root) for (const prop of root.properties) if (ts.isPropertyAssignment(prop)) fields.set(propertyName(prop.name), prop);
  return { ...constants, root, fields };
}
