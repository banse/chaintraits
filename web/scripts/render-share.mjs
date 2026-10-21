import fs from "node:fs";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const svg = fs.readFileSync(
    new URL("../assets/share.svg", import.meta.url),
    "utf8",
  );
  await page.goto("data:image/svg+xml," + encodeURIComponent(svg));
  await page.screenshot({
    path: new URL("../public/share.png", import.meta.url).pathname,
  });
  console.log("Rendered local 1200×630 share PNG.");
} finally {
  await browser.close();
}
