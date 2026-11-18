import { describe, expect, it } from "vitest";
import FamilyProfilePage, { metadata } from "./page";

describe("family profile page", () => {
  it("keeps private profile navigation out of search indexing and accepts only safe support returns", async () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    const valid = await FamilyProfilePage({ searchParams: Promise.resolve({ next: "/get-support?need=gas" }) });
    expect(valid.props.returnTo).toBe("/get-support?need=gas");
    for (const next of ["https://attacker.example.test", "/family-profile", "/family-profile?next=//attacker.example.test"])
      expect((await FamilyProfilePage({ searchParams: Promise.resolve({ next }) })).props.returnTo).toBe("/my-support");
  });
});
