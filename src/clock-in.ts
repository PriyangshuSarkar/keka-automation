import { getPage } from "./lib/browser";
import { getAttendanceStatus, getClockControl, waitForStatus } from "./status";
import { hasSucceededToday, logError, logSuccess } from "./lib/logger";

async function main(): Promise<void> {
  if (hasSucceededToday("clock-in")) {
    console.log("already succeeded today, skipping");
    return;
  }

  const page = await getPage();
  try {
    const status = await getAttendanceStatus(page);

    if (status === "clocked-in") {
      console.log("already clocked in");
      logSuccess("clock-in", "already clocked in");
      return;
    }

    await getClockControl(page).click();
    await waitForStatus(page, "clocked-in");
    console.log("clocked in");
    logSuccess("clock-in", "clocked in");
  } finally {
    await page.close().catch(() => {});
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logError("clock-in", err);
      console.error(err);
      process.exit(1);
    });
}
