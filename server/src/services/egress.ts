/** INT-03: проверка целей. Сетевое соединение выполняет вызывающий код на возвращённый адрес. */
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { domainToASCII } from "node:url";

export type TargetRule =
  | { kind: "host"; host: string }
  | { kind: "suffix"; suffix: string }
  | { kind: "cidr"; net: string; prefix: number; family: 4 | 6 };
type CidrRule = Extract<TargetRule, { kind: "cidr" }>;
export interface TargetConfig { allowedTargets: readonly TargetRule[]; denyCidrs: readonly string[]; allowHttp: boolean }
export type TargetReason = "shape" | "scheme" | "not_allowed" | "denied_range" | "dns";
export class TargetBlockedError extends Error {
  constructor(public readonly reason: TargetReason) {
    super("Цель вебхука заблокирована: " + reason); this.name = "TargetBlockedError";
  }
}
type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<LookupAddress[]>;
const unbracket = (host: string) => host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

/** IPv6 разобран только после net.isIP; преобразуем также dotted IPv4 в последних двух словах. */
function ipv6Words(ip: string): number[] {
  let text = ip.toLowerCase();
  if (text.includes(".")) {
    const lastColon = text.lastIndexOf(":");
    const bytes = text.slice(lastColon + 1).split(".").map(Number);
    text = text.slice(0, lastColon + 1) + ((bytes[0] << 8) | bytes[1]).toString(16)
      + ":" + ((bytes[2] << 8) | bytes[3]).toString(16);
  }
  const [left, right] = text.split("::");
  const a = left ? left.split(":").map(x => parseInt(x, 16)) : [];
  if (right === undefined) return a;
  const b = right ? right.split(":").map(x => parseInt(x, 16)) : [];
  return [...a, ...Array<number>(8 - a.length - b.length).fill(0), ...b];
}

function addressOf(raw: string): { address: string; family: 4 | 6 } | null {
  const address = unbracket(raw);
  if (address.includes("%")) return null; // интерфейсные zone-id не входят в правила целей
  const family = isIP(address);
  if (family === 4) return { address, family };
  if (family !== 6) return null;
  const words = ipv6Words(address);
  if (words.slice(0, 5).every(x => x === 0) && words[5] === 0xffff) {
    return { address: [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join("."), family: 4 };
  }
  return { address: words.map(x => x.toString(16)).join(":"), family: 6 };
}

function cidrOf(raw: string): CidrRule {
  const pieces = raw.split("/");
  const source = unbracket(pieces[0]);
  const family = isIP(source);
  if (pieces.length > 2 || !family || source.includes("%")) throw new Error("Неверный CIDR");
  const bits = family === 4 ? 32 : 128;
  let prefix = pieces.length === 1 ? bits : Number(pieces[1]);
  if (pieces.length === 2 && !/^\d+$/.test(pieces[1])) throw new Error("Неверный CIDR");
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) throw new Error("Неверный CIDR");
  const normalized = addressOf(source)!;
  if (family === 6 && normalized.family === 4) {
    if (prefix < 96) throw new Error("Неверный CIDR");
    prefix -= 96;
  }
  return { kind: "cidr", net: normalized.address, family: normalized.family, prefix };
}

