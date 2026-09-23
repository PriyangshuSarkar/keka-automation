import { execFileSync } from "child_process";
import { join } from "path";
import { chromium, Page } from "playwright-core";
import { pollUntil } from "./poll";

const CDP_URL = "http://localhost:9222";

const PROJECT_ROOT = join(__dirname, "..", "..");

export function launchBrave(): void {
  execFileSync(join(PROJECT_ROOT, "brave-launcher.sh"), { stdio: "inherit" });
}

async function waitForCdp(url: string, timeoutMs = 15000): Promise<void> {
  await pollUntil(() => fetch(`${url}/json/version`), (res) => res.ok, {
    timeoutMs,
    intervalMs: 300,
    timeoutMessage: `Timed out waiting for Brave's CDP endpoint at ${url}`,
  });
}

export async function getPage(): Promise<Page> {
  launchBrave();
  await waitForCdp(CDP_URL);

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  // Each script closes its own tab when it's done, so normally there's
  // nothing to find here — this only reuses a leftover tab if a previous
  // run's close() failed, instead of leaking another one on top of it
  // ("most recent page" is ambiguous with multiple tabs open and can land
  // on an unrelated blank tab). Bring it to the front — Chrome throttles JS
  // timers in background tabs, which can stall the SPA's render past our
  // wait timeouts.
  const page = context.pages().find((p) => p.url().includes("keka.com")) ?? (await context.newPage());
  await page.bringToFront();
  return page;
}
