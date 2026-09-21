# Artwork and third-party assets

## Glorp artwork

`dist/assets/glorp-64.png` is the padded, optimized favicon/header image. It was
derived from an earlier `glorp.png`; the original image is not currently included
in this checkout. The repository owner has confirmed that they have permission to
redistribute this artwork as part of Emote Workshop. The artwork is not granted
under the project's MIT license unless its rights holder states otherwise.

The unused intermediate `dist/assets/glorp.png` has been removed.

## Sample artwork

`dist/sample.js` contains **GlorpWitch**, supplied by the user as `GlorpWitch.png`,
embedded as a 128 × 128 lossless WebP (13,980 bytes). Its RGBA pixels and transparency
are unchanged; metadata is omitted. It replaces the earlier AI-generated sample.
The original PNG is not included in the checkout. Regenerate the embedded sample
with `python scripts/optimize-sample.py <path-to-GlorpWitch.png>` using the pinned
Pillow development dependency, then rebuild the offline edition.

`docs/images/emote-workshop-v1.3.png` is a browser screenshot of the authored app using
the bundled GlorpWitch sample. Regenerate it with `npm run docs:screenshot` after a
material interface change. The sample artwork shown in the screenshot remains
covered by the same permission described above.

The repository owner has confirmed that they have permission to redistribute the
sample as part of Emote Workshop. The artwork is not granted under the project's
MIT license unless its rights holder states otherwise. The offline build embeds
the same sample; it does not fetch artwork from the network.

## JSZip

`dist/vendor/jszip.min.js` is JSZip **3.10.1**, vendored for offline ZIP generation.
Its upstream URL is <https://github.com/Stuk/jszip>. The upstream copyright and
license header are retained, and the accompanying license text is in
`dist/vendor/JSZip-LICENSE.md`. Do not format or strip the vendored library header.

The authored application code and documentation are available under the repository's
MIT license. The separately documented artwork permission and JSZip license remain
in effect for those assets.
