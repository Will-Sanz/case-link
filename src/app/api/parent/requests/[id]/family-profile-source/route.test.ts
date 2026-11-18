import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sources: vi.fn() }));
vi.mock("@/lib/parent/family-profile-data", () => ({ getFamilyProfileSources: mocks.sources }));
import { GET } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => vi.clearAllMocks());
it("returns only the exact owned version's metadata without caching", async () => {
  const fields = [{ applicationPath: "contact.firstName", profilePaths: ["primaryPerson.firstName"] }];
  mocks.sources.mockResolvedValue({ fields });
  const response = await GET(new Request(`http://127.0.0.1:3200/api/parent/requests/${id}/family-profile-source?expectedVersion=2`), { params: Promise.resolve({ id }) });
  expect(await response.json()).toEqual({ ok: true, fields });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.sources).toHaveBeenCalledExactlyOnceWith(id, 2);
});
it.each(["", "0", "2.0", "02", "2147483648"])("rejects invalid version %s before metadata access", async version => {
  const response = await GET(new Request(`http://127.0.0.1:3200/api/parent/requests/${id}/family-profile-source?expectedVersion=${version}`), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(400); expect(mocks.sources).not.toHaveBeenCalled();
});
