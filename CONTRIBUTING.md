# Contributing

Thank you for helping improve Emote Workshop.

## Before opening a change

- Use an existing issue or open a focused bug report for behavior changes.
- Treat `dist/` as canonical source. `Emote Workshop.html` is generated and must not be edited by hand.
- Keep imported media local. Do not add telemetry, runtime network requests, browser persistence, or runtime dependencies without prior discussion.
- Preserve the documented artwork permissions and third-party notices.

## Development

Use npm for JavaScript dependencies and repository scripts. Python 3.12 with the pinned Pillow dependency is required only for independent GIF verification and sample optimization.

```sh
npm ci
python -m pip install -r requirements-dev.txt
npm run check
npm test
npm run test:gif:verify
```

Include focused tests for changed behavior. When `dist/` changes, run `npm run build` and commit the deterministically regenerated `Emote Workshop.html`.

## Pull requests

Describe the user-visible problem, the chosen behavior, and the verification performed. Keep unrelated formatting and refactoring out of the same pull request. Releases and tags are created only through the maintainer release process.
