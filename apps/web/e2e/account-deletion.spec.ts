import { expect, test, type Page } from "@playwright/test";
import {
  accountState,
  auditActionsFor,
  closeE2eDatabase,
  createTestUser,
  deleteTestUsers,
  hasTestAuth,
  seedProject,
  signInAs,
} from "./auth";

/*
 * Delete account (Section 6 "Subscription and account end states"; Section 28):
 * the exact phrase, a recent sign-in, then the account is refused everywhere
 * and its content revoked. Stripe isn't configured for the test server, and
 * its Auth0 domain doesn't resolve, so nothing outside the local stack is
 * touched; the domain tests cover the subscription and identity steps.
 */

const created: string[] = [];

/** The theme radio reflects next-themes only after hydration, so the dialog trigger is live. */
async function openDeleteDialog(page: Page) {
  await page.goto("/dashboard/settings");
  await expect(page.getByRole("radio", { checked: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Account flows run once, at desktop width.");
  test.skip(
    !(await hasTestAuth(request)),
    "The server has no Auth0 settings: stop any running dev server so Playwright starts one with the test configuration.",
  );
});

test.afterAll(async () => {
  await deleteTestUsers(created);
  await closeE2eDatabase();
});

test("deleting an account needs the exact phrase, then ends every session", async ({
  context,
  page,
}) => {
  const user = await createTestUser();
  created.push(user.id);
  const projectId = await seedProject(user.id, { title: "Field notes on rivers" });
  await signInAs(context, user);

  const dialog = await openDeleteDialog(page);
  await expect(dialog.getByText("A Pro subscription is cancelled at once")).toBeVisible();
  const phrase = dialog.getByLabel(/to confirm/);
  await phrase.fill("delete it");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(dialog.getByText("Type “delete my account” to confirm.")).toBeVisible();
  await expect(phrase).toHaveAttribute("aria-invalid", "true");
  expect((await accountState(user.id, projectId)).status).toBe("active");

  await phrase.fill("delete my account");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  // The action, then /session/end, then /login: longer than one default wait in CI.
  await expect(page).toHaveURL(/\/login\?auth_error=deleted/, { timeout: 15_000 });
  await expect(
    page.getByRole("alert").filter({ hasText: "This account has been deleted" }),
  ).toBeVisible();

  expect(await accountState(user.id, projectId)).toEqual({
    status: "deleting",
    projectDeleted: true,
  });
  expect(await auditActionsFor(user.id)).toContain("user.deletion_requested");

  // A session minted before the deletion opens nothing either.
  await signInAs(context, user);
  await page.goto("/dashboard/projects");
  await expect(page).toHaveURL(/\/login\?auth_error=deleted/);
});

test("an older sign-in must sign in again before deleting", async ({ context, page }) => {
  const user = await createTestUser();
  created.push(user.id);
  const projectId = await seedProject(user.id, { title: "Kept project" });
  await signInAs(context, user, { signedInAt: new Date(Date.now() - 30 * 60 * 1000) });

  const dialog = await openDeleteDialog(page);
  await dialog.getByLabel(/to confirm/).fill("delete my account");
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(dialog.getByText(/sign in again, then delete your account/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
    "href",
    /prompt=login/,
  );
  expect(await accountState(user.id, projectId)).toEqual({
    status: "active",
    projectDeleted: false,
  });
});
