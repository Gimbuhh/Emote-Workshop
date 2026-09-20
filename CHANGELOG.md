# Changelog

All notable changes to Emote Workshop are documented here. Per-version notes are preserved under `release-notes/`. Dates below follow the repository's version commits.

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
