import { useCallback, useState } from 'react';
import GameTile from '../components/GameTile';
import { GAMES } from '../games/registry';
import { storage } from '../services/storage';
import './homeScreen.css';

export default function HomeScreen() {
  const [refreshKey, setRefreshKey] = useState(0);

  const resetProgress = useCallback(() => {
    if (
      window.confirm(
        'Reset all saved progress? This clears high scores and settings.',
      )
    ) {
      storage.clearNamespace();
      setRefreshKey((k) => k + 1);
    }
  }, []);

  return (
    <div className="home">
      <header className="home__header">
        <h1>Retro Arcade</h1>
        <p className="home__tagline">Pick a game and play.</p>
      </header>

      <ul className="home__grid" key={refreshKey}>
        {GAMES.map((game) => (
          <GameTile key={game.id} game={game} />
        ))}
      </ul>

      <footer className="home__footer">
        <button
          type="button"
          className="home__reset"
          onClick={resetProgress}
        >
          Reset progress
        </button>
      </footer>
    </div>
  );
}
