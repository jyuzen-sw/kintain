import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const source = await readFile(resolve("public/icon.svg"), "utf8");
const browser = await chromium.launch();

try {
  for (const [fileName, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["apple-touch-icon.png", 180],
  ] as const) {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: size, height: size },
    });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${source}`,
    );
    await page.screenshot({ path: resolve("public", fileName) });
    await page.close();
  }
} finally {
  await browser.close();
}
