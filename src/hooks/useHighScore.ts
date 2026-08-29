import { useCallback, useState } from 'react';
import { storage as defaultStorage, gameKey } from '../services/storage';
import type { StorageService } from '../services/storage';
import type { Game } from '../types/game';

export function useHighScore(game: Game, storage: StorageService = defaultStorage) {
  const key = gameKey(game.id, 'highScore');
  const [highScore, setHighScore] = useState<number | null>(() =>
    storage.get<number | null>(key, null),
  );

  const submitScore = useCallback(
    (value: number) => {
      setHighScore((prev) => {
        if (prev != null && prev >= value) return prev;
        storage.set(key, value);
        return value;
      });
    },
    [key, storage],
  );

  const refresh = useCallback(() => {
    setHighScore(storage.get<number | null>(key, null));
  }, [key, storage]);

  return { highScore, submitScore, refresh };
}
