import { useCallback, useMemo, useState } from 'react';
import { storage as defaultStorage, gameKey } from '../services/storage';
import type { StorageService } from '../services/storage';
import type { Game, SettingsValues } from '../types/game';

function seedDefaults(game: Game): SettingsValues {
  const values: SettingsValues = {};
  for (const field of game.settings ?? []) {
    values[field.key] = field.default;
  }
  return values;
}

export function useGameSettings(
  game: Game,
  storage: StorageService = defaultStorage,
) {
  const key = gameKey(game.id, 'settings');
  const defaults = useMemo(() => seedDefaults(game), [game]);

  const [values, setValues] = useState<SettingsValues>(() => ({
    ...defaults,
    ...storage.get<SettingsValues>(key, {}),
  }));

  const setValue = useCallback(
    (fieldKey: string, value: boolean | string) => {
      setValues((prev) => {
        const next = { ...prev, [fieldKey]: value };
        storage.set(key, next);
        return next;
      });
    },
    [key, storage],
  );

  const reset = useCallback(() => {
    setValues(defaults);
    storage.set(key, defaults);
  }, [defaults, key, storage]);

  return { values, setValue, reset };
}
