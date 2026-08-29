import { Routes, Route } from 'react-router-dom';
import HomeScreen from './screens/HomeScreen';
import GameScreen from './screens/GameScreen';
import NotFoundScreen from './screens/NotFoundScreen';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/game/:gameId" element={<GameScreen />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}
