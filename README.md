# Emote Workshop

A self-contained, offline emote editor for Twitch, Discord, and 7TV. Open **Emote Workshop.html** in Chrome or Edge — no install, account, or internet connection required.

Import PNG, JPEG, GIF, WebP, AVIF, or MP4 (animated sources supported), pick a destination, adjust framing, and export:

- **Twitch** emote packs at 112×112, 56×56, 28×28
- **Discord** emoji at 128×128 and stickers at 320×320
- **7TV** up to 1000×1000 and 7 MB, preserving aspect ratio without upscaling

Features: per-destination framing and undo/redo, drag/keyboard positioning with snapping, rotation, flip, fit/fill, transparent-margin trimming, width/height stretching, outlines, brightness, animation trim (filmstrip with start/end handles), speed control, dark/light chat previews, and file size/dimension limit checks. Animated exports are GIF (Twitch/Discord emoji) or APNG (Discord stickers); static sources export as PNG. All processing is local — the content security policy blocks network access.

Choose **Try sample** to try it with the included sample artwork.

## Development

Requirements: Node.js 22+, and for the independent GIF verification Python 3.12+ with Pillow.

```text
npm ci
npm run dev        # optional local server at http://127.0.0.1:4173
npm run build      # rebuild Emote Workshop.html after editing dist/
npm run check      # syntax, formatting, offline-build freshness
npm test           # full test suite
npm run test:gif:verify  # independent GIF verification (needs Python + Pillow)
```

- `dist/` is authored source, not disposable build output — commit changes to it.
- **Emote Workshop.html** is generated but intentionally committed; rebuild it whenever `dist/` changes.
- `npm run format` formats; browser tests use an installed Chrome (`npx playwright install chrome`).
- The GitHub Actions workflow runs these checks on pushes and pull requests.
