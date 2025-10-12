import { test, expect } from '@playwright/test';

test.describe('index.html smoke test', () => {
  test('loads without console warnings or errors', async ({ page }) => {
    const consoleIssues = [];
    const pageErrors = [];
    const allowedWarningPatterns = [
      /cdn\.tailwindcss\.com should not be used in production/i,
    ];

    page.on('console', (message) => {
      const type = message.type();
      const text = message.text();

      if (type === 'error') {
        consoleIssues.push({ type, text });
      } else if (type === 'warning') {
        const isAllowed = allowedWarningPatterns.some((pattern) =>
          pattern.test(text)
        );

        if (!isAllowed) {
          consoleIssues.push({ type, text });
        }
      }
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    const response = await page.goto('/');

    await expect(response, 'Expected to receive a valid response when loading /').not.toBeNull();

    if (response) {
      expect.soft(
        response.status(),
        `Expected a successful status code for index.html but received ${response.status()} ${response.statusText()}`
      ).toBeLessThan(400);
    }

    // Using 'load' avoids timeouts seen when parallel browsers wait for 'networkidle'.
    await page.waitForLoadState('load');

    const heroHeading = page.getByRole('heading', {
      level: 1,
      name: /iterative interior canvas/i,
    });
    await expect(heroHeading).toBeVisible();

    expect(consoleIssues, 'Console warning/error detected while loading index.html').toEqual([]);
    expect(pageErrors, 'Unhandled page errors detected while loading index.html').toEqual([]);
  });

  test('first-run layout hides advanced controls until iterations exist', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    await page.waitForFunction(() => window.moodCanvas !== undefined);

    await page.evaluate(() => {
      const app = window.moodCanvas;
      app.state.main = null;
      app.state.roomBrief = {
        paragraph: 'Calm bedroom retreat with layered neutrals.',
        bullets: ['Keep envelope intact', 'Lean on warm lighting'],
      };
      app.state.generatingRoomBrief = false;
      app.state.rounds = [];
      app.state.selectedForNext.clear();
      app.state.roundGuidance = '';
      app.render();
    });

    const sectionHeadings = await page.$$eval('#timeline > section', (sections) =>
      sections.map((section) => section.querySelector('h2')?.textContent?.trim() ?? '')
    );

    const briefIndex = sectionHeadings.findIndex((text) =>
      text.toLowerCase().includes('silent room brief')
    );
    const startIndex = sectionHeadings.findIndex((text) =>
      text.toLowerCase().includes('ready to')
    );

    expect.soft(briefIndex, 'Silent room brief card should render').toBeGreaterThan(-1);
    expect(startIndex, 'Start section should render after the brief card').toBe(briefIndex + 1);

    const startButton = page.getByRole('button', {
      name: /start generating first suggestions/i,
    });
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeDisabled();

    await expect(page.locator('#generateBar')).toBeHidden();
    await expect(page.locator('#final-modal')).toHaveCount(0);
    await expect(page.locator('#final-backdrop')).toHaveCount(0);
  });
});
