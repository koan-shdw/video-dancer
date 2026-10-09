// settings.json read: the one door every settings load and save goes through. A MISSING file is
// normal (first run) and reads as {}. Anything else (damaged JSON, not an object, a lock that
// outlasts the retries) THROWS: a save must never merge onto a plausible empty object, because
// that write replaces every key and setting on disk (audit 2026-10-08, Part 1 #1).
import { readIfExists } from './fileSave'

export class SettingsUnreadable extends Error {}

export async function readSettingsFile<T extends object>(file: string): Promise<T> {
  try {
    const text = await readIfExists(file)
    if (text == null) return {} as T
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not a settings object')
    return value as T
  } catch (e) {
    throw new SettingsUnreadable(`${file} could not be read (${e instanceof Error ? e.message : String(e)})`)
  }
}
