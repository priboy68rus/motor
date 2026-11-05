import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL("./fixtures/filterContext.js", import.meta.url)),
  ],
  bundle: true,
  format: "esm",
  target: "es2022",
  write: false,
});
const template = await readFile(
  new URL("../../src/motor/templates/report.html.j2", import.meta.url),
  "utf8",
);
const style = template.match(/<style>([\s\S]*?)<\/style>/)[1];
const browser = await chromium.launch({
  executablePath: process.env.MOTOR_BROWSER_EXECUTABLE,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1120, height: 900 },
    hasTouch: true,
  });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`<style>${style}</style><main id="motor-root"></main>`);
  for (const file of ["vega.min.js", "vega-lite.min.js", "vega-embed.min.js"])
    await page.addScriptTag({
      path: fileURLToPath(
        new URL("../../src/motor/static/" + file, import.meta.url),
      ),
    });
  await page.addScriptTag({
    content: bundled.outputFiles[0].text,
    type: "module",
  });
  await page.waitForFunction(() => !!window.fixture, undefined, { timeout: 30000 });
  assert.deepEqual(errors, []);
  assert.equal(await page.locator(".motor-chart-filter-button").count(), 4);
  assert.equal(
    await page.locator("#scatter .motor-download-control").count(),
    0,
  );
  assert.equal(
    await page
      .locator(
        "#table .motor-chart-filter-button,#big .motor-chart-filter-button",
      )
      .count(),
    0,
  );
  const panel = page.locator(".motor-chart-filter-tooltip");
  const tooltipStyle = (element) => {
    const style = getComputedStyle(element);
    return [
      style.backgroundColor,
      style.borderColor,
      style.boxShadow,
      style.fontFamily,
    ];
  };
  assert.deepEqual(
    await panel.evaluate(tooltipStyle),
    await page
      .locator(".motor-chart-shared-tooltip")
      .first()
      .evaluate(tooltipStyle),
  );
  const trigger = page.locator("#line .motor-chart-filter-button");
  const download = page.locator("#line .motor-download-data");
  const buttonStyle = (element) => {
    const style = getComputedStyle(element);
    return [style.color, style.opacity];
  };
  assert.deepEqual(
    await trigger.evaluate(buttonStyle),
    await download.evaluate(buttonStyle),
  );
  await trigger.hover();
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(), false);
  const hoveredStyle = await trigger.evaluate(buttonStyle);
  await download.hover();
  await page.waitForTimeout(150);
  assert.deepEqual(hoveredStyle, await download.evaluate(buttonStyle));
  await trigger.focus();
  assert.equal(await panel.isVisible(), false);
  await page.keyboard.press("ArrowDown");
  assert.equal(await panel.isVisible(), false);
  await page.keyboard.press("Enter");
  await panel.waitFor({ state: "visible" });
  assert.deepEqual(
    await panel.locator(".motor-filter-context-heading").allTextContents(),
    ["Breakdown", "Filters", "Not applied"],
  );
  assert.equal(await panel.locator('[data-param="country"]').count(), 1);
  assert.deepEqual(
    await panel
      .locator('[data-param="country"] .motor-filter-source')
      .evaluateAll((icons) =>
        icons.map((icon) => icon.getAttribute("aria-label")),
      ),
    ["Sidebar", "This tab: Overview", "Other tab: Details"],
  );
  assert.equal(
    await panel.locator('[data-param="country"] summary').textContent(),
    "Multiple · 4",
  );
  assert.equal(
    await panel
      .locator(".motor-filter-context-default")
      .filter({ hasText: "Default" })
      .count(),
    4,
  );
  await panel
    .locator('[data-param="country"] .motor-filter-source')
    .last()
    .click();
  assert.match(
    await panel
      .locator('[data-param="country"] .motor-filter-context-source-details')
      .textContent(),
    /Other tab: Details/,
  );
  assert.equal(
    await panel
      .locator('[data-param="country"] .motor-filter-context-source-details')
      .isVisible(),
    true,
  );
  await panel
    .locator('[data-param="country"] .motor-filter-source')
    .last()
    .click();
  await page.keyboard.press("Escape");
  await page.locator("h1").click();
  await trigger.hover();
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(), false);
  await trigger.click();
  await panel.hover();
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(), true);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(), true);
  await trigger.click();
  assert.equal(await panel.isVisible(), false);
  await trigger.click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(), true);
  await panel.locator('[data-param="country"] summary').click();
  assert.equal(
    await panel.locator('[data-param="country"] details').getAttribute("open"),
    "",
  );
  assert.match(
    await panel
      .locator('[data-param="country"] .motor-filter-context-full-value')
      .textContent(),
    /Netherlands/,
  );
  await page.evaluate(() => window.fixture.update("channel", "Retail"));
  assert.equal(
    await panel.locator('[data-param="channel"] summary').textContent(),
    "Retail",
  );
  assert.equal(
    await panel
      .locator('[data-param="channel"] .motor-filter-context-default')
      .textContent(),
    "",
  );
  await page.evaluate(() => window.fixture.update("country", ["Italy"]));
  await page.evaluate(() => window.fixture.loading());
  assert.match(await panel.textContent(), /Updating/);
  assert.equal(
    await panel.locator('[data-param="country"] summary').textContent(),
    "Italy",
  );
  await page.evaluate(() => window.fixture.finish());
  assert.equal(await panel.isVisible(), true);
  assert.equal(
    await panel.locator(".motor-filter-context-updating").count(),
    0,
  );
  assert.equal(
    await panel
      .locator('[data-param="country"] .motor-filter-context-default')
      .textContent(),
    "",
  );
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await page.locator("h1").click();
  await trigger.focus();
  assert.equal(await panel.isVisible(), false);
  await page.keyboard.press("Space");
  await panel.waitFor({ state: "visible" });
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await page.evaluate(() => document.activeElement.tagName),
    "SUMMARY",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await trigger.evaluate((button) => button === document.activeElement),
    true,
  );
  assert.equal(await panel.isVisible(), false);
  await trigger.click();
  await trigger.click();
  assert.equal(await panel.isVisible(), false);
  await page.locator("#bar .motor-chart-filter-button").click();
  assert.equal(
    await panel.textContent(),
    "Filters and breakdown do not apply to this chart.",
  );
  await page.locator("h1").click();
  assert.equal(await panel.isVisible(), false);
  await page.locator("#scatter .motor-chart-filter-button").click();
  assert.equal(
    await panel.locator(".motor-filter-context-heading").first().textContent(),
    "Breakdown",
  );
  await page.keyboard.press("Escape");
  await trigger.click();
  await page.evaluate(() => window.fixture.fail());
  assert.equal(await panel.isVisible(), true);
  assert.match(await panel.textContent(), /Chart unavailable/);
  assert.equal(
    await page.locator("#line .motor-chart-filter-button").count(),
    1,
  );
  await page.evaluate(() => window.fixture.finish());
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  assert.equal(await panel.isVisible(), false);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await trigger.click();
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(150);
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 667);
  await page.keyboard.press("Escape");
  await trigger.tap();
  assert.equal(await panel.isVisible(), true);
  await panel
    .locator('[data-param="country"] .motor-filter-source')
    .last()
    .tap();
  assert.equal(
    await panel
      .locator('[data-param="country"] .motor-filter-context-source-details')
      .isVisible(),
    true,
  );
  await panel.locator('[data-param="country"] summary').tap();
  assert.equal(
    await panel.locator('[data-param="country"] details').getAttribute("open"),
    "",
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1120, height: 900 });
  await trigger.click();
  await page.evaluate(async () => {
    for (let index = 0; index < 40; index++) {
      const name = `unused_${index}`;
      window.fixture.spec.params[name] = { type: "select", default: "all" };
      window.fixture.values[name] = "all";
    }
    await window.fixture.update("channel", "Online");
  });
  const scrollState = await panel.evaluate((element) => {
    element.scrollTop = 100;
    return {
      top: element.scrollTop,
      scrolls: element.scrollHeight > element.clientHeight,
    };
  });
  assert.ok(scrollState.scrolls && scrollState.top > 0);
  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(100);
  assert.ok(
    await panel.evaluate(
      (element) =>
        element.scrollTop >= element.scrollHeight - element.clientHeight - 1,
    ),
  );
  await page.evaluate(() => window.fixture.update("channel", "Retail"));
  assert.ok(await panel.evaluate((element) => element.scrollTop > 0));
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.fixture.remount());
  assert.equal(await page.locator(".motor-chart-filter-tooltip").count(), 1);
  assert.equal(await panel.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: all chart types, grouping, sources, defaults, overflow, click/keyboard, hover stays closed, updates/errors/tabs, mobile, remount.",
  );
} finally {
  await browser.close();
}
