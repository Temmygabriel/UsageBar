import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const widths = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1600, 1920];
const baseUrl = process.env.USAGEBAR_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = process.env.USAGEBAR_ARTIFACT_DIR ?? "artifacts/viewport-inspection";
const failures = [];
const results = [];

await mkdir(outputDir, { recursive: true });

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
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

  // Exercise the wallet chooser and both connection recovery paths with
  // deterministic fake providers. These tests prove app state recovery, not
  // the behavior of a real browser extension or a real transaction.
  async function checkWalletPromptRecovery(mode) {
    const walletPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    walletPage.on("pageerror", error => pageErrors.push(error.message));
    await walletPage.addInitScript(`
      (() => {
        const behavior = ${JSON.stringify(mode)};
        const connect = behavior === "hang"
          ? () => new Promise(() => {})
          : async () => {
              // Let the Connecting state render before the fake wallet rejects.
              await new Promise((resolve) => setTimeout(resolve, 300));
              const error = new Error("User rejected the request");
              Object.defineProperty(error, "code", { value: 4001 });
              throw error;
            };

        // Always use the explicitly selected legacy Phantom provider in this
        // regression test; wallet-standard integration is implemented separately
        // and needs a real extension to verify.
        Object.defineProperty(window, "phantom", {
          configurable: true,
          value: {
            solana: {
              isPhantom: true,
              connect,
              publicKey: null,
            },
          },
        });
      })();
    `);

    await walletPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await walletPage.locator("#hero-title").waitFor({ state: "visible", timeout: 15000 });
    await walletPage.getByRole("button", { name: "Connect wallet" }).first().click();

    const dialog = walletPage.getByRole("dialog", { name: "Connect a wallet" });
    await dialog.waitFor({ state: "visible", timeout: 3000 });
    const chooserText = await dialog.innerText();
    for (const walletName of ["Solflare", "Phantom", "OKX Wallet"]) {
      if (!chooserText.includes(walletName)) {
        throw new Error(`Wallet chooser did not list ${walletName}.`);
      }
    }

    if (mode === "hang") {
      await walletPage.screenshot({
        path: `${outputDir}/wallet-chooser-cancel-test.png`,
        animations: "disabled",
      });
    }

    const phantomOption = dialog.locator('[data-wallet-id="phantom"]');
    await phantomOption.getByRole("button", { name: "Connect", exact: true }).click();
    if (mode === "hang") {
      // The never-settling provider keeps the pending state open long enough to
      // assert the selected wallet label and Cancel action deterministically.
      const connectingStatus = walletPage.locator("header [role='status']");
      await connectingStatus.waitFor({ state: "visible", timeout: 3000 });
      const observedConnectingLabel = (await connectingStatus.innerText()).replace(/\s+/g, " ").trim();
      await walletPage.screenshot({
        path: `${outputDir}/wallet-connecting-state.png`,
        animations: "disabled",
      });
      if (!observedConnectingLabel.includes("Connecting to Phantom")) {
        throw new Error(
          `Header did not identify the selected wallet while connecting. Observed: "${observedConnectingLabel}"`,
        );
      }

      // This prompt intentionally never settles. UsageBar's own Cancel must
      // immediately clear the connecting UI even when the provider hangs.
      await walletPage.getByRole("button", { name: "Cancel", exact: true }).click();
      await walletPage.getByText(/Connection cancelled in UsageBar/).waitFor({
        state: "visible",
        timeout: 3000,
      });
    } else {
      // Mimic a wallet extension rejecting a prompt with the standard 4001 code.
      await walletPage.getByText(/Phantom connection was cancelled/).waitFor({
        state: "visible",
        timeout: 3000,
      });
    }

    await walletPage.getByRole("button", { name: "Connect wallet" }).first().waitFor({
      state: "visible",
      timeout: 3000,
    });

    if (mode === "hang") {
      await walletPage.screenshot({
        path: `${outputDir}/wallet-chooser-after-cancel.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await walletPage.close();
  }

  await checkWalletPromptRecovery("reject");
  await checkWalletPromptRecovery("hang");

  // Verify that a modern Solflare Wallet Standard registration can be discovered
  // through the official app-ready -> register-wallet handshake.
  const standardPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  standardPage.on("pageerror", error => pageErrors.push(error.message));
  await standardPage.addInitScript(`
    (() => {
      const connect = async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const error = new Error("User rejected the request");
        Object.defineProperty(error, "code", { value: 4001 });
        throw error;
      };
      const solflare = {
        name: "Solflare",
        chains: ["solana:devnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect },
          "solana:signAndSendTransaction": {
            version: "1.0.0",
            signAndSendTransaction: async () => [],
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {},
          },
        },
      };

      // The wallet side listens for app-ready, then dispatches a
      // register-wallet event whose detail is the registration callback.
      window.addEventListener("wallet-standard:app-ready", () => {
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
          detail: (api) => api.register(solflare),
        }));
      });
    })();
  `);
  await standardPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await standardPage.locator("#hero-title").waitFor({ state: "visible", timeout: 15000 });
  await standardPage.getByRole("button", { name: "Connect wallet" }).first().click();

  const standardDialog = standardPage.getByRole("dialog", { name: "Connect a wallet" });
  await standardDialog.waitFor({ state: "visible", timeout: 3000 });
  const solflareRow = standardDialog.locator('[data-wallet-id="solflare"]');
  if (!(await solflareRow.innerText()).includes("Detected in this browser")) {
    throw new Error("Wallet Standard Solflare registration was not detected.");
  }
  await solflareRow.getByRole("button", { name: "Connect", exact: true }).click();
  await standardPage.getByText(/Solflare connection was cancelled/).waitFor({
    state: "visible",
    timeout: 3000,
  });
  await standardPage.getByRole("button", { name: "Connect wallet" }).first().waitFor({
    state: "visible",
    timeout: 3000,
  });
  await standardPage.close();

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
      primaryActionBounds: (() => {
        const node = document.querySelector('article[aria-label="Usage tab"] button');
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height), viewportHeight: window.innerHeight };
      })(),
      primaryActionVisibleInFirstViewport: (() => {
        const node = document.querySelector('article[aria-label="Usage tab"] button');
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
      })(),
      cameraIconCount: document.querySelectorAll('article[aria-label="Usage tab"] svg[viewBox="0 0 48 48"]').length,
      simulatedCameraDisclosure: document.body.innerText.includes("Camera usage is simulated"),
    }));

    const overflow = measurement.documentWidth > width || measurement.bodyWidth > width;
    const valid = measurement.headingVisible
      && measurement.usageTabVisible
      && measurement.primaryActionVisibleInFirstViewport
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
          !measurement.primaryActionVisibleInFirstViewport ? "primary action is below the first viewport" : null,
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
