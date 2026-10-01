/** Страж английского интерфейса (трек E): русский текст в коде клиента — только в словаре или парой RU/EN.
 *
 *  Ловит новую строку вида `toast("error", "Не удалось …")` без английской половины — такое в английском интерфейсе
 *  показывается по-русски, и раньше это находили только глазами. Разрешено:
 *  - словари (`src/i18n/*`), тесты, витрина `src/dev/`, мёртвые демо-данные `seed.ts`;
 *  - пара RU/EN: внутри `local(…)` (стор) или строка с выбором по `lang`;
 *  - запасной русский вариант после словаря: `t ? t("…") : "…"`;
 *  - сообщения для разработчика: `console.*`, `throw new Error(…)`, `new ApiError(…)` (ошибки API переводятся по коду,
 *    см. apiErrors.ts), `reject(new Error(…))`;
 *  - однобуквенные клавиши русской раскладки (`"с"`, `р:`) — горячие клавиши, а не текст;
 *  - файлы из FILE_ALLOW — там русский не текст интерфейса, причина рядом. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const ROOT = join(__dirname, "..");
const CYR = /[А-Яа-яЁё]/;

const FILE_ALLOW: Record<string, string> = {
  "components/DocsView.tsx": "русская справка целиком; английская — рядом, состав разделов сверяет DocsView.test.tsx",
  "ds/dateParse.ts": "разбор дат словами на обоих языках («завтра» / tomorrow)",
  "permissions.matrix.ts": "генерируется из shared/permissions.matrix.json; в интерфейсе названия прав — из словаря",
  "permissions.ts": "denialReason — зеркало русского текста сервера для permissions-sync.test.ts; интерфейс — denialText",
  "validation.ts": "русские сообщения зеркалят сервер; английский — localizeValidationError",
  "activityText.ts": "разбор русских фраз истории, записанных до трека E",
  "workflowStatus.ts": "узнавание стандартных русских названий статусов, чтобы их перевести",
  "palette/fuzzy.ts": "раскладка клавиатуры для поиска с неверной раскладкой",
  "components/ProjectWizard.tsx": "транслитерация названия проекта в ключ",
  "components/CommandPalette.tsx": "синонимы для поиска в палитре на обоих языках",
  "import/trello.ts": "сообщения разбора файла переводит ImportModal (трек D)",
  "import/jira.ts": "русские типы задач в выгрузке Jira; пометка «Импортировано из…» — данные задачи, не интерфейс (трек D)",
  "import/asana.ts": "пометка «Импортировано из Asana» — данные задачи (описание), не интерфейс (трек D)",
  "components/ImportModal.tsx": "сопоставление русских сообщений разбора с английскими (трек D)",
  "api/index.ts": "reason ошибок API: английский интерфейс его не показывает — переводит по коду (apiErrors.ts)",
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return ["i18n", "dev", "perf"].includes(name) && dir === ROOT ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "seed.ts" ? [p] : [];
  });
}

/** Код без комментариев: блочные, JSX-комментарии и `//` до конца строки (не внутри "http://"). */
function stripComments(src: string): string {
  return src
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/(^|[\s;,(){}])\/\/.*$/, "$1"))
    .join("\n");
}

test.each(["\n", "\r\n"])("страж удаляет комментарии при переносах %j и сохраняет строки", (eol) => {
  const source = [
    '// Русский комментарий',
    'const endpoint = "http://example.test"; // Русский комментарий',
    '/* Блочный',
    ' * комментарий */',
    'const label = "Русский текст интерфейса";',
  ].join(eol);
  const stripped = stripComments(source);
  expect(stripped).not.toMatch(/комментарий|Блочный/);
  expect(stripped).toContain('"http://example.test"');
  expect(stripped).toContain('"Русский текст интерфейса"');
  expect(stripped.split("\n")).toHaveLength(5);
});

const LINE_OK = [
  /\blang(Ref\.current)? === "(ru|en)"/,
  /\bt \? t\(/,
  /console\.(error|warn|info|log)\(/,
  /throw new Error\(/,
  /reject\(new Error\(/,
  /new ApiError\(/,
  /(^|[^\p{L}])["']?[а-яё]["']?\s*(:|===|\|\|)/u, // клавиша русской раскладки
  /=== "[а-яё]"/,
];

function offenders(path: string): string[] {
  const lines = stripComments(readFileSync(path, "utf8")).split("\n");
  const out: string[] = [];
  let inLocal = 0; // глубина скобок внутри local(…), растянутого на несколько строк
  lines.forEach((line, i) => {
    const startsLocal = line.includes("local(");
    const covered = inLocal > 0 || startsLocal;
    if (startsLocal || inLocal > 0) {
      const from = inLocal > 0 ? 0 : line.indexOf("local(") + "local".length;
      for (const ch of line.slice(from)) {
        if (ch === "(") inLocal++;
        else if (ch === ")") inLocal = Math.max(0, inLocal - 1);
      }
    }
    if (!CYR.test(line) || covered || LINE_OK.some((re) => re.test(line))) return;
    out.push(`${relative(ROOT, path)}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return out;
}

test("комментарии исключаются при LF и CRLF, URL сохраняются", () => {
  const source = 'const url = "http://localhost"; // комментарий\n/* русский\nкомментарий */\nconst label = "Текст";';
  const expected = 'const url = "http://localhost"; \n          \n              \nconst label = "Текст";';
  expect(stripComments(source)).toBe(expected);
  expect(stripComments(source.replace(/\n/g, "\r\n"))).toBe(expected);
});

test("русский текст в коде клиента — только в словаре или парой RU/EN", () => {
  const found = files(ROOT)
    .filter((p) => !(relative(ROOT, p).replace(/\\/g, "/") in FILE_ALLOW))
    .flatMap(offenders);
  expect(found, `Русский текст вне словаря — перенесите в src/i18n (t("…")) или дайте английскую пару:\n${found.join("\n")}`).toEqual([]);
});

test("исключения стража существуют — список не протухает", () => {
  for (const f of Object.keys(FILE_ALLOW)) expect(statSync(join(ROOT, f)).isFile(), f).toBe(true);
});
