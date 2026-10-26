// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SavedAccountAnswers } from "./saved-account-answers";
import { fixtureRequest, fixtureIntake } from "@/lib/parent/test-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("prefills account-specific facts and permits repeated corrections while keeping a request paused", async () => {
  const request = fixtureRequest({
    status: "paused",
    intake: fixtureIntake({ needs: ["electricity", "gas"] }),
    facts: [
      {
        need: "electricity",
        field: "amountDue",
        value: 80,
        source: "parent",
        confirmedAt: "2026-10-25T16:00:00Z",
        asOf: "2026-10-25T16:00:00Z",
      },
      {
        need: "electricity",
        field: "utilityProvider",
        value: "peco",
        source: "parent",
        confirmedAt: "2026-10-25T16:00:00Z",
        asOf: "2026-10-25T16:00:00Z",
      },
      {
        need: "gas",
        field: "amountDue",
        value: 12,
        source: "parent",
        confirmedAt: "2026-10-25T16:00:00Z",
        asOf: "2026-10-25T16:00:00Z",
      },
    ],
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, request: { ...request, version: 2 } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, request: { ...request, version: 3 } }),
    });
  vi.stubGlobal("fetch", fetch);
  render(<SavedAccountAnswers request={request} onChange={() => {}} />);
  screen
    .getByText("Review or correct account answers")
    .closest("details")!.open = true;
  const electricity = within(
    screen.getByRole("region", { name: "Electric bill saved answers" }),
  );
  const gas = within(
    screen.getByRole("region", { name: "Gas bill saved answers" }),
  );
  expect(electricity.getByText("$80.00")).toBeTruthy();
  expect(gas.getByText("$12.00")).toBeTruthy();
  const amount = electricity.getByLabelText(
    "Amount due ($)",
  ) as HTMLInputElement;
  expect(amount.value).toBe("80");
  fireEvent.change(amount, { target: { value: "90" } });
  fireEvent.click(
    electricity.getByRole("button", { name: "Save account answer" }),
  );
  await electricity.findByText(/This request remains paused/);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    action: "answer_fact",
    need: "electricity",
    field: "amountDue",
    value: 90,
    version: 1,
  });
  fireEvent.change(amount, { target: { value: "95" } });
  fireEvent.click(
    electricity.getByRole("button", { name: "Save account answer" }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body).version).toBe(2);
  fireEvent.change(electricity.getByLabelText("Account detail to update"), {
    target: { value: "utilityProvider" },
  });
  expect(
    (electricity.getByLabelText("Utility provider") as HTMLSelectElement).value,
  ).toBe("peco");
  expect(
    electricity.getByText(
      /Changing provider clears previous account-specific answers/,
    ),
  ).toBeTruthy();
});
