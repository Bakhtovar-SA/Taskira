/** Роняет тест, запрос которого получил ответ не по схеме `contract.ts` (см. responseContract.ts). */
import { afterEach } from "vitest";
import { takeViolations } from "./responseContract.js";

afterEach(() => {
  const found = takeViolations();
  if (found.length === 0) return;
  const lines = [...new Map(found.map((v) => [`${v.route} — ${v.issues}`, v])).keys()];
  throw new Error(`Ответ API не соответствует схеме contract.ts:\n  ${lines.join("\n  ")}`);
});
