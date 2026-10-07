/**
 * Creates the demo logins in the Bubble app through its one-time `setup` page
 * (docs/bubble-build-guide.md, Part 7.5), so nobody has to type 11 sign-ups.
 *
 *   BUBBLE_APP_URL=https://bookleaf-royalty.bubbleapps.io/version-test node scripts/bubble-create-logins.mjs
 *
 * App Settings' `signup_open` must be "yes" while this runs; set it to "no"
 * afterwards. Accounts that already exist are reported and skipped.
 */
import { chromium } from "@playwright/test";
import { dataset } from "./lib/payload.mjs";

const BASE = (process.env.BUBBLE_APP_URL || "").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_PASSWORD || "BookLeaf@2026";
if (!BASE) throw new Error("Set BUBBLE_APP_URL, e.g. https://bookleaf-royalty.bubbleapps.io/version-test");

const accounts = ["admin@bookleaf.demo", ...dataset.authors.map((a) => a.email)];

const browser = await chromium.launch();
const page = await browser.newPage();
let alertText = "";
page.on("dialog", async (d) => {
  alertText = d.message();
  await d.dismiss();
});

for (const email of accounts) {
  alertText = "";
  await page.goto(`${BASE}/setup`, { waitUntil: "networkidle" });
  const form = page.locator("#setup-email");
  if (!(await form.isVisible().catch(() => false))) {
    console.log("The setup form isn't visible: is App Settings' signup_open set to yes?");
    break;
  }
  await form.fill(email);
  await page.locator("#setup-password").fill(PASSWORD);
  await page.locator("#setup-submit").click();
  const created = await page
    .locator("#setup-result", { hasText: email })
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const bubbleError = await page.locator(".bubble-element.Alert, .alert-message").first().textContent().catch(() => "");
  console.log(`${created ? "created " : "skipped "} ${email}${created ? "" : `  (${alertText || bubbleError || "no confirmation; probably exists already"})`}`);
}

await browser.close();
console.log("\nNow set App Settings → signup_open = no, then run: npm run test:e2e");
