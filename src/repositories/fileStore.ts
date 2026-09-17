import fs from "fs";
import path from "path";

// Deliberately simple: synchronous read on startup, synchronous write after
// every mutation. This is a single-process demo backend with light write
// volume (saved routes), not a service that needs a write queue or a real
// database - just enough that data survives `npm run dev` restarting.
const DATA_DIR = path.join(process.cwd(), "data");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Under the test runner, repositories built on this store should behave
// like the plain in-memory Maps they used to be - no reading real data on
// disk, and no leaving test fixtures behind that the next run would load.
const PERSISTENCE_DISABLED = !!process.env.VITEST;

export function loadJsonFile<T>(fileName: string, fallback: T): T {
  if (PERSISTENCE_DISABLED) return fallback;
  const filePath = path.join(DATA_DIR, fileName);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    // Missing file (first run) or corrupt JSON - either way, start fresh
    // rather than crashing the server over a persistence-layer read.
    return fallback;
  }
}

export function saveJsonFile<T>(fileName: string, data: T): void {
  if (PERSISTENCE_DISABLED) return;
  ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
