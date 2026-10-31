# Turns a flat #00FF00 background into transparency (needs Pillow and numpy), the step between Codex image generation and
# public/art/characters/owner-*. Usage: python3 scripts/chroma-key.py in.png out.png [WIDTHxHEIGHT]
# The optional size resamples (Lanczos) before keying; the matte is eroded one pixel and green spill is clamped to the larger of red and blue.
import sys
import numpy as np
from PIL import Image, ImageFilter

source, target = sys.argv[1], sys.argv[2]
image = Image.open(source).convert('RGB')
if len(sys.argv) > 3: image = image.resize(tuple(int(v) for v in sys.argv[3].split('x')), Image.LANCZOS)
rgb = np.array(image).astype(np.float32)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
greenness = g - np.maximum(r, b)
alpha = np.clip(1 - (greenness - 30) / 80, 0, 1)
alpha = np.array(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))).astype(np.float32) / 255
out = np.dstack([r, np.where(g > np.maximum(r, b), np.maximum(r, b), g), b])
rgba = np.dstack([out, alpha * 255]).astype(np.uint8)
rgba[alpha == 0, :3] = 0
Image.fromarray(rgba, 'RGBA').save(target, optimize=True)
