"""
v4.6 风格图标切图：把画图 AI 的 3x3 品红底总览图拆成 9 张透明 PNG。

用法：
  python scripts/crop-style-sheet.py
  python scripts/crop-style-sheet.py assets/art_raw/v46/style_sheet.png

约定：
  - 输入 384x384 或 768/1024/1536 等能被 3 整除的正方形；
  - 每格一个图标，背景接近纯品红；
  - 输出固定 128x128，保留原格内构图，透明底；
  - 右下角豆包水印在「鲸落」格内，按区域清除。
"""
from __future__ import annotations

import math
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "assets", "art_raw", "v46", "style_sheet.png")
OUT_DIR = os.path.join(ROOT, "assets", "art_raw", "v46", "icons")

# 顺序与画图提示词一致：左→右、上→下
NAMES = [
    "style_mutsumi_solo",
    "style_mutsumi_duet",
    "style_mutsumi_requiem",
    "style_murasame_iai",
    "style_murasame_blood",
    "style_murasame_guard",
    "style_fish_school",
    "style_fish_burst",
    "style_fish_whale",
]


def background_color(im: Image.Image) -> tuple[float, float, float]:
    """取四角小色块均值，兼容 AI 出图的轻微品红偏差。"""
    w, h = im.size
    pts: list[tuple[int, int, int]] = []
    for cx, cy in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)):
        for dx in range(4):
            for dy in range(4):
                pts.append(im.getpixel((min(w - 1, cx + dx), min(h - 1, cy + dy))))
    return tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))


def key_pixel(px: tuple[int, int, int], bg: tuple[float, float, float]) -> tuple[int, int, int, int]:
    """按到品红背景的距离生成 alpha，并对半透明边缘做去背景色污染。"""
    dist = math.dist(px, bg)
    if dist <= 48:
        return (0, 0, 0, 0)
    if dist >= 105:
        return (px[0], px[1], px[2], 255)
    alpha = (dist - 48) / (105 - 48)
    # 反预乘：pixel = fg * a + bg * (1 - a)
    r = (px[0] - bg[0] * (1 - alpha)) / max(alpha, 0.01)
    g = (px[1] - bg[1] * (1 - alpha)) / max(alpha, 0.01)
    b = (px[2] - bg[2] * (1 - alpha)) / max(alpha, 0.01)
    return (
        max(0, min(255, int(r))),
        max(0, min(255, int(g))),
        max(0, min(255, int(b))),
        int(alpha * 255),
    )


def remove_specks(cell: Image.Image, min_pixels: int = 10) -> None:
    """清掉品红噪点/极小的孤立碎屑；鱼泡泡和血滴都大于该阈值。"""
    alpha = cell.getchannel("A")
    px = alpha.load()
    seen: set[tuple[int, int]] = set()
    for y in range(cell.height):
        for x in range(cell.width):
            if px[x, y] <= 16 or (x, y) in seen:
                continue
            stack = [(x, y)]
            seen.add((x, y))
            comp: list[tuple[int, int]] = []
            while stack:
                ax, ay = stack.pop()
                comp.append((ax, ay))
                for nx, ny in ((ax + 1, ay), (ax - 1, ay), (ax, ay + 1), (ax, ay - 1)):
                    if 0 <= nx < cell.width and 0 <= ny < cell.height and px[nx, ny] > 16 and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(comp) < min_pixels:
                for ax, ay in comp:
                    px[ax, ay] = 0


def main() -> None:
    if not os.path.exists(SRC):
        raise SystemExit(f"找不到输入图：{SRC}")
    im = Image.open(SRC).convert("RGB")
    if im.width != im.height or im.width % 3 != 0:
        raise SystemExit(f"输入图必须是能被 3 整除的正方形，当前 {im.width}x{im.height}")
    cell_size = im.width // 3
    bg = background_color(im)
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"input: {SRC} ({im.width}x{im.height})  bg≈{tuple(round(v) for v in bg)}  cell={cell_size}")

    for index, name in enumerate(NAMES):
        cx, cy = index % 3, index // 3
        cell = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        for y in range(128):
            for x in range(128):
                # 「鲸落」格右下角有画图工具水印；鲸尾主体在 y<103，直接切掉水印带
                if cx == 2 and cy == 2 and y >= 103:
                    continue
                sx = cx * cell_size + min(cell_size - 1, int(x * cell_size / 128))
                sy = cy * cell_size + min(cell_size - 1, int(y * cell_size / 128))
                cell.putpixel((x, y), key_pixel(im.getpixel((sx, sy)), bg))
        remove_specks(cell)
        path = os.path.join(OUT_DIR, f"{name}.png")
        cell.save(path)
        print(f"  -> {path}  bbox={cell.getbbox()}")


if __name__ == "__main__":
    main()
