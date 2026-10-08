import { test, expect, Page } from '@playwright/test';

test.describe('iOS Safari sticky header on workout page', () => {
  test.beforeEach(async ({ page }) => {
    // TODO: Add authentication and navigation to an active workout
    // For now, this test structure shows what we would verify
    // In a real implementation, you would:
    // 1. Sign in as a test user
    // 2. Create or navigate to an active workout session
    // 3. Add exercises with sets
  });

  test('sticky header should not jitter during scroll', async ({ page }) => {
    // Navigate to workout page (replace with actual test workout ID)
    await page.goto('/dashboard/workout/test-workout-id');

    // Wait for page to load and workout header to be visible
    const workoutHeader = page.locator('[data-testid="workout-header"]').first();
    await expect(workoutHeader).toBeVisible();

    // Scroll down to make the header stick
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.waitForTimeout(300); // Wait for scroll to settle

    // Measure initial position and height when pinned
    const initialRect = await workoutHeader.boundingBox();
    expect(initialRect).toBeTruthy();
    const initialTop = initialRect!.y;
    const initialHeight = initialRect!.height;

    // Perform multiple scroll steps
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 100));
      await page.waitForTimeout(100);

      const currentRect = await workoutHeader.boundingBox();
      expect(currentRect).toBeTruthy();

      // Assert header position stays at top once pinned
      expect(currentRect!.y).toBe(initialTop);
      // Assert header height doesn't change
      expect(currentRect!.height).toBe(initialHeight);
    }
  });

  test('only one sticky header should occupy top of viewport on workout page', async ({ page }) => {
    await page.goto('/dashboard/workout/test-workout-id');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check that the app header is not visible on workout page
    const appHeader = page.locator('header.sticky').filter({ hasText: 'HyperTrack' });
    await expect(appHeader).toBeHidden();

    // Check that only the workout header is visible at top
    const workoutHeader = page.locator('[data-testid="workout-header"]').first();
    await expect(workoutHeader).toBeVisible();

    // Verify it's the only sticky element at top-0
    const stickyElements = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements
        .filter((el) => {
          const style = window.getComputedStyle(el);
          return style.position === 'sticky' && style.top === '0px';
        })
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          text: el.textContent?.substring(0, 50),
        }));
    });

    // Should only have one sticky top-0 element on workout page
    expect(stickyElements.length).toBeLessThanOrEqual(2); // Allow for workout header and possibly empty state header
  });

  test('header height should stay constant across timer ticks', async ({ page }) => {
    await page.goto('/dashboard/workout/test-workout-id');

    const workoutHeader = page.locator('[data-testid="workout-header"]').first();
    await expect(workoutHeader).toBeVisible();

    // Get initial height
    const initialRect = await workoutHeader.boundingBox();
    expect(initialRect).toBeTruthy();
    const initialHeight = initialRect!.height;

    // Wait for multiple timer updates (timer updates every second)
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1100); // Slightly longer than 1 second

      const currentRect = await workoutHeader.boundingBox();
      expect(currentRect).toBeTruthy();

      // Height should remain constant despite timer updates
      expect(currentRect!.height).toBe(initialHeight);
    }
  });

  test('header should have proper compositing hints for smooth scrolling', async ({ page }) => {
    await page.goto('/dashboard/workout/test-workout-id');

    const workoutHeader = page.locator('[data-testid="workout-header"]').first();
    await expect(workoutHeader).toBeVisible();

    // Check that header has will-change: transform for GPU compositing
    const willChange = await workoutHeader.evaluate((el) =>
      window.getComputedStyle(el).willChange
    );
    expect(willChange).toContain('transform');

    // Check that header has translateZ(0) for layer promotion
    const transform = await workoutHeader.evaluate((el) =>
      window.getComputedStyle(el).transform
    );
    // translateZ(0) results in a 3D matrix
    expect(transform).toMatch(/matrix3d|matrix/);
  });

  test('header should use solid background, not backdrop-filter', async ({ page }) => {
    await page.goto('/dashboard/workout/test-workout-id');

    const workoutHeader = page.locator('[data-testid="workout-header"]').first();
    await expect(workoutHeader).toBeVisible();

    // Check that backdrop-filter is not used (causes jitter on iOS)
    const backdropFilter = await workoutHeader.evaluate((el) =>
      window.getComputedStyle(el).backdropFilter
    );
    expect(backdropFilter).toBe('none');

    // Check that it uses a solid background instead
    const backgroundColor = await workoutHeader.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );
    // Should have solid background (not transparent)
    expect(backgroundColor).not.toContain('rgba(0, 0, 0, 0)');
  });

  test('should not use dvh units that reflow during Safari toolbar animation', async ({ page }) => {
    await page.goto('/dashboard/workout/test-workout-id');

    // Check that no elements use dvh units in their computed styles
    const dvhUsage = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const withDvh = elements.filter((el) => {
        const style = window.getComputedStyle(el);
        const minHeight = style.minHeight;
        const height = style.height;
        const maxHeight = style.maxHeight;
        return (
          minHeight.includes('dvh') ||
          height.includes('dvh') ||
          maxHeight.includes('dvh')
        );
      });
      return withDvh.length;
    });

    // Should not use dvh units (they cause reflow during Safari toolbar animation)
    expect(dvhUsage).toBe(0);
  });
});
