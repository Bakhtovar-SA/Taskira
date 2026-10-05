import { afterEach, describe, expect, test, vi } from "vitest";
import { _allowLoopbackForTests, checkUrlShape, parseDenyCidrs, parseTargetRules, redactUrl, resolveTarget, TargetBlockedError, type TargetConfig } from "../src/services/egress.js";

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = "test"; _allowLoopbackForTests(false); process.env.NODE_ENV = originalNodeEnv; });
const config = (targets = "hooks.corp.local", denyCidrs = ""): TargetConfig => ({
  allowedTargets: parseTargetRules(targets), denyCidrs: parseDenyCidrs(denyCidrs), allowHttp: false,
});
const lookup = (addresses: string[]) => vi.fn(async () => addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })));
const resolve = (raw: string, cfg = config(), addresses = ["10.1.2.3"]) => resolveTarget(new URL(raw), cfg, lookup(addresses));

describe("target rules", () => {
  test("normalizes hosts, suffixes, literals, IDNs and mapped IPv6", () => {
    expect(parseTargetRules(" Hooks.Corp.Local., *.CORP.local, 10.20.30.40, 10.20.0.0/16, fd00::/8, ::ffff:10.20.0.0/112, пример.рф "))
      .toEqual([
        { kind: "host", host: "hooks.corp.local" }, { kind: "suffix", suffix: "corp.local" },
        { kind: "cidr", net: "10.20.30.40", prefix: 32, family: 4 }, { kind: "cidr", net: "10.20.0.0", prefix: 16, family: 4 },
        { kind: "cidr", net: "fd00:0:0:0:0:0:0:0", prefix: 8, family: 6 }, { kind: "cidr", net: "10.20.0.0", prefix: 16, family: 4 },
        { kind: "host", host: "xn--e1afmkfd.xn--p1ai" },
      ]);
    expect(parseTargetRules("  ")).toEqual([]);
    expect(parseDenyCidrs(" 172.30.0.0/24, , fd00::/8 ")).toEqual(["172.30.0.0/24", "fd00:0:0:0:0:0:0:0/8"]);
  });
  test.each(["10.0.0.0/33", "fd00::/129", "10.0.0.0/-1", "10.0.0.0/", "not-a-cidr/8", "::ffff:10.0.0.0/95", "fe80::1%eth0", "https://secret.example", "secret.example:443", "user@secret.example", "secret.example?key=private", "foo\\bar", "foo bar", "*corp.local", "*.127.0.0.1", "-host.local", "a..local", ""])("rejects rule %s without echoing its value", raw => {
    expect(() => parseTargetRules("valid.local," + raw)).toThrow("WEBHOOK_ALLOWED_TARGETS: неверное правило в позиции 2");
  });
  test.each(["host.local", "10.0.0.0/33", "fd00::/129"])("rejects invalid deny CIDR %s", raw => {
    expect(() => parseDenyCidrs("10.0.0.0/8," + raw)).toThrow("WEBHOOK_DENY_CIDRS: неверный CIDR в позиции 2");
  });
});

describe("URL shape and redaction", () => {
  test("drops fragments and redacts credentials, query and fragment", () => {
    expect(checkUrlShape("https://hooks.corp.local:8443/x?token=private#part", config()).href).toBe("https://hooks.corp.local:8443/x?token=private");
    expect(redactUrl("https://user:pw@host:8443/path?key=secret#x")).toBe("https://host:8443/path");
    expect(redactUrl("https://[fd00::1]/x?secret=private")).toBe("https://[fd00::1]/x");
  });
  test.each(["", "not a URL", "https://", "https://user:pw@host/x", "https://host/\npath", "https://host/" + "x".repeat(2048)])("rejects invalid shape", raw => {
    expect(() => checkUrlShape(raw, config())).toThrow(expect.objectContaining({ reason: "shape" }));
  });
  test.each(["http://host/x", "ftp://host/x", "file:///tmp/x"])("rejects unapproved scheme", raw => {
    expect(() => checkUrlShape(raw, config())).toThrow(expect.objectContaining({ reason: "scheme" }));
  });
  test("accepts HTTP only with the operator opt-in", async () => {
    const cfg = { ...config(), allowHttp: true };
    expect(checkUrlShape("http://hooks.corp.local/x", cfg).protocol).toBe("http:");
    expect(await resolve("http://hooks.corp.local/x", cfg)).toMatchObject({ protocol: "http:", port: 80 });
  });
});

