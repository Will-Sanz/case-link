// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ParentPrivacyPage from "@/app/(parent)/support/privacy/page";
import ParentTermsPage from "@/app/(parent)/support/terms/page";

afterEach(cleanup);

describe("parent policy commitments", () => {
  it("preserves the published contact and data policy while explaining shared-identity erasure", () => {
    render(<ParentPrivacyPage />);
    expect(
      screen
        .getByRole("link", { name: "willsanz23@gmail.com" })
        .getAttribute("href"),
    ).toBe("mailto:willsanz23@gmail.com");
    expect(document.getElementById("data-policy")?.textContent).toContain(
      "storage, access & security",
    );
    expect(
      screen.getByText(/We do not sell personal information/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /It does not delete a reused CaseLink sign-in identity or school records/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Resend delivers/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "OpenAI’s API data controls" })
        .getAttribute("href"),
    ).toBe("https://developers.openai.com/api/docs/guides/your-data");
  });

  it("preserves contact, personal acts and honest limits without inventing OpenAI endorsement", () => {
    render(<ParentTermsPage />);
    expect(
      screen
        .getByRole("link", { name: "willsanz23@gmail.com" })
        .getAttribute("href"),
    ).toBe("mailto:willsanz23@gmail.com");
    expect(screen.getByText(/CaseLink does not sign as you/)).toBeTruthy();
    expect(
      screen.getByText(/OpenAI operates CaseLink or guarantees assistance/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Mandatory consumer rights remain in place/),
    ).toBeTruthy();
  });
});
