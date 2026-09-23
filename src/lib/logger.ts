import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

const LOGS_ROOT = join(__dirname, "..", "..", "logs");
const RETENTION_DAYS = 10;
const DESKTOP_DIR = join(homedir(), "Desktop");
const SUMMARY_HEADER = "| Date | Time | Context | Message | Detail |\n| --- | --- | --- | --- | --- |\n";

type LogKind = "error" | "success";

function kindDir(kind: LogKind): string {
  return join(LOGS_ROOT, kind);
}

function summaryPath(kind: LogKind): string {
  return join(kindDir(kind), "summary.md");
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function timeStr(d: Date): string {
  return d.toISOString().slice(11, 19).replace(/:/g, "-");
}

function sanitizeForTable(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const escaped = firstLine.replace(/\|/g, "\\|");
  return escaped.length > 200 ? escaped.slice(0, 200) + "…" : escaped;
}

function appendSummaryRow(kind: LogKind, date: string, time: string, context: string, message: string, detailRelPath: string): void {
  const path = summaryPath(kind);
  if (!existsSync(path)) {
    mkdirSync(kindDir(kind), { recursive: true });
    writeFileSync(path, SUMMARY_HEADER);
  }
  const row = `| ${date} | ${time} | ${context} | ${sanitizeForTable(message)} | [detail](${detailRelPath}) |\n`;
  appendFileSync(path, row);
}

function pruneSummary(kind: LogKind, cutoff: string): void {
  const path = summaryPath(kind);
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf-8").split("\n");
  const header = lines.slice(0, 2);
  const rows = lines.slice(2).filter((line) => {
    const date = line.split("|")[1]?.trim();
    return !date || date >= cutoff;
  });

  writeFileSync(path, [...header, ...rows].join("\n"));
}

function pruneDanglingDesktopSymlinks(): void {
  if (!existsSync(DESKTOP_DIR)) return;

  for (const name of readdirSync(DESKTOP_DIR)) {
    if (!name.startsWith("keka-error-")) continue;
    const path = join(DESKTOP_DIR, name);
    try {
      if (lstatSync(path).isSymbolicLink() && !existsSync(path)) {
        unlinkSync(path);
      }
    } catch {
      // ignore — best-effort Desktop cleanup
    }
  }
}

function pruneOldDates(kind: LogKind): void {
  const dir = kindDir(kind);
  if (!existsSync(dir)) return;

  const cutoff = dateStr(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
  let removedAny = false;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name >= cutoff) continue;
    rmSync(join(dir, entry.name), { recursive: true, force: true });
    removedAny = true;
  }

  if (!removedAny) return;

  pruneSummary(kind, cutoff);
  if (kind === "error") pruneDanglingDesktopSymlinks();
}

function writeEntry(kind: LogKind, context: string, message: string, detail: string): string {
  const now = new Date();
  const date = dateStr(now);
  const time = timeStr(now);

  const dayDir = join(kindDir(kind), date);
  mkdirSync(dayDir, { recursive: true });

  const fileName = `${time}-${context}.log`;
  const filePath = join(dayDir, fileName);
  writeFileSync(filePath, detail);

  appendSummaryRow(kind, date, time, context, message, join(date, fileName));
  pruneOldDates(kind);

  return filePath;
}

export function logSuccess(context: string, message: string): void {
  const detail = `[${new Date().toISOString()}] [${context}] SUCCESS: ${message}\n`;
  writeEntry("success", context, message, detail);
}

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const filePath = writeEntry("error", context, message, `[${new Date().toISOString()}] [${context}] ERROR: ${detail}\n`);

  // Drop a symlink on the Desktop so a new failure is hard to miss, without
  // piling up full file copies. Overwrites nothing — each error gets its own
  // link, and stale links are swept up in pruneDanglingDesktopSymlinks once
  // their target's date folder is pruned.
  try {
    const time = timeStr(new Date());
    symlinkSync(filePath, join(DESKTOP_DIR, `keka-error-${context}-${time}.log`));
  } catch {
    // ignore — best-effort; the log entry above is the source of truth
  }
}

export function hasSucceededToday(context: string): boolean {
  const path = summaryPath("success");
  if (!existsSync(path)) return false;

  const today = dateStr(new Date());
  return readFileSync(path, "utf-8")
    .split("\n")
    .some((line) => {
      const cols = line.split("|").map((c) => c.trim());
      return cols[1] === today && cols[3] === context;
    });
}
