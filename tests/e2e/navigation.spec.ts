import { test, expect, signIn, createFamily, accessible, activate, createPlan } from "./helpers";

test("background family navigation fetches loading shells instead of complete family records", async ({ page, local }) => {
  await signIn(page, await local.staff());
  let capture!: (body: string) => void;
  const prefetched = new Promise<string>(resolve => { capture = resolve; });
  await page.route("**/families/*/profile?*", async route => {
    if (route.request().headers()["next-router-prefetch"] !== "1") return route.continue();
    const response = await route.fetch();
    capture(await response.text());
    await route.fulfill({ response });
  });
  const familyId = await createFamily(page);
  const body = await prefetched;
  expect(body).not.toContain("Family 014");
  await page.getByRole("navigation", { name: "Family workspace", exact: true })
    .getByRole("link", { name: "Family profile", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/profile$`));
  await expect(page.getByRole("heading", { name: "Family 014", exact: true })).toBeVisible();
});

test("family tabs respond and keep the workspace available", async ({ page, local }, testInfo) => {
  await signIn(page, await local.staff());
  const familyId = await createFamily(page);
  await expect(page.getByRole("heading", { name: "Family 014", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Family workspace", exact: true });
  const timings: { destination: string; round: number; milliseconds: number }[] = [];
  for (let round = 0; round < 3; round++) {
    for (const [label, path] of [["Intervention plan", "plan"], ["Family profile", "profile"], ["Review PDF", "paperwork"], ["Barriers", "overview"]]) {
      const started = Date.now();
      await navigation.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/families/${familyId}/${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      timings.push({ destination: path, round, milliseconds: Date.now() - started });
      await expect(navigation).toBeVisible();
    }
  }
  console.log("NAVIGATION_TIMINGS", JSON.stringify(timings));
  await testInfo.attach("navigation-timings", { body: JSON.stringify(timings, null, 2), contentType: "application/json" });
});

test("slow tab navigation gives feedback and can be interrupted", async ({ page, local }, testInfo) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  // Hold prefetches too, so this exercises a destination that is not ready yet.
  await page.route("**/families/*/profile?*", async route => {
    await held;
    await route.continue();
  });
  await signIn(page, await local.staff());
  const familyId = await createFamily(page);
  await expect(page.getByRole("heading", { name: "Family 014", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Family workspace", exact: true });
  try {
    const started = Date.now();
    await activate(page, navigation.getByRole("link", { name: "Family profile", exact: true }));
    await expect(page.getByRole("status").filter({ hasText: /Loading workspace|Opening Family profile/ }).first()).toBeVisible({ timeout: 1000 });
    console.log("SLOW_NAVIGATION_FEEDBACK_MS", Date.now() - started);
    await expect(navigation).toBeVisible();
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath("desktop-loading.png") });
    // A second destination must remain usable while the first response is held.
    await navigation.getByRole("link", { name: "Intervention plan", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/families/${familyId}/plan$`));
    await expect(page.getByRole("heading", { name: "Family 014", exact: true })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(navigation.getByRole("link", { name: "Intervention plan", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/plan$`));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("summary").filter({ hasText: "Open navigation" }).click();
  const mobile = page.getByRole("navigation", { name: "Mobile workspace", exact: true });
  await expect(mobile).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-navigation.png") });
  await mobile.getByRole("link", { name: "Barriers", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/overview$`));
  await expect(page.getByRole("heading", { name: "Family 014", exact: true })).toBeVisible();
  await expect(mobile).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("unsaved action edits can still be recovered after switching tabs", async ({ page, local }) => {
  await signIn(page, await local.staff());
  const familyId = await createPlan(page);
  const action = page.locator("article[id^=step-]").first();
  await action.getByRole("button", { name: "Edit action", exact: true }).click();
  await action.getByLabel("Action 1", { exact: true }).fill("Confirm the afternoon follow-up together");
  const navigation = page.getByRole("navigation", { name: "Family workspace", exact: true });
  await navigation.getByRole("link", { name: "Family profile", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/profile$`));
  await expect(page.getByRole("heading", { name: "Current context", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "Intervention plan", exact: true }).click();
  await page.getByRole("button", { name: "Restore edit", exact: true }).click();
  await expect(action.getByLabel("Action 1", { exact: true })).toHaveValue("Confirm the afternoon follow-up together");
});

test("saved context refreshes previously loaded tabs", async ({ page, local }) => {
  await signIn(page, await local.staff());
  const familyId = await createFamily(page);
  const navigation = page.getByRole("navigation", { name: "Family workspace", exact: true });
  await navigation.getByRole("link", { name: "Family profile", exact: true }).click();
  await page.getByLabel("Summary", { exact: true }).fill("The family now prefers a meeting after school.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await navigation.getByRole("link", { name: "Barriers", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/overview$`));
  await expect(page.locator("#family-additional-context")).toHaveValue("The family now prefers a meeting after school.");
});
