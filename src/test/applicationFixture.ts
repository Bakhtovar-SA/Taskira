import { vi } from "vitest";

// Store tests mock their session/project APIs. Keep the independent installation
// catalogue local as well; application controller tests override this fixture.
vi.mock("../api/applications", () => ({ applicationsApi: {
  get: vi.fn(async () => ({
    revision: 1,
    canManage: false,
    applications: ["work", "knowledge", "objects"].map((id) => ({
      id: id as "work" | "knowledge" | "objects", enabled: true,
      projectIds: ["p1", "p2", "p3", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"],
    })),
  })),
  patch: vi.fn(),
} }));
