# Releasing

1. Start from the latest verified release and make application changes on a version-specific branch, such as `release/1.4`.
2. Update the authoritative version in `package.json` and `package-lock.json`.
3. Display the release version in the header and link it to `CHANGELOG.md` on GitHub without a section anchor.
4. Add a release-note file and a matching dated `CHANGELOG.md` entry. Use the displayed two-part version for an established `.0` release (`release-notes/1.1.md` for package `1.1.0`) and the full version for patch releases (`release-notes/1.1.1.md`). Both describe published-version-to-published-version user outcomes; omit test-only and repository-maintenance work.
5. Run `npm run build` after changes to authored editor files or hosted resolver source. Commit the regenerated standalone HTML when it changes; leave generated `dist/server/` output ignored.
6. Run `npm run check`, `npm test`, and `npm run test:gif:verify`.
7. Refresh the README screenshot with `npm run docs:screenshot` when the displayed version or interface changes, then run `npm run release:verify -- <version>` before committing the release. GitHub Actions runs the same release metadata check.
8. Commit and push the complete release branch, then open a pull request into `main`.
9. Wait for required checks and review, then merge the release branch into `main`. Check out the merged release commit and rerun `npm run release:verify -- <version>`.
10. Create an immutable `v<version>` tag at that merged release commit. For `.0` releases that historically use a two-part display, the verifier derives the established two-part tag. Run `npm run release:verify -- <version> --require-tag` to prove that the tag points at the verified release commit.
11. Push the tag, create the GitHub Release from the matching release-note file, and attach `Emote Workshop.html`. Verify the downloaded HTML and the tag's source archive against the merged release commit before making the release public.

Do not move or replace a published tag. Correct mistakes in a new patch release.

## Twitter/X import in 1.4

The website and standalone HTML resolve public post URLs through `https://emotes.gimba.uk/api/twitter`. Direct `video.twimg.com` MP4 links bypass the resolver. Verify post import from a local HTML file and the hosted website, including unavailable-post recovery and animated GIF export. For local development, open `dist/index.html` in Chrome or Edge.

`npm run build` produces both `Emote Workshop.html` and the Worker entrypoint at `dist/server/index.js`. The hosted Worker serves the editor and a public, CORS-enabled metadata-only route; it embeds the authored assets so no runtime storage or additional bindings are required. Publish it through the existing Site identified by `.openai/hosting.json`, preserving the Site's access settings.
