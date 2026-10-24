# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local automation that clocks in/out on Keka (`pointo.keka.com`) by driving an already-running Brave
browser over the Chrome DevTools Protocol (CDP), instead of a headless/managed browser instance. This
lets the automation reuse the user's real, already-authenticated Brave session and tab.

## Commands

- `bun install` — install dependencies (this project uses Bun, not npm/yarn)
- `bun run build` — type-check and compile to `dist/` via `tsc`
- `bun src/clock-in.ts` / `bun run clock-in` — clock in
- `bun src/clock-out.ts` / `bun run clock-out` — clock out
- `bun src/status.ts` / `bun run status` — print current attendance status (`clocked-in` / `clocked-out`)
- `bun src/login.ts` / `bun run login` — drive the Google SSO login flow
- `bun x tsc --noEmit` — type-check without emitting (useful after edits; there is no separate lint/test setup)

There is no test suite or linter configured in this repo — verification is `tsc --noEmit` plus running the
relevant script against a real Brave session.

## Architecture

**Entry point scripts** (`src/clock-in.ts`, `src/clock-out.ts`, `src/status.ts`, `src/login.ts`) are each
independently runnable (`if (require.main === module)` / bare `main()`) and follow the same shape: get a
`Page` via `getPage()` inside a `try` block, drive it, call `logSuccess()` on the success path, always
`page.close()` in a `finally` (swallowing close errors so they can't mask the real one), and on failure
call `logError()` then `console.error` + `process.exit(1)`. `clock-in.ts`/`clock-out.ts` additionally
short-circuit at the top of `main()` via `hasSucceededToday()` (see `logger.ts` below) before touching the
browser at all; `clock-out.ts` also bails out early via `hasInternet()` (see `network.ts` below) before
launching Brave if there's no connectivity.

**Clocking out is a two-step confirm in Keka's UI** (clock-in has no such step): clicking the initial
"Web Clock-out" control doesn't submit anything — it swaps to a "Clock-out"/"Cancel" pair, and only
clicking the second "Clock-out" button actually confirms it. `clock-out.ts` does both clicks in sequence;
missing the second click was a real production bug (the run silently no-oped, logging nothing, since
`waitForStatus` just timed out waiting for a status change that was never going to happen).

**`src/lib/browser.ts`** — `getPage()` is the shared entry point every script uses to obtain a Playwright
`Page`:
1. If the CDP endpoint is already up, Brave is reused as-is. Otherwise `launchBrave()` shells out to
   `brave-launcher.sh`, which launches Brave with `--remote-debugging-port=9223` on a fixed profile
   (`Default`, the "Pointo" profile). The CDP flag only takes effect on Brave's *first* process launch, so
   if Brave is already running without it (opened from the Dock, or relaunched by Brave's own auto-updater,
   which drops custom flags), `getPage()` first gracefully quits Brave via AppleScript (like Cmd+Q, so the
   session is restored) and waits for it to exit before launching. This was a real production bug: after
   an auto-update relaunch, every scheduled run failed with "Timed out waiting for Brave's CDP endpoint".
2. `pollUntil()` (see below) waits for the CDP endpoint to come up.
3. `chromium.connectOverCDP()` attaches, and opens a new tab. An existing tab whose URL includes
   `keka.com` is reused only as a fallback (each script closes its own tab on the way out, so normally
   there's nothing to find — this just stops a failed `close()` from leaking tabs on top of each other).
   The tab is brought to the foreground because Chrome throttles JS timers in background tabs, which can
   stall the SPA's render past our wait timeouts.

**`src/lib/poll.ts`** — `pollUntil(fn, predicate, opts)` is the shared retry-until-timeout primitive used
by both CDP-endpoint polling and attendance-status polling. It swallows errors thrown by `fn()` while
polling (treating them as "not ready yet") and only throws `opts.timeoutMessage` once `opts.timeoutMs`
elapses.

**`src/lib/network.ts`** — `hasInternet(timeoutMs = 5000)` does a short-timeout `fetch` to
`https://www.gstatic.com/generate_204` (a lightweight, high-uptime endpoint used for connectivity checks
generally, so a Keka-specific outage isn't misreported as "no internet"). Used by `clock-out.ts` to fail
fast with a clear error instead of launching Brave only to hit a navigation error deep inside.

**`src/status.ts`** — `getClockControl()` locates the clock-in/out control via
`page.getByText(/web clock-(in|out)/i)`. `getAttendanceStatus()` reads it with two safeguards learned the
hard way: the SPA can briefly render a stale value before its real status has loaded, and a single read
can silently trust that stale snapshot since it doesn't throw — so it requires **two reads 1.5s apart to
agree** before trusting the result. It also retries (default 3 attempts) on a genuine `page.reload()` if
the reads disagree or the control never renders — note `page.goto()` to this same hash-only URL is a
same-document no-op once already on it, so only the very first navigation uses `goto()`; retries must use
`reload()` or they silently re-read the same DOM. `waitForStatus()` polls the *same* page in place after a
click (no navigation/reload) with a short 2s per-read timeout — the SPA updates the clock control
reactively, and reloading here would abort the in-flight clock-in/out request before the server responds.

**`src/lib/logger.ts`** — separate `error`/`success` logs under `logs/` at the repo root, each shaped as:

```
logs/<error|success>/summary.md              # one markdown-table row per run
logs/<error|success>/<YYYY-MM-DD>/<HH-MM-SS>-<context>.log   # full detail for that run
```

- `logSuccess(context, message)` / `logError(context, error)` write today's date-folder detail file, then
  append a row to that kind's `summary.md` (creating the header if missing).
- Retention is `RETENTION_DAYS` (10), enforced by deleting whole date-folders older than the cutoff — a
  cheap directory-name comparison, no per-file reads — then trimming `summary.md` to match. This runs on
  every write.
- `logError()` also best-effort drops a *symlink* (not a copy) to the new detail file at
  `~/Desktop/keka-error-<context>-<time>.log`. When an old date-folder is pruned, any now-dangling
  `keka-error-*` Desktop symlink is swept up in the same pass.
- `hasSucceededToday(context)` reads `logs/success/summary.md` (kept small by pruning) and checks for a row
  matching today's date and `context` — this is what lets `clock-in.ts`/`clock-out.ts` skip launching Brave
  entirely once today's run has already succeeded.

`logs/` is gitignored in full.

## Scheduling (launchd)

`clock-in.ts` and `clock-out.ts` are run automatically by two per-user launchd agents, each firing 4x/day,
Mon–Sat. The canonical plists live in this repo at `launchd/` and are symlinked into
`~/Library/LaunchAgents/` (launchd itself only reads from that real path, and won't follow a symlinked
*directory*, but a symlinked *file* inside it works fine) — edit the repo copy, not the symlink:

- `com.user.keka-clockin.plist` — `bun src/clock-in.ts` at 09:00, 09:30, 10:00, 10:30
- `com.user.keka-clockout.plist` — `bun src/clock-out.ts` at 20:00, 20:30, 21:00, 21:30

The repeated daily triggers exist as retries in case an earlier run in the window fails (Brave not up yet,
a transient SPA hiccup, etc.) — `hasSucceededToday()` in `logger.ts` makes the later triggers cheap no-ops
once one run in the window has already succeeded, so they don't relaunch Brave for nothing.

Both invoke `/opt/homebrew/bin/bun` directly (not `bun run`) with `WorkingDirectory` set to the repo root,
log raw stdout/stderr to `logs/launchd/clockin.{out,err}.log` / `logs/launchd/clockout.{out,err}.log`
(under the same gitignored `logs/` tree as the structured error/success logs, but not subject to their
retention pruning — these grow unbounded), and have `RunAtLoad: false` — they only fire on the calendar
schedule, never on login/agent-load. There is no Sunday run, and nothing currently reschedules or disables
a run for a given day (e.g. a holiday). Since these agents call `bun` with an absolute path outside any
login shell, `getPage()` relaunching Brave via `brave-launcher.sh` (plain `open -a`) is what actually needs
to succeed unattended — there's no interactive terminal to fall back on if it fails. `logs/launchd/` must
exist on disk before (re)loading either agent — launchd does not create intermediate directories for
`StandardOutPath`/`StandardErrorPath` itself.

Reload an agent after editing its plist (in `launchd/`, followed through the symlink):
`launchctl unload ~/Library/LaunchAgents/com.user.keka-clockin.plist && launchctl load ~/Library/LaunchAgents/com.user.keka-clockin.plist`.

## Notes

- `status-screenshot.png` and `skip-today` are gitignored but not referenced anywhere in `src/` — they
  aren't produced or consumed by the current code, so treat them as vestigial/external rather than
  assuming missing functionality.
- No `main` field in `package.json` — these scripts are only ever run directly (`bun src/...ts`), never
  imported as a module.
