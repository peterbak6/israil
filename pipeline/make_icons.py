"""Write the app icons into public/.

The mark: a closed S (two 290-degree arcs, blue then orange: two trains, one change),
a white station dot at each end and in the centre, and a straight white line with a black
outline through the three dots (the schematic laid over the real track).

Needs rsvg-convert (librsvg) and ImageMagick's `convert` on PATH.
Run from the repository root:  python3 pipeline/make_icons.py
"""
import math
import pathlib
import subprocess
import tempfile

OUT = pathlib.Path("public")
BG, INK, BLUE, ORANGE = "#ffffff", "#111111", "#1f6feb", "#f08c00"
R, C = 34, 90                      # arc radius, centre of the 180x180 canvas
END = math.radians(20)             # where the top arc ends (how closed the S is)

t1 = (C + R * math.cos(END), (C - R) + R * math.sin(END))
t2 = (2 * C - t1[0], 2 * C - t1[1])  # point-symmetric through the centre


def svg(rounded: bool, scale: float = 1.0) -> str:
    rx = 40 if rounded else 0
    xf = f' transform="translate({C} {C}) scale({scale}) translate(-{C} -{C})"' if scale != 1 else ""
    dot = lambda x, y: f'<circle cx="{x:.2f}" cy="{y:.2f}" r="12" fill="#fff" stroke="{INK}" stroke-width="4"/>'
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
<rect width="180" height="180" rx="{rx}" fill="{BG}"/>
<g{xf}>
<path d="M{t1[0]:.2f} {t1[1]:.2f} A{R} {R} 0 1 0 {C} {C}" fill="none" stroke="{BLUE}" stroke-width="18" stroke-linecap="round"/>
<path d="M{C} {C} A{R} {R} 0 1 1 {t2[0]:.2f} {t2[1]:.2f}" fill="none" stroke="{ORANGE}" stroke-width="18" stroke-linecap="round"/>
<line x1="{t1[0]:.2f}" y1="{t1[1]:.2f}" x2="{t2[0]:.2f}" y2="{t2[1]:.2f}" stroke="{INK}" stroke-width="14" stroke-linecap="round"/>
<line x1="{t1[0]:.2f}" y1="{t1[1]:.2f}" x2="{t2[0]:.2f}" y2="{t2[1]:.2f}" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
{dot(*t1)}
{dot(C, C)}
{dot(*t2)}
</g>
</svg>
"""


def png(src: pathlib.Path, size: int, dst: pathlib.Path) -> None:
    subprocess.run(["rsvg-convert", "-w", str(size), str(src), "-o", str(dst)], check=True)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    fav = OUT / "favicon.svg"
    fav.write_text(svg(rounded=True))
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        square, mask = tmp / "square.svg", tmp / "maskable.svg"
        square.write_text(svg(rounded=False))
        mask.write_text(svg(rounded=False, scale=0.78))
        png(square, 180, OUT / "apple-touch-icon.png")
        png(fav, 192, OUT / "icon-192.png")
        png(fav, 512, OUT / "icon-512.png")
        png(mask, 512, OUT / "icon-maskable-512.png")
        small = []
        for s in (16, 32, 48):
            png(fav, s, tmp / f"{s}.png")
            small.append(str(tmp / f"{s}.png"))
        subprocess.run(["convert", *small, str(OUT / "favicon.ico")], check=True)
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
