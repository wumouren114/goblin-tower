本目录 = 《像素小勇士》美术资源交付包（共 37 张成品 PNG）
============================================================
来源：豆包办公 AI 原画（按 docs/07-美术资源需求.md 规格生产）
用法：把本目录所有 PNG 拷贝到游戏项目的 assets/art_raw/ 即可（文件名与文档一一对应）。

一、角色图集（PNG 透明底，≤32 色，脚底对齐，无残留背景）
  char_mutsumi.png   640×400  若叶睦（行1-4 常态：浅绿长发/紫格纹裙/小黄瓜；行5 = Mortis 变身态）
  char_murasame.png  640×400  丛雨（绿发马尾/紫黑和服/红腰带/太刀，攻击列带蓝白刀光）
  char_fish.png      640×400  大肥鱼（纤细女仆装/蓝长发/鲸鱼围裙/鱼尾/黄色水枪，非胖体型）
  行序：下/上/左/右/技能态；列序：待机×2/跑×4/攻击×3/受击

二、Boss 图集与标题
  boss_king.png     576×448  哥布林之王（4行×6列，格96×112）
  keyart_title.png 1920×1080 标题主视觉（大肥鱼已按设定图修正为纤细体型，无文字）

三、场景道具（透明底）
  prop_crate.png   40×40   木箱     prop_barrel.png  40×48   木桶
  prop_pillar.png  32×64   断裂石柱  prop_crystal.png 40×56   冰晶簇

四、拾取物（透明底，16×16 等小图）
  pickup_coin.png  16×16  金币（正面，四角星纹，无符号）
  pickup_heart.png 16×16  红心     pickup_rice.png  16×16  白饭团
  pickup_card.png  20×28  金边卡牌

五、弹道（透明底）
  proj_cucumber.png 20×10  小黄瓜    proj_bubble.png  24×24  泡泡
  proj_wave.png     32×32  紫色音波月牙
  proj_slash.png    48×48  青色刀弧  proj_orbfire.png 24×24  敌方紫色弹幕球

六、特效（透明底；fx_glow 允许半透明）
  fx_ring.png  64×64  白色圆环（技能/升级光效）
  fx_glow.png  32×32  柔光点（粒子）

七、UI 头像（透明底半身像）
  portrait_mutsumi.png / portrait_mortis.png / portrait_murasame.png / portrait_fish.png  128×128
  portrait_boss.png    192×192（Boss 血条左侧用）

八、UI 图标（32×32，透明底）
  icon_weapon_mutsumi.png / icon_weapon_murasame.png / icon_weapon_fish.png（黄瓜/太刀/水枪）
  icon_card_magic.png / icon_card_stamina.png / icon_card_intelligence.png
  icon_card_hp.png / icon_card_moveSpeed.png / icon_card_charge.png
  icon_card_armor.png / icon_card_dodge.png / icon_card_crit.png

说明
- 所有 PNG 均为硬边、透明背景、≤32 色、无抗锯齿残留、无背景噪点（程序化校验通过）。
- 角色图集格内无字母/文字标注；图集行 5（技能态）含义：睦=Mortis、丛雨=拔刀蓄力、肥鱼=召唤。
- 若需 Mortis 独立文件 char_mortis.png，可从 char_mutsumi.png 第 5 行裁出（96×80×10 帧）。
- 原稿/过程版本已在会话画布（Canvas）中存档，可随时回看。

九、角色正面行样张（新规格 v5，先出正面行确认）
  char_mutsumi_row1_front.png / char_fish_row1_front.png / char_murasame_row1_front.png  640×80 透明底（10格×64×80）
  脚底对齐 y=74、跑步 4 帧明显交替、无网格/分隔/地面线、≤32 色；preview_*_x4.png 为 ×4 放大预览。
  注：三角色剩余四行（背面/朝左/朝右/技能态）确认正面行后补齐为完整 640×400 图集。

十、角色其余四行（新规格 v5 补齐）
  char_<角色>_row2_back / row3_left / row4_right / row5_skill.png 各 4 张（3 角色共 12 张），每张 640×80 透明底（10格×64×80）
  脚底对齐 y=75、跑步 4 帧明显交替、无网格/分隔/地面线、≤32 色；row5 技能态：睦=Mortis（紫色音波）、丛雨=拔刀蓄力（蓝白刀光）、大肥鱼=召唤（青白泡泡）；preview_*_x4.png 为 ×4 放大预览。
