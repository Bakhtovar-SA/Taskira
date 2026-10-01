import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { setup } from "./global-setup.js";
import { TEST_STORAGE_DIR } from "./env.js";

test("отклонённый второй runner сохраняет хранилище активного прогона", async () => {
  // Vitest global setup already owns the session lock in the parent process.
  // A second setup in this worker must fail before touching shared attachments.
  await mkdir(TEST_STORAGE_DIR, { recursive: true });
  const sentinel = join(TEST_STORAGE_DIR, "runner-lock-sentinel.txt");
  await writeFile(sentinel, "active runner attachment");
  try {
    await expect(setup()).rejects.toThrow("Другой `vitest run`");
    expect(await readFile(sentinel, "utf8")).toBe("active runner attachment");
  } finally {
    await unlink(sentinel).catch(() => undefined);
  }
});
