# Keka Attendance Automation

Automatically clocks you in and out on [Keka](https://pointo.keka.com) by driving your own,
already-running Brave browser over the Chrome DevTools Protocol (CDP) — not a separate headless
browser. It reuses your existing, already-authenticated Brave session, so there's no separate login
flow for the automation to manage on every run.

Runs on a schedule via `launchd` (macOS), with structured success/error logging, same-day dedup so
repeated scheduled triggers stay cheap, and a network pre-flight check before clock-out.

## How it works

1. `brave-launcher.sh` (re)launches Brave with `--remote-debugging-port=9222` on your normal
   ("Default"/"Pointo") profile.
2. The script connects to that running Brave instance over CDP (via `playwright-core`), opens the
   Keka attendance page, and reads the current clock-in/out state directly from the page.
3. If action is needed, it clicks the appropriate control(s) and waits for the page to confirm the
   new state.
4. Every run logs a structured success or error entry, and closes its own browser tab on the way out.

Nothing runs headless, and nothing creates a separate browser profile — it's driving the same Brave
window you'd otherwise use yourself, which is why it can skip authentication entirely as long as
you're already logged into Keka in that browser.

## Requirements

- macOS (the launcher script and scheduling are macOS-specific: `open -a`, `launchd`)
- [Bun](https://bun.sh) — this project uses `bun`, not `npm`/`yarn`/`node` directly
- Brave Browser, already signed into Keka (via Google SSO) on your normal profile
- Already logged into that Google account in Brave, since `login.ts` relies on the one-click "Continue
  with Google" flow rather than entering credentials

## Setup

1. **Install dependencies**

   ```
   bun install
   ```

2. **Confirm you're logged into Keka in Brave** (your normal, everyday browser profile). If not, run:

   ```
   bun src/login.ts
   ```

   This navigates to Keka's login page and clicks "Continue with Google," relying on your browser
   already being signed into the right Google account. It does not accept or store credentials.

3. **Install the scheduled agents.** The canonical `launchd` plists live in this repo, under
   [`launchd/`](launchd), and need to be symlinked into `~/Library/LaunchAgents/` (launchd only reads
   from that real path):

   ```
   ln -s "$(pwd)/launchd/com.user.keka-clockin.plist"  ~/Library/LaunchAgents/com.user.keka-clockin.plist
   ln -s "$(pwd)/launchd/com.user.keka-clockout.plist" ~/Library/LaunchAgents/com.user.keka-clockout.plist
   launchctl load ~/Library/LaunchAgents/com.user.keka-clockin.plist
   launchctl load ~/Library/LaunchAgents/com.user.keka-clockout.plist
   ```

   The paths inside those plists (`ProgramArguments`, `WorkingDirectory`, `bun`'s location at
   `/opt/homebrew/bin/bun`) are absolute and specific to this machine/user — if you're setting this up
   fresh elsewhere, edit the repo copies in `launchd/` to match before symlinking them in.

## Usage

Run any of these manually at any time:

| Command | What it does |
|---|---|
| `bun run status` (or `bun src/status.ts`) | Prints the current attendance status: `clocked-in` or `clocked-out` |
| `bun run clock-in` (or `bun src/clock-in.ts`) | Clocks in, if not already clocked in |
| `bun run clock-out` (or `bun src/clock-out.ts`) | Clocks out, if not already clocked out |
| `bun run login` (or `bun src/login.ts`) | Re-runs the Google SSO login flow |
| `bun run build` | Type-checks and compiles to `dist/` |
| `bun x tsc --noEmit` | Type-checks without emitting (no separate lint/test suite exists) |

`clock-in`/`clock-out` are safe to run repeatedly — each one checks the live attendance state first
and simply logs "already clocked in/out" if there's nothing to do, without touching the button.

## Scheduling

Two `launchd` agents fire automatically, Monday–Saturday (no Sunday run):

- **Clock-in**: 09:00, 09:30, 10:00, 10:30
- **Clock-out**: 20:00, 20:30, 21:00, 21:30

Each slot is a retry window, not four separate clock actions — the first run that actually succeeds
in a given day makes every later trigger in that window a fast no-op (see **Dedup** below), so under
normal conditions only one real clock-in and one real clock-out happen per day; the extra slots exist
in case Brave/network isn't ready yet on the first attempt.

To change the schedule, edit the plist(s) in `launchd/` directly (not the symlinks) and reload:

```
launchctl unload ~/Library/LaunchAgents/com.user.keka-clockin.plist
launchctl load   ~/Library/LaunchAgents/com.user.keka-clockin.plist
```

## Logs

Everything writes to `logs/` at the repo root (gitignored — none of it is committed):

```
logs/
  error/
    summary.md                      # one markdown-table row per failed run
    2026-09-24/
      09-32-11-clock-in.log         # full error detail for that run
  success/
    summary.md                      # one markdown-table row per successful run
    2026-09-24/
      09-32-11-clock-in.log
  launchd/
    clockin.out.log                 # raw stdout/stderr from the launchd agents
    clockin.err.log                 # (not pruned — these grow unbounded over time)
    clockout.out.log
    clockout.err.log
```

- `summary.md` files are plain markdown tables — open them in any markdown viewer (or just `cat` them)
  for a quick history of what ran and when.
- Detail logs and summary rows older than 10 days are pruned automatically on every write.
- New errors also drop a symlink (not a full copy) on your Desktop —
  `keka-error-<context>-<time>.log` — so a failure is hard to miss without needing to dig into `logs/`.
  Symlinks whose target has since been pruned are cleaned up automatically too.

### Dedup

Before doing anything, `clock-in`/`clock-out` check whether that same action already succeeded
*today* (via `logs/success/summary.md`) and, if so, skip immediately without touching the browser at
all. This is what makes the repeated 30-minute retry slots cheap. It only tracks "succeeded once
today," not live state — if you manually clock in/out again later the same day through Keka itself,
the automation won't re-detect that as a new day's first success.

## Known quirks

- **Clocking out requires two clicks.** Keka's UI treats the initial "Web Clock-out" control as a
  reveal step — it swaps to a "Clock-out" / "Cancel" pair, and only the second "Clock-out" click
  actually submits it. Clock-in has no equivalent step. This tripped up an earlier version of this
  automation for a full day before being caught.
- **The CDP debug port only applies on Brave's first launch.** If Brave is already running (opened
  normally, not via `brave-launcher.sh`), relaunching it with `--remote-debugging-port=9222` has no
  effect on the already-running process — the port simply won't be reachable until Brave is fully
  quit and restarted through the launcher script.
- **The attendance page can briefly show a stale status right after loading**, before its real state
  finishes fetching. `getAttendanceStatus()` guards against this by requiring two reads 1.5 seconds
  apart to agree before trusting the result, with retries on a genuine page reload if they disagree.

## Project structure

```
brave-launcher.sh          # relaunches Brave with the CDP debug port enabled
launchd/                   # canonical launchd plists, symlinked into ~/Library/LaunchAgents/
src/
  clock-in.ts               # entry point: clock in
  clock-out.ts              # entry point: clock out
  login.ts                  # entry point: Google SSO login flow
  status.ts                 # entry point: print status; shared status-reading logic
  lib/
    browser.ts               # getPage() — launches/connects to Brave over CDP
    logger.ts                 # structured success/error logging, retention, dedup
    network.ts                 # connectivity pre-flight check
    poll.ts                     # shared retry-until-timeout helper
```

See [`CLAUDE.md`](CLAUDE.md) for a more detailed architectural walkthrough aimed at whoever (human or
AI) is next modifying this code.
