# Branding

The reddont mark is a speech bubble holding an R, cut by a diagonal slash.
Every file here is drawn from the same vector paths as `reddont.svg`, the
editable master.

## Files

| File | Use |
| --- | --- |
| `reddont.svg` | The mark on a transparent background. |
| `reddont-64.png` to `reddont-1024.png` | Transparent PNGs at 64, 128, 256, 512, and 1024 px. The readme shows the 64 px file at 32 px. |
| `reddont-white.svg`, `reddont-ink.svg` | One-color marks for colored or photo backgrounds. Change the path's `fill` to recolor them. |
| `reddont-wordmark-on-light.*`, `reddont-wordmark-on-dark.*` | The mark and name for light and dark backgrounds, as SVG and as 1420 × 320 PNG. |
| `reddont-app-dark.svg`, `reddont-app-light.svg` | Square tiles with the mark on ink or warm light. |
| `reddont-maskable.svg` | An ink tile with the mark inside the maskable safe zone. |

The tiles keep square corners so each platform can apply its own shape.

## Copies in the app and docs

The app and the documentation site serve their own copies. After changing a
source here, export it again to these paths:

| Path | Source |
| --- | --- |
| `src/public/favicon.svg` | `reddont.svg`; also the desktop header logo |
| `src/public/favicon.ico` | `reddont.svg` at 16, 32, 48, and 64 px |
| `src/public/apple-touch-icon.png` | `reddont-app-dark.svg` at 180 px |
| `src/public/icons/icon-192.png`, `icon-512.png` | `reddont-app-dark.svg` |
| `src/public/icons/icon-maskable-192.png`, `icon-maskable-512.png` | `reddont-maskable.svg` |
| `docs/assets/logo.svg` | `reddont.svg`; the documentation logo and favicon |

The PNGs were rendered with librsvg, for example:

```sh
rsvg-convert -w 512 -h 512 reddont-app-dark.svg -o ../src/public/icons/icon-512.png
```

## Colors

| Color | Hex |
| --- | --- |
| Orange | `#FF4F00` |
| Ink | `#17191D` |
| Warm light | `#FFF6F0` |
| White | `#FFFFFF` |
