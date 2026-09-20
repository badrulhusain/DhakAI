import { expect, test } from '@playwright/test';

test('backend disconnection is distinct and recovers without a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Local backend: Connected')).toBeVisible();
  await page.route('http://127.0.0.1:4100/api/state', route => route.abort('connectionfailed'));
  await expect(page.getByText('Cannot reach the backend.')).toBeVisible({ timeout: 7_000 });
  await expect(page.getByText(/Supabase:/)).toBeVisible();
  await page.unroute('http://127.0.0.1:4100/api/state');
  await expect(page.getByText('Local backend: Connected')).toBeVisible({ timeout: 7_000 });
});

test('keyboard focus is visible and reduced motion suppresses achievement canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus-visible');
  await expect(focused).toBeVisible();
  await expect(page.locator('body > canvas')).toHaveCount(0);
});
