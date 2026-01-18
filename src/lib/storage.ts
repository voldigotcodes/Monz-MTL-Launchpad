import type { CopyPreset, HistoryEntry, Preset } from "../types";

const HISTORY_KEY = "monz_launch_history";
const PRESETS_KEY = "monz_launch_presets";
const COPY_PRESETS_KEY = "monz_copy_presets";

function read<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

export function loadHistory(): HistoryEntry[] {
  return read<HistoryEntry[]>(HISTORY_KEY, []);
}

export function saveHistory(entries: HistoryEntry[]): void {
  write(HISTORY_KEY, entries.slice(0, 10));
}

export function loadPresets(): Preset[] {
  return read<Preset[]>(PRESETS_KEY, []);
}

export function savePresets(presets: Preset[]): void {
  write(PRESETS_KEY, presets.slice(0, 20));
}

export function loadCopyPresets(): CopyPreset[] {
  return read<CopyPreset[]>(COPY_PRESETS_KEY, []);
}

export function saveCopyPresets(presets: CopyPreset[]): void {
  write(COPY_PRESETS_KEY, presets.slice(0, 50));
}
