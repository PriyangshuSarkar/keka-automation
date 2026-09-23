import { getPage } from "./lib/browser";
import { getAttendanceStatus, getClockControl, waitForStatus } from "./status";
import { hasSucceededToday, logError, logSuccess } from "./lib/logger";
import { hasInternet } from "./lib/network";

async function main(): Promise<void> {
  if (hasSucceededToday("clock-out")) {
    console.log("already succeeded today, skipping");
    return;
  }

  if (!(await hasInternet())) {
    throw new Error("No internet connection — skipping this run");
  }

  const page = await getPage();
  try {
    const status = await getAttendanceStatus(page);

    if (status === "clocked-out") {
      console.log("already clocked out");
      logSuccess("clock-out", "already clocked out");
      return;
    }

    // Clocking out is a two-step confirm in Keka's UI: the first click just
    // swaps "Web Clock-out" for a "Clock-out"/"Cancel" pair, and only the
    // second click actually submits it (clock-in has no such step).
    await getClockControl(page).click();
    await page.getByRole("button", { name: "Clock-out", exact: true }).click();
    await waitForStatus(page, "clocked-out");
    console.log("clocked out");
    logSuccess("clock-out", "clocked out");
  } finally {
    await page.close().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logError("clock-out", err);
      console.error(err);
      process.exit(1);
    });
}
