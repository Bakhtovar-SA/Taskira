/** TRUST_PROXY → значение Fastify `trustProxy`.
 *  За nginx без него `req.ip` = адрес прокси: ломает rate-limit логина по IP
 *  (routes/auth.ts) и IP в audit-логе. */
import Fastify from "fastify";
import { describe, expect, test } from "vitest";
import { parseTrustProxy } from "../src/config.js";

describe("parseTrustProxy", () => {
  test("пусто / не задано → false (прямой доступ, X-Forwarded-* игнорируются)", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
  });

  test("булевы слова", () => {
    for (const v of ["true", "yes", "on", "1", "TRUE", " On "]) expect(parseTrustProxy(v)).toBe(true);
    for (const v of ["false", "no", "off", "0", "OFF"]) expect(parseTrustProxy(v)).toBe(false);
  });

  test("IP / CIDR-список — строкой как есть", () => {
    expect(parseTrustProxy("127.0.0.1")).toBe("127.0.0.1");
    expect(parseTrustProxy("127.0.0.1,10.0.0.0/8")).toBe("127.0.0.1,10.0.0.0/8");
    expect(parseTrustProxy(" 10.0.0.0/8 ")).toBe("10.0.0.0/8");
  });
});

describe("Fastify trustProxy → req.ip", () => {
  const mkApp = async (trustProxy: boolean | string) => {
    const app = Fastify({ logger: false, trustProxy });
    app.get("/ip", async (req) => ({ ip: req.ip }));
    await app.ready();
    return app;
  };

  test("выключен: X-Forwarded-For игнорируется", async () => {
    const app = await mkApp(false);
    const r = await app.inject({ url: "/ip", headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(JSON.parse(r.body).ip).not.toBe("203.0.113.7");
    await app.close();
  });

  test("включён: req.ip берётся из X-Forwarded-For (первый адрес)", async () => {
    const app = await mkApp(true);
    const r = await app.inject({ url: "/ip", headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(JSON.parse(r.body).ip).toBe("203.0.113.7");
    await app.close();
  });
});
