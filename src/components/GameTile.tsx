import { Link } from 'react-router-dom';
import type { Game } from '../types/game';
import { useHighScore } from '../hooks/useHighScore';
import './gameTile.css';

export default function GameTile({ game }: { game: Game }) {
  const { highScore } = useHighScore(game);
  const showScore = game.hasHighScore && highScore != null;
  const formatted = game.formatHighScore
    ? game.formatHighScore(highScore ?? 0)
    : String(highScore);

  return (
    <li className="game-tile">
      <Link to={`/game/${game.id}`} className="game-tile__link">
        <span className="game-tile__thumb" aria-hidden="true">
          {game.thumbnail}
        </span>
        <span className="game-tile__title">{game.title}</span>
        <span className="game-tile__desc">{game.description}</span>
        {showScore && (
          <span className="game-tile__score">Best: {formatted}</span>
        )}
      </Link>
    </li>
  );
}
