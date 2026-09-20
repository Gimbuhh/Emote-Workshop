# Releasing

1. Start from the latest verified release and make application changes on a version-specific branch.
2. Update the authoritative version in `package.json` and `package-lock.json`.
3. Display the release version in the header and link it to that version's dated entry in `CHANGELOG.md` on GitHub.
4. Add a release-note file and a matching dated `CHANGELOG.md` entry. Use the displayed two-part version for an established `.0` release (`release-notes/1.1.md` for package `1.1.0`) and the full version for patch releases (`release-notes/1.1.1.md`). Both describe published-version-to-published-version user outcomes; omit test-only and repository-maintenance work.
5. Run `npm run build` after any `dist/` change.
6. Run `npm run check`, `npm test`, and `npm run test:gif:verify`.
7. Run `npm run release:verify -- <version>` before committing the release.
8. Commit the complete release, then create an immutable `v<version>` tag. For `.0` releases that historically use a two-part display, the verifier derives the established two-part tag.
9. Run `npm run release:verify -- <version> --require-tag` to prove that the tag points at the verified release commit.
10. Push the branch and tag, create the GitHub Release from the matching release-note file, and attach `Emote Workshop.html`. Verify the downloaded artifact before making the release public.

Do not move or replace a published tag. Correct mistakes in a new patch release.
