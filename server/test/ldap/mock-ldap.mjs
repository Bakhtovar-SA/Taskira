/**
 * Мок LDAP-сервера на ldapjs — то же дерево, что bootstrap.ldif, но in-process.
 * Нужен, когда Docker недоступен (dev-машина без Docker) и для быстрых
 * прогонов. В CI/полноценной разработке — docker-compose.ldap.yml (D7).
 *
 *   node test/ldap/mock-ldap.mjs            # порт 1389
 *   MOCK_LDAP_PORT=1389 node test/ldap/mock-ldap.mjs
 *
 * Bind: cn=admin,dc=taskira,dc=test / admin  (сервис-аккаунт);
 *       uid=t.*,ou=people,... / testpass123
 */
import ldap from "ldapjs";

const PORT = Number(process.env.MOCK_LDAP_PORT ?? 1389);
const BASE = "dc=taskira,dc=test";
const SERVICE_DN = `cn=admin,${BASE}`;
const SERVICE_PW = "admin";
const USER_PW = "testpass123";

const people = {
  "t.admin": { cn: "Тест Админ", sn: "Админ", mail: "t.admin@taskira.test" },
  "t.manager": { cn: "Тест Менеджер", sn: "Менеджер", mail: "t.manager@taskira.test" },
  "t.employee": { cn: "Тест Сотрудник", sn: "Сотрудник", mail: "t.employee@taskira.test" },
  "t.viewer": { cn: "Тест Наблюдатель", sn: "Наблюдатель", mail: "t.viewer@taskira.test" },
  "t.outsider": { cn: "Тест Посторонний", sn: "Посторонний", mail: "t.outsider@taskira.test" },
};
const groups = {
  "taskira-admins": ["t.admin"],
  "dept-infosec": ["t.manager", "t.employee"],
  "dept-it": ["t.viewer"],
};

const personDn = (uid) => `uid=${uid},ou=people,${BASE}`;
const groupDn = (cn) => `cn=${cn},ou=groups,${BASE}`;

/** Все записи каталога: { dn, attributes(lowercase keys) }. */
const entries = [
  { dn: BASE, attributes: { objectclass: ["dcObject", "organization"], dc: ["taskira"], o: ["Taskira Test"] } },
  { dn: `ou=people,${BASE}`, attributes: { objectclass: ["organizationalUnit"], ou: ["people"] } },
  { dn: `ou=groups,${BASE}`, attributes: { objectclass: ["organizationalUnit"], ou: ["groups"] } },
  ...Object.entries(people).map(([uid, p]) => ({
    dn: personDn(uid),
    attributes: {
      objectclass: ["inetOrgPerson", "person", "top"],
      uid: [uid],
      cn: [p.cn],
      sn: [p.sn],
      mail: [p.mail],
      // memberOf для полноты (наш dev-конфиг использует LDAP_GROUP_MEMBERSHIP=search,
      // но пусть будет — вдруг переключат)
      memberof: Object.entries(groups).filter(([, m]) => m.includes(uid)).map(([g]) => groupDn(g)),
    },
  })),
  ...Object.entries(groups).map(([cn, members]) => ({
    dn: groupDn(cn),
    attributes: {
      objectclass: ["groupOfNames", "top"],
      cn: [cn],
      member: members.map(personDn),
    },
  })),
];

const server = ldap.createServer();

server.bind(BASE, (req, res, next) => {
  const dn = req.dn.toString();
  const pw = req.credentials;
  const eqCI = (a, b) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();
  if (eqCI(dn, SERVICE_DN) && pw === SERVICE_PW) return (res.end(), next());
  const m = dn.match(/^uid=([^,]+),ou=people,/i);
  if (m && people[m[1]] && pw === USER_PW) return (res.end(), next());
  return next(new ldap.InvalidCredentialsError());
});

server.search(BASE, (req, res, next) => {
  const base = req.dn.toString().toLowerCase();
  const scope = req.scope; // base | one | sub
  for (const e of entries) {
    const edn = e.dn.toLowerCase();
    const inScope =
      scope === "base" ? edn === base : scope === "one" ? edn.endsWith(base) && edn !== base : edn === base || edn.endsWith("," + base);
    if (!inScope) continue;
    if (req.filter.matches(e.attributes)) res.send(e);
  }
  res.end();
  next();
});

server.on("error", (e) => console.error("[mock-ldap] server error:", e.message));
process.on("uncaughtException", (e) => console.error("[mock-ldap] uncaught:", e.message));

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-ldap] ${server.url} — base ${BASE}`);
});
