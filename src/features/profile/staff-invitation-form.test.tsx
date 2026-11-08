/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StaffInvitationForm } from "./staff-invitation-form";
import { inviteStaff } from "@/app/actions/staff-invitations";
vi.mock("@/app/actions/staff-invitations", () => ({ inviteStaff: vi.fn() }));
it("makes a copyable link, copies it, and clears it when the intended recipient changes", async () => {
  const link = "https://caselink.example/auth/callback#token_hash=synthetic";
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.mocked(inviteStaff).mockResolvedValue({ ok: true, status: "link", link }); render(<StaffInvitationForm />);
  fireEvent.change(screen.getByLabelText("Their email address"), { target: { value: "staff@example.test" } }); fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
  await screen.findByLabelText("Invite link"); fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
  fireEvent.change(screen.getByLabelText("Their email address"), { target: { value: "another@example.test" } }); expect(screen.queryByLabelText("Invite link")).toBeNull();
});
it("retains the recipient and allows retry after a failure", async () => {
  vi.mocked(inviteStaff).mockResolvedValue({ ok: false, error: "Wait a minute, then retry." }); render(<StaffInvitationForm />);
  fireEvent.change(screen.getByLabelText("Their email address"), { target: { value: "staff@example.test" } }); fireEvent.click(screen.getByRole("button", { name: "Send invitation email" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Wait a minute, then retry."); expect((screen.getByLabelText("Their email address") as HTMLInputElement).value).toBe("staff@example.test"); expect((screen.getByRole("button", { name: "Send invitation email" }) as HTMLButtonElement).disabled).toBe(false);
});
