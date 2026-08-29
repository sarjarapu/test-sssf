import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TicTacToeGame from './TicTacToeGame';
import { ticTacToe } from './index';

function renderGame() {
  return render(
    <MemoryRouter>
      <TicTacToeGame game={ticTacToe} />
    </MemoryRouter>,
  );
}

function cells() {
  return screen.getAllByRole('gridcell') as HTMLButtonElement[];
}

async function playSequence(indices: number[]) {
  const user = userEvent.setup();
  for (const index of indices) {
    await user.click(cells()[index]);
  }
  return user;
}

describe('TicTacToeGame', () => {
  it('X wins across the top row: announces winner, marks line, locks board', async () => {
    renderGame();
    // X:0 O:3 X:1 O:4 X:2
    await playSequence([0, 3, 1, 4, 2]);

    expect(screen.getByRole('status')).toHaveTextContent('Player 1 (X) wins!');

    const winning = document.querySelectorAll('.ttt__cell.winning');
    expect(winning).toHaveLength(3);

    for (const cell of cells()) {
      expect(cell).toBeDisabled();
    }
  });

  it('clicking a disabled cell after game over does not change the board', async () => {
    const user = await playSequenceRendered([0, 3, 1, 4, 2]);
    const before = cells().map((c) => c.textContent);
    await user.click(cells()[5]);
    expect(cells().map((c) => c.textContent)).toEqual(before);
  });

  it('tally increments by one after a win', async () => {
    renderGame();
    await playSequence([0, 3, 1, 4, 2]);
    expect(screen.getByText(/X wins: 1 · O wins: 0 · Draws: 0/)).toBeInTheDocument();
  });

  it('Restart clears the board and re-enables cells while the tally persists', async () => {
    const user = await playSequenceRendered([0, 3, 1, 4, 2]);
    await user.click(screen.getByRole('button', { name: 'Restart' }));

    for (const cell of cells()) {
      expect(cell).toBeEnabled();
      expect(cell).toHaveTextContent('');
    }
    expect(screen.getByText(/X wins: 1 · O wins: 0 · Draws: 0/)).toBeInTheDocument();
  });

  it('a draw sequence announces "It\'s a draw!"', async () => {
    renderGame();
    await playSequence([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(screen.getByRole('status')).toHaveTextContent("It's a draw!");
  });
});

async function playSequenceRendered(indices: number[]) {
  renderGame();
  return playSequence(indices);
}
