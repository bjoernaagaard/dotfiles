import { accessSync, constants } from "node:fs";
import type { Browser } from "puppeteer-core";
import { loadConfig } from "./config";

const COMMON_CHROMIUM_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ],
  win32: [
    `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.LOCALAPPDATA ?? ""}\\Chromium\\Application\\chrome.exe`,
  ],
};

let browser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;
let browserAvailable = true;

function isExecutable(filePath: string): boolean {
  if (!filePath) return false;
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findChromiumExecutable(preferredPath?: string): string | undefined {
  if (preferredPath && isExecutable(preferredPath)) return preferredPath;
  return (COMMON_CHROMIUM_PATHS[process.platform] ?? []).find(isExecutable);
}

export function setBrowserAvailable(available: boolean): void {
  browserAvailable = available;
}

export function isBrowserAvailable(): boolean {
  return browserAvailable;
}

export async function getSharedBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  if (browserLaunch) return browserLaunch;

  const executablePath = findChromiumExecutable(loadConfig().puppeteerExecutablePath);
  if (!browserAvailable || !executablePath) {
    browserAvailable = false;
    throw new Error(
      "No Chromium browser found. Install Chrome, Brave, or Edge, " +
        "or set puppeteerExecutablePath in pi-parseview settings.",
    );
  }

  browserLaunch = (async () => {
    const { launch } = await import("puppeteer-core");
    try {
      browser = await launch({
        headless: true,
        args: ["--no-sandbox"],
        executablePath,
      });
      browserAvailable = true;
      return browser;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Could not find") || msg.includes("executablePath")) {
        browserAvailable = false;
        throw new Error(
          "No Chromium browser found. Install Chrome, Brave, or Edge, " +
            "or set puppeteerExecutablePath in pi-parseview settings.",
        );
      }
      throw err;
    } finally {
      browserLaunch = null;
    }
  })();

  return browserLaunch;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserLaunch;
  if (pending) {
    await pending.catch(() => undefined);
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Already closed.
    }
    browser = null;
  }
}
