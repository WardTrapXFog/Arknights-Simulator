"""离线绘制 HUD 配色与几何造型对比，不启动模拟器。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'art' / 'ui' / 'hud-style-comparison.png'
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 2400, 1660
img = Image.new('RGB', (W, H), '#0b0e10')
d = ImageDraw.Draw(img)
FONT = 'C:/Windows/Fonts/msyh.ttc'
BOLD = 'C:/Windows/Fonts/msyhbd.ttc'


def text(x, y, value, size=22, color='#c3cbc7', bold=False):
    d.text((x, y), value, font=ImageFont.truetype(BOLD if bold else FONT, size), fill=color)


def box(rect, fill, edge=None, radius=0, width=1):
    d.rounded_rectangle(rect, radius, fill=fill, outline=edge, width=width)


def diamond(x, y, r, color, fill=None):
    pts = [(x, y-r), (x+r, y), (x, y+r), (x-r, y)]
    d.polygon(pts, fill=fill)
    d.line(pts + [pts[0]], fill=color, width=2)


def icon(x, y, kind, color):
    if kind == 'kill':
        d.ellipse((x-10, y-12, x+10, y+7), outline=color, width=2)
        d.rectangle((x-6, y+3, x+6, y+13), fill=color)
        for dx in [-4, 4]:
            d.ellipse((x+dx-2, y-5, x+dx+2, y-1), fill='#141819')
    elif kind == 'life':
        d.polygon([(x,y+12),(x-12,y-1),(x-11,y-9),(x-5,y-12),(x,y-6),
                   (x+5,y-12),(x+11,y-9),(x+12,y-1)], fill=color)
    else:
        d.ellipse((x-12,y-12,x+12,y+12), outline=color, width=2)
        d.line([(x,y-8),(x,y),(x+6,y+3)], fill=color, width=2)


text(64, 42, '自由沙盒 / HUD 样式对比', 43, '#f2f2f2', True)
text(66, 111, '三版使用相同内容和布局，只比较配色、圆角与菱形元素。', 23, '#91a09a')
text(66, 151, '离线绘制的方案示意，非运行截图；B、C 尚未接入。', 20, '#6b7c73')

configs = [
    dict(letter='A', title='当前方案', sub='绿灰底 · 大面积薄荷绿 · 方角角框',
         accent='#4ed8af', panel='#14231b', line='#38604b', radius=0, mint=True),
    dict(letter='B', title='石墨金 / 圆角菱形', sub='中性石墨底 · 金色重点 · 圆角＋菱形',
         accent='#eac568', panel='#1a1e24', line='#51555d', radius=22, mint=False),
    dict(letter='C', title='克制青绿 / 圆角菱形', sub='中性石墨底 · 青绿只标交互 · 金色状态',
         accent='#68c4af', panel='#1a1e24', line='#51555d', radius=22, mint=False),
]

for i, c in enumerate(configs):
    x = 48 + i * 784
    a, p, line, r = c['accent'], c['panel'], c['line'], c['radius']
    box((x, 219, x+736, 1570), '#101417', '#2b3336', 16)
    box((x+22, 246, x+76, 300), a, radius=12 if r else 0)
    text(x+35, 249, c['letter'], 33, '#0a100d', True)
    text(x+96, 246, c['title'], 29, '#f0f1ef', True)
    text(x+26, 321, c['sub'], 20, '#94a29a')

    # 相同的战场上下文。
    sx, sy = x+24, 375
    box((sx,sy,sx+688,sy+625), '#171b20', '#343a41', 12)
    for row in range(6):
        for col in range(10):
            gx = sx+34+col*57+row*5
            gy = sy+210+row*39
            d.polygon([(gx,gy),(gx+51,gy),(gx+56,gy+32),(gx+5,gy+32)],
                      fill='#292e34', outline='#3c4248')
    box((sx+575,sy+300,sx+610,sy+334), '#5a2c2c', '#a35d54', 4)
    box((sx+50,sy+300,sx+85,sy+334), '#264a60', '#5c8aab', 4)

    # 歼灭 / 基地 / 时间。
    tx, ty = sx+44, sy+27
    if i == 0:
        box((tx,ty,tx+600,ty+88), p, a)
        d.line((tx,ty+88,tx+600,ty+88), fill=a, width=3)
    else:
        box((tx,ty,tx+600,ty+88), '#191d23', '#a58b52', 23, 2)
        diamond(tx+9,ty+44,7,'#eac568','#2b2923')
        diamond(tx+591,ty+44,7,'#eac568','#2b2923')
    for j,(label,val,kind) in enumerate([('歼灭数','08 / 24','kill'),('基地生命','3','life'),('作战时间','01:28','time')]):
        bx = tx+32+j*196
        if j:
            d.line((bx-16,ty+20,bx-16,ty+68), fill=line, width=1)
        icon(bx+8, ty+45, kind, a if c['mint'] else '#dfc389')
        text(bx+37,ty+11,label,15,'#94a29a')
        text(bx+37,ty+33,val,29,'#f2f2f2',True)

    # 时间控制：A 方角，B/C 圆角容器和菱形播放。
    cy=sy+139
    box((sx+262,cy,sx+644,cy+58),p,line,15 if r else 0)
    if r:
        diamond(sx+296,cy+29,22,a,a)
        d.rectangle((sx+288,cy+21,sx+292,cy+37),fill='#101417')
        d.rectangle((sx+300,cy+21,sx+304,cy+37),fill='#101417')
    else:
        box((sx+270,cy+7,sx+320,cy+51),a)
        d.rectangle((sx+286,cy+20,sx+290,cy+37),fill='#101417')
        d.rectangle((sx+299,cy+20,sx+303,cy+37),fill='#101417')
    for j,t in enumerate(['1×','单帧','重开','2D']):
        box((sx+335+j*74,cy+9,sx+401+j*74,cy+49),p,line,8 if r else 0)
        text(sx+346+j*74,cy+14,t,18,'#cbd2cf')

    # 工具箱和选中态。
    box((sx+18,sy+219,sx+136,sy+393),p,line,14 if r else 0)
    for j,label in enumerate(['敌人','地形']):
        yy=sy+238+j*76
        if r:
            diamond(sx+48,yy+19,13,a if j==0 else '#87968d',a if j==0 else None)
        else:
            box((sx+35,yy+5,sx+61,yy+31),a if j==0 else '#587262',a)
        text(sx+73,yy+3,label,18,a if j==0 else '#9ca79f')
    center=(sx+360,sy+320)
    if r:
        diamond(*center,47,a)
    else:
        box((center[0]-40,center[1]-40,center[0]+40,center[1]+40),None,a,0,2)
    text(center[0]-30,center[1]-13,'选中',20,a)

    # 费用＋真实工程头像。
    box((sx+240,sy+463,sx+650,sy+594),p,line,16 if r else 0)
    if c['mint']:
        d.line((sx+240,sy+463,sx+650,sy+463),fill=a,width=3)
    diamond(sx+276,sy+519,17,'#ffc600','#ffc600')
    text(sx+307,sy+479,'30',43,'#ffc600',True)
    text(sx+306,sy+538,'部署费用',15,'#94a29a')
    ava=Image.open(ROOT/'public/assets/custom/op_talulah/avatar.png').convert('RGB')
    ava=ImageOps.fit(ava,(84,84))
    mask=Image.new('L',(84,84),255)
    if r:
        mask=Image.new('L',(84,84),0)
        ImageDraw.Draw(mask).rounded_rectangle((0,0,83,83),8,fill=255)
    img.paste(ava,(sx+439,sy+479),mask)
    box((sx+436,sy+476,sx+525,sy+565),None,a,10 if r else 0,2)
    text(sx+435,sy+565,'塔露拉',15,'#e6e7e4')
    box((sx+554,sy+484,sx+620,sy+562),None,line,12 if r else 0)
    text(sx+574,sy+494,'＋',30,a)

    text(x+28,1028,'开始菜单 / 同步使用相同造型',19,'#94a29a')
    for j,label in enumerate(['自由沙盒','关卡编辑器']):
        mx=x+26+j*346
        box((mx,1076,mx+338,1363),p,line,24 if r else 0)
        if i==0:
            d.line((mx,1076,mx+338,1076),fill=a,width=3)
            d.line((mx+314,1088,mx+326,1088,mx+326,1101),fill=a,width=2)
        diamond(mx+169,1162,42,a)
        diamond(mx+169,1162,56,line)
        text(mx+138,1143,'SI' if j==0 else 'LV',28,a,True)
        text(mx+30,1232,label,27,'#f0f1ee',True)
        text(mx+30,1305,'进入',18,a)
        text(mx+284,1300,'→',26,a)

    notes = [
        ['状态、边框、选中态均使用绿色', '方角面板与角框；费用仍为金色', '作为当前版本的比较基准'],
        ['歼灭 / 基地回到金色，数值白色', '圆角面板；菱形用于播放与选中态', '绿色仅保留在血条等功能语义中'],
        ['歼灭 / 基地同 B，费用保持金色', '圆角面板；菱形用于播放与选中态', '青绿限于当前选中、播放与入口'],
    ][i]
    for j,line_text in enumerate(notes):
        text(x+30,1393+j*43,line_text,20,'#aeb9b2')

text(64,1607,'可直接选择 A / B / C，也可以组合，例如：B 的状态栏＋C 的菜单与选中态。',22,'#aeb9b2')
img.save(OUT)
print(str(OUT))
