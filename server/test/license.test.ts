/**
 * ТЗ 4.3 (план v2, Трек 4): офлайн-лицензия. Два пункта, которые план прямо выделил как
 * обязательные с первого дня (см. файловый комментарий services/license.ts) проверяются здесь
 * явно, не только как побочный эффект остальных тестов:
 *   1. `kid` + несколько доверенных ключей — "ротация kid" ниже держит ДВА валидных ключа в
 *      реестре одновременно и проверяет токены, подписанные каждым.
 *   2. Подсчёт мест по активности за N дней (не count(*) от users) — отдельный блок ниже,
 *      включая ровно тот сценарий из ТЗ (1000 пользователей, 40 активны → seats = 40).
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getApp, q, resetDb, stopApp } from "./helpers.js";
import {
  countActiveSeats,
  getLicenseStatus,
  licenseHasFeature,
  signLicense,
  verifyLicenseToken,
  type LicenseClaims,
} from "../src/services/license.js";

function genKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

const keyA = genKeyPair(); // "kid-a" — доверенный
const keyB = genKeyPair(); // "kid-b" — тоже доверенный (для теста ротации) и "чужой" ключ для bad_signature
const trustedKeys = { "kid-a": keyA.publicKey, "kid-b": keyB.publicKey };

const baseClaims = (over: Partial<Omit<LicenseClaims, "iat">> = {}): Omit<LicenseClaims, "iat"> => ({
  plan: "pro",
  maxSeats: 100,
  features: ["sso"],
  activeWindowDays: 30,
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...over,
});

describe("verifyLicenseToken", () => {
  test("валидная лицензия проверяется успешно", () => {
    const token = signLicense(baseClaims(), keyA.privateKey, "kid-a");
    const result = verifyLicenseToken(token, trustedKeys);
    expect(result.ok).toBe(true);
    expect(result.claims?.plan).toBe("pro");
    expect(result.claims?.maxSeats).toBe(100);
  });

  test("просроченная лицензия — reason=expired, но claims доступны (grace period)", () => {
    const token = signLicense(baseClaims({ exp: Math.floor(Date.now() / 1000) - 10 }), keyA.privateKey, "kid-a");
    const result = verifyLicenseToken(token, trustedKeys);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
    expect(result.claims?.plan).toBe("pro"); // grace — данные лицензии видны, не отказ
  });

  test("подписана чужим ключом (заявленный kid не совпадает фактическому подписавшему) — bad_signature", () => {
    // Токен заявляет kid-a (в реестре под ним — публичный ключ keyA), но фактически подписан keyB.
    const token = signLicense(baseClaims(), keyB.privateKey, "kid-a");
    const result = verifyLicenseToken(token, trustedKeys);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
    expect(result.claims).toBeUndefined(); // в отличие от expired — не настоящая лицензия вовсе
  });

  test("неизвестный kid — unknown_kid, подпись даже не проверяется", () => {
    const token = signLicense(baseClaims(), keyA.privateKey, "kid-unknown");
    const result = verifyLicenseToken(token, trustedKeys);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_kid");
  });

  test("битый токен — malformed (неверная структура/битые base64/JSON)", () => {
    expect(verifyLicenseToken("not-a-token", trustedKeys)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyLicenseToken("a.b", trustedKeys).reason).toBe("malformed");
    expect(verifyLicenseToken("a.b.c", trustedKeys).reason).toBe("malformed");
    expect(verifyLicenseToken("", trustedKeys).reason).toBe("malformed");
  });

  test("ротация kid: два ключа доверены одновременно — старый и новый токен оба валидны", () => {
    const tokenOld = signLicense(baseClaims(), keyA.privateKey, "kid-a");
    const tokenNew = signLicense(baseClaims(), keyB.privateKey, "kid-b");
    expect(verifyLicenseToken(tokenOld, trustedKeys).ok).toBe(true);
    expect(verifyLicenseToken(tokenNew, trustedKeys).ok).toBe(true);
  });

  test("пустой реестр (продовое состояние до первого выпуска лицензии) — unknown_kid, не падает", () => {
    const token = signLicense(baseClaims(), keyA.privateKey, "kid-a");
    expect(verifyLicenseToken(token, {})).toEqual({ ok: false, reason: "unknown_kid" });
  });
});

describe("licenseHasFeature (решение requiresPlan)", () => {
  test("active со списком фич: в списке — true, не в списке — false", () => {
    const claims = { ...baseClaims({ features: ["sso"] }), iat: 0 } as LicenseClaims;
    expect(licenseHasFeature({ state: "active", claims, seatsUsed: 1, seatsOverLimit: false, daysUntilExpiry: 10 }, "sso")).toBe(true);
    expect(licenseHasFeature({ state: "active", claims, seatsUsed: 1, seatsOverLimit: false, daysUntilExpiry: 10 }, "sprints")).toBe(false);
  });

  test("expired (grace) с фичей в списке — всё ещё true: ТЗ просит без отказа в работе при истечении", () => {
    const claims = { ...baseClaims({ features: ["sso"] }), iat: 0 } as LicenseClaims;
    expect(licenseHasFeature({ state: "expired", claims, seatsUsed: 1, seatsOverLimit: false, daysSinceExpiry: 5 }, "sso")).toBe(true);
  });

  test("unset/invalid — всегда false, никакая фича не открыта без лицензии", () => {
    expect(licenseHasFeature({ state: "unset" }, "sso")).toBe(false);
    expect(licenseHasFeature({ state: "invalid", reason: "malformed" }, "sso")).toBe(false);
  });
});

describe("countActiveSeats / getLicenseStatus (БД)", () => {
  beforeAll(async () => {
    await getApp();
  });
  afterAll(async () => {
    await stopApp();
  });
  beforeEach(async () => {
    await resetDb();
  });

  async function mkUser(username: string, opts: { lastLoginDaysAgo?: number | null; active?: boolean } = {}): Promise<void> {
    const lastLoginAt = opts.lastLoginDaysAgo == null ? null : new Date(Date.now() - opts.lastLoginDaysAgo * 86_400_000);
    await q(
      `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role, is_active, last_login_at)
       VALUES ($1, 'x', $1, 'XX', '#334455', 'qa', 'member', $2, $3)`,
      [username, opts.active ?? true, lastLoginAt],
    );
  }

  test("считает только активных (is_active) пользователей, логинившихся в окне N дней", async () => {
    await mkUser("in_window", { lastLoginDaysAgo: 1 });
    await mkUser("edge_of_window", { lastLoginDaysAgo: 29 });
    await mkUser("outside_window", { lastLoginDaysAgo: 31 });
    await mkUser("never_logged_in", {}); // last_login_at NULL — JIT-провижненный, ни разу не входил
    await mkUser("deactivated_but_recent", { lastLoginDaysAgo: 1, active: false });
    expect(await countActiveSeats(30)).toBe(2);
  });

  // ТЗ 4.3, «Проверка»: ровно этот сценарий — 1000 пользователей, 40 активны, seats = 40.
  test("1000 пользователей (LDAP-масштаб дерева), из них 40 активны за 30 дней — seats = 40", async () => {
    await q(
      `INSERT INTO users (username, password_hash, name, initials, color, job_role, global_role, is_active, last_login_at)
       SELECT 'bulk' || g, 'x', 'Bulk ' || g, 'XX', '#334455', 'qa', 'member', true,
              CASE WHEN g <= 40 THEN now() - interval '1 day' ELSE now() - interval '90 days' END
         FROM generate_series(1, 1000) AS g`,
    );
    expect(await countActiveSeats(30)).toBe(40);
  });

  test("getLicenseStatus(): unset, пока instance.license_key не заполнен", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'Test Instance')`);
    expect(await getLicenseStatus(trustedKeys)).toEqual({ state: "unset" });
  });

  test("getLicenseStatus(): active, seatsUsed из БД, seatsOverLimit=false в пределах лимита", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'Test Instance')`);
    await mkUser("u1", { lastLoginDaysAgo: 1 });
    await mkUser("u2", { lastLoginDaysAgo: 1 });
    const token = signLicense(baseClaims({ maxSeats: 10 }), keyA.privateKey, "kid-a");
    await q(`UPDATE instance SET license_key = $1 WHERE id = 1`, [token]);

    const status = await getLicenseStatus(trustedKeys);
    expect(status.state).toBe("active");
    if (status.state === "active") {
      expect(status.seatsUsed).toBe(2);
      expect(status.seatsOverLimit).toBe(false);
      expect(status.daysUntilExpiry).toBeGreaterThan(0);
    }
  });

  test("getLicenseStatus(): seatsOverLimit=true, когда занятых мест больше maxSeats", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'Test Instance')`);
    await mkUser("u1", { lastLoginDaysAgo: 1 });
    await mkUser("u2", { lastLoginDaysAgo: 1 });
    const token = signLicense(baseClaims({ maxSeats: 1 }), keyA.privateKey, "kid-a");
    await q(`UPDATE instance SET license_key = $1 WHERE id = 1`, [token]);

    const status = await getLicenseStatus(trustedKeys);
    expect(status.state).toBe("active");
    if (status.state === "active") expect(status.seatsOverLimit).toBe(true);
  });

  test("getLicenseStatus(): expired — grace, состояние отдельное от invalid", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'Test Instance')`);
    const token = signLicense(baseClaims({ exp: Math.floor(Date.now() / 1000) - 86_400 }), keyA.privateKey, "kid-a");
    await q(`UPDATE instance SET license_key = $1 WHERE id = 1`, [token]);

    const status = await getLicenseStatus(trustedKeys);
    expect(status.state).toBe("expired");
    if (status.state === "expired") expect(status.daysSinceExpiry).toBeGreaterThanOrEqual(1);
  });

  test("getLicenseStatus(): invalid для неизвестного kid — не то же самое, что unset", async () => {
    await q(`INSERT INTO instance (id, name) VALUES (1, 'Test Instance')`);
    const token = signLicense(baseClaims(), keyA.privateKey, "kid-not-in-registry");
    await q(`UPDATE instance SET license_key = $1 WHERE id = 1`, [token]);

    const status = await getLicenseStatus(trustedKeys);
    expect(status).toEqual({ state: "invalid", reason: "unknown_kid" });
  });
});
