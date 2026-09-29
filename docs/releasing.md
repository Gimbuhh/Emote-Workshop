# Releasing

1. Start from the latest verified release and make application changes on a version-specific branch, such as `release/1.4`.
2. Update the authoritative version in `package.json` and `package-lock.json`.
3. Display the release version in the header and link it to `CHANGELOG.md` on GitHub without a section anchor.
4. Add a release-note file and a matching dated `CHANGELOG.md` entry. Use the displayed two-part version for an established `.0` release (`release-notes/1.1.md` for package `1.1.0`) and the full version for patch releases (`release-notes/1.1.1.md`). Both describe published-version-to-published-version user outcomes; omit test-only and repository-maintenance work.
5. Run `npm run build` after any `dist/` change.
6. Run `npm run check`, `npm test`, and `npm run test:gif:verify`.
7. Refresh the README screenshot with `npm run docs:screenshot` when the displayed version or interface changes, then run `npm run release:verify -- <version>` before committing the release. GitHub Actions runs the same release metadata check.
8. Commit the complete release, then create an immutable `v<version>` tag. For `.0` releases that historically use a two-part display, the verifier derives the established two-part tag.
9. Run `npm run release:verify -- <version> --require-tag` to prove that the tag points at the verified release commit.
10. Push the branch and tag, create the GitHub Release from the matching release-note file, and attach `Emote Workshop.html`. Verify the downloaded artifact before making the release public.

Do not move or replace a published tag. Correct mistakes in a new patch release.

## Twitter/X import in 1.4

The standalone HTML supports direct `video.twimg.com` MP4 links. Public post URLs use the local resolver started with `npm run dev`; static hosting alone does not enable post import. The resolver is written with web APIs so it can be reused in a future hosted route, but that deployment is separate from this release. Keep this distinction in release notes and verify both the standalone editor and local-server workflow before publishing.
