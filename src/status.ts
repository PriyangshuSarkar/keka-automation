import { Page } from "playwright-core";
import { getPage } from "./lib/browser";
import { logError, logSuccess } from "./lib/logger";
import { pollUntil } from "./lib/poll";

const ATTENDANCE_URL = "https://pointo.keka.com/#/me/attendance";

export type AttendanceStatus = "clocked-in" | "clocked-out";

export function getClockControl(page: Page) {
  return page.getByText(/web clock-(in|out)/i).first();
}

async function readStatus(page: Page, timeoutMs = 10000): Promise<AttendanceStatus> {
  const label = (await getClockControl(page).textContent({ timeout: timeoutMs }))?.trim().toLowerCase() ?? "";

  if (label.includes("clock-out")) return "clocked-in";
  if (label.includes("clock-in")) return "clocked-out";
  throw new Error(`Could not determine attendance status from button label: "${label}"`);
}

// A page load can land on a SPA that never renders the clock control (e.g.
// a stuck state left over from a network blip) — a plain single-shot check
// would burn the whole scheduled slot on that one bad load. Reload and
// retry a few times before giving up.
export async function getAttendanceStatus(page: Page, attempts = 3): Promise<AttendanceStatus> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.goto(ATTENDANCE_URL, { waitUntil: "domcontentloaded" });
    try {
      return await readStatus(page);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// Polls the current page in place (no navigation) — the SPA updates the
// clock control reactively after a click, and reloading here would abort
// the in-flight clock-in/out request before the server responds.
export async function waitForStatus(
  page: Page,
  expected: AttendanceStatus,
  timeoutMs = 15000
): Promise<void> {
  // A short per-call timeout here so a single stuck read can't eat most of
  // this function's own timeoutMs budget — readStatus's 10s default is
  // sized for getAttendanceStatus's reload-and-retry loop, not this
  // fast in-place poll.
  await pollUntil(() => readStatus(page, 2000), (status) => status === expected, {
    timeoutMs,
    intervalMs: 500,
    timeoutMessage: `Timed out waiting for attendance status to become "${expected}"`,
  });
}

async function main(): Promise<void> {
  const page = await getPage();
  try {
    const status = await getAttendanceStatus(page);
    console.log(status);
    logSuccess("status", status);
  } finally {
    await page.close().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logError("status", err);
      console.error(err);
      process.exit(1);
    });
}
