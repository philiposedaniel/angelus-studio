import type { Page } from '@playwright/test'

/**
 * Waits until React has attached to the page's interactive elements. Before that, clicks do
 * nothing and a form submits as a plain GET, so tests that click right after `goto` or `reload`
 * must wait here. Unlike `networkidle`, this does not depend on how quiet the network is.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button, form, input')).some((element) =>
      Object.keys(element).some((key) => key.startsWith('__reactFiber$')),
    ),
  )
}
