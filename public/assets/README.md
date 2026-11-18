# Art asset brief for DeepSeek (or any image generator)

The game runs with placeholder circles right now. Drop correctly-named PNG files
into this folder and they replace the placeholders automatically — no code changes.

## Global style direction (paste this into every prompt)

> Top-down 2D game sprite, orthographic overhead view, clean vector-like digital
> painting, bold readable silhouette, thick dark outline, limited neon palette on a
> very dark navy background (#0d1220). Neon pink #ff4d6d, cyan #7bdff2, yellow
> #ffd43b, green #69db7c, purple #6a4c93. Simple geometric shapes, game-ready,
> centered, facing UP, transparent background, no shadow, no text, no gradient
> background, square 1:1 image, crisp edges, suitable for a small 32px character
> on a 1200x800 canvas.

## Files to generate

| Filename | Subject | Notes |
|---|---|---|
| `player.png` | Small sci-fi shooter Drone/pilot | Neon-pink and white body, visible gun barrel pointing UP, circular-ish, ~64x64 art inside 512x512 canvas. Must read clearly at 34px. |
| `enemy-crawler.png` | Basic swarm drone | Cyan, small, bug-like, simple. |
| `enemy-runner.png` | Fast darting drone | Orange, triangular/arrow shape pointing UP, sleeker than crawler. |
| `enemy-tank.png` | Heavy armored drone | Purple, chunky square armor, larger, imposing. |
| `enemy-spitter.png` | Ranged spore drone | Green, diamond shape with a small muzzle pointing UP. |
| `enemy-boss.png` | Boss war machine | Neon pink/red, large menacing mechanical eye, crown-like spikes, reads at 88px. |
| `bullet.png` | Player projectile | Yellow glowing energy bolt, pointing UP, small, mostly transparent canvas. |
| `bullet-hostile.png` | Enemy projectile | Red glowing bolt, pointing UP. |
| `bg-tile.png` | Floor tile (OPTIONAL) | 64x64 seamless dark navy tile with faint circuit/grid detail. If omitted, the game draws a grid. |

## Important generation tips

- Ask for **transparent background** explicitly. If the tool can't do transparency,
  ask for pure black (#000000) background and we can key it out.
- Generate one sprite per call; keep prompts short and consistent with the style block.
- Square images (512x512 or 1024x1024) work best; the game scales them down.
- If a sprite looks off, regenerate rather than editing — consistency matters more
  than detail at this size.

## When to generate

Now is a good time: the mechanics are built, so you can drop the files in and
immediately see them in game. The placeholders are intentionally simple so the
swap is instant.
