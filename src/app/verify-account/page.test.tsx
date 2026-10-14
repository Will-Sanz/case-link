import { expect, it, vi } from "vitest";
import VerifyAccountPage from "./page";

vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

it("sends old verification bookmarks to the protected workspace", () => {
  expect(() => VerifyAccountPage()).toThrow("redirect:/families");
});
