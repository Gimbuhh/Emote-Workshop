# Changelog

All notable changes to Emote Workshop are documented here. Per-version notes are preserved under `release-notes/`. Dates below follow the repository's version commits.

## 1.3 - 2026-09-21

### Added

- **Import media** accepts 7TV emote page and CDN links and downloads a selected 1x–4x rendition for local editing, with 4x AVIF as the recommended default and WebP, GIF, and PNG options.
- Animated media imports decode frames in bounded parallel batches and report decode and transparency-analysis progress.
- 7TV exports have an AVIF-first format selector with explicit WebP and GIF choices. Unsupported animated AVIF encoding falls back to a locally encoded animated WebP, then GIF, and the actual result is shown before download.

### Changed

- Discord and Twitch animation ranges are no longer cut off at five seconds. The exporter preserves the selected duration when it fits, then samples frames and reduces palette detail as needed to meet each destination's file-size and frame-count limits.

### Fixed

- The plus badge in the empty import control is optically centered.
- The file-name field uses one contained focus ring instead of a wide double border.
- Framing toggles have padded, rounded hover and active surfaces that no longer stop abruptly at their content edges.
- Imported animations begin playing as soon as decoding finishes, continue uninterrupted when export preparation completes, and hand over to processed playback only after an edit or explicit interaction.
- The canvas playback control keeps a fixed width so switching between **Play** and **Pause** no longer shifts the adjacent **Compare** button.
- Discord stickers use filtered APNG delta frames so localized motion can remain at 320×320 with its full duration while fitting the 512 KB upload limit.

Package version: `1.3.0`; Git tag: `v1.3`. [Release notes](release-notes/1.3.md).

## 1.2 - 2026-09-20

### Added

- An optional **Keep canvas filled** framing control dynamically updates Scale when Width or Height changes.
- A **Compare** mode shows the untouched source beside the actual converted output, with synchronized animation playback and a compact Original/Converted switch on mobile.
- Original and converted file formats and sizes are shown together, including the percentage saved or added.
- A labeled GitHub link in the app header opens the Emote Workshop repository.

### Changed

- The editor has a cleaner, denser layout with larger control text, clearer supporting copy, and destination-specific Discord, 7TV, and Twitch accents.
- Canvas animation playback and chat Preview animation playback now have independent controls and state.
- A selected animation range can be dragged as a single block with mouse, touch, or keyboard controls.
- Animation speed changes now adjust the end of Discord and Twitch selections in both directions, trimming when slowed and restoring eligible frames when sped up while respecting the five-second limit.
- Animated AVIF and GIF conversions retain smoother motion where the file-size limit allows and reduce palette detail before dropping additional frames.
- Precision-trackpad zoom now uses gentler accumulation for slow movement and proportional multi-step zoom for faster gestures, while conventional wheel input remains one step per notch.

### Fixed

- 7TV output dimensions are now fitted inside a strict sub-3:1 canvas so wide and tall exports meet the service's upload constraint.
- The version link now opens the main changelog instead of an invalid release-section URL.

### Documentation

- The README now starts with a website-first usage guide, documents the updated editing workflow, and includes a current screenshot of the working editor.

Package version: `1.2.0`; Git tag: `v1.2`. [Release notes](release-notes/1.2.md).

## 1.1.1 - 2026-09-19

### Added

- A header link showing the exact installed version and opening its matching immutable GitHub Release.

### Changed

- Precision-trackpad scrolling now accumulates small movements before applying a one-point Scale change, while discrete mouse-wheel input remains one step per event.

### Fixed

- Twitch packs now enforce the current manual-upload limits for static and animated emotes, including the 512 KB and 60-frame animated limits.
- Very long 7TV animations preserve their encoded GIF timing instead of overflowing the format's per-frame delay field.

### Security

- Animation rendering now samples oversized frame plans before allocating output frames, and MP4 handoff validates decoded-frame count, dimensions, total pixels, and timing metadata.

Package version: `1.1.1`; Git tag: `v1.1.1`. [Release notes](release-notes/1.1.1.md).

## 1.1 - 2026-09-17

### Added

- Scroll over the image framing canvas to adjust Scale by one percentage point per vertical wheel event, within the existing 10–300% limits and with per-destination undo/redo support.
- Canvas instructions and accessible text describing the new scroll-to-zoom control.

Package version: `1.1.0`; Git tag: `v1.1`. [Release notes](release-notes/1.1.md).

## 1.0 - 2026-09-17

### Added

- A self-contained offline editor for Twitch emotes, Discord emoji/stickers, and 7TV emotes, with PNG, JPEG, GIF, WebP, AVIF, and MP4 imports.
- Per-destination framing and undo/redo, drag/keyboard positioning with center guides, Scale, independent Width/Height stretching, rotation, flip, fit/fill, transparent-margin trimming, outlines, and brightness.
- Animation trimming with a thumbnail timeline, exact frame entry, playback controls, and speed adjustment.
- Dark/light chat previews, destination-specific PNG/GIF/APNG exports, file dimension/size validation, and ZIP downloads.
- A deterministic offline build and automated syntax, formatting, packaging, media, and browser tests.

Package version: `1.0.0`; Git tag: `1.0`. [Release notes](release-notes/1.0.md).
