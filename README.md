# Emote Workshop — offline proof of concept

Open **Emote Workshop.html** in a current Chrome or Edge browser. It is self-contained: no installation, account, internet connection, or local server is required.

Choose **Try sample** to open GlorpWitch, import a file, drop one anywhere on the page, or paste an image from the clipboard. The editor accepts PNG, JPEG, GIF, WebP, AVIF, and MP4 files, including animated GIF, WebP, and AVIF sources. MP4 audio is ignored and video frames are sampled locally. Animated imports include start/end frame controls and a playable preview. Choose Twitch, Discord, or 7TV, adjust the framing, then export.

## Included

- Twitch packs at 112 × 112, 56 × 56, and 28 × 28.
- Discord emoji at 128 × 128 and Discord stickers at 320 × 320.
- 7TV uploads preserve the source aspect ratio (including wide emotes), without upscaling, up to 1000 × 1000, 7 MB (7,000,000 bytes), and 1000 exported frames. Static exports are PNG; animated exports are GIF. 7TV generates the final 1×–4× sizes itself; these are not bundled into the upload. The destination accent is `#7b3fc9`, darker than Twitch's `#9146ff`.
- Static sources export as PNG. Animated GIF, WebP, AVIF, and MP4 sources export as GIF for Twitch/Discord emoji and APNG for Discord stickers. AVIF is an import format, not an export format.
- Large source imports up to 100 MiB, 48 megapixels, and 20,000 pixels on either side. Image animations use at most 120 working frames and MP4 uses at most 240; both use an editing resolution up to 512 pixels on the longest side.
- Independent framing per destination, drag and keyboard positioning, center snapping with guides, rotation, horizontal flip, fit/fill, transparent-margin trimming, outlines, and brightness.
- Separate undo/redo history for every destination.
- Independent animation start/end selection for every destination, also respected by the all-destinations ZIP.
- Dark and light chat previews. Animated output plays in the preview.
- File dimensions and byte limits checked before download.
- Current-destination download and a ZIP containing all destinations.
- Local background processing. The content security policy blocks network connections from the app.

## Framing controls

- Click a slider's number to type an exact value. Press Enter or click away to apply; Escape cancels. Values are clamped to the slider's range and rounded to its step (including half-pixel outline widths). Animation frame fields follow the current range constraints.
- The small reset icon beside each number restores that control's default: scale 90%, rotation 0°, outline 0 px, brightness 100%, or the animation range boundary allowed by the destination. Framing/finish edits and resets work with undo/redo and do not reset other artwork settings.

- **Center image** changes only the horizontal and vertical position.
- **Height** stretches the artwork vertically from 100% (natural proportions) to 300%, independently of Scale. This makes wide emotes taller without cropping the sides; stronger values intentionally distort proportions. The reset returns to 100%. It applies to still/animated previews and exports, with independent settings per destination and undo/redo. 7TV’s canvas follows the adjusted aspect ratio within its resolution limit; explicit stretching can add vertical pixels but not new detail.
- **Fit** adds a small margin using the adjusted proportions. **Fill** fills the square for Twitch/Discord (up to 300% scale), cropping the longer side. For 7TV, **Fill** uses 100% scale on the adjusted-aspect-ratio canvas.
- **Ignore transparent margins** centers and sizes using visible artwork in Twitch and Discord modes, while keeping the square canvas. In 7TV mode, **Trim transparent space** also crops the canvas to visible artwork. The toggle is persistent, but disabled with “No transparent margins found” when the source has no removable margins. Animation bounds cover all retained working frames, including movement and transparent opening frames. The transparent padding added by a square output canvas is not a source margin.
- Transparency alone does not mean there are trimmable margins: artwork can touch every canvas edge while leaving transparent corners. The trim hint distinguishes this from an opaque source. GlorpWitch is an example of transparent artwork with full-canvas bounds. Bounds preserve a one-pixel safety border and all retained animation frames to avoid cutting off antialiasing or movement.
- **Reset rotation** changes only the angle. It does not move or resize the artwork.
- Drag near the horizontal or vertical center to snap to exact alignment. A guide appears while the pointer is held down.
- Arrow keys nudge the image. Hold Shift for a larger step.

## Animation notes

Trim animations using the thumbnail filmstrip’s start/end handles instead of separate range sliders. Excluded frames are shaded; dragging previews the boundary frame and restores the previous playing/paused state on release. Handles support arrow keys, Page Up/Down, and Home/End. Exact start/end frame entry and reset remain available. Filmstrip previews sample up to ten frames from the imported working animation, show original artwork rather than current effects, and fall back to handles/numeric fields if previews cannot load. Trimming supports undo/redo and destination-specific limits.

**Speed** ranges from 50% (half speed) to 150% (1.5×), with original speed at 100% in the middle. Type an exact percentage or use the reset icon. Speed is independent per destination and changes preview playback plus GIF/APNG export delays. Timing has a 20 ms minimum and export-format rounding, so already-fast frames may not get faster. Twitch/Discord frame selections are shortened as needed to stay within five seconds at the chosen speed; undo/redo restores speed and the frame selection together. 7TV has no five-second cap.

The large editor uses an 800-pixel-long-side preview for both still images and animation playback, preserving 7TV's canvas aspect ratio. Chat/output previews and downloaded files use destination resolutions separately. This avoids destination-dependent preview softness, but cannot add detail to a low-resolution source.

