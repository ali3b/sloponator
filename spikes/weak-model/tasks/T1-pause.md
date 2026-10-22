Add a pause feature to this Phaser 3 game.

- Pressing the P key while a room is being played (the `Room` scene) pauses the game: Joe, the creatures and the
  timers stop. Pressing P again resumes it.
- While paused, the text `PAUSED` is shown in the centre of the screen, in the same style as the HUD text. It is
  removed on resume.
- Keep the change small and in TypeScript. Do not touch `public/assets`.

Before you finish, run `npm run typecheck` and `node scripts/load-check.mjs http://localhost:$PORT room` (start the
dev server first with `npx vite --port $PORT --strictPort`, in the background), and make sure both pass.
