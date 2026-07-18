import { getSharedBrowser } from "../browser";

export async function exportToPng(html: string, outputPath: string): Promise<string> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await page.close();
  }
  return outputPath;
}

export async function exportToPdf(html: string, outputPath: string): Promise<string> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
    });
  } finally {
    await page.close();
  }
  return outputPath;
}
