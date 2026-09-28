import { describe, expect, test } from "vitest";
import { ApiError } from "../api";
import ru, { type TKey } from "./ru";
import en from "./en";
import { apiErrorText } from "./apiErrors";

const tEn = (k: TKey) => en[k];
const tRu = (k: TKey) => ru[k];

describe("ошибки сервера на языке интерфейса (A8)", () => {
  test("русский интерфейс показывает причину сервера как есть", () => {
    const e = new ApiError(403, "FORBIDDEN", "Сотрудник может править только свои задачи");
    expect(apiErrorText(e, "ru", tRu, "Не удалось сохранить задачу")).toBe("Сотрудник может править только свои задачи");
  });

  test("английский: общий код — действие + причина, без русского текста", () => {
    const e = new ApiError(403, "FORBIDDEN", "Сотрудник может править только свои задачи");
    expect(apiErrorText(e, "en", tEn, "Couldn't save the issue")).toBe("Couldn't save the issue. You don't have permission for this action");
  });

  test("английский: конкретный код самодостаточен", () => {
    const e = new ApiError(413, "ATTACHMENT_TOO_LARGE", "Файл больше 25 МБ");
    expect(apiErrorText(e, "en", tEn, "Couldn't upload")).toBe("The file is too large");
  });

  test("английский: неизвестный код — общий текст действия, не русская причина", () => {
    const e = new ApiError(409, "SOMETHING_NEW", "Что-то новое");
    expect(apiErrorText(e, "en", tEn, "Couldn't save")).toBe("Couldn't save");
  });

  test("без действия (подзаголовок пустого состояния) — только причина", () => {
    const e = new ApiError(0, "NETWORK", "Нет связи с сервером");
    expect(apiErrorText(e, "en", tEn, "")).toBe("Can't connect to the server");
    expect(apiErrorText(new ApiError(404, "NOT_FOUND", "Нет"), "en", tEn, "")).toBe("Not found — it may have been deleted");
  });

  test("не ошибка API — общий текст действия", () => {
    expect(apiErrorText(new Error("boom"), "en", tEn, "Couldn't load")).toBe("Couldn't load");
    expect(apiErrorText("строка", "ru", tRu, "Не удалось")).toBe("Не удалось");
  });

  test("каждый код, который бросает сервер, есть в словаре", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const codes = new Set<string>();
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/ApiHttpError\(\s*\d{3},\s*"([A-Za-z_]+)"/g)) codes.add(m[1]);
          for (const m of src.matchAll(/code: "([A-Za-z_]+)", reason/g)) codes.add(m[1]);
        }
      }
    };
    walk(join(__dirname, "../../server/src"));
    expect(codes.size).toBeGreaterThan(10);
    const missing = [...codes].filter((c) => !(`apiError.${c}` in ru));
    expect(missing).toEqual([]);
  });
});
