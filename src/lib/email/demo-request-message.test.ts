import { describe, expect, it } from "vitest";
import { buildDemoRequestMessage } from "@/lib/email/demo-request-message";

describe("buildDemoRequestMessage", () => {
  it("includes the request details in text and HTML", () => {
    const message = buildDemoRequestMessage({
      name: "Jordan Lee",
      email: "jordan@school.org",
      organization: "Example District",
      role: "Student services director",
      message: "We repeat the same intake details.",
    }, new Date("2026-08-03T01:00:00Z"));

    expect(message.subject).toBe("New CaseLink demo request — Example District");
    expect(message.text).toContain("Work email: jordan@school.org");
    expect(message.text).toContain("We repeat the same intake details.");
    expect(message.html).toContain("Example District");
  });

  it("escapes requester content before including it in HTML", () => {
    const message = buildDemoRequestMessage({
      name: "<script>alert('x')</script>",
      email: "safe@example.org",
      organization: "A & B Schools",
      role: "Director",
      message: "<b>Needs review</b>",
    }, new Date("2026-08-03T01:00:00Z"));

    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<b>Needs review</b>");
    expect(message.html).toContain("A &amp; B Schools");
  });
});
