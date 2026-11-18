# RECOIL

A top-down co-op PvE arena shooter where you have no movement keys — you move by the recoil of your own gunfire. Also has a PvP deathmatch mode against friends.

## Modes

- **Co-op (PvE):** survive light enemy waves, pick upgrades every 60s, bosses every 5 min.
- **PvP:** free-for-all deathmatch, no AI enemies, all weapons unlocked, respawn in 2s, first to 5 kills (or 3 min time limit) wins.

## Stack

- Node.js + `ws` (WebSocket server, authoritative 30 Hz simulation)
- Plain HTML/CSS/JS + Canvas 2D (no build step)

## Run

```
npm install
npm start
```

Open http://localhost:3000. Create a room, share the 4-letter code, host clicks START.

## Art

Drop sprites into `public/assets/` — see `public/assets/README.md` for the asset brief. Placeholders are used until files exist.
