import { execFileSync } from "child_process";
import { join } from "path";
import { chromium, Page } from "playwright-core";
import { pollUntil } from "./poll";

const CDP_URL = "http://localhost:9223";

const PROJECT_ROOT = join(__dirname, "..", "..");

export function launchBrave(): void {
  execFileSync(join(PROJECT_ROOT, "brave-launcher.sh"), { stdio: "inherit" });
}

async function isCdpUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function isBraveRunning(): boolean {
  try {
    execFileSync("pgrep", ["-x", "Brave Browser"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Gracefully quit Brave (same as Cmd+Q, so the session is restored on
// relaunch) and wait for its main process to actually exit — `open -a`
// against a still-exiting Brave would just reattach to it, flagless.
async function quitBrave(timeoutMs = 30000): Promise<void> {
  execFileSync("osascript", ["-e", 'tell application "Brave Browser" to quit']);
  await pollUntil(async () => isBraveRunning(), (running) => !running, {
    timeoutMs,
    intervalMs: 500,
    timeoutMessage: "Timed out waiting for Brave to quit",
  });
}

async function waitForCdp(url: string, timeoutMs = 15000): Promise<void> {
  await pollUntil(() => fetch(`${url}/json/version`), (res) => res.ok, {
    timeoutMs,
    intervalMs: 300,
    timeoutMessage: `Timed out waiting for Brave's CDP endpoint at ${url}`,
  });
}

export async function getPage(): Promise<Page> {
  if (!(await isCdpUp(CDP_URL))) {
    // --remote-debugging-port only applies to Brave's first process launch, so
    // if Brave is already running without it (opened from the Dock, or
    // relaunched by its own auto-updater, which drops custom flags) the
    // launcher's `open -a` is a no-op and CDP never comes up. Restart it.
    if (isBraveRunning()) {
      console.log("Brave is running without CDP enabled, restarting it");
      await quitBrave();
    }
    launchBrave();
  }
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
