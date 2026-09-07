/**
 * Вложения к задачам (миграция 010, FILES_MIGRATION.md Фаза 2).
 * Права D2, видимость/IDOR D4, guard D3 (расширение + magic-байты), заголовки D5.
 *
 * Тестовое окружение (test/env.ts): STORAGE_DRIVER=local во временный каталог,
 * ATTACH_MAX_BYTES=4096, ATTACH_MAX_PER_ISSUE=5.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { getApp, stopApp, resetDb, seedFixture, login, auth, q, type Fixture } from "./helpers.js";

/* -------- сборка multipart/form-data вручную (form-data не установлен) -------- */
function mp(file: { field?: string; filename: string; contentType?: string; data: Buffer | string }): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const b = `----taskira${Math.random().toString(16).slice(2)}`;
  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
  let head = `--${b}\r\nContent-Disposition: form-data; name="${file.field ?? "file"}"; filename="${file.filename}"\r\n`;
  if (file.contentType) head += `Content-Type: ${file.contentType}\r\n`;
  head += "\r\n";
  const payload = Buffer.concat([Buffer.from(head, "utf8"), data, Buffer.from(`\r\n--${b}--\r\n`, "utf8")]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${b}` } };
}

/* -------- фейковые «файлы» (по первым байтам) -------- */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake png body")]);
const PE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), Buffer.from("this is really an exe")]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const TXT = Buffer.from("2026-09-07 12:00:00 INFO just a log line\n");

let app: FastifyInstance;
let fx: Fixture;

/** URL вложений задачи внутри проекта. */
const A = (pid: string, iid: string, rest = "") => `/api/projects/${pid}/issues/${iid}/attachments${rest}`;

async function upload(pid: string, iid: string, token: string, file: Parameters<typeof mp>[0]) {
  const { payload, headers } = mp(file);
  return app.inject({ method: "POST", url: A(pid, iid), headers: { ...auth(token), ...headers }, payload });
}

beforeAll(async () => {
  app = await getApp();
});
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  fx = await seedFixture();
});

describe("Вложения: guard типа файла (D3)", () => {
  test("запрещённое расширение .exe -> 400", async () => {
    const tok = await login(app, "emp1");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "tool.exe", data: TXT });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.reason).toMatch(/\.exe/);
  });

  test("исполняемый файл, переименованный в .jpg -> 400 ПО MAGIC-БАЙТАМ, не по расширению", async () => {
    const tok = await login(app, "emp1");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, {
      filename: "innocent.jpg",
      contentType: "image/jpeg", // клиент врёт про тип
      data: PE, // а внутри — MZ
    });
    expect(res.statusCode).toBe(400);
    // отказ именно по сигнатуре (исполняемый), а не по чёрному списку расширений
    expect(JSON.parse(res.body).error.reason).toMatch(/исполняем|сигнатур/i);
  });

  test("содержимое не соответствует расширению (.png, а внутри PDF) -> 400", async () => {
    const tok = await login(app, "emp1");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "chart.png", data: PDF });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.reason).toMatch(/не соответствует расширению/i);
  });

  test("нормальный PNG -> 201, content_type нормализован на image/png", async () => {
    const tok = await login(app, "emp1");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, {
      filename: "shot.png",
      contentType: "application/octet-stream",
      data: PNG,
    });
    expect(res.statusCode).toBe(201);
    const dto = JSON.parse(res.body);
    expect(dto.contentType).toBe("image/png");
    expect(dto.byteSize).toBe(PNG.length);
    expect(dto.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Вложения: права (D2)", () => {
  test("viewer грузить не может -> 403", async () => {
    const tok = await login(app, "viw1");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "a.txt", data: TXT });
    expect(res.statusCode).toBe(403);
  });

  test("employee грузит -> 201", async () => {
    const tok = await login(app, "emp1");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "a.txt", data: TXT });
    expect(res.statusCode).toBe(201);
  });

  test("приглашённый (collaborator) грузит -> 201", async () => {
    await q(`INSERT INTO issue_collaborators (issue_id, user_id) VALUES ($1, $2)`, [
      fx.issues.p1issue,
      fx.users.outsider,
    ]);
    const tok = await login(app, "outsider");
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "note.txt", data: TXT });
    expect(res.statusCode).toBe(201);
  });

  test("employee удаляет своё -> 204; чужое -> 403; manager удаляет любое -> 204", async () => {
    const mgrTok = await login(app, "mgr1");
    const empTok = await login(app, "emp1");

    const byMgr = JSON.parse((await upload(fx.projects.p1, fx.issues.p1issue, mgrTok, { filename: "m.txt", data: TXT })).body);
    const byEmp = JSON.parse((await upload(fx.projects.p1, fx.issues.p1issue, empTok, { filename: "e.txt", data: TXT })).body);

    // employee сносит чужое (загрузил mgr1) -> 403
    let res = await app.inject({ method: "DELETE", url: A(fx.projects.p1, fx.issues.p1issue, `/${byMgr.id}`), headers: auth(empTok) });
    expect(res.statusCode).toBe(403);

    // employee сносит своё -> 204
    res = await app.inject({ method: "DELETE", url: A(fx.projects.p1, fx.issues.p1issue, `/${byEmp.id}`), headers: auth(empTok) });
    expect(res.statusCode).toBe(204);

    // manager сносит чужое -> 204
    res = await app.inject({ method: "DELETE", url: A(fx.projects.p1, fx.issues.p1issue, `/${byMgr.id}`), headers: auth(mgrTok) });
    expect(res.statusCode).toBe(204);

    // повтор -> 404
    res = await app.inject({ method: "DELETE", url: A(fx.projects.p1, fx.issues.p1issue, `/${byMgr.id}`), headers: auth(mgrTok) });
    expect(res.statusCode).toBe(404);
  });
});

describe("Вложения: видимость и IDOR (D4)", () => {
  test("не-участник не-shared проекта -> 403 на списке и загрузке", async () => {
    const tok = await login(app, "mgr2"); // менеджер SEC, в CORP не состоит; CORP не shared
    expect((await app.inject({ method: "GET", url: A(fx.projects.p1, fx.issues.p1issue), headers: auth(tok) })).statusCode).toBe(403);
    expect((await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "x.txt", data: TXT })).statusCode).toBe(403);
  });

  test("скачивание вложения из ЧУЖОЙ задачи через свой проект -> 404 (IDOR)", async () => {
    // вложение принадлежит задаче в CORP
    const empTok = await login(app, "emp1");
    const att = JSON.parse((await upload(fx.projects.p1, fx.issues.p1issue, empTok, { filename: "secret.txt", data: TXT })).body);

    // mgr2 (менеджер SEC) подставляет id вложения из CORP в путь СВОЕЙ задачи SEC
    const mgr2Tok = await login(app, "mgr2");
    const res = await app.inject({
      method: "GET",
      url: A(fx.projects.p2, fx.issues.p2issue, `/${att.id}`),
      headers: auth(mgr2Tok),
    });
    expect(res.statusCode).toBe(404);
  });

  test("путаница проектов: /projects/SEC/issues/<CORP-issue>/attachments -> 404", async () => {
    const tok = await login(app, "mgr2");
    const res = await app.inject({
      method: "GET",
      url: A(fx.projects.p2, fx.issues.p1issue), // задача из CORP под путём SEC
      headers: auth(tok),
    });
    expect(res.statusCode).toBe(404);
  });

  test("участник проекта скачивает вложение -> 200 и получает те же байты", async () => {
    const empTok = await login(app, "emp1");
    const att = JSON.parse((await upload(fx.projects.p1, fx.issues.p1issue, empTok, { filename: "doc.txt", data: TXT })).body);

    const viwTok = await login(app, "viw1"); // viewer тоже видит
    const res = await app.inject({ method: "GET", url: A(fx.projects.p1, fx.issues.p1issue, `/${att.id}`), headers: auth(viwTok) });
    expect(res.statusCode).toBe(200);
    expect(Buffer.from(res.rawPayload).equals(TXT)).toBe(true);
  });
});

describe("Вложения: заголовки скачивания (D5)", () => {
  test("Content-Disposition: attachment + nosniff; активный тип -> octet-stream", async () => {
    const tok = await login(app, "emp1");
    const svg = JSON.parse((await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "pic.svg", data: SVG })).body);
    expect(svg.contentType).toBe("image/svg+xml"); // в БД честный тип

    const res = await app.inject({ method: "GET", url: A(fx.projects.p1, fx.issues.p1issue, `/${svg.id}`), headers: auth(tok) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // активный тип на отдаче нейтрализован
    expect(res.headers["content-type"]).toMatch(/application\/octet-stream/);
  });
});

describe("Вложения: лимиты (D3)", () => {
  test("файл больше ATTACH_MAX_BYTES (4096) -> 413", async () => {
    const tok = await login(app, "emp1");
    const big = Buffer.concat([PNG, Buffer.alloc(5000, 0x20)]);
    const res = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "big.png", data: big });
    expect(res.statusCode).toBe(413);
  });

  test("больше ATTACH_MAX_PER_ISSUE (5) -> 409 на 6-м", async () => {
    const tok = await login(app, "emp1");
    for (let i = 0; i < 5; i++) {
      const r = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: `f${i}.txt`, data: TXT });
      expect(r.statusCode).toBe(201);
    }
    const r6 = await upload(fx.projects.p1, fx.issues.p1issue, tok, { filename: "f6.txt", data: TXT });
    expect(r6.statusCode).toBe(409);
  });
});

describe("Вложения: DTO и каскад", () => {
  test("getIssueDto.attachments отражает список; удаление задачи каскадит строки", async () => {
    const empTok = await login(app, "emp1");
    await upload(fx.projects.p1, fx.issues.p1issue, empTok, { filename: "one.txt", data: TXT });
    await upload(fx.projects.p1, fx.issues.p1issue, empTok, { filename: "two.txt", data: TXT });

    const dto = JSON.parse(
      (await app.inject({ method: "GET", url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`, headers: auth(empTok) })).body,
    );
    expect(dto.attachments).toHaveLength(2);
    expect(dto.attachments.map((a: { filename: string }) => a.filename).sort()).toEqual(["one.txt", "two.txt"]);

    const mgrTok = await login(app, "mgr1");
    const del = await app.inject({ method: "DELETE", url: `/api/projects/${fx.projects.p1}/issues/${fx.issues.p1issue}`, headers: auth(mgrTok) });
    expect(del.statusCode).toBe(204);
    const left = await q(`SELECT count(*)::int AS n FROM attachments WHERE issue_id = $1`, [fx.issues.p1issue]);
    expect((left[0] as { n: number }).n).toBe(0);
  });
});
