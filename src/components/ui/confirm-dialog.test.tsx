// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

describe("ConfirmDialog", () => {
  it("uses the native modal dialog and restores a safe Escape path", () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Delete action?"
        description="This cannot be undone."
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not dismiss while an action is pending", () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        pending
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Delete action?"
        description="This cannot be undone."
      />,
    );

    fireEvent(
      screen.getByRole("alertdialog"),
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
