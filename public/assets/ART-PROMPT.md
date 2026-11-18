# Exact prompt for an image model (DeepSeek-v4.1 or similar)

Paste the whole block below. It asks for all 9 sprites with exact filenames.

```
Create a complete 9-piece sprite set for a top-down 2D browser shooter called RECOIL.
Generate each item as a SEPARATE square 1:1 PNG image with a TRANSPARENT background,
512x512 or 1024x1024, centered, no text, no borders, no background scenery, no drop
shadow. Label each output with its exact filename.

GLOBAL ART STYLE (apply to every image):
Top-down orthographic overhead view, clean vector-like digital painting, bold readable
silhouette, thick dark outline, limited neon sci-fi palette: neon pink #ff4d6d, cyan
#7bdff2, yellow #ffd43b, green #69db7c, purple #6a4c93, orange #ff9f1c, on a dark navy
#0d1220 world. Simple geometric drone/machine designs, crisp edges, game-ready sprites
that stay readable when scaled down to 32-88 pixels. Every character faces UP.

THE 9 FILES:

1. player.png - small player combat drone: compact rounded pink and white body, one
   clearly visible gun barrel pointing straight UP, cyan visor. Reads at 34px.
2. enemy-crawler.png - basic weak cyan bug-like swarm drone with two antennae.
3. enemy-runner.png - fast orange sleek triangular arrow drone pointing UP.
4. enemy-tank.png - heavy purple chunky square armored drone, bulky and imposing.
5. enemy-spitter.png - green diamond-shaped ranged drone with a small muzzle pointing UP.
6. enemy-boss.png - large menacing pink-red boss war machine, glowing eye, crown spikes.
7. bullet.png - single small yellow glowing energy bolt pointing UP, mostly empty canvas.
8. bullet-hostile.png - single small red glowing energy bolt pointing UP, mostly empty canvas.
9. bg-tile.png - seamless 64x64 dark navy #0d1220 floor tile with faint circuit grid lines.

IMPORTANT: transparent background on every image. One image per file. Keep style
identical across all 9. No text or watermarks.
```

## If the model generates one image at a time

Paste the GLOBAL ART STYLE block, then append one line:

- `player.png` - A small player combat drone: pink and white rounded body, visible gun barrel pointing up, cyan visor.
- `enemy-crawler.png` - A small weak cyan bug-like swarm drone with two antennae.
- `enemy-runner.png` - A fast orange sleek triangular arrow drone pointing up.
- `enemy-tank.png` - A heavy chunky purple square armored drone.
- `enemy-spitter.png` - A green diamond-shaped ranged drone with a small muzzle pointing up.
- `enemy-boss.png` - A large menacing pink-red mechanical boss with a glowing eye and crown spikes.
- `bullet.png` - A single small yellow glowing energy bolt pointing up on a transparent canvas.
- `bullet-hostile.png` - A single small red glowing energy bolt pointing up on a transparent canvas.
- `bg-tile.png` - A seamless dark navy floor tile with faint circuit grid lines.

## Where to save

Save all files in this folder with these exact names (lowercase):

```
player.png
enemy-crawler.png
enemy-runner.png
enemy-tank.png
enemy-spitter.png
enemy-boss.png
bullet.png
bullet-hostile.png
bg-tile.png
```

Refresh the game and the PNGs replace the built-in SVGs automatically.

If transparency isn't supported, use a pure black (#000000) background instead
and we'll key it out.
