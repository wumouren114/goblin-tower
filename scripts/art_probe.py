"""探测美术整合包里每张图的透明边 / 每格内容 bbox，判断 AI 出图的对齐质量。

用法：
  python scripts/art_probe.py                 # 只打印角色/王/boss 图集逐格 bbox
  python scripts/art_probe.py --preview       # 额外输出 scripts/out/ 下的网格预览图
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PACK = ROOT / "assets" / "art_pack" / "美术资源整合包"
OUT = ROOT / "scripts" / "out"


def find(name: str) -> Path:
    hits = list(PACK.rglob(name))
    if not hits:
        raise SystemExit(f"missing {name}")
    return hits[0]


def alpha_bbox(img: Image.Image) -> tuple[int, int, int, int] | None:
    return img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()


def probe_sheet(name: str, cols: int, rows: int, preview: bool) -> None:
    path = find(name)
    img = Image.open(path).convert("RGBA")
    cw, ch = img.width // cols, img.height // rows
    print(f"\n== {name} {img.width}x{img.height}  cell {cw}x{ch}  ({cols}x{rows})")
    print("   global bbox:", alpha_bbox(img))
    boxes = 0
    widths: list[int] = []
    heights: list[int] = []
    for r in range(rows):
        row_txt = []
        for c in range(cols):
            cell = img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            bb = alpha_bbox(cell)
            if bb is None:
                row_txt.append("   .    ")
                continue
            x0, y0, x1, y1 = bb
            row_txt.append(f"{x1 - x0:2d}x{y1 - y0:<2d}@{x0:02d}")
            widths.append(x1 - x0)
            heights.append(y1 - y0)
            boxes += 1
        print(f" r{r}: " + " ".join(row_txt))
    if widths:
        print(
            f"   content w {min(widths)}..{max(widths)}  h {min(heights)}..{max(heights)}"
            f"  nonempty {boxes}/{cols * rows}"
        )
    if preview:
        OUT.mkdir(exist_ok=True)
        # 放大 3 倍 + 网格线，方便人眼看对齐
        scale = 3
        big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        dr = ImageDraw.Draw(big)
        for c in range(cols + 1):
            dr.line([(c * cw * scale, 0), (c * cw * scale, big.height)], fill=(255, 0, 0, 160), width=1)
        for r in range(rows + 1):
            dr.line([(0, r * ch * scale), (big.width, r * ch * scale)], fill=(255, 0, 0, 160), width=1)
        dst = OUT / f"grid_{path.stem}.png"
        big.save(dst)
        print("   preview:", dst)


def main() -> None:
    preview = "--preview" in sys.argv
    probe_sheet("char_mutsumi.png", 10, 5, preview)
    probe_sheet("char_murasame.png", 10, 5, preview)
    probe_sheet("char_fish.png", 10, 5, preview)
    probe_sheet("boss_king.png", 6, 4, preview)
    for name in ("prop_crate.png", "prop_barrel.png", "prop_pillar.png", "prop_crystal.png",
                 "pickup_coin.png", "pickup_heart.png", "pickup_rice.png", "pickup_card.png",
                 "proj_cucumber.png", "proj_bubble.png", "proj_wave.png", "proj_slash.png",
                 "proj_orbfire.png", "fx_ring.png", "fx_glow.png"):
        p = find(name)
        img = Image.open(p).convert("RGBA")
        print(f"{name:22s} {img.width}x{img.height} bbox={alpha_bbox(img)}")


if __name__ == "__main__":
    main()
