import type { PoolClient } from "pg";
import { expect, test, vi } from "vitest";

const { one, q } = vi.hoisted(() => ({ one: vi.fn(), q: vi.fn() }));
vi.mock("../src/db.js", () => ({ one, q, withTransaction: vi.fn() }));
import { assertTransition } from "../src/services/workflow.js";

test("a rejected transition reads status labels through the existing transaction client", async () => {
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes("workflow_transitions")) return { rows: [] };
    if (sql.startsWith("SELECT id")) return { rows: [{ id: "from" }, { id: "to" }] };
    return { rows: [{ name: args[0] === "from" ? "Open" : "Closed" }] };
  });
  await expect(assertTransition("project", "from", "to", { query } as unknown as PoolClient)).rejects.toMatchObject({ statusCode: 409 });
  expect(one).not.toHaveBeenCalled();
  expect(q).not.toHaveBeenCalled();
});
