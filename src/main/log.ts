// Crash/error log for beta testers. Everything the main process prints, plus uncaught exceptions,
// rejected promises, and renderer crashes, is appended to <userData>/logs/main.log. A tester who
// hits a bug can send that one file. Best-effort and self-contained — logging must never itself crash.
import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'fs'
import { join } from 'path'

let logFile = ''
const MAX = 2 * 1024 * 1024 // rotate at ~2MB → keep main.log + main.prev.log

function ts(): string {
  // pass a fixed epoch into Date so this stays deterministic-friendly; wall clock is fine for a log
  return new Date().toISOString()
}

function write(level: string, parts: unknown[]): void {
  if (!logFile) return
  try {
    const line =
      `[${ts()}] ${level} ` +
      parts
        .map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : safeJson(p)))
        .join(' ') +
      '\n'
    appendFileSync(logFile, line)
  } catch {
    /* logging must never throw */
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}
export function logFilePath(): string {
  return logFile
}

export function initLogging(): void {
  try {
    const dir = logDir()
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
    // rotate if the current log got big
    if (existsSync(logFile) && statSync(logFile).size > MAX) {
      try {
        renameSync(logFile, join(dir, 'main.prev.log'))
      } catch {
        /* ignore */
      }
    }
    appendFileSync(logFile, `\n[${ts()}] ==== Video Dancer ${app.getVersion()} started (${process.platform}) ====\n`)
  } catch {
    return // no writable userData → run without a file log
  }

  // tee console.* to the file (captures the app's existing console.error breadcrumbs)
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      write(level.toUpperCase(), args)
      orig(...args)
    }
  }

  process.on('uncaughtException', (err) => write('FATAL uncaughtException', [err]))
  process.on('unhandledRejection', (reason) => write('FATAL unhandledRejection', [reason]))
}

// called from the IPC handler when the renderer reports its own uncaught errors
export function logRenderer(msg: string): void {
  write('RENDERER', [msg])
}
