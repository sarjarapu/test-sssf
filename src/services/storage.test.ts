import { describe, it, expect } from 'vitest';
import {
  createStorageService,
  gameKey,
  NAMESPACE,
  type StorageLike,
} from './storage';

function makeFake(overrides: Partial<StorageLike> = {}): StorageLike {
  const map = new Map<string, string>();
  const fake: StorageLike = {
    getItem: overrides.getItem ?? ((k) => (map.has(k) ? (map.get(k) as string) : null)),
    setItem:
      overrides.setItem ??
      ((k, v) => {
        map.set(k, v);
      }),
    removeItem:
      overrides.removeItem ??
      ((k) => {
        map.delete(k);
      }),
    key: overrides.key ?? ((i) => Array.from(map.keys())[i] ?? null),
    get length() {
      return map.size;
    },
  };
  return fake;
}

describe('storage roundtrip', () => {
  it('get/set/remove against a working backend', () => {
    const s = createStorageService(makeFake());
    expect(s.get('k', 'fallback')).toBe('fallback');
    s.set('k', { a: 1 });
    expect(s.get('k', null)).toEqual({ a: 1 });
    s.remove('k');
    expect(s.get('k', 'gone')).toBe('gone');
  });
});

describe('storage fallback behaviour', () => {
  it('setItem throws -> set does not throw and value comes back from memory', () => {
    const s = createStorageService(
      makeFake({
        setItem: () => {
          throw new Error('quota');
        },
      }),
    );
    expect(() => s.set('k', 'v')).not.toThrow();
    expect(s.get('k', 'fallback')).toBe('v');
  });

  it('getItem throws -> returns fallback, no throw', () => {
    const s = createStorageService(
      makeFake({
        getItem: () => {
          throw new Error('boom');
        },
      }),
    );
    let result: string | undefined;
    expect(() => {
      result = s.get('k', 'fallback');
    }).not.toThrow();
    expect(result).toBe('fallback');
  });

  it('corrupt JSON -> returns fallback', () => {
    const fake = makeFake();
    fake.setItem('k', 'not-json{');
    const s = createStorageService(fake);
    expect(s.get('k', 'fallback')).toBe('fallback');
  });

  it('wrong envelope version -> returns fallback', () => {
    const fake = makeFake();
    fake.setItem('k', JSON.stringify({ v: 0, value: 'x' }));
    const s = createStorageService(fake);
    expect(s.get('k', 'fallback')).toBe('fallback');
  });
});

describe('clearNamespace', () => {
  it('removes namespaced keys and leaves foreign keys alone', () => {
    const fake = makeFake();
    const s = createStorageService(fake);
    s.set(gameKey('tic-tac-toe', 'highScore'), 5);
    s.set(`${NAMESPACE}:other:field`, 1);
    fake.setItem('unrelated', 'keep-me');
    s.clearNamespace();
    expect(fake.getItem('unrelated')).toBe('keep-me');
    expect(s.get(gameKey('tic-tac-toe', 'highScore'), 'gone')).toBe('gone');
  });
});
