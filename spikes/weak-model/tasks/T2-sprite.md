Add a new creature to this Phaser 3 game: a skeleton knight called `guard`.

- Every sprite in this game is declared in `ssg.assets.json` and built by `npm run assets` from the Synty Sprite
  Generator (see AGENTS.md for the CLI). Add a sprite named `guard` that uses the library asset
  `POLYGON_Dungeon_Pack/Character_Skeleton_Knight` with the moves `Idle_Standing` and `Walk_F`, declared the same way
  as the existing `skeleton` sprite, then build the assets. The build renders on a shared machine and can take a few
  minutes; wait for it.
- Show one `guard` standing (idle animation playing) in the first room, on the floor next to Joe's start position,
  facing him. It does not need to move or hurt Joe.
- Keep the change small and in TypeScript. Never hand-edit `public/assets`.

Before you finish, run `npm run typecheck` and `node scripts/load-check.mjs http://localhost:$PORT room` (start the
dev server first with `npx vite --port $PORT --strictPort`, in the background; restart it after `npm run assets`),
and make sure both pass.
