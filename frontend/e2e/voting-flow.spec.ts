import { test, expect } from "@playwright/test";

test.describe("Private DAO Voting", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
  });

  test("landing page loads with hero content", async ({ page }) => {
    // Check hero heading elements are visible
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("on Solana", { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test("displays feature cards on landing page", async ({ page }) => {
    await expect(page.getByText("Encrypted Votes")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("MPC Tallying")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Verified Results")).toBeVisible({ timeout: 5000 });
  });

  test("shows connect wallet button", async ({ page }) => {
    // Wallet adapter renders a button with "Select Wallet" or similar text
    const walletButton = page.locator(".wallet-adapter-button");
    await expect(walletButton.first()).toBeVisible({ timeout: 5000 });
  });

  test("has correct page title and meta tags", async ({ page }) => {
    await expect(page).toHaveTitle(/Private DAO Voting/);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toContain("Arcium");
  });

  test("theme toggle switches theme", async ({ page }) => {
    const toggle = page.locator('button[aria-label*="Switch to"]');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("light");
    await toggle.click();
    const themeDark = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(themeDark).toBe("dark");
  });

  test("hero landing shows key privacy features", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText("Encrypted Votes")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("MPC Tallying")).toBeVisible();
    await expect(page.getByText("Verified Results")).toBeVisible();
    await expect(page.getByText("Powered by Arcium")).toBeVisible();
  });

  test("proposal detail page handles missing wallet", async ({ page }) => {
    await page.goto("/proposal/999999", { waitUntil: "networkidle" });
    await expect(
      page.getByText("Connect Wallet", { exact: true }).or(page.getByText("Proposal Not Found"))
    ).toBeVisible({ timeout: 5000 });
  });

  test("PWA manifest is valid", async ({ page }) => {
    const response = await page.goto("/manifest.json");
    expect(response?.status()).toBe(200);
    const manifest = await response?.json();
    expect(manifest.name).toBe("Private DAO Voting");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test("tech badges are displayed", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Target the tech badge spans inside the badges container
    const badges = page.locator("main");
    await expect(badges.getByText("Solana", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(badges.getByText("Anchor", { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test("hero landing shows Arcium branding", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText("Built on Arcium MXE")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Vote")).toBeVisible();
  });
});
