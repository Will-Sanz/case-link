export async function chooseScreenLanguage(page, locale) {
  const settings = page.locator("details:visible").filter({ has: page.getByText(/^(Settings|Configuración)$/) });
  const summary = settings.locator("summary");
  const scrollY = await page.evaluate(() => window.scrollY);
  if (await settings.getAttribute("open") === null) await summary.click();
  await settings.getByLabel(/Screen language|Idioma de pantalla/).selectOption(locale);
  await summary.click();
  await page.evaluate(y => window.scrollTo(0, y), scrollY);
}
