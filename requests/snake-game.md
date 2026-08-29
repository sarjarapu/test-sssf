**Role:** You are an expert frontend web developer and game designer.

**Objective:** Write the complete HTML, CSS, and JavaScript code for a classic, browser-based Snake game. The code should be fully self-contained in a single file (using <style> and <script> tags) so it can be run directly in any modern web browser.

**Game Mechanics & Rules:**
1. **The Grid/Arena:** The game takes place inside a defined rectangular box (a canvas or grid). The borders of this box act as solid walls.
2. **The Snake:** The snake is represented by a series of connected blocks. It moves continuously in a single direction.
3. **Movement & Controls:**
   - The snake's direction is controlled by the user using either the Arrow keys (Up, Down, Left, Right) or WASD keys (W, A, S, D).
   - Prevent 180-degree instant turns (e.g., if moving right, the snake cannot immediately reverse to move left).
4. **Food (Apples):** Apples should appear one at a time at random block locations on the grid. Ensure apples do not spawn on top of the snake's current body.
5. **Growth & Scoring:** When the snake's head occupies the same block as an apple, the apple is "eaten." The snake's length must increase by one block, a new apple must spawn, and the player's score should increase. The score is directly tied to how many apples are eaten / how long the snake gets.
6. **Death/Game Over Conditions:** The game ends immediately if:
   - The snake's head collides with any of the outer walls.
   - The snake's head collides with any part of its own body.
7. **Replayability:** When the game ends, display a "Game Over" message alongside the final score, and provide a prompt or button to restart the game easily.

**Technical & UI Requirements:**
- **Rendering:** Use the HTML5 `<canvas>` API for efficient rendering of the grid, snake, and apples.
- **Styling:** Provide clean, modern CSS. Center the game board on the screen, give the walls a distinct border, color the snake (e.g., green with a slightly darker head), and color the apple (e.g., red).
- **Game Loop:** Use `window.requestAnimationFrame` or `setInterval` to manage the game loop. The speed of the snake should be smooth but challenging.
- **Readability:** Add comments explaining the game loop, collision detection logic, and input handling.

**Output:** Provide ONLY the raw, functional HTML/CSS/JS code in a single code block. Ensure it works perfectly on the first load without requiring external assets or libraries.
