/**
 * Интеграционные тесты LDAP против НАСТОЯЩЕГО OpenLDAP (slapd), не мока.
 * Запускаются только когда поднят реальный сервер и заданы LDAP_*:
 *   - CI: job `ldap` в .github/workflows/test.yml (docker compose openldap);
 *   - локально: `docker compose -f server/docker-compose.ldap.yml up -d --wait`
 *     + AUTH_MODE=ldap и остальные LDAP_* → `npm run test:ldap`.
 * Иначе (`npm test`) весь файл пропускается.
 *
 * Часть тестов намеренно проверяет то, чего мок (test/ldap/mock-ldap.mjs) НЕ
 * воспроизводит: серверный sizelimit и paged results (RFC 2696).
 */
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { Client, SizeLimitExceededError } from "ldapts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { auth, getApp, q, resetDb, stopApp } from "./helpers.js";

const RUN = process.env.AUTH_MODE === "ldap" && !!process.env.LDAP_URL;
const d = RUN ? describe : describe.skip;

const URL = process.env.LDAP_URL ?? "";
const BIND_DN = process.env.LDAP_BIND_DN ?? "cn=admin,dc=taskira,dc=test";
const BIND_PW = process.env.LDAP_BIND_PASSWORD ?? "admin";
const BASE = "dc=taskira,dc=test";
const PEOPLE = `ou=people,${BASE}`;
const GROUPS = `ou=groups,${BASE}`;
const DEPT_INFOSEC = `cn=dept-infosec,${GROUPS}`;
const DEPT_IT = `cn=dept-it,${GROUPS}`;

const svcClient = async (): Promise<Client> => {
  const c = new Client({ url: URL });
  await c.bind(BIND_DN, BIND_PW);
  return c;
};
const userClient = async (uid: string, pw = "testpass123"): Promise<Client> => {
  const c = new Client({ url: URL });
  await c.bind(`uid=${uid},${PEOPLE}`, pw);
  return c;
};

d("LDAP-вход против настоящего OpenLDAP", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getApp();
  });
  afterAll(() => stopApp());

  beforeEach(async () => {
    await resetDb();
    // 2 департамента, привязанные к тестовым LDAP-группам
    await q(
      `INSERT INTO departments (name, ldap_group_dn) VALUES ('ИБ', $1), ('IT', $2)`,
      [DEPT_INFOSEC, DEPT_IT],
    );
    // break-glass локальный админ (env ADMIN_*)
    const admU = process.env.ADMIN_USERNAME;
    const admP = process.env.ADMIN_PASSWORD;
    if (admU && admP) {
      await q(
        `INSERT INTO users (username, password_hash, name, global_role, auth_source)
         VALUES ($1, $2, 'Break Glass', 'admin', 'local')`,
        [admU, await bcrypt.hash(admP, 4)],
      );
    }
  });

  const login = (username: string, password: string) =>
    app.inject({ method: "POST", url: "/api/auth/login", headers: {}, payload: { username, password } });

  test("t.manager → 200, JWT, JIT-provision (auth_source=ldap, ldap_dn), department_members = ИБ", async () => {
    const res = await login("t.manager", "testpass123");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeTruthy();
    expect(body.user).toMatchObject({ username: "t.manager", authSource: "ldap", globalRole: "member" });

    const [u] = await q<{ auth_source: string; ldap_dn: string }>(
      `SELECT auth_source, ldap_dn FROM users WHERE username = 't.manager'`,
    );
    expect(u.auth_source).toBe("ldap");
    expect(u.ldap_dn.toLowerCase()).toBe(`uid=t.manager,${PEOPLE}`.toLowerCase());

    const dm = await q<{ name: string }>(
      `SELECT d.name FROM department_members dm
         JOIN departments d ON d.id = dm.department_id
         JOIN users u ON u.id = dm.user_id
        WHERE u.username = 't.manager'`,
    );
    expect(dm.map((r) => r.name)).toEqual(["ИБ"]);
  });

  test("t.admin (в cn=taskira-admins) → global_role = admin", async () => {
    const res = await login("t.admin", "testpass123");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).user.globalRole).toBe("admin");
  });

  test("t.viewer (в cn=dept-it) → department_members = IT", async () => {
    expect((await login("t.viewer", "testpass123")).statusCode).toBe(200);
    const dm = await q<{ name: string }>(
      `SELECT d.name FROM department_members dm
         JOIN departments d ON d.id = dm.department_id
         JOIN users u ON u.id = dm.user_id
        WHERE u.username = 't.viewer'`,
    );
    expect(dm.map((r) => r.name)).toEqual(["IT"]);
  });

  test("неверный пароль → 401 (реальный InvalidCredentials / result code 49)", async () => {
    expect((await login("t.manager", "definitely-wrong")).statusCode).toBe(401);
  });

  test("break-glass: локальный admin входит, хотя uid=<admin> в LDAP нет", async () => {
    const admU = process.env.ADMIN_USERNAME!;
    const admP = process.env.ADMIN_PASSWORD!;
    const res = await login(admU, admP);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).user).toMatchObject({ authSource: "local", globalRole: "admin" });
  });

  test("reverse group search находит реальное groupOfNames-членство (member=<userDN>)", async () => {
    const c = await svcClient();
    try {
      const { searchEntries } = await c.search(GROUPS, {
        scope: "sub",
        filter: `(&(objectClass=groupOfNames)(member=uid=t.employee,${PEOPLE}))`,
        attributes: ["cn"],
      });
      expect(searchEntries.map((e) => String(e.dn).toLowerCase())).toContain(DEPT_INFOSEC.toLowerCase());
    } finally {
      await c.unbind();
    }
  });
});

