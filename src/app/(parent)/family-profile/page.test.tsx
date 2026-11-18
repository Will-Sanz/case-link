import { describe, expect, it, vi } from "vitest";
import FamilyProfilePage, { generateMetadata } from "./page";

vi.mock("@/lib/parent/locale-server", () => ({ readParentLocale: vi.fn(async () => "es") }));

describe("family profile page", () => {
  it("keeps private profile navigation out of search indexing and accepts only safe support returns", async () => {
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Su información familiar");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    const valid = await FamilyProfilePage({ searchParams: Promise.resolve({ next: "/get-support?need=gas" }) });
    expect(valid.props.returnTo).toBe("/get-support?need=gas");
    for (const next of ["https://attacker.example.test", "/family-profile", "/family-profile?next=//attacker.example.test"])
      expect((await FamilyProfilePage({ searchParams: Promise.resolve({ next }) })).props.returnTo).toBe("/my-support");
  });
});
