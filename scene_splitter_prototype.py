\
# -*- coding: utf-8 -*-
"""
シナリオ整形ツール - シーン分割プロトタイプ

要件定義書(5.2)で決定した「ユーザーが見出し記号・書式を事前指定する半自動方式」の
検証用スクリプト。以下3種類の指定パターンを実装し、実際のサンプルシナリオで
分割結果を確認する。

1. 数字連番パターン (例: "01.導入") + 目次重複除外ロジック
   - 「お迎えには傘が必要」で確認された形式。今回は元データが手元にないため
     ロジックの再実装のみで、実データでの再検証はできていない(未検証)。
2. 単一記号パターン (例: "■シーン名")
   - 「花雷」で確認された形式。
3. 二階層パターン (例: 章"【Opening】" + シーン"▼夢幻")
   - 「LaLuLa」で確認された形式。
"""

import re


def split_by_numbered_heading(text, pattern=r'^([0-9]{1,2})\.(.+)$'):
    """数字連番+ピリオド形式の見出しでシーン分割する。

    本文中の見出しと、目次(シナリオチャートなど)に重複して出現する見出しを
    区別するため、見出し番号が「連番として大きく連続するまとまり」を検出し、
    最も範囲の広いまとまりを本文の区切りとして採用する。

    注意: このロジックは「お迎えには傘が必要」というサンプルの分析結果を
    もとに再実装したものであり、今回の検証では元データが手元にないため
    実データでの再確認はできていない(未検証)。
    """
    lines = text.split('\n')
    matches = []  # (line_index, number, heading_text)
    for i, line in enumerate(lines):
        m = re.match(pattern, line.strip())
        if m:
            matches.append((i, int(m.group(1)), m.group(2).strip()))

    if not matches:
        return {"runs": [], "chosen_run": [], "scenes": []}

    # 連番としてまとまって連続する区間(run)を検出する
    runs = []
    current_run = [matches[0]]
    for prev, curr in zip(matches, matches[1:]):
        if curr[1] == prev[1] + 1:
            current_run.append(curr)
        else:
            runs.append(current_run)
            current_run = [curr]
    runs.append(current_run)

    # 最も長い(範囲の広い)runを本文とみなす
    chosen_run = max(runs, key=len)

    scenes = []
    for idx, (line_no, num, heading) in enumerate(chosen_run):
        start = line_no + 1
        end = chosen_run[idx + 1][0] if idx + 1 < len(chosen_run) else len(lines)
        body = '\n'.join(lines[start:end]).strip()
        scenes.append({"number": num, "heading": heading, "body": body})

    return {"runs": runs, "chosen_run": chosen_run, "scenes": scenes}


def split_by_symbol(text, symbol):
    """単一記号(例: ■)で始まる行を見出しとしてシーン分割する。"""
    lines = text.split('\n')
    heading_indexes = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(symbol):
            heading_indexes.append((i, stripped[len(symbol):].strip()))

    scenes = []
    for idx, (line_no, heading) in enumerate(heading_indexes):
        start = line_no + 1
        end = heading_indexes[idx + 1][0] if idx + 1 < len(heading_indexes) else len(lines)
        body = '\n'.join(lines[start:end]).strip()
        scenes.append({"heading": heading, "body": body})
    return scenes


def split_two_level(text, chapter_symbol, scene_symbol):
    """二階層(章記号+シーン記号)でシーン分割する。

    まず章記号でテキスト全体を章単位に分割し、各章の中でさらにシーン記号で
    分割する。シーン記号が章内に1つもない場合は、章全体を1シーンとして扱う。
    """
    lines = text.split('\n')
    chapter_indexes = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r'^' + re.escape(chapter_symbol[0]) + r'.*' + re.escape(chapter_symbol[1]) + r'$', stripped):
            chapter_indexes.append((i, stripped))

    chapters = []
    for idx, (line_no, heading) in enumerate(chapter_indexes):
        start = line_no + 1
        end = chapter_indexes[idx + 1][0] if idx + 1 < len(chapter_indexes) else len(lines)
        chapter_text = '\n'.join(lines[start:end])
        scenes = split_by_symbol(chapter_text, scene_symbol)
        if not scenes:
            scenes = [{"heading": "(シーン記号なし)", "body": chapter_text.strip()}]
        chapters.append({"chapter_heading": heading, "scenes": scenes})
    return chapters


