import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { directoryCase, directoryId, directoryStamp } from "../../../tests/fixtures/directory-case";
import { assertResourceCatalogCurrent, contactsForResourceIds, formatResourceCatalog, planResourceCatalog } from "./plan-resources";

describe("directory contact provenance", () => {
  it("copies only supplied program facts and keeps contact values out of prompts", () => {
    const catalog = planResourceCatalog(directoryCase().resourceMatches);
    expect(contactsForResourceIds([directoryId],catalog)).toEqual([expect.objectContaining({ source_resource_id: directoryId, source_updated_at: directoryStamp, name: "Housing support", phone: "215-555-0148", email: "intake@example.test" })]);
    expect(formatResourceCatalog(catalog)).not.toMatch(/215-555|intake@|Directoryperson/);
    catalog[0].phone = null; catalog[0].email = null;
    const contact = contactsForResourceIds([directoryId],catalog)[0];
    expect(contact.phone).toBeUndefined(); expect(contact.email).toBeUndefined();
    expect(contact.notes).toContain("Confirm current availability");
  });
  it("refuses unknown and repeated IDs", () => {
    const catalog = planResourceCatalog(directoryCase().resourceMatches);
    expect(() => contactsForResourceIds([directoryId,directoryId],catalog)).toThrow();
    expect(() => contactsForResourceIds(["90000000-0000-4000-8000-000000000009"],catalog)).toThrow();
    expect(contactsForResourceIds([],[])).toEqual([]);
  });
  it.each(["current","missing","dismissed","inactive","demo","stale","error","array embed"])("checks %s sources against current authorized rows", async kind => {
    const resource = { id: directoryId, updated_at: directoryStamp, active: kind !== "inactive", is_demo: kind === "demo" };
    if (kind === "stale") resource.updated_at = "2026-10-13T12:00:00.123457+00:00";
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(async () => ({ error: kind === "error" ? {} : null,
      data: kind === "missing" ? [] : [{resource_id:directoryId,status:kind === "dismissed" ? "dismissed" : "accepted",resource:kind === "array embed" ? [resource] : resource}] })) };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    const detail = directoryCase();
    const check = assertResourceCatalogCurrent(client,detail.id,planResourceCatalog(detail.resourceMatches));
    if (["current","array embed"].includes(kind)) await expect(check).resolves.toBeUndefined();
    else await expect(check).rejects.toThrow(/resource|directory/);
    expect(query.eq).toHaveBeenCalledWith("family_id",detail.id);
  });
});
