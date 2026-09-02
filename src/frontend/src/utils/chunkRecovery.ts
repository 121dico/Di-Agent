export const CHUNK_RECOVERY_KEY = 'dihub:chunk-recovery';
export const CHUNK_RECOVERY_WINDOW_MS = 60_000;

type RecoveryAttempt = {
  path: string;
  attemptedAt: number;
};

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type RecoveryOptions = {
  storage: RecoveryStorage;
  reload: () => void;
  path: string;
  now: number;
};

export type ChunkRecoveryOutcome = 'reloading' | 'showing-fallback';

let memoryAttempt: RecoveryAttempt | null = null;

function readAttempt(storage: RecoveryStorage): RecoveryAttempt | null {
  try {
    const raw = storage.getItem(CHUNK_RECOVERY_KEY);
    if (!raw) return memoryAttempt;
    const parsed = JSON.parse(raw) as Partial<RecoveryAttempt>;
    if (typeof parsed.path !== 'string' || typeof parsed.attemptedAt !== 'number') return memoryAttempt;
    return { path: parsed.path, attemptedAt: parsed.attemptedAt };
  } catch {
    return memoryAttempt;
  }
}

function writeAttempt(storage: RecoveryStorage, attempt: RecoveryAttempt) {
  memoryAttempt = attempt;
  try {
    storage.setItem(CHUNK_RECOVERY_KEY, JSON.stringify(attempt));
  } catch {
    // Private browsing or locked-down storage can fail. The in-memory guard
    // still prevents a reload loop for the current document.
  }
}

export function clearChunkRecoveryGuard(storage: RecoveryStorage = window.sessionStorage) {
  memoryAttempt = null;
  try {
    storage.removeItem(CHUNK_RECOVERY_KEY);
  } catch {
    // A manual recovery remains useful even when storage is unavailable.
  }
}

export function handleVitePreloadError(
  event: Event,
  { storage, reload, path, now }: RecoveryOptions,
): ChunkRecoveryOutcome {
  const previous = readAttempt(storage);
  const alreadyRetried = previous
    && previous.path === path
    && now - previous.attemptedAt >= 0
    && now - previous.attemptedAt < CHUNK_RECOVERY_WINDOW_MS;

  if (alreadyRetried) {
    return 'showing-fallback';
  }

  writeAttempt(storage, { path, attemptedAt: now });
  event.preventDefault();
  reload();
  return 'reloading';
}

export function installChunkRecovery(target: Window = window) {
  target.addEventListener('vite:preloadError', (event) => {
    handleVitePreloadError(event, {
      storage: target.sessionStorage,
      reload: () => target.location.reload(),
      path: `${target.location.pathname}${target.location.search}${target.location.hash}`,
      now: Date.now(),
    });
  });
}

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk .+ failed|chunkloaderror/i.test(message);
}
