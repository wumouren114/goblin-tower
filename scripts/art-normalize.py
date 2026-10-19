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
    "char_fish.png": dict(cols=10, rows=5, cell=(64, 80), fit=(74, 74), baseline=75, mode="window"),
    "boss_king.png": dict(cols=6, rows=4, cell=(96, 112), fit=(90, 104), baseline=107),
}

# 新规格 v5 的单行样张：出图先只出「正面行」确认，放在 09-角色正面行样张/。
# 存在时用样张覆盖图集的第 1 行（正面/朝下），其余行仍用原图集，逐行升级不打断游戏。
ROW_PATCHES = {
    "char_mutsumi.png": "char_mutsumi_row1_front.png",
    "char_murasame.png": "char_murasame_row1_front.png",
    "char_fish.png": "char_fish_row1_front.png",
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


def strip_cell_borders(sheet: Image.Image, cols: int, rows: int, cw: int, ch: int, ring: int = 3) -> None:
    """清掉每格最外 ring 像素内的洋红分隔线。

    AI 图集的分隔线是「每格一圈」，不是贯穿整张图的长线，所以按格子逐圈处理：
    只在距格子边缘 ≤3px 的环带里清洋红像素，角色本体不会贴边，安全。
    """
    px = sheet.load()

    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cw, r * ch
            for y in range(y0, y0 + ch):
                for x in range(x0, x0 + cw):
                    edge = x - x0 < ring or x0 + cw - 1 - x < ring or y - y0 < ring or y0 + ch - 1 - y < ring
                    if not edge:
                        continue
                    pr, pg, pb, pa = px[x, y]
                    if _is_pink_line(pr, pg, pb, pa):
                        px[x, y] = (pr, pg, pb, 0)


def strip_grid_lines(sheet: Image.Image) -> None:
    """抹掉 AI 图集自带的洋红网格线。

    豆包出图时会在每格之间画一圈洋红分隔线（就在 64/80 的整数倍位置上）。
    这些线会跟着切图进到游戏里，看起来就像「动画帧之间夹着粉色间隔」。
    这里按整列/整行统计：某列上有 ≥50% 高度的洋红像素 → 整列清掉，行同理。
    角色本体不会落在格子分界线上，所以不会误伤。
    """
    px = sheet.load()
    w, h = sheet.size

    def is_line(x: int, y: int) -> bool:
        return _is_pink_line(*px[x, y])

    for x in range(w):
        if sum(1 for y in range(h) if is_line(x, y)) >= h * 0.5:
            for y in range(h):
                if is_line(x, y):
                    r, g, b, _ = px[x, y]
                    px[x, y] = (r, g, b, 0)
    for y in range(h):
        if sum(1 for x in range(w) if is_line(x, y)) >= w * 0.5:
            for x in range(w):
                if is_line(x, y):
                    r, g, b, _ = px[x, y]
                    px[x, y] = (r, g, b, 0)


def strip_bars(img: Image.Image) -> None:
    """清掉贯穿整帧的洋红竖条/横条（隔壁帧被切下来、又和主体连在一起的那种）。

    判定：某一列上「暗洋红」像素占帧高 ≥45% → 整列洋红像素清掉；行同理。
    角色的洋红配饰是零散小块，不会在单列上连续占满半帧。
    """
    px = img.load()
    w, h = img.size

    def is_mag(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        return a > 8 and 118 <= r <= 225 and g < 62 and 80 <= b <= 155

    for x in range(w):
        if sum(1 for y in range(h) if is_mag(x, y)) >= h * 0.45:
            for y in range(h):
                if is_mag(x, y):
                    r, g, b, _ = px[x, y]
                    px[x, y] = (r, g, b, 0)
    for y in range(h):
        if sum(1 for x in range(w) if is_mag(x, y)) >= w * 0.45:
            for x in range(w):
                if is_mag(x, y):
                    r, g, b, _ = px[x, y]
                    px[x, y] = (r, g, b, 0)


def strip_edge_magenta(img: Image.Image, depth: int = 4, min_run: int = 20) -> None:
    """清掉紧贴帧边缘的洋红直线残段（隔壁帧被格线切下来的边框）。

    只清「帧最外 4px 内、颜色是洋红、且在该列/行上连续 ≥20px」的像素，
    角色自己的粉色配饰不会成条贴着边框，基本不会被误伤。
    """
    px = img.load()
    w, h = img.size

    def is_mag(r: int, g: int, b: int, a: int) -> bool:
        return a > 8 and 118 <= r <= 220 and g < 60 and 80 <= b <= 150

    def clear_col(x: int) -> None:
        if sum(1 for y in range(h) if is_mag(*px[x, y])) >= min_run:
            for y in range(h):
                r, g, b, a = px[x, y]
                if is_mag(r, g, b, a):
                    px[x, y] = (r, g, b, 0)

    def clear_row(y: int) -> None:
        if sum(1 for x in range(w) if is_mag(*px[x, y])) >= min_run:
            for x in range(w):
                r, g, b, a = px[x, y]
                if is_mag(r, g, b, a):
                    px[x, y] = (r, g, b, 0)

    for x in range(min(depth, w)):
        clear_col(x)
    for x in range(max(0, w - depth), w):
        clear_col(x)
    for y in range(min(depth, h)):
        clear_row(y)
    for y in range(max(0, h - depth), h):
        clear_row(y)


def _is_pink_line(r: int, g: int, b: int, a: int) -> bool:
    """AI 原画里的洋红分隔线/假阴影色（暗洋红 165,25,96 与亮粉 248,132,205 都算）。"""
    if a <= 8:
        return False
    return r >= 150 and b >= 70 and r - g > 45 and b - g >= 8 and g < 190


def strip_ground_line(img: Image.Image) -> None:
    """抹掉原画自带的洋红地线（角色脚底那条 1~3px 横线，有的偏暗、有的亮粉）。

    只处理底部 12 行、只清「连续 ≥8px 且颜色是洋红线色」的像素：
    这条线是出图时画的假阴影，进游戏会变成一条粉色横线，而游戏本身有影子。
    """
    px = img.load()
    w, h = img.size
    for y in range(max(0, h - 12), h):
        run = 0
        start = 0
        for x in range(w + 1):
            on = False
            if x < w:
                on = _is_pink_line(*px[x, y])
            if on:
                if run == 0:
                    start = x
                run += 1
            elif run > 0:
                if run >= 8:
                    for xx in range(start, start + run):
                        r, g, b, _ = px[xx, y]
                        px[xx, y] = (r, g, b, 0)
                run = 0


def clean_frame_window(sheet: Image.Image, c: int, r: int, cw: int, ch: int):
    """从整张图里按「本帧中心附近的主体」提取一帧，返回 (帧图, 脚底 x 偏移) 或 None。

    原画每帧常比格子宽 4~8px：硬切会把角色切掉一半，还会在格子边缘留下隔壁
    帧的细条（看着就像两帧之间夹了粉色竖线）。所以这里取一个比格子宽 32px 的
    窗口做连通域，抓离本帧中心最近的粗块当主体，细条/噪点直接丢掉。
    """
    sw, sh = sheet.size
    wx0 = max(0, c * cw - 16)
    wx1 = min(sw, (c + 1) * cw + 16)
    wy0 = max(0, r * ch - 6)
    wy1 = min(sh, (r + 1) * ch + 6)
    win = sheet.crop((wx0, wy0, wx1, wy1))
    w, h = win.size
    a = win.getchannel("A").tobytes()
    mask = [[a[y * w + x] > ALPHA_MIN for x in range(w)] for y in range(h)]
    comps = [cmp for cmp in components(mask, w, h) if cmp[0] >= 8]
    if not comps:
        return None

    # 本帧中心（脚底略上方）在窗口里的坐标
    tx = c * cw + cw / 2 - wx0
    ty = r * ch + ch * 0.62 - wy0

    def score(cmp):
        area, x0, y0, x1, y1, _ = cmp
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        return area - 40 * (((mx - tx) ** 2 + (my - ty) ** 2) ** 0.5)

    comps.sort(key=score, reverse=True)
    body = comps[0]
    if body[0] < 30:
        return None

    keep = [body]
    body_h = body[4] - body[2] + 1
    cell_l = c * cw - wx0
    cell_r = (c + 1) * cw - wx0
    for cmp in comps[1:]:
        bw = cmp[3] - cmp[1] + 1
        bh = cmp[4] - cmp[2] + 1
        # 在格线上被切掉的碎块 = 隔壁帧残留（左/右边缘贴着格线）
        if abs(cmp[1] - cell_l) <= 1 or abs(cmp[3] + 1 - cell_r) <= 1:
            continue
        # 离主体有明显空隙的碎块 = 隔壁帧掉进来的残影（本帧的刀光/气泡都贴着主体）
        gap_x = max(0, max(body[1] - cmp[3], cmp[1] - body[3]))
        gap_y = max(0, max(body[2] - cmp[4], cmp[2] - body[4]))
        if gap_x > 4 or gap_y > 4:
            continue
        # 细长小条（宽度/高度 ≤4px 且面积小）= 隔壁帧残影、地线、噪点
        if (bw <= 4 or bh <= 4) and cmp[0] < 60:
            continue
        # 窄而高的竖条（≤14px 宽、≥ 主体 65% 高）= 隔壁帧被切下来的边缘
        if bw <= 14 and bh >= body_h * 0.65:
            continue
        # 只有几乎整个落在主体 bbox 里（±3px）的碎块才算本帧自己的描边/特效
        if cmp[1] >= body[1] - 3 and cmp[3] <= body[3] + 3 and cmp[2] >= body[2] - 3 and cmp[4] <= body[4] + 3:
            keep.append(cmp)

    x0 = min(cmp[1] for cmp in keep)
    y0 = min(cmp[2] for cmp in keep)
    x1 = max(cmp[3] for cmp in keep) + 1
    y1 = max(cmp[4] for cmp in keep) + 1
    fw, fh = x1 - x0, y1 - y0

    keep_set = set()
    for cmp in keep:
        keep_set.update(cmp[5])
    out = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    src = win.load()
    px = out.load()
    for (px_x, px_y) in keep_set:
        if x0 <= px_x < x1 and y0 <= px_y < y1:
            px[px_x - x0, px_y - y0] = src[px_x, px_y]

    strip_ground_line(out)
    strip_edge_magenta(out)
    strip_bars(out)

    return out, _foot_center(out)


def clean_frame_cell(sheet: Image.Image, c: int, r: int, cw: int, ch: int):
    """按格子硬切（mutsumi/murasame 这种一帧基本占满格子、且相邻帧在边界相连的图集更稳）。

    保留与格子中部相交的连通域，贴边细条（隔壁帧残影）丢掉；脚底对齐由调用方做。
    """
    cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
    w, h = cell.size
    a = cell.getchannel("A").tobytes()
    mask = [[a[y * w + x] > ALPHA_MIN for x in range(w)] for y in range(h)]
    comps = [cmp for cmp in components(mask, w, h) if cmp[0] >= 6]
    if not comps:
        return None

    inset_x0, inset_x1 = w * 0.10, w * 0.90
    inset_y0, inset_y1 = h * 0.04, h * 0.96
    keep = [
        cmp
        for cmp in comps
        if cmp[1] < inset_x1 and cmp[3] > inset_x0 and cmp[2] < inset_y1 and cmp[4] > inset_y0
    ]
    if not keep or sum(cmp[0] for cmp in keep) < 30:
        return None

    x0 = min(cmp[1] for cmp in keep)
    y0 = min(cmp[2] for cmp in keep)
    x1 = max(cmp[3] for cmp in keep) + 1
    y1 = max(cmp[4] for cmp in keep) + 1
    keep_set = set()
    for cmp in keep:
        keep_set.update(cmp[5])
    out = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    src = cell.load()
    px = out.load()
    for (px_x, px_y) in keep_set:
        if x0 <= px_x < x1 and y0 <= px_y < y1:
            px[px_x - x0, px_y - y0] = src[px_x, px_y]

    strip_ground_line(out)
    strip_edge_magenta(out)
    strip_bars(out)
    return out, _foot_center(out)


def _foot_center(img: Image.Image) -> float:
    """底部 12% 行（至少 3 行）像素的 x 均值，用来把脚底对齐格子中心。"""
    px = img.load()
    w, h = img.size
    rows = max(3, int(h * 0.12))
    sx = 0.0
    n = 0
    for y in range(h - rows, h):
        for x in range(w):
            if px[x, y][3] > 8:
                sx += x
                n += 1
    return sx / n if n else w / 2


def clean_cell(sheet: Image.Image, c: int, r: int, cw: int, ch: int):
    """先按格子硬切；如果切出来只剩一条（角色被格线切掉一半），再用 ±16px 窗口重取。"""
    a = clean_frame_cell(sheet, c, r, cw, ch)
    if a is not None and a[0].width >= 40:
        return a
    b = clean_frame_window(sheet, c, r, cw, ch)
    if a is None:
        return b
    if b is None:
        return a
    return b if b[0].width > a[0].width else a


def normalize_sheet(name: str, cols: int, rows: int, cell_wh, fit_wh, baseline: int, mode: str = "cell") -> None:
    path = find(name)
    src_img = Image.open(path).convert("RGBA")
    cw, ch = cell_wh
    expect = (cw * cols, ch * rows)
    if src_img.size != expect:
        raise SystemExit(f"[art-normalize] {name} 尺寸 {src_img.size} != 期望 {expect}")

    # 先抹掉原图自带的洋红网格线，不然它会变成动画帧之间的粉色间隔
    strip_grid_lines(src_img)
    strip_cell_borders(src_img, cols, rows, cw, ch)

    # 新规格 v5 的「正面行」样张：有就用它覆盖第 1 行（只做轻度清理，样张本身没有格线）
    patch_img = None
    patch_name = ROW_PATCHES.get(name)
    if patch_name:
        try:
            patch_img = Image.open(find(patch_name)).convert("RGBA")
        except SystemExit:
            patch_img = None
        if patch_img is not None and patch_img.size[1] != ch:
            print(f"  !! {patch_name} 高度 {patch_img.size[1]} != 格子高 {ch}，忽略该行样张")
            patch_img = None

    frames = [[None] * cols for _ in range(rows)]
    dims: list[tuple[int, int]] = []
    patch_dims: list[tuple[int, int]] = []
    for r in range(rows):
        for c in range(cols):
            is_patch = r == 0 and patch_img is not None and c < cols
            if is_patch:
                res = clean_frame_cell(patch_img, c, 0, cw, ch)
            elif mode == "window":
                res = clean_frame_window(src_img, c, r, cw, ch)
            else:
                res = clean_cell(src_img, c, r, cw, ch)
            if res is None:
                continue
            fimg, foot_x = res
            frames[r][c] = (fimg, foot_x)
            (patch_dims if is_patch else dims).append((fimg.width, fimg.height))

    def p90_dim(items: list[tuple[int, int]]) -> tuple[int, int]:
        if not items:
            return (1, 1)
        ws = sorted(d[0] for d in items)
        hs = sorted(d[1] for d in items)
        idx = max(0, int(round(0.9 * (len(items) - 1))))
        return (ws[idx], hs[idx])

    fit_w, fit_h = fit_wh
    # 用 90 分位而不是最大值算缩放：个别帧多抓到一条刀光/残影不会把整个角色缩小
    ref_w, ref_h = p90_dim(dims)
    scale = min(1.0, fit_w / ref_w, fit_h / ref_h)

    # 行样张和旧行是两批出图，身高可能差 10~20%：按参考高度把样张行单独缩放到同一身高
    row_scale = scale
    if patch_dims and dims:
        pw, ph = p90_dim(patch_dims)
        if ph > 1:
            row_scale = scale * (ref_h / ph)
            max_w_patch = max(d[0] for d in patch_dims)
            # 放大后别顶出格子/内容框
            row_scale = min(row_scale, (cw - 2) / max_w_patch, fit_w / max_w_patch)
    out = Image.new("RGBA", expect, (0, 0, 0, 0))
    for r in range(rows):
        for c in range(cols):
            item = frames[r][c]
            if item is None:
                continue
            fimg, foot_x = item
            used_scale = row_scale if (r == 0 and patch_dims) else scale
            tw = max(1, round(fimg.width * used_scale))
            th = max(1, round(fimg.height * used_scale))
            fimg = fimg.resize((tw, th), Image.NEAREST)
            # 脚底重心对齐格子中心，脚底贴基线
            dx = round(cw / 2 - foot_x * used_scale)
            dx = max(-8, min(cw - tw + 8, dx))
            dy = baseline - th
            out.alpha_composite(fimg, (c * cw + dx, r * ch + dy))
    out.save(DST / name, optimize=True)
    print(
        f"  {name:22s} {expect[0]}x{expect[1]}  {cols}x{rows}  cell {cw}x{ch}"
        f"  scale={scale:.3f}  ref {ref_w}x{ref_h}"
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
        normalize_sheet(name, cfg["cols"], cfg["rows"], cfg["cell"], cfg["fit"], cfg["baseline"], cfg.get("mode", "cell"))

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
