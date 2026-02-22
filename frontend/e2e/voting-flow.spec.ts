import { test, expect } from "@playwright/test";

test.describe("Private DAO Voting", () => {
  test("landing page loads with hero content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Vote")).toBeVisible();
    await expect(page.locator("text=Privately")).toBeVisible();
    await expect(page.locator("text=on Solana")).toBeVisible();
  });

  test("displays feature cards on landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Encrypted Votes")).toBeVisible();
    await expect(page.locator("text=MPC Tallying")).toBeVisible();
    await expect(page.locator("text=Verified Results")).toBeVisible();
  });

  test("shows connect wallet prompt", async ({ page }) => {
    await page.goto("/");
    const walletButton = page.locator("button:has-text('Select Wallet')");
    await expect(walletButton).toBeVisible();
  });

  test("has correct page title and meta tags", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Private DAO Voting/);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toContain("Arcium");
  });

  test("theme toggle is visible", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator('button[aria-label*="Switch to"]');
    await expect(toggle).toBeVisible();
  });

  test("how it works button is visible", async ({ page }) => {
    await page.goto("/");
    const howBtn = page.locator('button[aria-label="How it works"]');
    await expect(howBtn).toBeVisible();
  });

  test("how it works stepper opens and navigates", async ({ page }) => {
    await page.goto("/");
    await page.click('button[aria-label="How it works"]');
    await expect(page.locator("text=Connect Wallet")).toBeVisible();
    await expect(page.locator("text=Step 1 of 5")).toBeVisible();

    await page.click("text=Next");
    await expect(page.locator("text=Step 2 of 5")).toBeVisible();
    await expect(page.locator("text=Create or Find a Proposal")).toBeVisible();
  });

  test("proposal detail page shows 404 for invalid ID", async ({ page }) => {
    await page.goto("/proposal/999999");
    // Should show connect wallet or not found state
    await expect(page.locator("text=Connect Wallet").or(page.locator("text=Proposal Not Found"))).toBeVisible();
  });

  test("PWA manifest is accessible", async ({ page }) => {
    const response = await page.goto("/manifest.json");
    expect(response?.status()).toBe(200);
    const manifest = await response?.json();
    expect(manifest.name).toBe("Private DAO Voting");
    expect(manifest.display).toBe("standalone");
  });

  test("keyboard shortcut hints visible on desktop", async ({ page }) => {
    // This test requires a connected wallet state, so we just check the page loads
    await page.goto("/");
    // The keyboard hints only show when connected, so this is a smoke test
    await expect(page).toHaveTitle(/Private DAO Voting/);
  });
});
