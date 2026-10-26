// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParentIntake } from "./intake";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const response = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      response(
        url.endsWith("/account")
          ? {
              account: {
                email: "synthetic@example.test",
                preferences: { language: "en", contactPreference: "in_app" },
              },
            }
          : { capabilities: [] },
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("one coherent upfront support intake", () => {
  it("requires an explicit choice between SNAP and food today from the food entry point", async () => {
    render(<ParentIntake initialNeed="food" />);
    const snap = await screen.findByRole("checkbox", {
      name: /Apply for SNAP/,
    });
    const food = screen.getByRole("checkbox", { name: /Food for now/ });
    expect((snap as HTMLInputElement).checked).toBe(false);
    expect((food as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Choose at least one kind of support",
    );
    expect(
      screen.getByText(/This does not start a SNAP application/),
    ).toBeTruthy();
  });
  it("collects available SNAP household and income facts together before permission, preserving answers on back", async () => {
    render(<ParentIntake initialNeed="snap_new" />);
    await screen.findByRole("checkbox", { name: /Apply for SNAP/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", {
        name: "Your household details, in one place",
      }),
    ).toBeTruthy();
    const size = screen.getByLabelText("People in your household");
    const income = screen.getByLabelText("Household income before taxes ($)");
    expect(size.closest("details")).toBeNull();
    expect(income.closest("details")).toBeNull();
    fireEvent.change(screen.getByLabelText("Household ZIP code"), {
      target: { value: "19104" },
    });
    fireEvent.change(size, { target: { value: "4" } });
    fireEvent.change(income, { target: { value: "0" } });
    fireEvent.change(
      screen.getByLabelText("How often is that amount received?"),
      { target: { value: "monthly" } },
    );
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("checkbox", { name: /Pennsylvania SNAP/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Applications are not connected yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      (screen.getByLabelText("People in your household") as HTMLInputElement)
        .value,
    ).toBe("4");
    expect(
      (
        screen.getByLabelText(
          "Household income before taxes ($)",
        ) as HTMLInputElement
      ).value,
    ).toBe("0");
    expect(screen.queryByLabelText(/Social Security/)).toBeNull();
    expect(screen.getByText(/Names, addresses, dates of birth/)).toBeTruthy();
  });
  it("does not collect income or health information just to find food today", async () => {
    render(<ParentIntake initialNeed="food_now" />);
    await screen.findByRole("checkbox", { name: /Food for now/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.queryByLabelText("Household income before taxes ($)"),
    ).toBeNull();
    expect(screen.queryByLabelText("Pregnant or postpartum?")).toBeNull();
    expect(screen.getByLabelText("Household ZIP code")).toBeTruthy();
  });
  it("keeps utility questions visible in the same bundle and can proceed with unknown optional facts", async () => {
    render(<ParentIntake initialNeed="utilities" />);
    const electricity = await screen.findByRole("checkbox", {
      name: "Electric bill",
    });
    expect((electricity as HTMLInputElement).checked).toBe(false);
    fireEvent.click(electricity);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen
        .getByRole("group", { name: "Your utility information" })
        .closest("details"),
    ).toBeNull();
    expect(screen.getByLabelText("PECO")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Household ZIP code"), {
      target: { value: "19104" },
    });
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByText("Named programs for this request")).toBeTruthy(),
    );
  });
});
