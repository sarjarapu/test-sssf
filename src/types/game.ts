import type React from 'react';

export interface ControlHint {
  action: string;
  how: string;
}

export type SettingsField =
  | { key: string; label: string; type: 'boolean'; default: boolean }
  | {
      key: string;
      label: string;
      type: 'select';
      default: string;
      options: { value: string; label: string }[];
    };

export type SettingsValues = Record<string, boolean | string>;

export interface GameComponentProps {
  game: Game;
}

export interface Game {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  component: React.ComponentType<GameComponentProps>;
  controls: ControlHint[];
  hasHighScore?: boolean;
  settings?: SettingsField[];
  formatHighScore?: (value: number) => string;
}
