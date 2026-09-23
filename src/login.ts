import { getPage } from "./lib/browser";
import { logError, logSuccess } from "./lib/logger";

const LOGIN_URL = "https://app.keka.com/Account/Login";

async function main(): Promise<void> {
  const page = await getPage();
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    try {
      await page.getByRole("button", { name: "Continue with Google" }).click({ timeout: 5000 });
    } catch {
      // Button never showed up, likely already logged in and redirected past it.
    }

    await page.waitForURL(/\.keka\.com\/#\/home/, { timeout: 15000 });
    logSuccess("login", "logged in");
  } finally {
    await page.close().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logError("login", err);
    console.error(err);
    process.exit(1);
  });
