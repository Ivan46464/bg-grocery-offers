"""
Generates the app icons from code so they match the theme (run once; outputs PNGs next to this file).

    python make_icons.py

Design: dark navy rounded square, a teal price tag tilted 20° with a white "€" in it
and a small amber dot (the tag's hole). Android adaptive icon = same glyph on a plain
navy background with extra safe-zone padding.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
NAVY = (11, 18, 32, 255)
TEAL = (20, 184, 166, 255)
TEAL_DARK = (13, 148, 136, 255)
AMBER = (245, 158, 11, 255)
WHITE = (255, 255, 255, 255)

FONT_CANDIDATES = [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "DejaVuSans-Bold.ttf"]


def font(size: int) -> ImageFont.FreeTypeFont:
    for f in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def tag_glyph(size: int, scale: float = 1.0) -> Image.Image:
    """Transparent square with the tilted price tag centred; `scale` shrinks it for safe zones."""
    S = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w, h = S * 0.62 * scale, S * 0.40 * scale
    cx, cy = S / 2, S / 2
    # tag body: rounded rect with a pointed left end
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    tip = h * 0.5
    bd.rounded_rectangle([x0 + tip, y0, x1, y1], radius=h * 0.18, fill=TEAL)
    # the triangle overlaps well past the rounded corners so no notch shows at the joint
    bd.polygon([(x0, cy), (x0 + tip + h * 0.3, y0), (x0 + tip + h * 0.3, y1)], fill=TEAL)
    # hole
    r = h * 0.09
    bd.ellipse([x0 + tip * 0.75 - r, cy - r, x0 + tip * 0.75 + r, cy + r], fill=AMBER)
    # euro sign
    f = font(int(h * 0.78))
    txt = "€"
    bb = bd.textbbox((0, 0), txt, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    bd.text((x0 + tip + (w - tip) / 2 - tw / 2 - bb[0], cy - th / 2 - bb[1]), txt, font=f, fill=WHITE)
    # subtle shadow then rotate
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x0 + tip, y0 + S * 0.02, x1, y1 + S * 0.02], radius=h * 0.18, fill=(0, 0, 0, 70))
    sd.polygon([(x0, cy + S * 0.02), (x0 + tip + h * 0.3, y0 + S * 0.02), (x0 + tip + h * 0.3, y1 + S * 0.02)], fill=(0, 0, 0, 70))
    img.alpha_composite(shadow.rotate(-18, resample=Image.BICUBIC, center=(cx, cy)))
    img.alpha_composite(body.rotate(-18, resample=Image.BICUBIC, center=(cx, cy)))
    return img.resize((size, size), Image.LANCZOS)


def rounded_bg(size: int, radius_ratio: float = 0.22) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=NAVY)
    return img


def main() -> None:
    # App icon (iOS / fallback): 1024x1024, opaque rounded square look
    icon = Image.new("RGBA", (1024, 1024), NAVY)
    icon.alpha_composite(tag_glyph(1024, 0.95))
    icon.save(HERE / "icon.png")

    # Android adaptive: foreground glyph (keep inside the 66% safe zone), plain backgrounds
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    fg.alpha_composite(tag_glyph(1024, 0.62))
    fg.save(HERE / "android-icon-foreground.png")
    Image.new("RGBA", (1024, 1024), NAVY).save(HERE / "android-icon-background.png")
    mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    g = tag_glyph(1024, 0.62)
    alpha = g.getchannel("A")
    mono.paste(Image.new("RGBA", (1024, 1024), WHITE), mask=alpha)
    mono.save(HERE / "android-icon-monochrome.png")

    # Splash icon + favicon
    splash = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    splash.alpha_composite(tag_glyph(1024, 0.6))
    splash.save(HERE / "splash-icon.png")
    fav = rounded_bg(96)
    fav.alpha_composite(tag_glyph(96, 0.95))
    fav.save(HERE / "favicon.png")
    print("icons written to", HERE)


if __name__ == "__main__":
    main()
