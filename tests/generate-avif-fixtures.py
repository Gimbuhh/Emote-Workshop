"""Generate tiny original AVIF fixtures with Pillow, without external artwork."""

from pathlib import Path

from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parent / "fixtures"
destination.mkdir(exist_ok=True)
frames = []
for position, color in enumerate(["red", "green", "blue"]):
    image = Image.new("RGBA", (32, 16))
    ImageDraw.Draw(image).rectangle((position * 8, 4, position * 8 + 7, 11), fill=color)
    frames.append(image)
frames[0].save(destination / "still.avif", quality=100, subsampling="4:4:4")
frames[0].save(
    destination / "animated.avif",
    save_all=True,
    append_images=frames[1:],
    duration=[80, 160, 240],
    quality=100,
    subsampling="4:4:4",
)
for name, count in [("still.avif", 1), ("animated.avif", 3)]:
    with Image.open(destination / name) as decoded:
        assert decoded.size == (32, 16)
        assert decoded.n_frames == count
        for index in range(count):
            decoded.seek(index)
            rgba = decoded.convert("RGBA")
            assert rgba.getpixel((31, 0))[3] == 0
            assert rgba.getpixel((index * 8 + 4, 8))[3] == 255
print("Generated and independently decoded static/animated AVIF fixtures")
