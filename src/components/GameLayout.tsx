import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import HowToPlayPanel from './HowToPlayPanel';
import SettingsPanel from './SettingsPanel';
import type { Game, SettingsValues } from '../types/game';
import './gameLayout.css';

interface GameLayoutProps {
  game: Game;
  status: ReactNode;
  onRestart: () => void;
  settings?: {
    values: SettingsValues;
    setValue: (key: string, value: boolean | string) => void;
    reset: () => void;
  };
  children: ReactNode;
}

export default function GameLayout({
  game,
  status,
  onRestart,
  settings,
  children,
}: GameLayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSettings = Boolean(game.settings?.length);

  return (
    <div className="game-layout">
      <header className="game-layout__header">
        <Link to="/" className="link-button">
          <span aria-hidden="true">←</span> Back to Home
        </Link>
        <h1 className="game-layout__title">{game.title}</h1>
        <div className="game-layout__actions">
          <button type="button" onClick={onRestart}>
            Restart
          </button>
          {hasSettings && (
            <button type="button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          )}
        </div>
      </header>

      <div className="game-layout__status" role="status" aria-live="polite">
        {status}
      </div>

      <main className="game-layout__board">{children}</main>

      <HowToPlayPanel controls={game.controls} />

      {settingsOpen && hasSettings && settings && (
        <SettingsPanel
          fields={game.settings ?? []}
          values={settings.values}
          setValue={settings.setValue}
          reset={settings.reset}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
