export interface StorageService {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  clearNamespace(): void;
}

export const NAMESPACE = 'retro-arcade:v1';

export const gameKey = (gameId: string, field: string) =>
  `${NAMESPACE}:${gameId}:${field}`;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

interface Envelope<T> {
  v: 1;
  value: T;
}

function isEnvelope(parsed: unknown): parsed is Envelope<unknown> {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { v?: unknown }).v === 1
  );
}

function probe(backend: StorageLike | undefined): StorageLike | null {
  try {
    if (!backend) return null;
    const probeKey = `${NAMESPACE}:__probe__`;
    backend.setItem(probeKey, '1');
    backend.removeItem(probeKey);
    return backend;
  } catch {
    return null;
  }
}

function createMemoryBackend(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export function createStorageService(backend?: StorageLike): StorageService {
  let live: StorageLike | null = probe(backend);
  const memory = createMemoryBackend();

  function fallbackToMemory() {
    if (live !== memory) {
      live = memory;
    }
  }

  function active(): StorageLike {
    return live ?? memory;
  }

  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = active().getItem(key);
        if (raw == null) return fallback;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          this.remove(key);
          return fallback;
        }
        if (!isEnvelope(parsed)) {
          this.remove(key);
          return fallback;
        }
        return (parsed as Envelope<T>).value;
      } catch {
        fallbackToMemory();
        return fallback;
      }
    },

    set<T>(key: string, value: T): void {
      const payload = JSON.stringify({ v: 1, value } satisfies Envelope<T>);
      try {
        active().setItem(key, payload);
      } catch {
        fallbackToMemory();
        try {
          memory.setItem(key, payload);
        } catch {
          /* never rethrow */
        }
      }
    },

    remove(key: string): void {
      try {
        active().removeItem(key);
      } catch {
        fallbackToMemory();
        try {
          memory.removeItem(key);
        } catch {
          /* never rethrow */
        }
      }
    },

    clearNamespace(): void {
      try {
        const b = active();
        const doomed: string[] = [];
        for (let i = 0; i < b.length; i += 1) {
          const k = b.key(i);
          if (k && k.startsWith(`${NAMESPACE}:`)) doomed.push(k);
        }
        for (const k of doomed) {
          try {
            b.removeItem(k);
          } catch {
            /* skip */
          }
        }
      } catch {
        fallbackToMemory();
      }
    },
  };
}

function defaultBackend(): StorageLike | undefined {
  try {
    return window.localStorage as unknown as StorageLike;
  } catch {
    return undefined;
  }
}

export const storage: StorageService = createStorageService(defaultBackend());
