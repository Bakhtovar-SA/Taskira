import { describe, expect, test } from "vitest";
import * as server from "../../server/src/contract";
import * as client from "./spec";

describe("константы дашбордов совпадают с сервером", () => {
  test.each(["DASHBOARD_GRID", "COUNT_METRICS", "BREAKDOWN_GROUPS", "ISSUE_PRESETS", "WIDGET_PERIODS", "PROJECT_WIDGET_LIMITS", "MILESTONE_PERIOD_LIMITS"] as const)("%s", (name) => {
    expect(client[name]).toEqual(server[name]);
  });
});
