import { expect, test } from "@playwright/test";

test("home placeholder renders", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "FolioMind" })).toBeVisible();
  await expect(page.getByText("Your knowledge, connected.")).toBeVisible();
});
