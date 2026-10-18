"""把豆包出的原始图集，归一化成游戏能直接用的等分图集。

原始问题（AI 出图的通病）：
  * 每一帧在格子里的位置/大小有抖动，直接播会「抖一下」；
  * 相邻帧的头发、武器会溢进隔壁格子，切图后会看到别人的残影。

处理方式：
  1. 逐格做 alpha 连通域分析，只保留「主体」和紧贴主体的特效件，丢掉边缘碎渣；
  2. 每张图集统一一个缩放系数（同一个角色所有帧一起缩，保持比例一致）；
  3. 水平按「脚底重心」对齐到格子中心，垂直按「脚底」对齐到基线。

输出：assets/art_raw/*.png
  * 三张角色图集仍是 640x400（10x5 格，格 64x80）；
  * boss_king 仍是 576x448（6x4 格，格 96x112）；
  * 其余单图原样复制（尺寸不变，仅去元数据）。

用法：
  python scripts/art-normalize.py [--no-copy]

依赖：Pillow（本机已有）。不需要 numpy。
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "art_pack" / "美术资源整合包"
DST = ROOT / "assets" / "art_raw"
ALPHA_MIN = 8  # alpha > 8 视为实体像素

# 图集定义：目标格子、内容框（缩放后必须装得下）、脚底基线（格子坐标）
SHEETS = {
    "char_mutsumi.png": dict(cols=10, rows=5, cell=(64, 80), fit=(62, 74), baseline=75),
    "char_murasame.png": dict(cols=10, rows=5, cell=(64, 80), fit=(62, 74), baseline=75),
    "char_fish.png": dict(cols=10, rows=5, cell=(64, 80), fit=(62, 74), baseline=75),
    "boss_king.png": dict(cols=6, rows=4, cell=(96, 112), fit=(90, 104), baseline=107),
}

# 单图资源：原样复制（尺寸必须与 docs/07 规格一致，不一致会告警）
SINGLES = {
    "keyart_title.png": (1920, 1080),
    "prop_crate.png": (40, 40),
    "prop_barrel.png": (40, 48),
    "prop_pillar.png": (32, 64),
    "prop_crystal.png": (40, 56),
    "pickup_coin.png": (16, 16),
    "pickup_heart.png": (16, 16),
    "pickup_rice.png": (16, 16),
    "pickup_card.png": (20, 28),
    "proj_cucumber.png": (20, 10),
    "proj_bubble.png": (24, 24),
    "proj_wave.png": (32, 32),
    "proj_slash.png": (48, 48),
    "proj_orbfire.png": (24, 24),
    "fx_ring.png": (64, 64),
    "fx_glow.png": (32, 32),
    "portrait_mutsumi.png": (128, 128),
    "portrait_mortis.png": (128, 128),
    "portrait_murasame.png": (128, 128),
    "portrait_fish.png": (128, 128),
    "portrait_boss.png": (192, 192),
    "icon_weapon_mutsumi.png": (32, 32),
    "icon_weapon_murasame.png": (32, 32),
    "icon_weapon_fish.png": (32, 32),
    "icon_card_magic.png": (32, 32),
    "icon_card_stamina.png": (32, 32),
    "icon_card_intelligence.png": (32, 32),
    "icon_card_hp.png": (32, 32),
    "icon_card_moveSpeed.png": (32, 32),
    "icon_card_charge.png": (32, 32),
    "icon_card_armor.png": (32, 32),
    "icon_card_dodge.png": (32, 32),
    "icon_card_crit.png": (32, 32),
}


def find(name: str) -> Path:
    hits = list(SRC.rglob(name))
    if not hits:
        raise SystemExit(f"[art-normalize] 找不到 {name}（在 {SRC} 下）")
    return hits[0]


def components(mask: list[list[bool]], w: int, h: int):
    """4 邻接连通域：返回 [(area, x0, y0, x1, y1, pixels)]"""
    seen = [[False] * w for _ in range(h)]
    out = []
    for y in range(h):
        for x in range(w):
            if not mask[y][x] or seen[y][x]:
                continue
            stack = [(x, y)]
            seen[y][x] = True
            pixels = []
            x0 = x1 = x
            y0 = y1 = y
            while stack:
                cx, cy = stack.pop()
                pixels.append((cx, cy))
                if cx < x0:
                    x0 = cx
                if cx > x1:
                    x1 = cx
                if cy < y0:
                    y0 = cy
                if cy > y1:
                    y1 = cy
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            out.append((len(pixels), x0, y0, x1, y1, pixels))
    return out


def clean_cell(cell: Image.Image):
    """从一格原始裁片里取出「本帧角色」，返回 (帧图, 脚底 x 偏移) 或 None。

    AI 图集里一帧常比格子宽 4~6px，于是隔壁帧的碎片会落在本格边缘。
    这里用「离格子中心最近的粗连通域」当主体，只合并几乎完全落在主体 bbox
    内部的小件（被抗锯齿缝切开的描边/气泡），隔壁碎片因此被丢掉。
    """
    w, h = cell.size
    a = cell.getchannel("A").tobytes()
    mask = [[a[y * w + x] > ALPHA_MIN for x in range(w)] for y in range(h)]
    comps = [c for c in components(mask, w, h) if c[0] >= 6]
    if not comps:
        return None

    # 只保留「和格子中部有交集」的连通域：贴边的 3~6px 竖条是隔壁帧的残影。
    # 不按大小排序，避免把同一角色的两半（被细分缝隙切开）当成两个角色。
    inset_x0, inset_x1 = w * 0.10, w * 0.90
    inset_y0, inset_y1 = h * 0.04, h * 0.96
    keep = [
        c
        for c in comps
        if c[1] < inset_x1 and c[3] > inset_x0 and c[2] < inset_y1 and c[4] > inset_y0
    ]
    if not keep:
        return None
    if sum(c[0] for c in keep) < 30:
        return None

    x0 = min(c[1] for c in keep)
    y0 = min(c[2] for c in keep)
    x1 = max(c[3] for c in keep) + 1
    y1 = max(c[4] for c in keep) + 1
    fw, fh = x1 - x0, y1 - y0

    keep_set = set()
    for c in keep:
        keep_set.update(c[5])
    out = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    src = cell.load()
    px = out.load()
    for (px_x, px_y) in keep_set:
        if x0 <= px_x < x1 and y0 <= px_y < y1:
            px[px_x - x0, px_y - y0] = src[px_x, px_y]

    # 脚底重心：底部 12% 行（至少 3 行）像素的 x 均值，用它对齐格子中心
    foot_rows = max(3, int(fh * 0.12))
    fx_sum = 0.0
    fx_n = 0
    for (px_x, px_y) in keep_set:
        if px_y >= y1 - foot_rows:
            fx_sum += px_x - x0
            fx_n += 1
    foot_x = fx_sum / fx_n if fx_n else fw / 2
    return out, foot_x


def normalize_sheet(name: str, cols: int, rows: int, cell_wh, fit_wh, baseline: int) -> None:
    path = find(name)
    src_img = Image.open(path).convert("RGBA")
    cw, ch = cell_wh
    expect = (cw * cols, ch * rows)
    if src_img.size != expect:
        raise SystemExit(f"[art-normalize] {name} 尺寸 {src_img.size} != 期望 {expect}")

    frames = [[None] * cols for _ in range(rows)]
    max_w = max_h = 1
    for r in range(rows):
        for c in range(cols):
            cell = src_img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            res = clean_cell(cell)
            if res is None:
                continue
            fimg, foot_x = res
            frames[r][c] = (fimg, foot_x)
            max_w = max(max_w, fimg.width)
            max_h = max(max_h, fimg.height)

    fit_w, fit_h = fit_wh
    scale = min(1.0, fit_w / max_w, fit_h / max_h)
    out = Image.new("RGBA", expect, (0, 0, 0, 0))
    for r in range(rows):
        for c in range(cols):
            item = frames[r][c]
            if item is None:
                continue
            fimg, foot_x = item
            tw = max(1, round(fimg.width * scale))
            th = max(1, round(fimg.height * scale))
            fimg = fimg.resize((tw, th), Image.NEAREST)
            # 脚底重心对齐格子中心，脚底贴基线
            dx = round(cw / 2 - foot_x * scale)
            dx = max(-8, min(cw - tw + 8, dx))
            dy = baseline - th
            out.alpha_composite(fimg, (c * cw + dx, r * ch + dy))
    out.save(DST / name, optimize=True)
    print(
        f"  {name:22s} {expect[0]}x{expect[1]}  {cols}x{rows}  cell {cw}x{ch}"
        f"  scale={scale:.3f}  maxframe {max_w}x{max_h}"
    )


def strip_plate(img: Image.Image, tol: int = 34) -> Image.Image:
    """抠掉头像自带的品红底板。

    豆包出的 portrait_* 是「角色 + 实心品红圆盘」合成图（透明区还留着品红色 matte）。
    圆盘外面还有一圈暗红描边，直接从边界 flood fill 走不进盘里，所以改成：
    取「品红类」像素（高 R、低 G、B 中高）的连通域，面积 ≥ 全图 6% 的整块删掉——
    角色身上的粉色配饰面积远小于这个阈值，不会被误删。
    """
    w, h = img.size
    px = img.load()
    total = w * h

    def pinkish(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        if a <= 8:
            return False
        return r > 90 and g < 125 and b > 65 and r - g > 45 and b - g > 18

    mask = [[pinkish(x, y) for x in range(w)] for y in range(h)]
    seen = [[False] * w for _ in range(h)]
    removed = 0
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0][x0] or seen[y0][x0]:
                continue
            stack = [(x0, y0)]
            seen[y0][x0] = True
            comp = []
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            if len(comp) < total * 0.06:
                continue
            for (x, y) in comp:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
                removed += 1
    return img


def main() -> None:
    copy_singles = "--no-copy" not in sys.argv
    DST.mkdir(parents=True, exist_ok=True)

    print("[art-normalize] 图集：")
    for name, cfg in SHEETS.items():
        normalize_sheet(name, cfg["cols"], cfg["rows"], cfg["cell"], cfg["fit"], cfg["baseline"])

    if copy_singles:
        print("[art-normalize] 单图：")
        for name, size in SINGLES.items():
            src = find(name)
            img = Image.open(src).convert("RGBA")
            if img.size != size:
                print(f"  !! {name} 尺寸 {img.size} != 规格 {size}（照原样复制，请在 docs/07 更新规格）")
            if name.startswith("portrait_"):
                before = img.getchannel("A").histogram()[0]
                strip_plate(img)
                after = img.getchannel("A").histogram()[0]
                removed = (after - before) / (img.width * img.height)
                print(f"  {name:22s} 去品红底：{removed:6.1%} 像素")
            img.save(DST / name, optimize=True)
        print(f"  已复制 {len(SINGLES)} 张单图")

    # 清单，方便自检脚本 / 文档核对
    lines = ["# 原画归一化输出清单（scripts/art-normalize.py 生成，勿手改）", ""]
    for name, cfg in SHEETS.items():
        w = cfg["cell"][0] * cfg["cols"]
        h = cfg["cell"][1] * cfg["rows"]
        lines.append(
            f"sheet {name} {w}x{h} cols={cfg['cols']} rows={cfg['rows']} "
            f"cell={cfg['cell'][0]}x{cfg['cell'][1]}"
        )
    for name, size in SINGLES.items():
        p = DST / name
        if p.exists():
            lines.append(f"image {name} {size[0]}x{size[1]}")
    (DST / "MANIFEST.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[art-normalize] 完成 → {DST}")


if __name__ == "__main__":
    main()