def detect_flat_headings(text, symbols):
    """複数の記号(例: ['【', '▼', '■'])のいずれかで始まる行を、出現順のフラットな
    見出しリストとして検出する。どの記号がどの階層(大見出し/小見出し)に対応するかは
    記号だけからは判断できない(例: LaLuLaの【】はOpening/Nightのような大見出しにも、
    一階：警備本部のような小見出しにも使われている)ため、ここでは検出のみを行い、
    階層の割り当ては build_hierarchy() 側でユーザー指定のレベル(level_map)に委ねる。
    """
    lines = text.split('\n')
    headings = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        for sym in symbols:
            if stripped.startswith(sym):
                headings.append({"line": i, "symbol": sym, "heading": stripped})
                break

    result = []
    for idx, h in enumerate(headings):
        start = h["line"] + 1
        end = headings[idx + 1]["line"] if idx + 1 < len(headings) else len(lines)
        body = '\n'.join(lines[start:end]).strip()
        result.append({**h, "body": body})
    return result


def build_hierarchy(flat_headings, level_map, default_level=0):
    """見出しごとに手動指定された階層レベル(0=最上位, 1=その下の階層…)をもとに、
    フラットな見出しリストから木構造(親子関係)を組み立てる。

    level_map: {見出しテキスト: レベル} の辞書。指定がない見出しは default_level を使う。
    どの見出しを大見出し(レベル0)にし、どれを小見出し(レベル1以降)にするかは、
    ツール側では自動判定せず、プレビュー画面上でユーザーが手動で決める想定
    (Mikoto確認済み、2026-07-23。「大見出し/小見出しの判断は手動でかまわない」)。
    """
    tree = []
    stack = []  # [(level, node), ...]
    for h in flat_headings:
        level = level_map.get(h["heading"], default_level)
        node = {**h, "level": level, "children": []}
        while stack and stack[-1][0] >= level:
            stack.pop()
        if stack:
            stack[-1][1]["children"].append(node)
        else:
            tree.append(node)
        stack.append((level, node))
    return tree


def render_outline(tree, indent=0):
    lines = []
    for node in tree:
        lines.append("  " * indent + f"- {node['heading']}")
        lines.extend(render_outline(node["children"], indent + 1))
    return lines


if __name__ == "__main__":
    with open("karinari.txt", encoding="utf-8") as f:
        karinari_text = f.read()
    with open("lalula.txt", encoding="utf-8") as f:
        lalula_text = f.read()

    print("=== 花雷: ■記号による分割 ===")
    karinari_scenes = split_by_symbol(karinari_text, "■")
    print(f"検出シーン数: {len(karinari_scenes)}")
    for s in karinari_scenes[:10]:
        print(f"  - {s['heading']}  (本文 {len(s['body'])}文字)")

    print()
    print("=== LaLuLa: 【】章 + ▼シーンによる二階層分割 ===")
    lalula_chapters = split_two_level(lalula_text, ("【", "】"), "▼")
    print(f"検出章数: {len(lalula_chapters)}")
    for c in lalula_chapters:
        print(f"  ・{c['chapter_heading']} - シーン数: {len(c['scenes'])}")
        for s in c['scenes'][:5]:
            print(f"      - {s['heading']}  (本文 {len(s['body'])}文字)")

    print()
    print("=== 数字連番パターン(お迎えには傘が必要相当のロジック、実データなし・未検証) ===")
    dummy_text = (
        "■シナリオチャート\n01.導入\n02.探索\n03.クライマックス\n\n"
        "本編ここから\n01.導入\nダミー本文1\n02.探索\nダミー本文2\n03.クライマックス\nダミー本文3\n"
    )
    result = split_by_numbered_heading(dummy_text)
    print(f"runの数: {len(result['runs'])}  最長run(採用): {len(result['chosen_run'])}件")
    for sc in result['scenes']:
        print(f"  - {sc['number']:02d}.{sc['heading']}  (本文: {sc['body'][:20]!r})")

    print()
    print("=== LaLuLa: 複層構造(手動レベル指定)の検証 ===")
    print("「Hospital」大見出しの中に「一階：警備本部」等の小見出しを手動で1段階層下げるケースを再現")
    flat = detect_flat_headings(lalula_text, ["【"])
    # Hospital〜Idolaの間にある同じ【】記号の見出しのうち、階層内の場所を示す6件を
    # 「手動でレベル1(Hospitalの子)に指定した」という想定でlevel_mapを組む。
    level_map = {
        "【一階：警備本部】": 1,
        "【一階：検査室】": 1,
        "【二階：病棟】": 1,
        "【図書室】": 1,
        "【三階】": 1,
        "【四階】": 1,
    }
    tree = build_hierarchy(flat, level_map, default_level=0)
    # Hospital〜Idolaの範囲だけ抜き出して表示
    hospital_idx = next(i for i, n in enumerate(tree) if n["heading"] == "【Hospital】")
    idola_idx = next(i for i, n in enumerate(tree) if n["heading"] == "【Idola】")
    for line in render_outline(tree[hospital_idx:idola_idx]):
        print(f"  {line}")
