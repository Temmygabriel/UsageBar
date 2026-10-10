import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const widths = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1600, 1920];
const baseUrl = process.env.USAGEBAR_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = "artifacts/viewport-inspection";
const failures = [];
const results = [];

await mkdir(outputDir, { recursive: true });

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return response.status;
      lastError = new Error(`server returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(`UsageBar server did not become ready at ${url}: ${String(lastError)}`);
}

const initialStatus = await waitForServer(baseUrl);
if (initialStatus !== 200) throw new Error(`UsageBar root returned HTTP ${initialStatus}`);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#hero-title").waitFor({ state: "visible", timeout: 15000 });
  await page.locator('article[aria-label="Usage tab"]').waitFor({ state: "visible", timeout: 15000 });

  const staticInfo = await page.evaluate(async () => {
    const hero = document.querySelector("#hero-title")?.parentElement;
    const imageSet = getComputedStyle(hero, "::after").backgroundImage;
    const match = imageSet.match(/url\(["']?(.*?)["']?\)/);
    let background = { url: match?.[1] ?? null, naturalWidth: null, naturalHeight: null, loaded: false };
    if (match?.[1]) {
      const image = new Image();
      image.src = new URL(match[1], location.href).href;
      try {
        await image.decode();
        background = { ...background, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, loaded: true };
      } catch {
        background = { ...background, loaded: false };
      }
    }
    const camera = document.querySelector('article[aria-label="Usage tab"] svg[viewBox="0 0 48 48"]');
    return {
      title: document.title,
      heading: document.querySelector("#hero-title")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
      background,
      cameraIcon: {
        presentInsideUsageTab: Boolean(camera),
        outlineOnly: Boolean(camera?.querySelector('[fill="none"][stroke="currentColor"]')),
      },
    };
  });

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);

    const measurement = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      headingVisible: (() => {
        const node = document.querySelector("#hero-title");
        return Boolean(node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      })(),
      headingText: document.querySelector("#hero-title")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
      headingLinesSeparated: (() => {
        const node = document.querySelector("#hero-title");
        const lines = Array.from(node?.querySelectorAll(":scope > span") ?? []);
        if (lines.length !== 2 || lines.some((line) => getComputedStyle(line).display !== "block")) return false;
        const first = lines[0].getBoundingClientRect();
        const second = lines[1].getBoundingClientRect();
        return second.top >= first.top + first.height * 0.8;
      })(),
      usageTabVisible: (() => {
        const node = document.querySelector('article[aria-label="Usage tab"]');
        return Boolean(node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
      })(),
      cameraIconCount: document.querySelectorAll('article[aria-label="Usage tab"] svg[viewBox="0 0 48 48"]').length,
      simulatedCameraDisclosure: document.body.innerText.includes("Camera usage is simulated"),
    }));

    const overflow = measurement.documentWidth > width || measurement.bodyWidth > width;
    const valid = measurement.headingVisible
      && measurement.usageTabVisible
      && measurement.headingText === "Pay for what you actually use."
      && measurement.headingLinesSeparated
      && measurement.cameraIconCount === 1
      && measurement.simulatedCameraDisclosure
      && !overflow;

    const screenshot = `${outputDir}/viewport-${String(width).padStart(4, "0")}.png`;
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    const result = { width, ...measurement, horizontalOverflow: overflow, passed: valid, screenshot };
    results.push(result);

    if (!valid) {
      failures.push({
        width,
        reasons: [
          !measurement.headingVisible ? "hero proposition is not visible" : null,
          !measurement.usageTabVisible ? "Usage Tab is not visible" : null,
          measurement.headingText !== "Pay for what you actually use." ? `incorrect hero headline text: "${measurement.headingText}"` : null,
          !measurement.headingLinesSeparated ? "hero headline lines are joined or not displayed as separate lines" : null,
          measurement.cameraIconCount !== 1 ? "outline camera icon is missing or duplicated inside Usage Tab" : null,
          !measurement.simulatedCameraDisclosure ? "simulated-camera disclosure is missing" : null,
          overflow ? `horizontal overflow: document=${measurement.documentWidth}, body=${measurement.bodyWidth}, viewport=${width}` : null,
        ].filter(Boolean),
      });
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    status: initialStatus,
    widths,
    staticInfo,
    pageErrors,
    results,
    failures,
    passed: failures.length === 0 && pageErrors.length === 0,
  };
  await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (pageErrors.length) throw new Error(`Page errors detected: ${pageErrors.join("; ")}`);
  if (failures.length) throw new Error(`Responsive checks failed at ${failures.map(x => x.width).join(", ")} CSS px`);
} finally {
  await browser.close();
}