describe("resolved destinations", () => {
  test("pins the first address while preserving hostname for Host/SNI", async () => {
    const dns = lookup(["10.1.2.3", "fd00::2"]);
    expect(await resolveTarget(new URL("https://Hooks.Corp.Local:8443/x"), config(), dns))
      .toEqual({ address: "10.1.2.3", family: 4, hostname: "hooks.corp.local", port: 8443, protocol: "https:",
        addresses: [{ address: "10.1.2.3", family: 4 }, { address: "fd00:0:0:0:0:0:0:2", family: 6 }] });
    expect(dns).toHaveBeenCalledWith("hooks.corp.local", { all: true, verbatim: true });
  });
  test("suffixes match subdomains but not the root or lookalike names", async () => {
    const cfg = config("*.corp.local");
    expect(await resolve("https://deep.a.corp.local", cfg)).toMatchObject({ address: "10.1.2.3" });
    for (const host of ["corp.local", "evilcorp.local", "corp.local.other"]) {
      await expect(resolve("https://" + host, cfg)).rejects.toMatchObject({ reason: "not_allowed" });
    }
  });
  test("unmatched names require every answer to be in an allowed CIDR", async () => {
    const cfg = config("10.0.0.0/8,fd00::/8");
    expect(await resolve("https://other.local", cfg, ["10.1.2.3", "fd00::2"])).toMatchObject({ address: "10.1.2.3" });
    await expect(resolve("https://other.local", cfg, ["10.1.2.3", "192.168.1.2"])).rejects.toMatchObject({ reason: "not_allowed" });
  });
  test("literal addresses require CIDR rules and never call DNS", async () => {
    const dns = lookup(["10.1.2.4"]);
    expect(await resolveTarget(new URL("https://10.1.2.3"), config("10.1.2.0/24"), dns)).toMatchObject({ address: "10.1.2.3", family: 4, port: 443 });
    expect(dns).not.toHaveBeenCalled();
    await expect(resolve("https://10.1.2.3", config())).rejects.toMatchObject({ reason: "not_allowed" });
    expect(await resolve("https://[fd00::1]", config("fd00::/8"))).toMatchObject({ address: "fd00:0:0:0:0:0:0:1", family: 6 });
  });
  test("an empty allowlist rejects names before DNS", async () => {
    const dns = lookup(["10.1.2.3"]);
    await expect(resolveTarget(new URL("https://hooks.corp.local"), config(""), dns)).rejects.toMatchObject({ reason: "not_allowed" });
    expect(dns).not.toHaveBeenCalled();
    await expect(resolve("https://10.1.2.3", config(""))).rejects.toMatchObject({ reason: "not_allowed" });
  });
  test.each(["0.0.0.0", "0.1.2.3", "127.0.0.1", "127.9.8.7", "169.254.169.254", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "febf::1", "ff02::1", "64:ff9b::a00:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254",
    "::127.0.0.1", "2002:7f00:1::", "2002:a9fe:a9fe::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "64:ff9b:1::a9fe:a9fe"])("never permits hard-denied DNS answer %s", address => {
    return expect(resolve("https://hooks.corp.local", config("hooks.corp.local,0.0.0.0/0,::/0"), [address])).rejects.toMatchObject({ reason: "denied_range" });
  });
  test.each(["https://127.1", "https://2130706433", "https://0x7f000001", "https://[::ffff:127.0.0.1]"])("denies normalized loopback literal %s", url => {
    return expect(resolve(url, config("0.0.0.0/0,::/0"))).rejects.toMatchObject({ reason: "denied_range" });
  });
  test.each(["::127.0.0.1", "2002:7f00:1::", "2002:a9fe:a9fe::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "64:ff9b:1::a9fe:a9fe"])("denies transitional IPv6 literals %s", address => {
    return expect(resolve("https://[" + address + "]", config("::/0"))).rejects.toMatchObject({ reason: "denied_range" });
  });
  test("checks all answers even after an allowed first result", async () => {
    await expect(resolve("https://hooks.corp.local", config(), ["10.1.2.3", "127.0.0.1"])).rejects.toMatchObject({ reason: "denied_range" });
    await expect(resolve("https://hooks.corp.local", config("hooks.corp.local", "172.30.0.0/24"), ["10.1.2.3", "172.30.0.5"])).rejects.toMatchObject({ reason: "denied_range" });
  });
  test("operator-denied ranges override hostname and CIDR grants, including mapped addresses", async () => {
    await expect(resolve("https://hooks.corp.local", config("hooks.corp.local,10.0.0.0/8", "10.1.0.0/16"), ["::ffff:10.1.2.3"])).rejects.toMatchObject({ reason: "denied_range" });
    await expect(resolve("https://[fd00::1]", config("fd00::/8", "fd00::/64"))).rejects.toMatchObject({ reason: "denied_range" });
  });
  test("normalizes allowed mapped addresses to IPv4", async () => {
    expect(await resolve("https://hooks.corp.local", config("10.0.0.0/8"), ["::ffff:10.1.2.3"]))
      .toMatchObject({ address: "10.1.2.3", family: 4 });
  });
  test("empty, failed or invalid DNS answers expose only a generic DNS reason", async () => {
    for (const dns of [lookup([]), vi.fn(async () => { throw new Error("private DNS error"); }), lookup(["not an IP"]),
      vi.fn(async () => [{ address: "10.1.2.3", family: 6 }])]) {
      await expect(resolveTarget(new URL("https://hooks.corp.local"), config(), dns)).rejects.toMatchObject({ reason: "dns", message: "Цель вебхука заблокирована: dns" });
    }
  });
  test("loopback override is restricted to tests and does not override other denies", async () => {
    _allowLoopbackForTests(true);
    expect(await resolve("https://127.0.0.1", config("127.0.0.1"))).toMatchObject({ address: "127.0.0.1" });
    expect(await resolve("https://[::1]", config("::1"))).toMatchObject({ address: "0:0:0:0:0:0:0:1", family: 6 });
    await expect(resolve("https://[::127.0.0.1]", config("::/0"))).rejects.toMatchObject({ reason: "denied_range" });
    await expect(resolve("https://169.254.169.254", config("0.0.0.0/0"))).rejects.toMatchObject({ reason: "denied_range" });
    await expect(resolve("https://127.0.0.1", config("127.0.0.1", "127.0.0.0/8"))).rejects.toMatchObject({ reason: "denied_range" });
    process.env.NODE_ENV = "production";
    expect(() => _allowLoopbackForTests(true)).toThrow("только тестам");
    await expect(resolve("https://127.0.0.1", config("127.0.0.1"))).rejects.toBeInstanceOf(TargetBlockedError);
  });
});
