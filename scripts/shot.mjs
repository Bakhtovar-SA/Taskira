/**
 * Скриншот клиента Taskira через Playwright — для визуальной самопроверки во
 * время работы над дизайном (не тест, просто снимок).
 *
 * Требует запущенный клиент (`npm run dev`, :3000). Для авторизованных экранов —
 * ещё и сервер (`cd server && npm run dev`, :8080): скрипт логинится через API и
 * кладёт JWT в localStorage до навигации.
 *
 * Использование:
 *   node scripts/shot.mjs <out.png> [опции]
 *     --path <p>        путь/хэш после origin (деф. "/")             напр. --path "#/issue/<pid>/<iid>"
 *     --settle <ms>     пауза после загрузки ДО click/press (деф. 800) — дать буту доехать
 *     --click <css>     кликнуть по селектору (после --settle, до --press); несколько — через " >> "
 *     --press <keys>    нажать клавиши через запятую (после --click)  напр. --press "Escape,4"
 *     --sel <css>       снять только этот элемент (иначе — вьюпорт; с --full — вся страница)
 *     --full            fullPage
 *     --no-auth         не логиниться (экран входа)
 *     --user <name>     логин (деф. из server/.env ADMIN_USERNAME или "admin")
 *     --pass <pw>       пароль (деф. из server/.env ADMIN_PASSWORD)
 *     --w <px> --h <px> вьюпорт (деф. 1440x900)
 *     --wait <ms>       пауза перед снимком, после всех действий (деф. 1200)
 *     --dark            prefers-color-scheme: dark
 *
 * Примеры:
 *   node scripts/shot.mjs shots/board.png
 *   node scripts/shot.mjs shots/backlog.png --press 2
 *   node scripts/shot.mjs shots/login.png --no-auth
 */
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const CLIENT = process.env.SHOT_CLIENT_URL || "http://localhost:3000";
const API = process.env.SHOT_API_URL || "http://localhost:8080";
const TOKEN_KEY = "taskira.token"; // src/api/index.ts

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const out = process.argv[2];
if (!out || out.startsWith("--")) {
  console.error("нужен путь выходного файла: node scripts/shot.mjs <out.png> [опции]");
  process.exit(1);
}

function envFromServer(key, fallback) {
  try {
    const txt = readFileSync(resolve("server/.env"), "utf8");
    const m = txt.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : fallback;
  } catch {
    return fallback;
  }
}

const user = arg("user", envFromServer("ADMIN_USERNAME", "admin"));
const pass = arg("pass", envFromServer("ADMIN_PASSWORD", ""));
const width = Number(arg("w", 1440));
const height = Number(arg("h", 900));
const waitMs = Number(arg("wait", 1200));

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`login ${user}: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: has("dark") ? "dark" : "light",
});
const page = await ctx.newPage();

try {
  if (!has("no-auth")) {
    const token = await login();
    // addInitScript — токен кладётся ДО загрузки страницы на каждой навигации,
    // включая переход по hash-URL (#/issue/...), где обычный goto не перезагружает.
    await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [TOKEN_KEY, token]);
  }

  await page.goto(`${CLIENT}/${arg("path", "").replace(/^\//, "")}`, { waitUntil: "networkidle" }).catch(() => {});

  // Дать SPA доехать (bootstrap → ready) прежде чем кликать/жать — иначе действия теряются.
  await page.waitForTimeout(Number(arg("settle", 800)));

  // --click принимает несколько селекторов через " >> " — кликает по очереди
  // (напр. карточка проекта на главном экране, затем пункт сайдбара).
  for (const sel of (arg("click", "") || "").split(" >> ").map((s) => s.trim()).filter(Boolean)) {
    await page.click(sel, { timeout: 3000 }).catch(() => console.warn(`--click "${sel}" не сработал`));
    await page.waitForTimeout(600);
  }

  for (const k of (arg("press", "") || "").split(",").filter(Boolean)) {
    await page.keyboard.press(k.trim());
    await page.waitForTimeout(120);
  }

  await page.waitForTimeout(waitMs);

  mkdirSync(dirname(resolve(out)), { recursive: true });
  const sel = arg("sel", "");
  if (sel) {
    await page.locator(sel).first().screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage: has("full") });
  }
  console.log(`✓ ${out}  (${width}x${height}${has("dark") ? " dark" : ""})`);
} finally {
  await browser.close();
}
