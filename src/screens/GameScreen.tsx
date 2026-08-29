import { useParams } from 'react-router-dom';
import { getGameById } from '../games/registry';
import NotFoundScreen from './NotFoundScreen';

export default function GameScreen() {
  const params = useParams<{ gameId: string }>();
  const game = getGameById(params.gameId);
  if (!game) return <NotFoundScreen />;
  const GameComponent = game.component;
  return <GameComponent game={game} />;
}
