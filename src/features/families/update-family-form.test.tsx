/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { updateFamilyMeta } from "@/app/actions/families";
import { UpdateFamilyForm } from "./update-family-form";

vi.mock("@/app/actions/families", () => ({ updateFamilyMeta: vi.fn() }));

it("keeps entered profile changes available after a lost save response", async () => {
  vi.mocked(updateFamilyMeta).mockRejectedValue(new Error("Private transport detail"));
  render(<UpdateFamilyForm family={{ id: "family", summary: "Original context", household_notes: null, urgency: null, status: "active" }} />);
  fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Discuss the agreed next step together." } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Your edits are still here");
  expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("Discuss the agreed next step together.");
  expect(screen.queryByText("Private transport detail")).toBeNull();
  expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
});
