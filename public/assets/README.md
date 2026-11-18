# Assets

The game ships with hand-built **SVG** sprites (no external art needed). Each
sprite is loaded as `name.png` first, then `name.svg` — so if you drop a PNG with
the same base name in here, it automatically replaces the SVG. No code changes.

## Current files

| Sprite | What it is |
|---|---|
| `player.svg` | Player drone (pink/white, gun pointing up, cyan visor) |
| `enemy-crawler.svg` | Basic cyan swarm drone |
| `enemy-runner.svg` | Fast orange arrow drone |
| `enemy-tank.svg` | Heavy purple armored drone |
| `enemy-spitter.svg` | Green diamond drone with muzzle |
| `enemy-boss.svg` | Large pink-red boss with eye and crown spikes |
| `bullet.svg` | Yellow player projectile |
| `bullet-hostile.svg` | Red enemy projectile |
| `bg-tile.svg` | Dark navy floor tile with faint grid |

## Swapping in generated art (DeepSeek / any model)

Name the output files `player.png`, `enemy-crawler.png`, etc. and drop them in
this folder. PNGs take priority over the SVGs. Keep them square, transparent
background, facing **up**.

See `ART-PROMPT.md` for the exact prompt to send to an image model.
