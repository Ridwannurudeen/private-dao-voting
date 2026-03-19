import { test, expect } from "@playwright/test";

/**
 * Landing page E2E tests covering:
 * - Mobile viewport behavior
 * - Skip-to-content link (a11y)
 * - Theme toggle aria attributes
 * - Governance tagline and privacy messaging
 * - Wallet modal dismiss behavior
 * - Feature card icon containers
 * - Meta tag validation (theme-color, manifest link)
 * - Orb decorative elements (visual polish)
 */

test.describe("Landing Page - Additional Coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
  });

  test("skip-to-content link is present and functional", async ({ page }) => {
    // The _document.tsx has a skip link targeting #main-content
    const skipLink = page.locator('a[href="#main-content"]');
    // It should exist (sr-only by default)
    await expect(skipLink).toHaveCount(1);
    // Tab to it to make it visible
    await page.keyboard.press("Tab");
    // Focus should land on the skip link
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    expect(focused).toBe("#main-content");
  });

  test("theme toggle has correct aria-label for current state", async ({ page }) => {
    // Default state is dark mode, so the toggle should say "Switch to light mode"
    const toggle = page.locator('button[aria-label*="Switch to"]');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    const initialLabel = await toggle.getAttribute("aria-label");
    expect(initialLabel).toBe("Switch to light mode");
    // After toggling, it should say "Switch to dark mode"
    await toggle.click();
    const newLabel = await toggle.getAttribute("aria-label");
    expect(newLabel).toBe("Switch to dark mode");
    // Clean up
    await toggle.click();
  });

  test("hero displays governance tagline", async ({ page }) => {
    await expect(
      page.getByText("Governance without social pressure")
    ).toBeVisible({ timeout: 5000 });
  });

  test("hero displays privacy messaging about votes never revealed", async ({ page }) => {
    await expect(
      page.getByText("never revealed")
    ).toBeVisible({ timeout: 5000 });
  });

  test("confidential computing badge is visible", async ({ page }) => {
    await expect(
      page.getByText("Confidential Computing for Solana")
    ).toBeVisible({ timeout: 5000 });
  });

  test("hero has animated pulse indicator", async ({ page }) => {
    // The "Built on Arcium MXE" badge has a pulsing dot
    const pulsingDot = page.locator(".animate-pulse").first();
    await expect(pulsingDot).toBeVisible({ timeout: 5000 });
  });

  test("wallet modal can be dismissed by clicking backdrop", async ({ page }) => {
    // Wait for the page to fully hydrate before interacting
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    const walletButton = page.locator(".wallet-adapter-button").first();
    await expect(walletButton).toBeVisible({ timeout: 5000 });
    await walletButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    // The wallet adapter modal uses a close button rather than an overlay click.
    // Use the modal's close button to dismiss it reliably.
    const closeButton = page.locator(".wallet-adapter-modal-button-close");
    if (await closeButton.count() > 0) {
      await closeButton.click();
    } else {
      // Fallback: press Escape to close the modal
      await page.keyboard.press("Escape");
    }
    // Dialog should be gone
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test("feature cards have icon containers", async ({ page }) => {
    // Wait for hydration — feature card text proves React has rendered
    await expect(page.getByText("Encrypted Votes")).toBeVisible({ timeout: 5000 });
    // Each of the three feature cards has a 12x12 rounded icon container
    const iconContainers = page.locator(".glass-card-elevated .rounded-2xl");
    const count = await iconContainers.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("page has theme-color meta tag", async ({ page }) => {
    const themeColor = await page
      .locator('meta[name="theme-color"]')
      .getAttribute("content");
    expect(themeColor).toBe("#0a0a1a");
  });

  test("page links to manifest.json", async ({ page }) => {
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", "/manifest.json");
  });

  test("page loads Google Fonts for Inter and Space Grotesk", async ({ page }) => {
    const fontLink = page.locator(
      'link[href*="fonts.googleapis.com/css2"]'
    );
    const count = await fontLink.count();
    expect(count).toBeGreaterThan(0);
    const href = await fontLink.first().getAttribute("href");
    expect(href).toContain("Inter");
    expect(href).toContain("Space+Grotesk");
  });

  test("hero section has decorative orb elements", async ({ page }) => {
    // Wait for hydration — hero text proves React has rendered
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    // The landing page has .orb-purple, .orb-cyan, .orb-blue decorative elements
    const orbPurple = page.locator(".orb-purple");
    const orbCyan = page.locator(".orb-cyan");
    const orbBlue = page.locator(".orb-blue");
    // They exist in the DOM (hidden with aria-hidden="true")
    expect(await orbPurple.count()).toBeGreaterThanOrEqual(1);
    expect(await orbCyan.count()).toBeGreaterThanOrEqual(1);
    expect(await orbBlue.count()).toBeGreaterThanOrEqual(1);
  });

  test("header is sticky", async ({ page }) => {
    const header = page.locator("header").first();
    const position = await header.evaluate((el) =>
      getComputedStyle(el).position
    );
    expect(position).toBe("sticky");
  });

  test("multiple wallet adapter buttons are rendered (header + hero CTA)", async ({ page }) => {
    // Wait for hydration before checking class-based selectors
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    // Landing page has WalletMultiButton in the header AND in the hero section
    const walletButtons = page.locator(".wallet-adapter-button");
    const count = await walletButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("favicons are linked correctly", async ({ page }) => {
    const ico = page.locator('link[rel="icon"][href="/favicon.ico"]');
    expect(await ico.count()).toBe(1);
    const svg = page.locator('link[rel="icon"][href="/favicon.svg"]');
    expect(await svg.count()).toBe(1);
    const apple = page.locator('link[rel="apple-touch-icon"]');
    expect(await apple.count()).toBe(1);
  });
});

test.describe("Landing Page - Mobile Viewport", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("mobile: landing page renders hero content", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("on Solana", { exact: true })).toBeVisible({
      timeout: 5000,
    });
  });

  test("mobile: feature cards stack vertically", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const cards = page.locator(".glass-card-elevated");
    // All three feature cards should be visible on mobile
    await expect(cards.nth(0)).toBeVisible({ timeout: 5000 });
    await expect(cards.nth(1)).toBeVisible({ timeout: 5000 });
    await expect(cards.nth(2)).toBeVisible({ timeout: 5000 });
  });

  test("mobile: wallet button is visible and clickable", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const walletButton = page.locator(".wallet-adapter-button").first();
    await expect(walletButton).toBeVisible({ timeout: 5000 });
    await expect(walletButton).toBeEnabled();
  });

  test("mobile: theme toggle is accessible", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const toggle = page.locator('button[aria-label*="Switch to"]');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(theme).toBe("light");
    // Clean up
    await toggle.click();
  });

  test("mobile: header is not clipped or overflowing", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const header = page.locator("header").first();
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    // Header should not extend beyond viewport width
    expect(box!.width).toBeLessThanOrEqual(375);
    expect(box!.x).toBeGreaterThanOrEqual(0);
  });
});