function hostnameOf(raw: string): string {
  if (/[\s/:@?#\[\]\\%]/.test(raw)) throw new Error("Неверное имя цели");
  const host = domainToASCII(raw.toLowerCase().replace(/\.$/, ""));
  if (!host || host.length > 253 || host.split(".").some(label =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Неверное имя цели");
  return host;
}

export function parseTargetRules(raw: string): TargetRule[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((item, index) => {
    try {
      const rule = item.trim();
      if (rule.includes("/") || isIP(unbracket(rule))) return cidrOf(rule);
      if (rule.startsWith("*.")) {
        const suffix = hostnameOf(rule.slice(2));
        if (isIP(suffix)) throw new Error("Неверный суффикс");
        return { kind: "suffix", suffix };
      }
      const host = hostnameOf(rule);
      return isIP(host) ? cidrOf(host) : { kind: "host", host };
    } catch { throw new Error(`WEBHOOK_ALLOWED_TARGETS: неверное правило в позиции ${index + 1}`); }
  });
}

export function parseDenyCidrs(raw: string): string[] {
  const result: string[] = [];
  raw.split(",").forEach((item, index) => {
    if (!item.trim()) return; // compose всегда добавляет свою сеть к необязательному списку оператора
    try {
      const cidr = cidrOf(item.trim());
      result.push(`${cidr.net}/${cidr.prefix}`);
    } catch { throw new Error(`WEBHOOK_DENY_CIDRS: неверный CIDR в позиции ${index + 1}`); }
  });
  return result;
}

function blockList(cidrs: readonly CidrRule[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) list.addSubnet(cidr.net, cidr.prefix, cidr.family === 4 ? "ipv4" : "ipv6");
  return list;
}
const denied = blockList(["0.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4",
  "::/128", "fe80::/10", "ff00::/8", "64:ff9b::/96"].map(cidrOf));
const loopback = blockList(["127.0.0.0/8", "::1/128"].map(cidrOf));
let allowLoopback = false;
export function _allowLoopbackForTests(on: boolean): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Разрешение loopback доступно только тестам");
  allowLoopback = on;
}

export function checkUrlShape(raw: string, cfg: Pick<TargetConfig, "allowHttp">): URL {
  if (raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new TargetBlockedError("shape");
  let url: URL;
  try { url = new URL(raw); } catch { throw new TargetBlockedError("shape"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && cfg.allowHttp)) throw new TargetBlockedError("scheme");
  if (url.username || url.password || !url.hostname) throw new TargetBlockedError("shape");
  url.hash = "";
  return url;
}

export function redactUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TargetBlockedError("shape"); }
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export async function resolveTarget(url: URL, cfg: TargetConfig, lookup: Lookup = dnsLookup): Promise<{
  address: string; family: 4 | 6; hostname: string; port: number; protocol: "https:" | "http:";
}> {
  const checked = checkUrlShape(url.href, cfg);
  const hostname = unbracket(checked.hostname).toLowerCase().replace(/\.$/, "");
  const literal = addressOf(hostname);
  const hostAllowed = !literal && cfg.allowedTargets.some(rule =>
    rule.kind === "host" ? hostname === rule.host
      : rule.kind === "suffix" && hostname.endsWith("." + rule.suffix));
  let answers: LookupAddress[];
  if (literal) answers = [literal];
  else {
    if (cfg.allowedTargets.length === 0) throw new TargetBlockedError("not_allowed");
    try { answers = await lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new TargetBlockedError("dns"); }
  }
  if (answers.length === 0) throw new TargetBlockedError("dns");
  const allowedCidrs = blockList(cfg.allowedTargets.filter((rule): rule is CidrRule => rule.kind === "cidr"));
  const operatorDenied = blockList(cfg.denyCidrs.map(cidrOf));
  const normalized = answers.map(answer => {
    const ip = addressOf(answer.address);
    if (!ip || isIP(unbracket(answer.address)) !== answer.family) throw new TargetBlockedError("dns");
    const family = ip.family === 4 ? "ipv4" : "ipv6";
    if (denied.check(ip.address, family) || operatorDenied.check(ip.address, family)
      || (!(allowLoopback && process.env.NODE_ENV === "test") && loopback.check(ip.address, family)))
      throw new TargetBlockedError("denied_range");
    if (!hostAllowed && !allowedCidrs.check(ip.address, family)) throw new TargetBlockedError("not_allowed");
    return ip;
  });
  return { ...normalized[0], hostname, port: Number(checked.port || (checked.protocol === "https:" ? 443 : 80)),
    protocol: checked.protocol as "https:" | "http:" };
}
