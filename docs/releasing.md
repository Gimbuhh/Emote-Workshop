# Releasing

1. Start from the latest verified release and make application changes on a version-specific branch, such as `release/1.4`.
2. Update the authoritative version in `package.json` and `package-lock.json`.
3. Display the release version in the header and link it to `CHANGELOG.md` on GitHub without a section anchor.
4. Add a release-note file and a matching dated `CHANGELOG.md` entry. Use the displayed two-part version for an established `.0` release (`release-notes/1.1.md` for package `1.1.0`) and the full version for patch releases (`release-notes/1.1.1.md`). Both describe published-version-to-published-version user outcomes; omit test-only and repository-maintenance work.
5. Run `npm run build` after changes to authored editor files or hosted resolver source. Commit the regenerated standalone HTML when it changes; leave generated `dist/server/` output ignored.
6. Run `npm run check`, `npm test`, and `npm run test:gif:verify`.
7. Refresh the README screenshot with `npm run docs:screenshot` when the displayed version or interface changes, then run `npm run release:verify -- <version>` before committing the release. GitHub Actions runs the same release metadata check.
8. Commit the complete release, then create an immutable `v<version>` tag. For `.0` releases that historically use a two-part display, the verifier derives the established two-part tag.
9. Run `npm run release:verify -- <version> --require-tag` to prove that the tag points at the verified release commit.
10. Push the branch and tag, create the GitHub Release from the matching release-note file, and attach `Emote Workshop.html`. Verify the downloaded artifact before making the release public. Merge the verified release branch into `main` so the README and the editor's changelog link describe the released version.

Do not move or replace a published tag. Correct mistakes in a new patch release.

## Twitter/X import in 1.4

The website and standalone HTML resolve public post URLs through `https://emotes.gimba.uk/api/twitter`. Development with `npm run dev` uses the guarded local resolver. Direct `video.twimg.com` MP4 links bypass both resolvers. Verify post import from a local HTML file, the hosted website, and the local server, including unavailable-post recovery and animated GIF export.

`npm run build` produces both `Emote Workshop.html` and the Worker entrypoint at `dist/server/index.js`. The hosted Worker serves the editor and a public, CORS-enabled metadata-only route; it embeds the authored assets so no runtime storage or additional bindings are required. Publish it through the existing Site identified by `.openai/hosting.json`, preserving the Site's access settings.

## Existing 1.4 publication

The [updated 1.4 HTML download](https://github.com/Gimbuhh/Emote-Workshop/releases/download/v1.4/Emote.Workshop.html) and hosted editor include the hosted Twitter resolver. Their matching [published source revision](https://github.com/Gimbuhh/Emote-Workshop/tree/c3c1ffa26520147167f7cde034392e1d3086a4d2) is on `release/1.4`.

The original published `v1.4` tag still points to `c624f2e`, whose source archives contain the initial local-server import. Preserve that tag. The updated release notes identify the source revision for the replacement HTML; downloading the tag's source archive does not include the hosted update.

`release:verify -- 1.4.0` checks version metadata and standalone build freshness. Adding `--require-tag` also requires HEAD to equal the tagged commit, so it intentionally fails on the updated `release/1.4` branch. Keep that stricter check for new release tags.
