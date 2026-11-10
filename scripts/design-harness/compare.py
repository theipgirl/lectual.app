"""Side-by-side images: design (left) | build (right), labelled, plus a <=800px-wide copy.

Usage: python3 -I compare.py [screenId ...]
Env:   DESIGN_SHOTS  folder of design board PNGs (default $SCRATCH/shots/design, else the scratchpad path below)
Reads  out/manifest.json (written by the render step) and out/shots/<id>.png; writes out/pairs/<id>.png,
out/pairs-small/<id>.png (<=800 wide) and out/pairs-stack/<id>.png (design above build, 800 wide). A screen's designCrop [x, y, w, h] (design pixels) picks one phone out of a board.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
DEFAULT_SHOTS = os.path.join(os.environ.get("SCRATCH", "/tmp/claude-0/-home-user-lectual-app/0abc6711-4007-57c6-ae92-98b7a7383e0f/scratchpad"), "shots", "design")
DESIGN_SHOTS = os.environ.get("DESIGN_SHOTS", DEFAULT_SHOTS)
GAP, LABEL_H, PAD = 24, 30, 12
BG = (236, 230, 220)


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    wanted = set(sys.argv[1:])
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
    os.makedirs(os.path.join(OUT, "pairs"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "pairs-small"), exist_ok=True)
    f = font(16)
    for s in manifest:
        if wanted and s["id"] not in wanted:
            continue
        design_path = os.path.join(DESIGN_SHOTS, s["designBoard"] + ".png")
        build_path = os.path.join(OUT, "shots", s["id"] + ".png")
        if not os.path.exists(build_path):
            print("skip (no build shot)", s["id"])
            continue
        build = Image.open(build_path).convert("RGB")
        if os.path.exists(design_path):
            design = Image.open(design_path).convert("RGB")
            if s.get("designCrop"):
                x, y, w, h = s["designCrop"]
                design = design.crop((x, y, x + w, y + h))
        else:
            print("no design board", design_path)
            design = Image.new("RGB", (build.width, 200), BG)
        h = max(design.height, build.height)
        sheet = Image.new("RGB", (design.width + build.width + GAP + 2 * PAD, h + LABEL_H + 2 * PAD), BG)
        d = ImageDraw.Draw(sheet)
        d.text((PAD, PAD // 2), f"DESIGN  {s['designBoard']}  {design.width}x{design.height}", fill=(60, 20, 30), font=f)
        d.text((PAD + design.width + GAP, PAD // 2), f"BUILD  {s['id']}  {build.width}x{build.height}", fill=(60, 20, 30), font=f)
        sheet.paste(design, (PAD, PAD + LABEL_H))
        sheet.paste(build, (PAD + design.width + GAP, PAD + LABEL_H))
        sheet.save(os.path.join(OUT, "pairs", s["id"] + ".png"))
        small = sheet
        if sheet.width > 800:
            small = sheet.resize((800, max(1, round(sheet.height * 800 / sheet.width))), Image.LANCZOS)
        small.save(os.path.join(OUT, "pairs-small", s["id"] + ".png"))
        # Stacked copy (design above build, each scaled to 800 wide): readable for desktop pages.
        os.makedirs(os.path.join(OUT, "pairs-stack"), exist_ok=True)
        w = 800
        dd = design.resize((w, max(1, round(design.height * w / design.width))), Image.LANCZOS)
        bb = build.resize((w, max(1, round(build.height * w / build.width))), Image.LANCZOS)
        st = Image.new("RGB", (w, dd.height + bb.height + 2 * LABEL_H), BG)
        sd = ImageDraw.Draw(st)
        sd.text((6, 6), f"DESIGN {s['designBoard']}", fill=(60, 20, 30), font=f)
        st.paste(dd, (0, LABEL_H))
        sd.text((6, LABEL_H + dd.height + 6), f"BUILD {s['id']}", fill=(60, 20, 30), font=f)
        st.paste(bb, (0, 2 * LABEL_H + dd.height))
        st.save(os.path.join(OUT, "pairs-stack", s["id"] + ".png"))
        print("pair", s["id"], sheet.size, "->", small.size)


if __name__ == "__main__":
    main()