AVIF files are identified by their contents, including the `avis` sequence brand, rather than their filename or supplied MIME type. Animated AVIF requires browser support for `ImageDecoder` with `image/avif`; unsupported browsers show an error instead of silently importing only the first frame. The same image-animation editing limits apply to AVIF, GIF, and WebP.

Twitch and Discord animated exports can use a start/end range up to five seconds. 7TV has no five-second export cap. The editor still samples image animations to at most 120 working frames and MP4 to at most 240, at an editing resolution up to 512 pixels on the longest side; 7TV animation exports use that working resolution, not an upscaled 1000-pixel copy. These editing limits are separate from 7TV's upload limits. When needed, the encoder reduces frame count and color detail to meet each destination’s file-size limit. The output list shows the actual format and retained frame count. The editor, chat, and output thumbnails share a frame-controlled preview: Pause keeps the currently displayed frame, and Play continues from that position. Animation/video decoding and APNG encoding rely on browser media APIs available in current Chromium browsers.

## Development

The authored app is in `dist/`: `index.html`, `styles.css`, `app.js`, and `engine.js`. **Do not ignore `dist/` in Git**; it is source, not disposable build output. The used padded, optimized icon is `dist/assets/glorp-64.png`; its original source image is not included in this checkout. See [ASSETS.md](ASSETS.md) for artwork provenance and third-party notices. JSZip 3.10.1 is vendored locally with its license in `dist/vendor/JSZip-LICENSE.md`.

The generated **Emote Workshop.html** is intentionally committed so a checkout includes the ready-to-open offline edition. Rebuild it whenever app source changes; the freshness check rejects a stale copy without overwriting it. `.openai/hosting.json` is the existing optional static-hosting configuration and contains no credentials.

### Setup

Development requires Node.js 22 or newer. Install the pinned Node tools:

```text
npm ci
```

The app itself has no installed runtime dependencies. Playwright and Prettier are development-only tools. Browser tests use an installed Google Chrome by its Playwright channel, rather than a Windows-specific path. If Chrome is not installed, install it for testing with:

```text
npx playwright install chrome
```

On Linux, `npx playwright install --with-deps chrome` also installs the browser's system dependencies. The MP4 test requires a Chrome build supporting MP4 recording; the general Playwright Chromium build is not a guaranteed substitute. Set `CHROME_PATH` to an explicit compatible executable to override the default (including an installed Edge). Browser downloads/setup need internet access; running the application does not.

Independent GIF verification additionally requires Python 3.12 or newer and Pillow. Use a virtual environment and activate it for your shell, then install:

```text
python -m venv .venv
python -m pip install -r requirements-dev.txt
```

Activate `.venv` between those commands (`.\.venv\Scripts\Activate.ps1` in PowerShell, or `source .venv/bin/activate` on macOS/Linux). `npm run test:gif:verify` uses the `python` executable on your PATH.

Optional local server:

```text
npm run dev
```

Then open `http://127.0.0.1:4173/`. The app also works by opening `dist/index.html` directly.

After editing source files, rebuild the self-contained edition:

```text
npm run build
```

The generated **Emote Workshop.html** embeds the scripts, styles, sample artwork, logo, and content-security hashes.

### Verification

```text
npm run format
npm run build
npm run check
npm test
npm run test:gif:verify
```

- `format` formats authored JS, CSS, HTML, and documentation, excluding generated and vendored files.
- `check` checks production/tooling JS syntax, formatting, and offline-build freshness. It does not regenerate files.
- `test` checks deterministic offline packaging and read-only freshness rejection, then runs GIF encoding regression fixtures, AVIF import regressions, and browser tests against both `dist/index.html` and the offline HTML. Coverage includes MP4 conversion, file budgets, rectangular framing/snapping, separate destination trims/history, and downloads.
- `test:avif` checks real still/animated AVIF containers and isolated import routing, frame timing, dimension limits, unsupported-browser errors, and resource cleanup. It uses media-API test doubles rather than testing a browser codec. The tiny original fixtures in `tests/fixtures/` can be regenerated and independently decoded with `python tests/generate-avif-fixtures.py`.
- `test:preview` checks consistent still/animated editor resolution, separate destination-sized playback, paused frames, stale results, and preview URL cleanup with isolated test doubles.
- `test:sliders` checks exact numeric entry, range/step validation, Enter/Escape behavior, individual resets, undo grouping, import locks, and destination-specific animation bounds with isolated element doubles.
- `test:framing-hints` checks unavailable-trim feedback, destination/import states, vertical stretching transforms and validation, adjusted Fill scaling, and bounds across moving or transparent animation frames with isolated canvas/element doubles.
- `test:timeline` checks filmstrip sampling, stale thumbnail rejection and URL cleanup, keyboard/drag frame limits, boundary preview, import locks, and preview failure fallback with isolated UI/media doubles.
- `test:gif:verify` independently decodes the generated GIF fixtures with Pillow to check compositing, transparency, and timing. Run `npm test` or `npm run test:gif` first to create those fixtures.

Generated GIF outputs are under `tests/output/` and ignored by Git; the small AVIF input fixtures are tracked. Browser reports, dependencies, virtual environments, environment files, and editor-local files are ignored too. Keep the package lockfile and the rebuilt offline HTML in commits.

The GitHub Actions workflow runs these checks on pushes and pull requests; it does not publish or deploy anything. Its Linux execution has not been verified locally on this Windows workstation.