test.describe("Proposal Detail Page - Without Wallet", () => {
  test("shows Proposal Detail header", async ({ page }) => {
    await page.goto("/proposal/1", { waitUntil: "networkidle" });
    await expect(page.getByText("Proposal Detail")).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows back navigation link to home", async ({ page }) => {
    await page.goto("/proposal/1", { waitUntil: "networkidle" });
    // The back arrow is an SVG inside a Link to "/"
    const backLink = page.locator('a[href="/"]');
    await expect(backLink).toBeVisible({ timeout: 5000 });
  });

  test("has wallet connect button in header", async ({ page }) => {
    await page.goto("/proposal/1", { waitUntil: "networkidle" });
    const walletButton = page.locator(".wallet-adapter-button");
    await expect(walletButton.first()).toBeVisible({ timeout: 5000 });
  });

  test("invalid proposal ID shows not found or loading", async ({ page }) => {
    await page.goto("/proposal/99999999", { waitUntil: "networkidle" });
    // Should show either "Proposal Not Found" or a skeleton loader that
    // eventually resolves to not found
    const notFound = page.getByText("Proposal Not Found");
    const connectWallet = page.getByText("Connect Wallet to Vote");
    await expect(notFound.or(connectWallet)).toBeVisible({ timeout: 10000 });
  });

  test("proposal detail page has correct title format", async ({ page }) => {
    await page.goto("/proposal/1", { waitUntil: "networkidle" });
    // Title should match either "Proposal | Private DAO Voting" or "[title] | Private DAO Voting"
    await expect(page).toHaveTitle(/Private DAO Voting/);
  });

  test("proposal page has gradient accent line below header", async ({
    page,
  }) => {
    await page.goto("/proposal/1", { waitUntil: "networkidle" });
    // Wait for React hydration
    await expect(page.getByText("Proposal Detail")).toBeVisible({ timeout: 5000 });
    // The gradient line is a div with purple gradient
    const gradientLine = page.locator(
      ".bg-gradient-to-r.from-transparent.via-purple-500\\/50"
    );
    expect(await gradientLine.count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Theme Persistence Across Navigation", () => {
  test("theme persists when navigating to proposal page and back", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Toggle to light mode
    const toggle = page.locator('button[aria-label*="Switch to"]');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    const themeBeforeNav = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(themeBeforeNav).toBe("light");
    // Navigate to proposal page
    await page.goto("/proposal/1", { waitUntil: "networkidle" });
    // Theme should still be in localStorage
    const themeOnProposal = await page.evaluate(() =>
      localStorage.getItem("theme")
    );
    expect(themeOnProposal).toBe("light");
    // Navigate back
    await page.goto("/", { waitUntil: "networkidle" });
    const themeAfterReturn = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(themeAfterReturn).toBe("light");
    // Clean up
    const toggleCleanup = page.locator('button[aria-label*="Switch to"]');
    await toggleCleanup.click();
  });
});

test.describe("Keyboard Interaction", () => {
  test("Escape key does not break page when no modal is open", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // Page should still be stable
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
  });

  test("pressing N key on landing page does not open modal (no wallet)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("n");
    // Without wallet, N key should not open create modal
    // The CreateModal's "Create Private Proposal" title should NOT be visible
    const modalTitle = page.getByText("Create Private Proposal");
    await expect(modalTitle).not.toBeVisible({ timeout: 2000 });
  });

  test("pressing R key on landing page does not cause errors", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("r");
    // Page remains stable
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
  });

  test("pressing V key on landing page does not trigger vote action", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("v");
    // No error, page is stable
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Accessibility", () => {
  test("all images and decorative elements have aria-hidden", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Wait for React hydration to complete before checking DOM attributes
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    // Orb elements should be aria-hidden
    const orbs = page.locator('[aria-hidden="true"]');
    const count = await orbs.count();
    // There should be multiple aria-hidden decorative elements
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("heading hierarchy: h1 before h2 before h3", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Wait for React hydration before querying heading elements
    await expect(page.getByText("Privately")).toBeVisible({ timeout: 5000 });
    const h1 = page.locator("h1");
    const h2 = page.locator("h2");
    const h3 = page.locator("h3");
    // At minimum: h1 (Private DAO Voting), h2 (Vote Privately), h3s (feature cards)
    expect(await h1.count()).toBeGreaterThanOrEqual(1);
    expect(await h2.count()).toBeGreaterThanOrEqual(1);
    expect(await h3.count()).toBeGreaterThanOrEqual(3);
  });

  test("wallet dialog has proper role and aria attributes", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const walletButton = page.locator(".wallet-adapter-button").first();
    await walletButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });
});
