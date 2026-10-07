/**
 * Checks the live Bubble app the way the brief says reviewers will: by signing
 * in as different authors and confirming each sees only their own data, then
 * exercising the admin portal.
 *
 *   npm run test:e2e                    (needs BUBBLE_APP_URL in .env)
 *   E2E_TRIGGER=1 npm run test:e2e      (also sends one real summary via n8n)
 */
import { expect, test } from "@playwright/test";
import { dataset } from "../../scripts/lib/payload.mjs";

const BASE = (process.env.BUBBLE_APP_URL || "").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_PASSWORD || "BookLeaf@2026";
test.skip(!BASE, "Set BUBBLE_APP_URL to run the Bubble end-to-end tests");

const titlesOf = (authorId) => dataset.authors.find((a) => a.author_id === authorId).books.map((b) => b.title);
const allTitles = dataset.authors.flatMap((a) => a.books.map((b) => b.title));

async function signIn(page, email) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator("#login-submit").click();
  await page.waitForURL(/\/(dashboard|admin)/, { timeout: 30_000 });
}

for (const authorId of ["AUTH001", "AUTH003", "AUTH007"]) {
  const author = dataset.authors.find((a) => a.author_id === authorId);
  test(`${author.name} sees exactly their own books`, async ({ page }) => {
    await signIn(page, author.email);
    await expect(page).toHaveURL(/dashboard/);
    const list = page.locator("#books-list");
    for (const title of titlesOf(authorId)) await expect(list).toContainText(title);
    const body = await page.locator("body").innerText();
    for (const title of allTitles.filter((t) => !titlesOf(authorId).includes(t))) {
      expect(body, `must not show another author's book "${title}"`).not.toContain(title);
    }
  });
}

test("authors are bounced from the admin pages", async ({ page }) => {
  await signIn(page, "priya.sharma@email.com");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/admin/);
  await expect(page.locator("body")).not.toContainText("Rohit Kapoor");
});

test("admin sees every author and can filter by city, status and name", async ({ page }) => {
  await signIn(page, "admin@bookleaf.demo");
  await expect(page).toHaveURL(/admin/);
  const list = page.locator("#authors-list");
  for (const a of dataset.authors) await expect(list).toContainText(a.name);

  await page.locator("#filter-city").selectOption({ label: "Pune" });
  await expect(list).toContainText("Vikram Joshi");
  await expect(list).not.toContainText("Priya Sharma");
  await page.locator("#filter-city").selectOption({ index: 0 });

  await page.locator("#filter-status").selectOption({ label: "Paid up" });
  await expect(list).toContainText("Farhan Sheikh");
  await expect(list).not.toContainText("Rohit Kapoor");
  await page.locator("#filter-status").selectOption({ index: 0 });

  await page.locator("#filter-name").fill("kap");
  await expect(list).toContainText("Rohit Kapoor");
  await expect(list).not.toContainText("Ananya Reddy");
});

test("admin can generate and send a royalty summary", async ({ page }) => {
  test.skip(!process.env.E2E_TRIGGER, "Set E2E_TRIGGER=1 to send a real summary (uses Gemini quota + email)");
  await signIn(page, "admin@bookleaf.demo");
  await page.locator("#filter-name").fill("Farhan");
  await page.locator("#authors-list").getByText("View", { exact: true }).first().click();
  await expect(page).toHaveURL(/admin_author/);
  await page.locator("#send-summary").click();
  await expect(page.locator("body")).toContainText(/Success|Duplicate/, { timeout: 90_000 });
});
