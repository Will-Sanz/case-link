import { test, expect, activate, accessible, signIn, createPlan } from "./helpers";

test("inline plan fields have names and the workflow reflows on narrow and zoomed screens", async ({ page, local }, testInfo) => {
  await signIn(page, await local.staff());
  await createPlan(page);
  const article = page.locator("article[id^=step-]").first();
  await activate(page, article.getByRole("button", { name: "Edit action", exact: true }));
  await activate(page, article.getByRole("button", { name: "Prepare a housing intake", exact: true }));
  await accessible(page);
  await expect(article.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await activate(page, article.getByRole("button", { name: /^Discuss the family's preferences/ }));
  await accessible(page);
  await expect(article.getByRole("textbox", { name: "Summary", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await activate(page, article.getByRole("button", { name: "The client will need Agreed preparation checklist.", exact: true }));
  await accessible(page);
  await expect(article.getByRole("textbox", { name: "Documents", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await activate(page, article.getByRole("button", { name: /^Expected outcome:/ }));
  await accessible(page);
  await expect(article.getByRole("textbox", { name: "Expected outcome", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await activate(page, article.getByRole("button", { name: "Cancel", exact: true }));

  for (const [name, width, zoom] of [["narrow", 375, "1"], ["200-percent", 1280, "2"]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(value => { document.documentElement.style.zoom = value; }, zoom);
    await accessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await activate(page, page.getByRole("button", { name: "Mark plan reviewed", exact: true }));
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`${name}-review.png`), fullPage: true });
    await activate(page, page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }));
    await expect(page.getByRole("button", { name: "Mark plan reviewed", exact: true })).toBeFocused();
  }
});
