/** Зеркало констант дашбордов из contract.ts (ADR-0022): значения оттуда в клиент импортировать нельзя — потянут zod в
 *  бандл (типы — можно). Совпадение проверяет spec.test.ts. */
export const DASHBOARD_GRID = { cols: 12, maxRows: 200, minH: 1, maxH: 8 } as const;
export const COUNT_METRICS = ["open", "overdue", "dueSoon", "unassigned", "closed", "created"] as const;
export const BREAKDOWN_GROUPS = ["status", "assignee", "priority", "type", "project"] as const;
export const ISSUE_PRESETS = ["mine", "overdue", "dueSoon", "unassigned", "recentlyCreated", "recentlyClosed"] as const;
export const WIDGET_PERIODS = [7, 14, 30, 90, 180, 365] as const;
