import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { WorkspaceControls, WorkspaceSelect } from "./WorkspaceControls";

afterEach(cleanup);

// Menu/Popover here come from ds/LazyOverlay: until the overlay chunk loads the trigger is a stub. The surfaces are
// controlled so that a click on the stub is remembered and the surface opens once the chunk arrives.
test("a click on the filters button before the overlay chunk loads still opens the panel", async () => {
  render(<I18nProvider><WorkspaceControls search={null} filters={<p>filter body</p>} /></I18nProvider>);
  const stub = screen.getByRole("button", { expanded: false });
  expect(stub.getAttribute("aria-controls")).toBeNull(); // still the stub
  fireEvent.click(stub);
  await waitFor(() => expect(screen.getByRole("button", { hidden: true, expanded: true }).getAttribute("aria-controls")).toBeTruthy(), { timeout: 5000 });
  expect(screen.getByText("filter body", { ignore: false }).textContent).toBe("filter body");
});

test("a click on a filter value menu before the overlay chunk loads still opens it", async () => {
  render(<I18nProvider><WorkspaceSelect label="Kind" value="a" onChange={() => {}} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} /></I18nProvider>);
  const stub = screen.getByRole("button", { name: "Kind" });
  expect(stub.getAttribute("aria-controls")).toBeNull();
  fireEvent.click(stub);
  await waitFor(() => expect(screen.getAllByRole("menuitem", { hidden: true }).length).toBe(2), { timeout: 5000 });
});
