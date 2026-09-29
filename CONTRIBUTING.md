# Contributing

Thank you for helping improve Emote Workshop.

## Before opening a change

- Use an existing issue or open a focused bug report for behavior changes.
- Treat the editor files in `dist/` as canonical source. `dist/server/` is generated and ignored; `Emote Workshop.html` is generated and intentionally committed. Do not edit either generated output by hand.
- Keep media processing local. Approved runtime network access is user-initiated link import: downloads from `cdn.7tv.app` and `video.twimg.com`, plus public post metadata from `cdn.syndication.twimg.com` through the hosted `emotes.gimba.uk/api/twitter` resolver or loopback-only development server. The resolver accepts numeric post IDs and returns a supported media URL; it never proxies media or fetches a user-provided URL. Do not add telemetry, other runtime network requests, browser persistence, or runtime dependencies without prior discussion.
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

Include focused tests for changed behavior. When authored editor files change, run `npm run build` and commit the deterministically regenerated `Emote Workshop.html`. Changes to `site-worker.mjs` or `twitter-import.mjs` require rebuilding the hosted Worker; keep its generated `dist/server/` output ignored.

## Pull requests

Describe the user-visible problem, the chosen behavior, and the verification performed. Keep unrelated formatting and refactoring out of the same pull request. Releases and tags are created only through the maintainer release process.