d("Специфика LDAP-протокола, которой нет в моке: sizelimit + paged results (RFC 2696)", () => {
  const BULK = `ou=bulk,${BASE}`;
  const N = 600; // заведомо больше дефолтного slapd sizelimit (500)

  beforeAll(async () => {
    const c = await svcClient();
    try {
      const add = async (dn: string, entry: Record<string, unknown>) => {
        try {
          await c.add(dn, entry);
        } catch (e) {
          if (!/AlreadyExists/i.test(String(e))) throw e;
        }
      };
      await add(BULK, { objectClass: ["organizationalUnit"], ou: "bulk" });
      for (let i = 0; i < N; i++) {
        const uid = `bulk${String(i).padStart(4, "0")}`;
        await add(`uid=${uid},${BULK}`, { objectClass: ["inetOrgPerson"], uid, cn: uid, sn: uid });
      }
    } finally {
      await c.unbind();
    }
  }, 180_000);

  test(`обычный search обычным пользователем обрезается серверным sizelimit (< ${N})`, async () => {
    const c = await userClient("t.employee"); // не rootdn → лимиты применяются
    let n = -1;
    try {
      const r = await c.search(BULK, { scope: "sub", filter: "(objectClass=inetOrgPerson)", attributes: ["uid"] });
      n = r.searchEntries.length;
      console.log(`[ldap] plain search вернул ${n} записей (N=${N}) — сервер ограничил`);
    } catch (e) {
      expect(String(e)).toMatch(/SizeLimit/i);
      console.log(`[ldap] plain search → ${(e as Error).name} (сервер отказал по sizelimit)`);
      n = -1;
    } finally {
      await c.unbind();
    }
    expect(n).not.toBe(N); // мок вернул бы ровно N — он sizelimit не воспроизводит
  });

  test("client-side sizeLimit → сервер отвечает SizeLimitExceeded (мок это игнорирует)", async () => {
    const c = await userClient("t.employee");
    try {
      await expect(
        c.search(BULK, { scope: "sub", filter: "(objectClass=inetOrgPerson)", sizeLimit: 25, attributes: ["uid"] }),
      ).rejects.toBeInstanceOf(SizeLimitExceededError);
    } finally {
      await c.unbind();
    }
  });

  test(`paged search (pageSize=100) листает и возвращает все ${N} записей`, async () => {
    const c = await userClient("t.employee");
    try {
      const { searchEntries } = await c.search(BULK, {
        scope: "sub",
        filter: "(objectClass=inetOrgPerson)",
        attributes: ["uid"],
        paged: { pageSize: 100 },
      });
      console.log(`[ldap] paged search (pageSize=100) собрал ${searchEntries.length} записей за ${Math.ceil(searchEntries.length / 100)} страниц`);
      expect(searchEntries.length).toBe(N);
    } finally {
      await c.unbind();
    }
  });
});
