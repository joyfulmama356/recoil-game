# RECOIL

A top-down shooter where you have no movement keys — you move by the recoil of your own gunfire. Includes co-op PvE survival and PvP deathmatch against friends.

## Modes

- **Co-op (PvE):** survive light enemy waves, pick 1 of 3 upgrades every 60s, bosses every 5 min. Unlock weapons by surviving longer.
- **PvP:** free-for-all deathmatch, no AI enemies, all weapons unlocked, respawn in 2s, first to 5 kills (or 3 min) wins.

## Run

```
npm install
npm start
```

Open http://localhost:3000. Create a room, share the 4-letter code, host clicks START. Up to 4 players.

## Controls

- Mouse — aim
- Left click / hold — fire (each shot pushes you backward)
- Space — dash
- 1 / 2 / 3 — pick upgrade (PvE)

## Stack

- Node.js + `ws` — authoritative 30 Hz simulation, 15 Hz snapshots
- Plain HTML/CSS/JS + Canvas 2D — no build step

## Tests

```
npm test           # 11 server end-to-end checks (both modes)
npm run test:browser  # 5 headless Chrome checks (client rendering, art, console)
```

Server tests use temporary score files so they never touch real leaderboards.

## Art

Nine hand-built SVG sprites ship in `public/assets/`. Drop same-named PNGs in that folder to override them automatically. See `public/assets/ART-PROMPT.md` for the image-model prompt.
