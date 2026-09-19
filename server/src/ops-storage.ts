import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat as fileStat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { loadConfig } from "./config.js";
import { getStorage } from "./services/storage.js";

type Entry = { key: string; file: string; size: number; sha256: string; contentType: string };
type ObjectManifest = { format: 1; driver: "local" | "s3"; objects: Entry[] };

function safeObjectKey(key: string): boolean {
  return !key.startsWith("/") && !key.includes("\\") && key.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function safeDirectory(value: string): string {
  const dir = resolve(value);
  if (dir === "/" || basename(dir) === "") throw new Error("refusing unsafe storage bundle directory");
  return dir;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function exportStorage(directory: string): Promise<void> {
  const cfg = loadConfig();
  const storage = await getStorage(cfg);
  const root = safeDirectory(directory);
  const objectsDir = join(root, "objects");
  await mkdir(objectsDir, { recursive: true });
  const entries: Entry[] = [];
  const objects = (await storage.list()).sort((a, b) => a.key.localeCompare(b.key));
  for (const [index, object] of objects.entries()) {
    if (!safeObjectKey(object.key)) throw new Error(`unsafe storage object key: ${object.key}`);
    const metadata = await storage.stat(object.key);
    if (!metadata) throw new Error(`storage object disappeared during backup: ${object.key}`);
    const file = `objects/${String(index).padStart(8, "0")}.bin`;
    const target = join(root, file);
    await pipeline(await storage.get(object.key), createWriteStream(target, { mode: 0o600 }));
    const actual = await fileStat(target);
    if (actual.size !== metadata.size) throw new Error(`storage object size changed during backup: ${object.key}`);
    entries.push({
      key: object.key,
      file,
      size: actual.size,
      sha256: await sha256(target),
      contentType: metadata.contentType ?? "application/octet-stream",
    });
  }
  const manifest: ObjectManifest = { format: 1, driver: cfg.storage.driver, objects: entries };
  await writeFile(join(root, "objects.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`Exported ${entries.length} storage objects (${cfg.storage.driver}).`);
}

async function readManifest(directory: string): Promise<{ root: string; manifest: ObjectManifest }> {
  const root = safeDirectory(directory);
  const manifest = JSON.parse(await readFile(join(root, "objects.json"), "utf8")) as ObjectManifest;
  if (manifest.format !== 1 || !Array.isArray(manifest.objects)) throw new Error("unsupported storage manifest");
  for (const entry of manifest.objects) {
    if (!safeObjectKey(entry.key) || !/^objects\/[0-9]{8}\.bin$/.test(entry.file) || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error("invalid storage manifest entry");
    }
    const source = join(root, entry.file);
    const actual = await fileStat(source);
    if (actual.size !== entry.size || (await sha256(source)) !== entry.sha256) {
      throw new Error(`storage object checksum mismatch: ${entry.key}`);
    }
  }
  return { root, manifest };
}

async function importStorage(directory: string): Promise<void> {
  const cfg = loadConfig();
  const storage = await getStorage(cfg);
  const { root, manifest } = await readManifest(directory);
  const existing = await storage.list();
  for (const object of existing) await storage.delete(object.key);
  for (const entry of manifest.objects) {
    await storage.put(entry.key, createReadStream(join(root, entry.file)), {
      contentType: entry.contentType,
      size: entry.size,
    });
  }
  console.log(`Imported ${manifest.objects.length} storage objects into ${cfg.storage.driver}.`);
}

async function verifyStorage(directory: string): Promise<void> {
  const { manifest } = await readManifest(directory);
  console.log(`Verified ${manifest.objects.length} storage objects.`);
}

const [command, directory] = process.argv.slice(2);
if (!directory || !["export", "verify", "import"].includes(command ?? "")) {
  console.error("Usage: node dist/ops-storage.js export|verify|import DIRECTORY");
  process.exit(2);
}

if (command === "export") await exportStorage(directory);
else if (command === "verify") await verifyStorage(directory);
else await importStorage(directory);
