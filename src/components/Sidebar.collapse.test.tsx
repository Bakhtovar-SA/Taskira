import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { I18nProvider } from "../i18n";

const store = {
  me: { id: "u1", name: "Ann", globalRole: "admin", authSource: "local", avatarUpdatedAt: null },
  data: {
    currentUserId: "u1", currentProjectId: "p1", users: [{ id: "u1", name: "Ann" }],
    project: { id: "p1", key: "A", name: "Alpha", sprintsEnabled: false },
    projects: [{ id: "p1", key: "A", name: "Alpha", departmentId: "d1", isShared: false, icon: null, color: null }],
    departments: [{ id: "d1", name: "Team" }], collaborations: [], favoriteProjectIds: [],
    assignedToMe: [], assignedTruncated: false,
  },
  ui: { view: "board", section: "" },
  bootStatus: "ready",
  setView: vi.fn(), goHome: vi.fn(), switchProject: vi.fn(), enterProject: vi.fn(),
  refreshAssignedToMe: vi.fn(async () => {}),
};
vi.mock("../store", () => ({
  useStore: () => store, useNotifications: () => ({ notifications: [] }),
  useUnreadCount: () => 0, useToasts: () => [],
}));
const glide = vi.hoisted(() => vi.fn());
vi.mock("../motion", async (importOriginal) => ({ ...(await importOriginal<object>()), glideWidth: glide }));
import Sidebar from "./Sidebar";

/** matchMedia whose (min-width: 1024px) answer the test flips, notifying listeners like a real resize. */
function mockViewport(wide: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    get matches() { return wide; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => mq);
  return { resize(next: boolean) { wide = next; act(() => listeners.forEach((fn) => fn())); } };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("Sidebar collapse shortcut", () => {
  test("after widening past the breakpoint, [ collapses the panel with the width glide", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const viewport = mockViewport(false);
    const { container } = render(<I18nProvider><Sidebar /></I18nProvider>);
    viewport.resize(true);
    expect(container.querySelector(".sidebar-expanded")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "[", code: "BracketLeft" });
    // Collapsed into the icon rail, and the old shell width was captured for the glide.
    expect(container.querySelector(".sidebar-expanded")).toBeNull();
    expect(glide).toHaveBeenCalledTimes(1);
  });
});
