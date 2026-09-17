"""Independent GIF decoding, compositing, timing and color-error checks."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageSequence

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'tests/output')
for case in json.loads((root / 'manifest.json').read_text()):
    name = case['kind']
    size = case['width'] * case['height'] * 4
    expected = (root / f'{name}.expected').read_bytes()
    original = (root / f'{name}.rgba').read_bytes()
    with Image.open(root / f'{name}.gif') as image:
        frames = [frame.convert('RGBA').tobytes() for frame in ImageSequence.Iterator(image)]
        assert len(frames) == case['frames'], name
        duration = sum(frame.info['duration'] for frame in ImageSequence.Iterator(image))
        assert duration == case['duration'], (name, duration)
        for i, pixels in enumerate(frames):
            assert pixels == expected[i*size:(i+1)*size], (name, i, 'composited pixels')
    def mse(decoded):
        return sum((a-b)**2 for i, pixels in enumerate(decoded) for p, (a,b) in enumerate(zip(pixels, original[i*size:(i+1)*size])) if p%4 != 3) / (len(decoded)*size*3/4)
    error = mse(frames)
    old_path = root / f'{name}.old.gif'
    if old_path.exists():
        with Image.open(old_path) as image:
            old_error = mse([frame.convert('RGBA').tobytes() for frame in ImageSequence.Iterator(image)])
        if name == 'rare-colors':
            assert error < old_error, (name, error, old_error)
        print(f'{name}: {case["oldBytes"]:,} -> {case["bytes"]:,} bytes; RGB MSE {old_error:.2f} -> {error:.2f}; timing/compositing OK')
    else:
        print(f'{name}: timing/compositing OK; RGB MSE {error:.2f}')
