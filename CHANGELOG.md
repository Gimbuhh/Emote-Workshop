# Changelog

All notable changes to Emote Workshop are documented here. Per-version notes are preserved under `release-notes/`. Dates below follow the repository's version commits.

## Unreleased

## 1.1.1 - 2026-09-17

### Added

- A visible version link beside the Emote Workshop title, opening this changelog on GitHub in a new tab.
- A root changelog and per-version release notes for the existing 1.0 and 1.1 versions.

Package version: `1.1.1`. [Release notes](release-notes/1.1.1.md).

## 1.1 - 2026-09-17

### Added

- Scroll over the image framing canvas to adjust Scale by one percentage point per vertical wheel event: up increases it, down decreases it, within the existing 10–300% limits.
- Wheel zoom uses the existing Scale control, updates previews, and supports per-destination settings and undo/redo. It is disabled during import/export and leaves horizontal-only scrolls and Ctrl/Command zoom gestures unchanged.
- Canvas instructions and an accessible label describing scroll zoom, plus regression coverage in the authored and offline editions.

Package version: `1.1.0`; Git tag: `v1.1`. [Release notes](release-notes/1.1.md).

## 1.0 - 2026-09-17

### Added

- A self-contained offline editor for Twitch emotes, Discord emoji/stickers, and 7TV emotes, with PNG, JPEG, GIF, WebP, AVIF, and MP4 imports.
- Per-destination framing and undo/redo, drag/keyboard positioning with center guides, Scale, independent Width/Height stretching, rotation, flip, fit/fill, transparent-margin trimming, outlines, and brightness.
- Animation trimming with a thumbnail timeline, exact frame entry, playback controls, and speed adjustment.
- Dark/light chat previews, destination-specific PNG/GIF/APNG exports, file dimension/size validation, and ZIP downloads.
- A deterministic offline build and automated syntax, formatting, packaging, media, and browser tests.

Package version: `1.0.0`; Git tag: `1.0`. [Release notes](release-notes/1.0.md).
