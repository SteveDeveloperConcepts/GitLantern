"""Draw Git Steve's app icon and the Microsoft Store tile images.

Optional: the generated files are committed, so builds don't need this. Run it again after changing
the design (needs Python 3 and Pillow: `pip install pillow`):

    python scripts/make_icons.py

Writes build/icon.png (macOS, 1024 px), build/icon.ico (Windows) and build/appx/*.png (Store tiles).
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SUPERSAMPLE = 4

GRAPHITE_TOP = (46, 48, 54)
GRAPHITE_BOTTOM = (22, 23, 26)
AMBER_TOP = (244, 186, 88)
AMBER_BOTTOM = (226, 146, 42)
INK = (27, 20, 5)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, top, bottom):
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        draw.line([(0, y), (size, y)], fill=lerp(top, bottom, y / max(1, size - 1)) + (255,))
    return image


def mask(size, draw_shape):
    image = Image.new("L", (size, size), 0)
    draw_shape(ImageDraw.Draw(image))
    return image


def stroke(draw, points, width, fill):
    """A round-capped polyline: stamp circles along it so curves and ends stay smooth."""
    r = width / 2
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        steps = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 / (r / 3)))
        for i in range(steps + 1):
            t = i / steps
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def icon(size, tile=0.805):
    """The icon on a transparent square: a graphite tile holding an amber diamond with a branch glyph.

    `tile` is the share of the canvas the tile covers: 0.805 matches macOS's icon grid, Windows uses more.
    """
    s = size * SUPERSAMPLE
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # Graphite tile.
    side = s * tile
    inset = (s - side) / 2
    radius = side * 0.225
    tile_box = [inset, inset, s - inset, s - inset]
    out.paste(gradient(s, GRAPHITE_TOP, GRAPHITE_BOTTOM), (0, 0), mask(s, lambda d: d.rounded_rectangle(tile_box, radius, fill=255)))
    rim = ImageDraw.Draw(out)
    rim.rounded_rectangle(tile_box, radius, outline=(255, 255, 255, 28), width=max(1, round(side * 0.006)))

    # Amber diamond: a rounded square turned 45°.
    c = s / 2
    half = side * 0.32
    diamond = Image.new("L", (s, s), 0)
    ImageDraw.Draw(diamond).rounded_rectangle([c - half, c - half, c + half, c + half], half * 0.26, fill=255)
    diamond = diamond.rotate(45, resample=Image.BICUBIC, center=(c, c))
    out.paste(gradient(s, AMBER_TOP, AMBER_BOTTOM), (0, 0), diamond)

    # Branch glyph: a trunk with two commits and a branch curving off to a third.
    g = half * 1.3
    draw = ImageDraw.Draw(out)
    width = g * 0.11
    node = g * 0.125
    trunk_x = c - g * 0.22
    top, bottom = c - g * 0.36, c + g * 0.36
    tip = (c + g * 0.24, c - g * 0.16)
    stroke(draw, [(trunk_x, top), (trunk_x, bottom)], width, INK)
    start = (trunk_x, c + g * 0.22)
    control = (tip[0], start[1])
    curve = [
        ((1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t * t * tip[0],
         (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t * t * tip[1])
        for t in (i / 24 for i in range(25))
    ]
    stroke(draw, curve, width, INK)
    for x, y in [(trunk_x, top), (trunk_x, bottom), tip]:
        draw.ellipse([x - node, y - node, x + node, y + node], fill=INK)

    return out.resize((size, size), Image.LANCZOS)


def wide(width, height):
    """A wide tile: the icon centred on a transparent background."""
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mark = icon(height, tile=0.62)
    out.paste(mark, ((width - height) // 2, 0), mark)
    return out


def main():
    BUILD.mkdir(exist_ok=True)
    icon(1024).save(BUILD / "icon.png")

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico = [icon(n, tile=0.94) for n in ico_sizes]
    ico[-1].save(BUILD / "icon.ico", sizes=[(n, n) for n in ico_sizes], append_images=ico[:-1])

    appx = BUILD / "appx"
    appx.mkdir(exist_ok=True)
    for old in appx.glob("*.png"):
        old.unlink()
    squares = {"StoreLogo": 50, "Square44x44Logo": 44, "SmallTile": 71, "Square150x150Logo": 150, "LargeTile": 310}
    for name, base in squares.items():
        # Start-menu tiles get some breathing room; the small logos fill their square.
        tile = 0.62 if name in ("Square150x150Logo", "LargeTile", "SmallTile") else 0.94
        for scale in (100, 200):
            icon(base * scale // 100, tile).save(appx / f"{name}.scale-{scale}.png")
    for scale in (100, 200):
        wide(310 * scale // 100, 150 * scale // 100).save(appx / f"Wide310x150Logo.scale-{scale}.png")
    # Taskbar and Start list icons, with and without the system's coloured plate.
    for n in (16, 24, 32, 48, 256):
        image = icon(n, tile=0.94)
        image.save(appx / f"Square44x44Logo.targetsize-{n}.png")
        image.save(appx / f"Square44x44Logo.targetsize-{n}_altform-unplated.png")

    print(f"Wrote {BUILD / 'icon.png'}, {BUILD / 'icon.ico'} and {len(list(appx.glob('*.png')))} Store images in {appx}")


if __name__ == "__main__":
    main()
