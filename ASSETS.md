# Artwork and third-party assets

## Glorp artwork

`dist/assets/glorp-64.png` is the padded, optimized favicon/header image. It was
derived from an earlier `glorp.png`; the original image is not currently included
in this checkout. The creator, original source URL, and permission terms were not
provided; they remain unverified.
Do not treat its presence here as an open-source artwork license. Confirm those
details before redistributing the artwork or making the repository public.

The unused intermediate `dist/assets/glorp.png` has been removed.

## Sample artwork

`dist/sample.js` contains **GlorpWitch**, supplied by the user as `GlorpWitch.png`,
embedded as a 128 × 128 lossless WebP (13,980 bytes). Its RGBA pixels and transparency
are unchanged; metadata is omitted. It replaces the earlier AI-generated sample.
The original PNG is not included in the checkout. Regenerate the embedded sample
with `python scripts/optimize-sample.py <path-to-GlorpWitch.png>` using the pinned
Pillow development dependency, then rebuild the offline edition.

The artwork's original creator/source and permission terms have not been provided.
Confirm and record them before redistributing it. The offline build embeds the
same sample; it does not fetch artwork from the network.

## JSZip

`dist/vendor/jszip.min.js` is JSZip **3.10.1**, vendored for offline ZIP generation.
Its upstream URL is <https://github.com/Stuk/jszip>. The upstream copyright and
license header are retained, and the accompanying license text is in
`dist/vendor/JSZip-LICENSE.md`. Do not format or strip the vendored library header.

No project-wide license has been selected. Keep third-party notices separate from
any license chosen for the authored application code.
