"use strict";

/* ============================================================
 * 定数
 * ========================================================== */

const SCHEMA_VERSION = 1;
const STATE_SCRIPT_ID = "scenario-tool-editor-state";

/* ============================================================
 * ユーティリティ
 * ========================================================== */

function uid(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return (prefix || "id") + "_" + crypto.randomUUID();
  }
  return (prefix || "id") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function clampLevel(level) {
  return Math.min(6, Math.max(1, level));
}

/* ============================================================
 * 要素参照
 * ========================================================== */

const el = {
  modeSwitch: document.getElementById("mode-switch"),
  btnModeEdit: document.getElementById("btn-mode-edit"),
  btnModePreview: document.getElementById("btn-mode-preview"),
  sidebarOpenBtn: document.getElementById("btn-sidebar-open"),
  sidebarCloseBtn: document.getElementById("btn-sidebar-close"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  sidebar: document.getElementById("sidebar"),
  sidebarTitle: document.getElementById("sidebar-title"),
  sidebarBody: document.getElementById("sidebar-body"),

  sectionLoad: document.getElementById("section-load"),
  fileInput: document.getElementById("file-input"),
  loadStatus: document.getElementById("load-status"),

  sectionEditor: document.getElementById("section-editor"),
  editorBody: document.getElementById("editor-body"),

  sectionPreview: document.getElementById("section-preview"),
  previewContent: document.getElementById("preview-content"),
  tocPanelInline: document.getElementById("toc-panel-inline"),
  tocListInline: document.getElementById("toc-list-inline"),
  npcCardsInline: document.getElementById("npc-cards-inline"),

  miniToolbar: document.getElementById("mini-toolbar"),
  exportBar: document.getElementById("export-bar"),
  exportFormatSelect: document.getElementById("export-format-select"),
  btnExportDownload: document.getElementById("btn-export-download"),

  linkPickerBackdrop: document.getElementById("link-picker-backdrop"),
  linkPicker: document.getElementById("link-picker"),
  linkPickerBody: document.getElementById("link-picker-body"),
  btnLinkPickerClose: document.getElementById("btn-link-picker-close"),

  toast: document.getElementById("toast"),
};

/* ============================================================
 * アプリ状態
 * ========================================================== */

const state = {
  mode: "edit", // "edit" | "preview"
  loaded: false,
  meta: {
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    sourceFileName: null,
  },
  npcs: [], // NPCカード(5.10): [{id, name, profile, params, status, skills}]
};

/* ============================================================
 * 読み込み(5.1・5.15)
 * ========================================================== */

el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files[0];
  if (!file) return;

  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (isPdf) {
    handlePdfFile(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const text = decodeTextFile(reader.result);
    const isHtml = /\.html?$/i.test(file.name) || /<html[\s>]/i.test(text.slice(0, 500));
    if (isHtml) {
      loadFromHtmlString(text, file.name);
    } else {
      loadFromPlainText(text, file.name, "新規読み込み(TXT)");
    }
  };
  reader.onerror = () => {
    el.loadStatus.textContent = "ファイルの読み込みに失敗しました。";
  };
  reader.readAsArrayBuffer(file);
});

// UTF-8として厳密デコードを試み、失敗したらShift-JIS(CP932)として読み直す。
// Windowsで作成されたシナリオTXTにはShift-JIS保存のものが少なくなく、これをUTF-8前提で
// 読むと文字化けする(2026-07-24、Mikoto報告で判明)。本ツールが書き出すHTMLは常にUTF-8
// (`<meta charset="UTF-8">`)のため、こちらの判定には影響しない。
function decodeTextFile(arrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(arrayBuffer);
  } catch (e) {
    return new TextDecoder("shift_jis").decode(arrayBuffer);
  }
}

function loadFromPlainText(text, fileName, kindLabel) {
  const lines = text.split(/\r\n|\r|\n/);
  // 空行は&nbsp;(実体は半角スペース相当の文字)ではなく<br>で高さを保持する。
  // &nbsp;だと選択・コピー・NPC自動抽出時などに余分な空白文字として残ってしまうため
  // (2026-07-24、Mikoto報告)。
  el.editorBody.innerHTML = lines
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("\n");
  state.meta = { schemaVersion: SCHEMA_VERSION, savedAt: null, sourceFileName: fileName };
  state.npcs = [];
  finishLoad(fileName, kindLabel || "新規読み込み(TXT)");
}

/* ============================================================
 * PDF読み込み(5.1・4章)
 * pdf.js(vendor/pdfjs/)を用いてテキストを抽出する。
 * レイアウトが複雑なPDFでは行の並び順が乱れる場合がある(要検証、11章-10参照)。
 * ========================================================== */

// pdf.min.js はクラシックスクリプト(UMDビルド)として読み込んでおり、
// window.pdfjsLib がグローバルに使える(動的importを使わないのは、
// file://で直接開いた場合にモジュール解決が失敗するため)。
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
}

async function handlePdfFile(file) {
  el.loadStatus.textContent = "PDFを解析しています…";
  try {
    if (!window.pdfjsLib) throw new Error("pdf.jsの読み込みに失敗しています。");
    const pdfjsLib = window.pdfjsLib;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      pageTexts.push(buildPdfPageText(textContent, viewport.height));
    }

    loadFromPlainText(pageTexts.join("\n\n"), file.name, "新規読み込み(PDF)");
  } catch (e) {
    console.error(e);
    el.loadStatus.textContent = "PDFの解析に失敗しました: " + e.message;
  }
}

// ページ内のテキスト断片をY座標(行)でグループ化し、X座標順に並べて行を復元する。
// 日本語の文章では単語間にスペースを挿入しない(誤ってスペースを混入させないため)。
function buildPdfPageText(textContent, pageHeight) {
  const rawItems = textContent.items.filter((it) => typeof it.str === "string" && it.str !== "");
  if (rawItems.length === 0) return "";

  const items = rawItems.map((it) => ({
    x: it.transform[4],
    y: it.transform[5],
    width: it.width || 0,
    scale: Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 1,
    str: it.str,
  }));

  // 本文の基準フォントサイズを、文字数で重み付けした最頻値として推定する
  const scaleWeights = new Map();
  items.forEach((it) => {
    const key = Math.round(it.scale * 10) / 10;
    scaleWeights.set(key, (scaleWeights.get(key) || 0) + it.str.length);
  });
  let dominantScale = items[0].scale;
  let bestWeight = -1;
  scaleWeights.forEach((weight, key) => {
    if (weight > bestWeight) {
      bestWeight = weight;
      dominantScale = key;
    }
  });

  // ルビ(ふりがな)は基準サイズより明確に小さいフォントで現れるため除外する。
  // (本文にそのまま混ぜると「家屋おく」のように読みが割り込んで文章が壊れるため)
  let bodyItems = items.filter((it) => it.scale >= dominantScale * 0.65);
  if (bodyItems.length === 0) return "";

  // ページ上下の余白(目安5%)にあるランニングヘッダー・ページ番号などは、
  // 段組み判定を邪魔 するうえ本文としても不要なので除外する。
  if (pageHeight) {
    const margin = pageHeight * 0.05;
    const withoutMargins = bodyItems.filter((it) => it.y > margin && it.y < pageHeight - margin);
    if (withoutMargins.length > 0) bodyItems = withoutMargins;
  }

  // 段組みの検出: 全断片の水平方向の占有範囲を統合し、空白帯(隙間)があれば
  // そこで列を左右に分割する(2段組まで対応)。
  const columns = splitIntoColumns(bodyItems);

  return columns
    .map((columnItems) => buildColumnText(columnItems))
    .filter((t) => t !== "")
    .join("\n\n");
}

// 段組みの検出: 全断片を水平方向の区間[x, x+width]とみなして統合(区間マージ)し、
// ページの水平投影に生じる「空白帯」を探す。この空白帯がページのほぼ中央にあり、
// 左右それぞれに十分な文字量があれば、2段組とみなしてそこで列を分割する。
// (単純な「開始x座標同士の最大の隙間」で判定すると、ルビ(ふりがな)で分断された
// 行の断片が作る見かけ上の隙間を段組みの境界と誤認することがあるため、
// 区間の統合によって本当に文字が存在しない帯だけを隙間として扱う。)
function splitIntoColumns(items) {
  if (items.length < 20) return [items]; // 判定に足る量がない場合は単一列扱い

  const intervals = items
    .map((it) => [it.x, it.x + Math.max(it.width, 0.1)])
    .sort((a, b) => a[0] - b[0]);

  const gaps = [];
  let curEnd = intervals[0][1];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s > curEnd) gaps.push({ from: curEnd, to: s, size: s - curEnd });
    curEnd = Math.max(curEnd, e);
  }
  if (gaps.length === 0) return [items];

  gaps.sort((a, b) => b.size - a.size);
  const overallMin = intervals[0][0];
  const overallMax = Math.max(...intervals.map((iv) => iv[1]));

  for (const gap of gaps) {
    if (gap.size <= 1) break; // サイズ順なので、これ以降はさらに小さい

    const splitPoint = (gap.from + gap.to) / 2;
    const relativePos = overallMax > overallMin ? (splitPoint - overallMin) / (overallMax - overallMin) : 0;
    if (relativePos <= 0.25 || relativePos >= 0.75) continue; // ページ中央付近でない隙間はヘッダー等とみなし除外

    const left = items.filter((it) => it.x < splitPoint);
    const right = items.filter((it) => it.x >= splitPoint);
    const totalChars = items.reduce((a, it) => a + Math.max(it.str.length, 1), 0);
    const leftChars = left.reduce((a, it) => a + Math.max(it.str.length, 1), 0);
    const rightChars = totalChars - leftChars;
    const minPopulationRatio = 0.12;
    const wellPopulated =
      leftChars / totalChars >= minPopulationRatio && rightChars / totalChars >= minPopulationRatio;

    if (wellPopulated) {
      return [left, right]; // 横書き2段組は左列→右列の順で読む想定
    }
  }

  return [items];
}

// 列内の断片をY座標で行にグループ化し、X座標順に並べたうえで、
// 行間隔・行末位置から「折り返し(連結)」か「段落・箇条書きの区切り」かを判定する。
function buildColumnText(items) {
  const yTolerance = 2.5;
  const lines = [];
  items.forEach((item) => {
    let line = lines.find((l) => Math.abs(l.y - item.y) <= yTolerance);
    if (!line) {
      line = { y: item.y, parts: [] };
      lines.push(line);
    }
    line.parts.push(item);
  });

  lines.forEach((line) => line.parts.sort((a, b) => a.x - b.x));
  lines.sort((a, b) => b.y - a.y); // PDF座標は下から上へ増えるため、Yが大きい順=読み順

  lines.forEach((line) => {
    line.text = line.parts.map((p) => p.str).join("").trim();
    const last = line.parts[line.parts.length - 1];
    line.rightEdge = last ? last.x + last.width : line.y;
  });

  const nonEmptyLines = lines.filter((l) => l.text !== "");
  if (nonEmptyLines.length === 0) return "";

  const gaps = [];
  for (let i = 1; i < nonEmptyLines.length; i++) {
    const g = nonEmptyLines[i - 1].y - nonEmptyLines[i].y;
    if (g > 0) gaps.push(g);
  }
  const typicalGap = median(gaps) || 14;
  const rightMargin = Math.max(...nonEmptyLines.map((l) => l.rightEdge));

  let result = nonEmptyLines[0].text;
  for (let i = 1; i < nonEmptyLines.length; i++) {
    const prev = nonEmptyLines[i - 1];
    const cur = nonEmptyLines[i];
    const gap = prev.y - cur.y;
    const prevWasFull = prev.rightEdge >= rightMargin - typicalGap;
    const normalSpacing = gap <= typicalGap * 1.6;

    if (normalSpacing && prevWasFull) {
      result += cur.text; // 折り返しとみなし、改行なしで連結する
    } else {
      result += "\n" + cur.text; // 段落・箇条書きの区切りとみなす
    }
  }
  return result;
}

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function loadFromHtmlString(htmlString, fileName) {
  const doc = new DOMParser().parseFromString(htmlString, "text/html");
  const scriptEl = doc.getElementById(STATE_SCRIPT_ID);
  if (!scriptEl) {
    el.loadStatus.textContent =
      "このHTMLは本ツールで書き出した編集用データを含んでいないため、読み込めませんでした。";
    return;
  }
  let data;
  try {
    data = JSON.parse(scriptEl.textContent);
  } catch (e) {
    el.loadStatus.textContent = "編集データの解析に失敗しました。";
    return;
  }
  el.editorBody.innerHTML = data.bodyHtml || "";
  state.meta = {
    schemaVersion: data.schemaVersion || SCHEMA_VERSION,
    savedAt: data.savedAt || null,
    sourceFileName: data.sourceFileName || fileName,
  };
  state.npcs = Array.isArray(data.npcs) ? data.npcs : [];
  finishLoad(fileName, "再読み込み(本ツールで書き出したHTML)");
}

function finishLoad(fileName, kindLabel) {
  state.loaded = true;
  el.loadStatus.textContent = `読み込み済み: ${fileName}(${kindLabel})`;
  el.sectionLoad.hidden = true;
  el.modeSwitch.hidden = false;
  el.exportBar.hidden = false;
  el.sidebarOpenBtn.hidden = false;
  syncAllHeadingIndents();
  setMode("edit");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============================================================
 * 編集⇄プレビュー モード切替(5.2)
 * ========================================================== */

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle("mode-edit", mode === "edit");
  document.body.classList.toggle("mode-preview", mode === "preview");
  el.btnModeEdit.classList.toggle("is-active", mode === "edit");
  el.btnModePreview.classList.toggle("is-active", mode === "preview");
  el.sectionEditor.hidden = mode !== "edit";
  el.sectionPreview.hidden = mode !== "preview";
  hideMiniToolbar();
  closeSidebar();

  if (mode === "preview") {
    renderPreview();
  }
  renderSidebarBody();
}

el.btnModeEdit.addEventListener("click", () => setMode("edit"));
el.btnModePreview.addEventListener("click", () => setMode("preview"));

/* ============================================================
 * ハンバーガーメニュー(サイドバードロワー)
 * ========================================================== */

function openSidebar() {
  renderSidebarBody();
  el.sidebar.hidden = false;
  el.sidebarBackdrop.hidden = false;
}

function closeSidebar() {
  // メニューを閉じたら、開いていた編集用トグルは畳んだ状態に戻す
  // (次に開いたときに前回の展開状態が残らないようにするため、5章UI要望、2026-07-24)。
  outlineOpenHid = null;
  npcOpenId = null;
  el.sidebar.hidden = true;
  el.sidebarBackdrop.hidden = true;
}

el.sidebarOpenBtn.addEventListener("click", openSidebar);
el.sidebarCloseBtn.addEventListener("click", closeSidebar);
el.sidebarBackdrop.addEventListener("click", closeSidebar);

// ハンバーガーメニューには、モードに応じて2つのセクションを縦に並べる
// (編集モード: アウトライン+NPC管理、プレビューモード: 目次+NPCカード。5.2参照)。
function renderSidebarBody() {
  el.sidebarBody.innerHTML = "";
  if (state.mode === "edit") {
    // 空行削除は書き出しボタンのすぐ下に来るよう、アウトラインより先に配置する
    // (2026-07-24、Mikoto要望)。
    el.sidebarBody.appendChild(buildSidebarSection("編集ツール", renderEditToolsView));
    el.sidebarBody.appendChild(buildSidebarSection("アウトライン", renderOutlineView));
    el.sidebarBody.appendChild(buildSidebarSection("NPC管理", renderNpcManageView));
  } else {
    el.sidebarBody.appendChild(buildSidebarSection("目次", renderTocList));
    el.sidebarBody.appendChild(buildSidebarSection("NPCカード", renderNpcCardView));
  }
}

function buildSidebarSection(title, renderFn) {
  const section = document.createElement("div");
  section.className = "sidebar-section";
  const heading = document.createElement("h3");
  heading.className = "sidebar-section__title";
  heading.textContent = title;
  section.appendChild(heading);
  const body = document.createElement("div");
  section.appendChild(body);
  renderFn(body);
  return section;
}

// 空行の一括削除ボタン(5章UI要望、2026-07-24)。段落単位の空<p>のみを対象とし、
// 見出しや本文が入っている段落は(テキストが残るため)誤って消えないようにする。
function renderEditToolsView(container) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--secondary btn--block";
  btn.textContent = "空行をまとめて削除";
  btn.addEventListener("click", () => {
    const paragraphs = Array.from(el.editorBody.children).filter((n) => n.tagName === "P");
    const emptyParagraphs = paragraphs.filter((p) => p.textContent.trim() === "");
    if (emptyParagraphs.length === 0) {
      showToast("削除できる空行はありませんでした。");
      return;
    }
    emptyParagraphs.forEach((p) => p.remove());
    scheduleAutoRender();
    showToast(`空行を${emptyParagraphs.length}件削除しました。`);
  });
  container.appendChild(btn);

  // 検索と置換(2026-07-24、Mikoto要望)。例: 本文中の「KPC」を一括で「{KPC}」に置換したい、など。
  const frTitle = document.createElement("p");
  frTitle.className = "edit-tools__subtitle";
  frTitle.textContent = "検索と置換";
  container.appendChild(frTitle);

  const searchField = document.createElement("div");
  searchField.className = "npc-edit-form__field";
  const searchLabel = document.createElement("label");
  searchLabel.className = "npc-edit-form__label";
  searchLabel.textContent = "検索する文字列";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "npc-edit-form__input";
  searchInput.placeholder = "例: KPC";
  searchField.appendChild(searchLabel);
  searchField.appendChild(searchInput);
  container.appendChild(searchField);

  const replaceField = document.createElement("div");
  replaceField.className = "npc-edit-form__field";
  const replaceLabel = document.createElement("label");
  replaceLabel.className = "npc-edit-form__label";
  replaceLabel.textContent = "置換後の文字列";
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.className = "npc-edit-form__input";
  replaceInput.placeholder = "例: {KPC}";
  replaceField.appendChild(replaceLabel);
  replaceField.appendChild(replaceInput);
  container.appendChild(replaceField);

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "btn btn--secondary btn--block";
  replaceBtn.textContent = "一括置換する";
  replaceBtn.addEventListener("click", () => {
    const searchTerm = searchInput.value;
    const replaceTerm = replaceInput.value;
    if (!searchTerm) {
      showToast("検索する文字列を入力してください。", true);
      return;
    }
    const count = findAndReplaceInEditor(searchTerm, replaceTerm);
    if (count === 0) {
      showToast("一致する文字列が見つかりませんでした。");
      return;
    }
    scheduleAutoRender();
    showToast(`「${searchTerm}」を${count}件、「${replaceTerm}」に置換しました。`);
  });
  container.appendChild(replaceBtn);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 本文中のテキストノードを走査し、単純な文字列一致で一括置換する。
// タグをまたいで分割された文字列(例: 太字装飾の途中で途切れている場合)は
// テキストノード単位でしか見ないため検出できない(既知の制約)。
function findAndReplaceInEditor(searchTerm, replaceTerm) {
  const walker = document.createTreeWalker(el.editorBody, NodeFilter.SHOW_TEXT, null);
  const re = new RegExp(escapeRegExp(searchTerm), "g");
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  let count = 0;
  textNodes.forEach((tn) => {
    const matches = tn.nodeValue.match(re);
    if (matches) {
      count += matches.length;
      tn.nodeValue = tn.nodeValue.replace(re, replaceTerm);
    }
  });
  return count;
}

/* ============================================================
 * 本文選択 → ミニツールバー(5.3)
 * iOS Safari実機検証で確認済みの方式(mousedown+preventDefaultで確定、
 * selectionchangeで常時バックアップ)を踏襲する。
 * ========================================================== */

let savedRange = null;

document.addEventListener("selectionchange", () => {
  captureCurrentSelectionIfAny();
  if (savedRange) {
    showMiniToolbarNear(savedRange);
  } else {
    hideMiniToolbar();
  }
});

function captureCurrentSelectionIfAny() {
  if (state.mode !== "edit") return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    // 開始点(anchorNode)だけでなく終了点もeditorBody内にあることを確認する。
    // ドラッグが本文の外(書き出しバーなど画面に固定表示されている要素)まで
    // はみ出すと、範囲の外接矩形が画面全体に近い大きさになり、ミニツールバーが
    // 選択位置と無関係な画面中央下寄りに表示されてしまうバグがあったため
    // (2026-07-24、Mikoto報告)、はみ出した選択はミニツールバーを出さないようにする。
    if (el.editorBody.contains(range.startContainer) && el.editorBody.contains(range.endContainer)) {
      savedRange = range.cloneRange();
      return;
    }
  }
  savedRange = null;
}

function showMiniToolbarNear(range) {
  // 複数行・複数段落にまたがる選択では、getBoundingClientRect()が段落と段落の間の
  // 余白を含んだ画面いっぱいに近い幅の矩形を返すことがある(段落全体が選択されている
  // 行間に、ブラウザが幅いっぱいのギャップ矩形を挟むため)。これをそのまま使うと、
  // ツールバーが選択位置と無関係な画面中央付近に表示されてしまう(2026-07-24、Mikoto報告)。
  // 実際の最上行のテキスト矩形(getClientRectsの先頭要素)を使い、選択範囲の上に
  // 表示されるようにする(2026-07-24、Mikoto要望: 最下行の上ではなく最上行の上に出したい)。
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) { hideMiniToolbar(); return; }
  el.miniToolbar.hidden = false;
  const barRect = el.miniToolbar.getBoundingClientRect();
  let top = rect.top - barRect.height - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - barRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - barRect.width - 8));
  el.miniToolbar.style.top = top + "px";
  el.miniToolbar.style.left = left + "px";
}

function hideMiniToolbar() {
  el.miniToolbar.hidden = true;
}

el.miniToolbar.querySelectorAll("button[data-action]").forEach((btn) => {
  btn.addEventListener("mousedown", (e) => {
    if (e.cancelable) e.preventDefault();
    captureCurrentSelectionIfAny();
  });
  btn.addEventListener("click", () => {
    applyMarkToSelection(btn.dataset.action);
  });
});

/* ============================================================
 * 見出し・文字装飾・コピペボタン設置の適用(5.4・5.6・5.12)
 * ========================================================== */

const DECORATION_TAGS = { bold: "STRONG", italic: "EM", underline: "U" };

// 選択範囲の中に、指定した条件に一致する既存のマーク(見出し・装飾・コピペボタン)が
// あればそれを返す(見つからなければnull)。同じ範囲を選び直して同じボタンを押すと
// 解除できるようにするための判定(5.4・5.6・5.12、2026-07-24、Mikoto要望)。
function findAncestorMark(node, matchFn) {
  let n = node.nodeType === 1 ? node : node.parentElement;
  while (n && n !== el.editorBody) {
    if (matchFn(n)) return n;
    n = n.parentElement;
  }
  return null;
}

// マーク要素を、その中身(子ノード)だけ残して取り除く(見出し解除・装飾解除・
// コピペボタン解除で共通に使う)。
function unwrapMarkElement(markEl) {
  const parent = markEl.parentNode;
  while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
  markEl.remove();
}

function removeCopyButtonMark(wrapperEl) {
  const target = wrapperEl.querySelector(".cp-target");
  const parent = wrapperEl.parentNode;
  if (target) {
    while (target.firstChild) parent.insertBefore(target.firstChild, wrapperEl);
  }
  wrapperEl.remove();
}

function applyMarkToSelection(type) {
  if (!savedRange) return;
  const range = savedRange;
  savedRange = null;
  if (!el.editorBody.contains(range.commonAncestorContainer)) { hideMiniToolbar(); return; }

  try {
    if (type === "heading") {
      const existing = findAncestorMark(range.commonAncestorContainer, (n) => n.classList && n.classList.contains("h-mark"));
      if (existing) {
        unwrapMarkElement(existing);
        syncAllHeadingIndents();
      } else {
        applyHeadingMark(range);
      }
    } else if (type === "copybtn") {
      const existing = findAncestorMark(range.commonAncestorContainer, (n) => n.classList && n.classList.contains("cp-wrap"));
      if (existing) {
        removeCopyButtonMark(existing);
      } else {
        applyCopyButtonMark(range);
      }
    } else if (type === "npc") {
      createNpcFromRange(range);
    } else if (type === "link") {
      openLinkPicker(range);
    } else {
      const tagName = DECORATION_TAGS[type];
      const existing = findAncestorMark(range.commonAncestorContainer, (n) => n.tagName === tagName);
      if (existing) {
        unwrapMarkElement(existing);
      } else {
        applyDecorationMark(range, type);
      }
    }
  } catch (e) {
    // 段落をまたいだ選択などで失敗した場合は何もしない
    console.error(e);
  }

  window.getSelection().removeAllRanges();
  hideMiniToolbar();
  scheduleAutoRender();
}

function closestBlock(node) {
  let n = node.nodeType === 1 ? node : node.parentElement;
  while (n && n.parentElement !== el.editorBody && n !== el.editorBody) {
    n = n.parentElement;
  }
  return n || el.editorBody;
}

// 選択範囲が含む段落(<p>)をすべて取得する。Range.toString()は段落境界に改行を
// 挿入しないため(複数行の選択が1行に潰れてしまう)、見出し化と同じ「段落単位」の
// 考え方で開始段落〜終了段落を辿り、行単位のテキストを組み立て直す(5.10のNPC自動抽出で使用)。
function getParagraphsInRange(range) {
  const startBlock = closestBlock(range.startContainer);
  const endBlock = closestBlock(range.endContainer);
  const result = [];
  let node = startBlock;
  while (node) {
    // innerHTML組み立て時の改行文字がテキストノードとして残っていることがあるため、
    // 段落要素(nodeType===1)だけを対象にする(buildSectionTreeと同じ考え方)。
    if (node.nodeType === 1) result.push(node);
    if (node === endBlock) break;
    node = node.nextSibling;
  }
  return result;
}

function getRawTextFromRange(range) {
  return getParagraphsInRange(range)
    .map((p) => plainTextExcludingCopyButtons(p))
    .join("\n");
}

// 見出し化(5.4): 選択範囲を独立した段落に切り出し、その段落全体を見出しにする。
// (アウトライン・トグル構造の組み立てを単純にするため、見出しは常に段落単位で持つ)
//
// 注意: トリプルクリックでの行選択は、選択範囲の終端が次の段落の先頭にまで
// 及ぶことがある(ブラウザの仕様)。その場合 range.commonAncestorContainer が
// editorBody 自体になってしまい、段落単位の処理が崩れるため、選択の開始位置
// (range.startContainer)を基準に対象段落を決め、終端がその段落の外に出ている
// ときは段落の末尾に丸める。
function applyHeadingMark(range) {
  const blockEl = closestBlock(range.startContainer);
  const tagName = blockEl.tagName === "P" ? "p" : "div";

  let endContainer = range.endContainer;
  let endOffset = range.endOffset;
  if (!blockEl.contains(endContainer)) {
    endContainer = blockEl;
    endOffset = blockEl.childNodes.length;
  }

  const afterRange = document.createRange();
  afterRange.setStart(endContainer, endOffset);
  afterRange.setEnd(blockEl, blockEl.childNodes.length);
  const afterFrag = afterRange.extractContents();

  const selectedRange = document.createRange();
  selectedRange.setStart(range.startContainer, range.startOffset);
  selectedRange.setEnd(endContainer, endOffset);
  const selectedFrag = selectedRange.extractContents();

  const headingP = document.createElement(tagName);
  const mark = document.createElement("span");
  mark.className = "h-mark";
  mark.dataset.hid = uid("h");
  mark.dataset.level = "1";
  mark.appendChild(selectedFrag);
  headingP.appendChild(mark);

  blockEl.parentNode.insertBefore(headingP, blockEl.nextSibling);

  if (afterFrag.textContent.trim() !== "") {
    const afterP = document.createElement(tagName);
    afterP.appendChild(afterFrag);
    headingP.parentNode.insertBefore(afterP, headingP.nextSibling);
  }

  if (blockEl.textContent.trim() === "") {
    blockEl.remove();
  }

  updateHeadingIndent(mark);
}

function applyDecorationMark(range, type) {
  const tag = type === "bold" ? "strong" : type === "italic" ? "em" : "u";
  const wrapper = document.createElement(tag);
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
}

let cpCounter = 0;

// コピー範囲は引用ブロックのようにまとめて表示する(2026-07-23、Mikoto要望)。
// <span>のままdisplay:blockにすることで、<p>の中に入れてもHTMLとして不正にならない
// ようにしている(<div>を<p>の中に入れると構造が壊れるため)。
function applyCopyButtonMark(range) {
  cpCounter++;
  const cpId = "cp_" + cpCounter + "_" + Date.now().toString(36);

  const wrapper = document.createElement("span");
  wrapper.className = "cp-wrap";
  wrapper.dataset.cpid = cpId;

  const target = document.createElement("span");
  target.className = "cp-target";
  target.dataset.cpid = cpId;
  target.appendChild(range.extractContents());
  wrapper.appendChild(target);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cp-btn";
  btn.dataset.cpid = cpId;
  btn.textContent = "📋コピー";
  wrapper.appendChild(btn);

  range.insertNode(wrapper);
}

// コピペボタンのクリックはエディタ・プレビューどちらでも動作させる(委譲リスナー)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".cp-btn");
  if (!btn) return;
  let text;
  if (btn.dataset.copyText !== undefined) {
    text = btn.dataset.copyText;
  } else {
    const span = document.querySelector(`.cp-target[data-cpid="${btn.dataset.cpid}"]`);
    text = span ? span.textContent : "";
  }
  copyTextToClipboard(text);
});

/* ============================================================
 * 内部リンク(5.13)
 * 見出し・NPCカードへのリンクを手動で設定できる機能(自動検出は行わない)。
 * ミニツールバーの「リンク」から、選択範囲のリンク先を見出し・NPC一覧から選ぶ
 * ピッカーを開き、選んだ時点で選択範囲を<a class="int-link">で包む。
 * ========================================================== */

let pendingLinkRange = null;

function openLinkPicker(range) {
  pendingLinkRange = range;
  renderLinkPickerBody();
  el.linkPicker.hidden = false;
  el.linkPickerBackdrop.hidden = false;
}

function closeLinkPicker() {
  pendingLinkRange = null;
  el.linkPicker.hidden = true;
  el.linkPickerBackdrop.hidden = true;
}

el.btnLinkPickerClose.addEventListener("click", closeLinkPicker);
el.linkPickerBackdrop.addEventListener("click", closeLinkPicker);

function renderLinkPickerBody() {
  const body = el.linkPickerBody;
  body.innerHTML = "";

  const headingSection = document.createElement("div");
  headingSection.className = "link-picker__section";
  const headingTitle = document.createElement("div");
  headingTitle.className = "link-picker__section-title";
  headingTitle.textContent = "見出し";
  headingSection.appendChild(headingTitle);

  const headings = getHeadingMarks();
  if (headings.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "見出しがありません。";
    headingSection.appendChild(p);
  } else {
    headings.forEach((markEl) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link-picker__item";
      const level = parseInt(markEl.dataset.level || "1", 10);
      btn.style.paddingLeft = 8 + (level - 1) * 14 + "px";
      btn.textContent = markEl.textContent;
      btn.addEventListener("click", () => {
        applyLinkMark(pendingLinkRange, "heading", markEl.dataset.hid);
        closeLinkPicker();
      });
      headingSection.appendChild(btn);
    });
  }
  body.appendChild(headingSection);

  const npcSection = document.createElement("div");
  npcSection.className = "link-picker__section";
  const npcTitle = document.createElement("div");
  npcTitle.className = "link-picker__section-title";
  npcTitle.textContent = "NPCカード";
  npcSection.appendChild(npcTitle);

  if (state.npcs.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "登録されたNPCがいません。";
    npcSection.appendChild(p);
  } else {
    state.npcs.forEach((npc) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link-picker__item";
      btn.textContent = npc.name || "(名前未設定)";
      btn.addEventListener("click", () => {
        applyLinkMark(pendingLinkRange, "npc", npc.id);
        closeLinkPicker();
      });
      npcSection.appendChild(btn);
    });
  }
  body.appendChild(npcSection);
}

function applyLinkMark(range, linkType, targetId) {
  if (!range) return;
  const a = document.createElement("a");
  a.className = "int-link";
  a.href = "#" + targetId;
  a.dataset.linkType = linkType;
  a.dataset.target = targetId;
  a.appendChild(range.extractContents());
  range.insertNode(a);
  scheduleAutoRender();
}

// 内部リンクのクリックは、編集モードでは何もしない(誤操作・カーソル移動との
// 競合を避けるため、Mikoto確認済み)。プレビューモードでのみジャンプする。
document.addEventListener("click", (e) => {
  const link = e.target.closest(".int-link");
  if (!link) return;
  e.preventDefault();
  if (state.mode !== "preview") return;
  if (link.dataset.linkType === "heading") {
    jumpToHeading(link.dataset.target);
  } else if (link.dataset.linkType === "npc") {
    jumpToNpc(link.dataset.target);
  }
});

// NPCカードへジャンプする。目次と同じく、画面幅900px以上では常時表示の
// インラインパネル、それ未満ではハンバーガードロワーにNPCカードがある(5.2・5.9参照)。
function jumpToNpc(npcId) {
  const inlineVisible = getComputedStyle(el.tocPanelInline).display !== "none";
  if (inlineVisible) {
    scrollToNpcCardIn(el.npcCardsInline, npcId);
  } else {
    openSidebar();
    scrollToNpcCardIn(el.sidebarBody, npcId);
  }
}

function scrollToNpcCardIn(container, npcId) {
  if (!container) return;
  const card = container.querySelector(`[data-npc-id="${npcId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.add("npc-card--highlight");
  setTimeout(() => card.classList.remove("npc-card--highlight"), 1500);
}

/* ============================================================
 * クリップボードコピー(iOS Safari実機検証で確認済みの方式)
 * ========================================================== */

let toastTimer = null;

// コピー成否をトースト通知で表示する(2026-07-23、Mikoto要望)
function showToast(message, isError) {
  el.toast.textContent = message;
  el.toast.classList.toggle("is-error", !!isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2000);
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showToast("コピーしました"),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) {
      showToast("コピーしました");
    } else {
      showToast("コピーに失敗しました", true);
    }
  } catch (e) {
    console.error("コピーに失敗しました", e);
    showToast("コピーに失敗しました", true);
  }
}

/* ============================================================
 * 見出し一覧の取得(5.5・5.9共通)
 * ========================================================== */

function getHeadingMarks() {
  return Array.from(el.editorBody.querySelectorAll(".h-mark"));
}

function getHeadingParagraph(markEl) {
  let n = markEl;
  while (n.parentElement !== el.editorBody && n.parentElement) {
    n = n.parentElement;
  }
  return n;
}

// 見出しレベルを編集タブ上でも見た目でわかるように、見出し段落だけでなく
// 次の見出しが現れるまでの本文段落にも同じインデントを付ける(2026-07-23、Mikoto要望)。
function updateHeadingIndent(markEl) {
  const level = parseInt(markEl.dataset.level || "1", 10);
  const marginPx = level > 1 ? (level - 1) * 20 + "px" : "";
  getSectionParagraphs(markEl).forEach((p) => {
    if (p && p.style) p.style.marginLeft = marginPx;
  });
}

function syncAllHeadingIndents() {
  getHeadingMarks().forEach((markEl) => updateHeadingIndent(markEl));
}

function getSectionParagraphs(markEl) {
  const marks = getHeadingMarks();
  const idx = marks.indexOf(markEl);
  const startP = getHeadingParagraph(markEl);
  const nextMark = marks[idx + 1];
  const endP = nextMark ? getHeadingParagraph(nextMark) : null;
  const result = [];
  let node = startP;
  while (node && node !== endP) {
    result.push(node);
    node = node.nextSibling;
  }
  return result;
}

/* ============================================================
 * アウトラインビュー(5.5)
 * ========================================================== */

// 現在「上へ/下へ/上位/下位」ボタンを展開表示中の見出し(hid)。なければnull。
// 編集タブの視認性向上のため、通常は折りたたんでおき、編集中の見出しだけ展開する
// (5.5、2026-07-24、Mikoto要望)。見出しの解除・本文ごと削除は、ミニツールバーで
// 同じ範囲を選び直して「見出し」ボタンを再度押すことで行う(applyMarkToSelection参照)。
let outlineOpenHid = null;

function renderOutlineView(container) {
  container.classList.remove("toc-list");
  container.innerHTML = "";
  const marks = getHeadingMarks();

  if (marks.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "まだ見出しが設定されていません。本文を選択し、ミニツールバーの「見出し」で設定してください。";
    container.appendChild(p);
    return;
  }

  const list = document.createElement("div");
  list.className = "outline-list";

  marks.forEach((markEl, index) => {
    const item = document.createElement("div");
    item.className = "outline-item";

    const row = document.createElement("div");
    row.className = "outline-item__row";

    const levelLabel = document.createElement("span");
    levelLabel.className = "outline-item__level";
    levelLabel.textContent = "Lv" + (markEl.dataset.level || "1");
    row.appendChild(levelLabel);

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "outline-item__text";
    textInput.value = markEl.textContent;
    textInput.addEventListener("change", () => {
      markEl.textContent = textInput.value;
      scheduleAutoRender();
    });
    row.appendChild(textInput);

    const isOpen = outlineOpenHid === markEl.dataset.hid;
    const toggleTitle = isOpen ? "編集欄を閉じる" : "並び替え・階層を編集";
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "outline-item__toggle";
    toggleBtn.textContent = isOpen ? "▾" : "▸";
    toggleBtn.title = toggleTitle;
    toggleBtn.setAttribute("aria-label", toggleTitle);
    toggleBtn.addEventListener("click", () => {
      outlineOpenHid = isOpen ? null : markEl.dataset.hid;
      renderOutlineView(container);
    });
    row.appendChild(toggleBtn);

    item.appendChild(row);

    if (isOpen) {
      const actions = document.createElement("div");
      actions.className = "outline-item__actions";

      actions.appendChild(makeOutlineActionBtn("▲", "上へ移動", index > 0, () => {
        moveHeadingUp(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));
      actions.appendChild(makeOutlineActionBtn("▼", "下へ移動", index < marks.length - 1, () => {
        moveHeadingDown(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));
      actions.appendChild(makeOutlineActionBtn("◀", "上位階層にする", true, () => {
        markEl.dataset.level = String(clampLevel(parseInt(markEl.dataset.level || "1", 10) - 1));
        updateHeadingIndent(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));
      actions.appendChild(makeOutlineActionBtn("▶", "下位階層にする", true, () => {
        markEl.dataset.level = String(clampLevel(parseInt(markEl.dataset.level || "1", 10) + 1));
        updateHeadingIndent(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));

      item.appendChild(actions);
    }

    list.appendChild(item);
  });

  container.appendChild(list);
}

function makeOutlineBtn(label, enabled, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--secondary btn--small";
  btn.textContent = label;
  btn.disabled = !enabled;
  btn.addEventListener("click", onClick);
  return btn;
}

// 上へ/下へ/上位/下位の4ボタンを1行に収めるため、矢印記号のみを表示し、
// 説明はtitle(長押し・ホバーで表示)に持たせる(5章UI要望、2026-07-24)。
function makeOutlineActionBtn(label, title, enabled, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--secondary outline-item__action-btn";
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.disabled = !enabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function moveHeadingUp(markEl) {
  const marks = getHeadingMarks();
  const idx = marks.indexOf(markEl);
  if (idx <= 0) return;
  const prevP = getHeadingParagraph(marks[idx - 1]);
  const paragraphs = getSectionParagraphs(markEl);
  paragraphs.forEach((p) => prevP.parentNode.insertBefore(p, prevP));
}

function moveHeadingDown(markEl) {
  const marks = getHeadingMarks();
  const idx = marks.indexOf(markEl);
  if (idx === -1 || idx >= marks.length - 1) return;
  const nextParagraphs = getSectionParagraphs(marks[idx + 1]);
  const insertBefore = nextParagraphs.length
    ? nextParagraphs[nextParagraphs.length - 1].nextSibling
    : null;
  const paragraphs = getSectionParagraphs(markEl);
  paragraphs.forEach((p) => el.editorBody.insertBefore(p, insertBefore));
}

/* ============================================================
 * NPC管理(5.10、編集モード)
 * 能力値・ステータス・技能(チャットパレット用)は、いずれも作品ごとの表記差が
 * 大きく自動抽出は行わない方針(5.10参照)のため、行の追加・削除ができる
 * 可変長リストとして手動入力する。アウトラインビュー(renderOutlineView)と
 * 同じ「一覧+ボタンで編集」の考え方を踏襲している。
 * ========================================================== */

let npcOpenId = null; // 現在展開中のNPC編集フォーム(なければnull)

function createEmptyNpc() {
  return {
    id: uid("npc"),
    name: "",
    profile: "",
    commandPrefix: "CCB", // 判定コマンドの6版(CCB)/7版(CC)。技能の自動抽出でのみ使う(5.11)
    params: [], // 能力値: [{label, value}]
    status: [], // ステータス: [{label, value, max}]
    skills: [], // 技能・チャットパレット行: [{command, label}]
  };
}

/* ============================================================
 * 選択範囲からのNPC半自動抽出(5.10、2026-07-24追加)
 * 見出し(5.4)は作品ごとに書式が違いすぎて自動検出を断念した経緯があるが、
 * NPCステータス欄はSTR/CON等の決まった略語や判定コマンドの書式に一定の
 * 規則性があるとMikotoから実例つきで指摘があったため、「まず自動抽出を試み、
 * 結果は原文とあわせて必ず手動修正できる」方式で導入する。
 * ========================================================== */

const NPC_PARAM_LABELS = ["STR", "CON", "POW", "DEX", "APP", "SIZ", "INT", "EDU"];
const NPC_STATUS_NUMERIC_LABELS = ["HP", "MP", "SAN", "耐久力", "正気度", "装甲", "BLD", "MOV"];

// 全角数字を半角に変換する(「２５」→「25」)。
function normalizeDigits(str) {
  return str.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// テキスト全体から「ラベル+数値」のペアを走査する。区切りが「：」「:」「半角スペース」
// 「区切りなし」のいずれでも拾えるよう、区切り文字はすべて任意(0文字含む)にしている。
function extractStatValues(text, labels, valuePattern) {
  const regex = new RegExp("(" + labels.join("|") + ")[：:]?\\s*(" + valuePattern + ")", "gi");
  const results = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    results.push({ label: m[1], value: normalizeDigits(m[2]), max: "" });
  }
  return results;
}

// 行の先頭トークンが判定コマンド(CCB<=/CC<=を含む)か、素のダイス表記(1d3+1d4など)かを判定する。
// 「sCCB<=87」のように前置文字が付く独自表記もそのまま拾えるよう、行頭一致ではなく部分一致にする。
function isSkillCommandToken(token) {
  return /(CCB|CC)<=/i.test(token) || /^[0-9０-９]+[dD][0-9０-９]+/.test(token);
}

// 技能名+数値のあとに続く文言からダイス表記だけを探して取り出す(完全一致ではなく検索なので、
// 「1d10(故障ナンバー00)　１R１回攻撃」のような余分な文言が混ざっていても、そこだけ正しく拾える)。
// 「1d3+1d4」のような複合ダイス表記も1つのダイス表記として続けて拾えるようにしている。
const DICE_TOKEN_REGEX = /[0-9０-９]+[dD][0-9０-９]+(?:[+\-][0-9０-９]+(?:[dD][0-9０-９]+)?)*/;

// 技能・チャットパレット行を抽出する。
// - 「CCB<=50 【こぶし（パンチ）】」のように判定コマンドで始まる行は、そのままコマンド+ラベルとして採用する
//   (ラベル側にダメージ表記まで続いていても、誤って分割せずそのままラベルに残す)。
// - 「回避：26％」「＜回避＞32」のように判定コマンドが書かれていない行は、NPCごとに手動設定した
//   commandPrefix(CCB=6版/CC=7版、Mikoto確認済み: バージョン判定は自動化せず手動設定に委ねる方針)
//   を使ってコマンドを組み立てる。数値の後にダイス表記が続く場合は、それを「ダメージ判定」ラベルの
//   別行として追加する(実例のチャットパレット記法で「1d3+1D4 【ダメージ判定】」という表記が
//   繰り返し使われていたのに合わせた)。
// - 本文中に「【チャットパレット】」「技能」の見出し行がある場合、そこより前の地の文の技能表記
//   (％表記・＜＞表記など)は同じ技能をすでに完成形で書いた重複であることが多いため無視し、
//   見出し以降の行だけを対象にする(実例で、地の文の「回避：26％」等とチャットパレット欄の
//   「CCB<=26 【回避】」が両方存在していた)。
function extractSkillLines(lines, commandPrefix) {
  const markerIndex = lines.findIndex((line) => {
    const t = line.replace(/\s/g, "");
    return t === "【チャットパレット】" || t === "技能";
  });
  const targetLines = markerIndex >= 0 ? lines.slice(markerIndex + 1) : lines;

  const percentLineRegex = /^(.+?)[：:]\s*([0-9０-９]+)％(?:\s+(\S.*))?$/;
  const angleLineRegex = /^[＜<](.+?)[＞>]\s*([0-9０-９]+)(?:\s+(.*))?$/;
  const skills = [];

  function pushSynthesized(name, percentage, trailing) {
    skills.push({ command: `${commandPrefix}<=${normalizeDigits(percentage)}`, label: name.trim() });
    if (trailing) {
      const diceMatch = trailing.match(DICE_TOKEN_REGEX);
      if (diceMatch) skills.push({ command: diceMatch[0], label: "ダメージ判定" });
    }
  }

  targetLines.forEach((line) => {
    const firstToken = line.split(/\s+/)[0] || "";
    if (isSkillCommandToken(firstToken)) {
      const label = line.slice(firstToken.length).trim().replace(/^【/, "").replace(/】$/, "");
      skills.push({ command: firstToken, label });
      return;
    }
    let m = line.match(percentLineRegex);
    if (m) {
      pushSynthesized(m[1], m[2], m[3]);
      return;
    }
    m = line.match(angleLineRegex);
    if (m) {
      pushSynthesized(m[1], m[2], m[3]);
      return;
    }
  });
  return skills;
}

// 選択範囲の生テキストからNPCカードを組み立てる。抽出結果に関わらず、選択範囲の全文を
// 必ずプロフィール欄にも残す(自動抽出が外れても情報が消えないための安全策)。
function extractNpcFromText(rawText) {
  const npc = createEmptyNpc();
  npc.profile = rawText.trim();

  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length > 0) {
    // 先頭の「**」(Markdown太字)や「〇」等の箇条書き記号だけを除去する(それ以上の区切り推測はしない)。
    npc.name = lines[0].replace(/^[\*〇○●■□◆・]+/, "").replace(/\*+$/, "").trim();
  }

  npc.params = extractStatValues(rawText, NPC_PARAM_LABELS, "[0-9０-９]+");
  // 「装甲：なし」のように数値を持たないステータス表記もそのままカードには残す
  // (ただしCCFOLIA駒出力のstatusは数値必須のため、buildCcfoliaJson側で除外する)。
  const statusNumeric = extractStatValues(rawText, NPC_STATUS_NUMERIC_LABELS, "[0-9０-９]+|なし");
  const dbValues = extractStatValues(rawText, ["DB"], "[+\\-]?[0-9０-９]+(?:[dD][0-9０-９]+)?");
  npc.status = statusNumeric.concat(dbValues);

  npc.skills = extractSkillLines(lines, npc.commandPrefix);

  return npc;
}

function createNpcFromRange(range) {
  const rawText = getRawTextFromRange(range);
  const npc = extractNpcFromText(rawText);
  state.npcs.push(npc);
  npcOpenId = npc.id;
  openSidebar();
}

function renderNpcManageView(container) {
  container.innerHTML = "";

  const list = document.createElement("div");
  list.className = "outline-list";

  if (state.npcs.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "まだNPCが登録されていません。";
    list.appendChild(p);
  }

  state.npcs.forEach((npc) => {
    const item = document.createElement("div");
    item.className = "outline-item";

    const row = document.createElement("div");
    row.className = "outline-item__row";

    const levelLabel = document.createElement("span");
    levelLabel.className = "outline-item__level";
    levelLabel.textContent = "NPC";
    row.appendChild(levelLabel);

    const nameDisplay = document.createElement("span");
    nameDisplay.className = "outline-item__text";
    nameDisplay.style.background = "none";
    nameDisplay.style.border = "none";
    nameDisplay.textContent = npc.name || "(名前未設定)";
    row.appendChild(nameDisplay);

    item.appendChild(row);

    const actions = document.createElement("div");
    actions.className = "outline-item__actions";

    const isOpen = npcOpenId === npc.id;
    actions.appendChild(makeOutlineBtn(isOpen ? "閉じる" : "編集", true, () => {
      npcOpenId = isOpen ? null : npc.id;
      renderNpcManageView(container);
    }));
    const delBtn = makeOutlineBtn("削除", true, () => {
      if (!confirm(`NPC「${npc.name || "(名前未設定)"}」を削除します。よろしいですか？(元に戻せません)`)) return;
      state.npcs = state.npcs.filter((n) => n.id !== npc.id);
      if (npcOpenId === npc.id) npcOpenId = null;
      renderNpcManageView(container);
    });
    delBtn.classList.add("btn--danger");
    actions.appendChild(delBtn);

    item.appendChild(actions);

    if (isOpen) {
      item.appendChild(buildNpcEditForm(npc, () => renderNpcManageView(container)));
    }

    list.appendChild(item);
  });

  container.appendChild(list);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn--primary btn--block btn--small";
  addBtn.style.marginTop = "10px";
  addBtn.textContent = "＋ NPCを追加";
  addBtn.addEventListener("click", () => {
    const npc = createEmptyNpc();
    state.npcs.push(npc);
    npcOpenId = npc.id;
    renderNpcManageView(container);
  });
  container.appendChild(addBtn);
}

function buildNpcEditForm(npc, rerender) {
  const form = document.createElement("div");
  form.className = "npc-edit-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "npc-edit-form__input";
  nameInput.placeholder = "NPC名";
  nameInput.value = npc.name;
  nameInput.addEventListener("input", () => { npc.name = nameInput.value; });
  nameInput.addEventListener("change", rerender); // 一覧側の表示名を更新する
  form.appendChild(npcLabeledField("名前", nameInput));

  const profileInput = document.createElement("textarea");
  profileInput.className = "npc-edit-form__textarea";
  profileInput.placeholder = "プロフィール文";
  profileInput.rows = 3;
  profileInput.value = npc.profile;
  profileInput.addEventListener("input", () => { npc.profile = profileInput.value; });
  form.appendChild(npcLabeledField("プロフィール", profileInput));

  const prefixSelect = document.createElement("select");
  prefixSelect.className = "npc-edit-form__input";
  [["CCB", "CCB(6版)"], ["CC", "CC(7版)"]].forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (npc.commandPrefix === value) opt.selected = true;
    prefixSelect.appendChild(opt);
  });
  prefixSelect.addEventListener("change", () => {
    const newPrefix = prefixSelect.value;
    npc.commandPrefix = newPrefix;
    // 既にCCB<=/CC<=形式で入っている技能行は、新しい版に合わせてコマンドを置き換える
    // (「sCCB<=95」のような独自表記や、ダイス表記だけの行は対象外のまま残す)。
    npc.skills.forEach((row) => {
      if (/^(CCB|CC)<=/i.test(row.command || "")) {
        row.command = row.command.replace(/^(CCB|CC)/i, newPrefix);
      }
    });
    rerender();
  });
  form.appendChild(npcLabeledField("判定コマンド(「回避：26％」等の自動抽出で使用)", prefixSelect));

  form.appendChild(buildNpcRowsField(npc, "params", "能力値", [
    { key: "label", placeholder: "STR" },
    { key: "value", placeholder: "10" },
  ], rerender));

  form.appendChild(buildNpcRowsField(npc, "status", "ステータス(HP・SANなど)", [
    { key: "label", placeholder: "HP" },
    { key: "value", placeholder: "10" },
    { key: "max", placeholder: "最大値(任意)" },
  ], rerender));

  form.appendChild(buildNpcRowsField(npc, "skills", "技能・チャットパレット", [
    { key: "command", placeholder: "CCB<=70" },
    { key: "label", placeholder: "目星" },
  ], rerender));

  return form;
}

function npcLabeledField(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "npc-edit-form__field";
  const label = document.createElement("label");
  label.className = "npc-edit-form__label";
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function buildNpcRowsField(npc, key, title, fields, rerender) {
  const wrap = document.createElement("div");
  wrap.className = "npc-edit-form__field";

  const label = document.createElement("div");
  label.className = "npc-edit-form__label";
  label.textContent = title;
  wrap.appendChild(label);

  npc[key].forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "npc-row";
    fields.forEach((f) => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "npc-row__input";
      input.placeholder = f.placeholder;
      input.value = row[f.key] || "";
      input.addEventListener("input", () => { row[f.key] = input.value; });
      rowEl.appendChild(input);
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn npc-row__del";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", () => {
      npc[key] = npc[key].filter((r) => r !== row);
      rerender();
    });
    rowEl.appendChild(delBtn);
    wrap.appendChild(rowEl);
  });

  const addRowBtn = document.createElement("button");
  addRowBtn.type = "button";
  addRowBtn.className = "btn btn--secondary btn--small";
  addRowBtn.textContent = "＋ 行を追加";
  addRowBtn.addEventListener("click", () => {
    const newRow = {};
    fields.forEach((f) => { newRow[f.key] = ""; });
    npc[key].push(newRow);
    rerender();
  });
  wrap.appendChild(addRowBtn);

  return wrap;
}

/* ============================================================
 * 目次(5.9)
 * ========================================================== */

function renderTocList(container) {
  container.classList.add("toc-list");
  container.innerHTML = "";
  const marks = getHeadingMarks();
  if (marks.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "見出しがありません。";
    container.appendChild(p);
    return;
  }
  marks.forEach((markEl) => {
    const a = document.createElement("a");
    a.href = "#" + markEl.dataset.hid;
    const level = parseInt(markEl.dataset.level || "1", 10);
    a.style.paddingLeft = (level - 1) * 14 + "px";
    a.textContent = markEl.textContent;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      jumpToHeading(markEl.dataset.hid);
      closeSidebar();
    });
    container.appendChild(a);
  });
}

function jumpToHeading(id) {
  const target = document.getElementById(id);
  if (!target) return;
  let d = target.tagName === "DETAILS" ? target : target.closest("details");
  while (d) {
    d.open = true;
    d = d.parentElement ? d.parentElement.closest("details") : null;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.jumpToHeading = jumpToHeading;

/* ============================================================
 * NPCカード表示(5.10・5.11、プレビューモード)
 * チャットパレット・ココフォリアJSON文字列の組み立ては、書き出しHTML側の
 * buildNpcCardsHtml(文字列版)とも共用する純粋関数として用意している。
 * ========================================================== */

function renderNpcCardView(container) {
  container.innerHTML = "";
  if (state.npcs.length === 0) {
    const p = document.createElement("p");
    p.className = "outline-empty";
    p.textContent = "登録されたNPCがありません。";
    container.appendChild(p);
    return;
  }
  state.npcs.forEach((npc) => container.appendChild(buildNpcCardEl(npc)));
}

function buildNpcCardEl(npc) {
  const card = document.createElement("div");
  card.className = "npc-card";
  card.dataset.npcId = npc.id; // 内部リンク(5.13)からのジャンプ先として使う

  const name = document.createElement("div");
  name.className = "npc-card__name";
  name.textContent = npc.name || "(名前未設定)";
  card.appendChild(name);

  if (npc.profile) {
    const profile = document.createElement("p");
    profile.className = "npc-card__profile";
    profile.textContent = npc.profile;
    card.appendChild(profile);
  }

  if (npc.params.length > 0) card.appendChild(buildNpcStatTableEl("能力値", npc.params, false));
  if (npc.status.length > 0) card.appendChild(buildNpcStatTableEl("ステータス", npc.status, true));

  if (npc.skills.length > 0) {
    const skillsTitle = document.createElement("div");
    skillsTitle.className = "npc-card__section-title";
    skillsTitle.textContent = "技能・チャットパレット";
    card.appendChild(skillsTitle);

    const skillsList = document.createElement("div");
    skillsList.className = "npc-card__skills";
    npc.skills.forEach((s) => {
      const line = formatSkillLine(s);
      if (!line) return;
      const lineEl = document.createElement("div");
      lineEl.className = "npc-card__skill-line";
      lineEl.textContent = line;
      skillsList.appendChild(lineEl);
    });
    card.appendChild(skillsList);
  }

  const actions = document.createElement("div");
  actions.className = "npc-card__actions";

  const copyPaletteBtn = document.createElement("button");
  copyPaletteBtn.type = "button";
  copyPaletteBtn.className = "btn btn--secondary btn--small cp-btn";
  copyPaletteBtn.textContent = "📋 チャットパレットをコピー";
  copyPaletteBtn.dataset.copyText = buildChatPaletteText(npc);
  actions.appendChild(copyPaletteBtn);

  const copyJsonBtn = document.createElement("button");
  copyJsonBtn.type = "button";
  copyJsonBtn.className = "btn btn--secondary btn--small cp-btn";
  copyJsonBtn.textContent = "📋 ココフォリア駒出力";
  copyJsonBtn.dataset.copyText = buildCcfoliaJson(npc);
  actions.appendChild(copyJsonBtn);

  card.appendChild(actions);
  return card;
}

function buildNpcStatTableEl(title, rows, withMax) {
  const wrap = document.createElement("div");
  wrap.className = "npc-card__section";
  const t = document.createElement("div");
  t.className = "npc-card__section-title";
  t.textContent = title;
  wrap.appendChild(t);
  const grid = document.createElement("div");
  grid.className = "npc-card__stat-grid";
  rows.forEach((r) => {
    const cell = document.createElement("div");
    cell.className = "npc-card__stat-cell";
    cell.textContent = `${r.label || ""}: ${formatStatValue(r, withMax)}`;
    grid.appendChild(cell);
  });
  wrap.appendChild(grid);
  return wrap;
}

function formatStatValue(row, withMax) {
  if (withMax && row.max) return `${row.value || ""}/${row.max}`;
  return row.value || "";
}

// チャットパレット記法(5.11): 「[判定コマンド] 【技能名】」を1行ずつ並べる。
function formatSkillLine(skill) {
  const command = (skill.command || "").trim();
  const label = (skill.label || "").trim();
  if (!command && !label) return "";
  return label ? `${command} 【${label}】` : command;
}

function buildChatPaletteText(npc) {
  return npc.skills.map(formatSkillLine).filter((line) => line !== "").join("\n");
}

// ココフォリアのクリップボードAPI(kind:"character")形式のJSON文字列を組み立てる。
// docs.ccfolia.com/developer-api/clipboard-api で公式に型定義が示されている通り、
// params[].value は文字列型、status[].value/max は数値型と、能力値とステータスで
// 型が異なる(2026-07-24、公式ドキュメントを直接確認して修正。以前はvalueを両方とも
// 数値化しており、これが能力値が駒に反映されない原因だった)。
// status側は数値型が必須のため、「装甲：なし」や「DB：2d6」のように数値化できない値は
// ステータス欄には出力できない(NPCカード上の表示・チャットパレットには引き続き残る)。
function buildCcfoliaJson(npc) {
  const status = npc.status
    .map((s) => {
      const hasValue = s.value !== undefined && s.value !== null && String(s.value).trim() !== "";
      if (!hasValue) return null;
      const value = Number(normalizeDigits(String(s.value)));
      if (!Number.isFinite(value)) return null; // 数値化できない値はCCFOLIAのstatusに出せないため除外

      // maxが未入力の場合は0にはせず(Number("")が0になってしまう罠を避ける)、valueと同じ値にして
      // 「満タン」として扱う。
      const hasMax = s.max !== undefined && s.max !== null && String(s.max).trim() !== "";
      const maxNum = hasMax ? Number(normalizeDigits(String(s.max))) : NaN;
      return { label: s.label || "", value, max: Number.isFinite(maxNum) ? maxNum : value };
    })
    .filter((s) => s !== null);

  const data = {
    kind: "character",
    data: {
      name: npc.name || "",
      memo: npc.profile || "",
      status,
      params: npc.params.map((p) => ({
        label: p.label || "",
        value: String(p.value || ""),
      })),
      commands: buildChatPaletteText(npc),
    },
  };
  return JSON.stringify(data);
}

/* ============================================================
 * トグル構造の組み立て(5.5・5.8)
 * 見出しは常に「独立した段落」であるという前提(applyHeadingMark参照)に
 * もとづき、段落を先頭から見て見出し段落が出るたびに新しいdetailsを開始する。
 * ========================================================== */

function buildToggleTree(rootEl) {
  const frag = document.createDocumentFragment();
  const stack = [{ level: 0, container: frag }];

  Array.from(rootEl.childNodes).forEach((child) => {
    let markEl = null;
    if (child.nodeType === 1) {
      markEl = child.classList && child.classList.contains("h-mark")
        ? child
        : child.querySelector && child.querySelector(":scope > .h-mark");
    }

    if (markEl) {
      const level = parseInt(markEl.dataset.level || "1", 10);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();

      const details = document.createElement("details");
      details.className = "toggle-block";
      details.id = markEl.dataset.hid || "";

      const summary = document.createElement("summary");
      summary.innerHTML = markEl.innerHTML;
      details.appendChild(summary);

      const bodyDiv = document.createElement("div");
      bodyDiv.className = "toggle-body";
      details.appendChild(bodyDiv);

      stack[stack.length - 1].container.appendChild(details);
      stack.push({ level, container: bodyDiv });
    } else {
      stack[stack.length - 1].container.appendChild(child);
    }
  });

  return frag;
}

/* ============================================================
 * プレビュー描画(5.8・5.9)
 * ========================================================== */

function renderPreview() {
  el.previewContent.innerHTML = "";
  const clone = el.editorBody.cloneNode(true);
  el.previewContent.appendChild(buildToggleTree(clone));
  renderTocList(el.tocListInline);
  // 画面幅900px以上では常時表示のtoc-panel-inlineを使う(ハンバーガーメニューは
  // このとき非表示になるため、5.2で決めたNPCカード閲覧もここに出す必要がある)。
  renderNpcCardView(el.npcCardsInline);
}

let renderTimer = null;
function scheduleAutoRender() {
  if (state.mode !== "preview") return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 150);
}

/* ============================================================
 * 書き出し用スタンドアロンHTMLの生成(5.14-1・5.15)
 * ========================================================== */

function buildStandaloneHtml() {
  const savedAt = new Date().toISOString();
  state.meta.savedAt = savedAt;

  const bodyClone = el.editorBody.cloneNode(true);
  // コピペボタンの対象テキストを data-copy-text に埋め込み、
  // 書き出し後の単体HTMLだけでもクリップボードコピーが動くようにする。
  bodyClone.querySelectorAll(".cp-btn").forEach((btn) => {
    const span = bodyClone.querySelector(`.cp-target[data-cpid="${btn.dataset.cpid}"]`);
    btn.setAttribute("data-copy-text", span ? span.textContent : "");
  });

  const toggleTree = buildToggleTree(bodyClone);
  const wrapper = document.createElement("div");
  wrapper.appendChild(toggleTree);
  const bodyHtml = wrapper.innerHTML;

  const tocHtml = getHeadingMarks()
    .map((m) => {
      const level = parseInt(m.dataset.level || "1", 10);
      return `<a href="#${m.dataset.hid}" style="padding-left:${(level - 1) * 14}px" onclick="jumpToHeading('${m.dataset.hid}');return false;">${escapeHtml(m.textContent)}</a>`;
    })
    .join("\n");

  const npcCardsHtml = buildNpcCardsHtml();

  const jsonData = {
    schemaVersion: SCHEMA_VERSION,
    savedAt,
    sourceFileName: state.meta.sourceFileName || null,
    bodyHtml: el.editorBody.innerHTML,
    npcs: state.npcs,
  };
  const jsonText = JSON.stringify(jsonData, null, 2).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(state.meta.sourceFileName || "シナリオ")}</title>
<style>
${STANDALONE_CSS}
</style>
</head>
<body>
<button type="button" id="btn-toc-open" class="toc-toggle-btn">☰ 目次・NPC</button>
<div class="layout">
  <div class="content">
${bodyHtml}
  </div>
  <aside class="toc" id="toc-panel">
    <div class="toc__header">
      <strong>目次・NPC</strong>
      <button type="button" id="btn-toc-close">×</button>
    </div>
    <div class="toc__section-title">目次</div>
    ${tocHtml}
    <div class="toc__section-title">NPCカード</div>
    ${npcCardsHtml}
  </aside>
</div>
<div class="toast" id="toast" hidden></div>
<script>
${STANDALONE_JS}
</script>
<script type="application/json" id="${STATE_SCRIPT_ID}">
${jsonText}
</script>
</body>
</html>`;
}

// 書き出しHTML用: NPCカードをHTML文字列として組み立てる(5.10・5.11)。
// ライブ編集アプリのbuildNpcCardEl(DOM版)と表示内容は同じだが、単体HTMLファイルに
// 直接埋め込む必要があるため、目次のtocHtmlと同様に文字列組み立て版を別途用意している。
// コピーボタンはSTANDALONE_JS側の.cp-btn委譲リスナー(data-copy-text読み取り)をそのまま使う。
function buildNpcCardsHtml() {
  if (state.npcs.length === 0) {
    return '<p class="toc-empty-note">登録されたNPCがありません。</p>';
  }
  return state.npcs.map(buildNpcCardHtml).join("\n");
}

function buildNpcCardHtml(npc) {
  let html = `<div class="npc-card" data-npc-id="${escapeHtml(npc.id)}">`;
  html += `<div class="npc-card__name">${escapeHtml(npc.name || "(名前未設定)")}</div>`;
  if (npc.profile) {
    html += `<p class="npc-card__profile">${escapeHtml(npc.profile)}</p>`;
  }
  if (npc.params.length > 0) html += buildNpcStatTableHtml("能力値", npc.params, false);
  if (npc.status.length > 0) html += buildNpcStatTableHtml("ステータス", npc.status, true);

  if (npc.skills.length > 0) {
    html += `<div class="npc-card__section-title">技能・チャットパレット</div>`;
    html += `<div class="npc-card__skills">`;
    npc.skills.forEach((s) => {
      const line = formatSkillLine(s);
      if (line) html += `<div class="npc-card__skill-line">${escapeHtml(line)}</div>`;
    });
    html += `</div>`;
  }

  html += `<div class="npc-card__actions">`;
  html += `<button type="button" class="cp-btn" data-copy-text="${escapeHtml(buildChatPaletteText(npc))}">📋 チャットパレットをコピー</button>`;
  html += `<button type="button" class="cp-btn" data-copy-text="${escapeHtml(buildCcfoliaJson(npc))}">📋 ココフォリア駒出力</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function buildNpcStatTableHtml(title, rows, withMax) {
  let html = `<div class="npc-card__section"><div class="npc-card__section-title">${escapeHtml(title)}</div><div class="npc-card__stat-grid">`;
  rows.forEach((r) => {
    html += `<div class="npc-card__stat-cell">${escapeHtml(r.label || "")}: ${escapeHtml(formatStatValue(r, withMax))}</div>`;
  });
  html += `</div></div>`;
  return html;
}

const STANDALONE_CSS = `
:root {
  --accent:#2196f3; --danger:#c62828; --bg:#f4f4f2; --panel-bg:#ffffff;
  --border:#ddd6c4; --cp-bg:#e3f1ff; --text:#222222; --text-muted:#555555; --text-faint:#888888;
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent:#64b5f6; --danger:#e57373; --bg:#1c1c1e; --panel-bg:#28282c;
    --border:#47453c; --cp-bg:#1e3549; --text:#e8e8e6; --text-muted:#b6b6b2; --text-faint:#8f8f8b;
  }
}
body { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif; margin:0; padding:12px; background:var(--bg); color:var(--text); line-height:1.8; }
.layout { display:flex; gap:16px; align-items:flex-start; }
.content { flex:1; min-width:0; max-width:720px; margin:0 auto; background:var(--panel-bg); border-radius:8px; padding:14px; font-size:0.95rem; }
.content p { margin:0 0 0.9em; }
.h-mark { display:none; }
.toggle-block { border:1px solid var(--border); border-radius:6px; padding:6px 10px; margin:0 0 10px; }
.toggle-block > summary { font-weight:bold; cursor:pointer; padding:4px 0; }
.toggle-body { padding-left:4px; margin-top:6px; }
.cp-wrap { display:block; border-left:3px solid var(--accent); background:var(--cp-bg); padding:8px 10px; margin:8px 0; border-radius:0 6px 6px 0; }
.cp-target { display:block; margin-bottom:6px; }
.cp-btn { display:inline-block; padding:4px 10px; font-size:0.8rem; border:none; border-radius:5px; background:var(--accent); color:#fff; }
.toc-toggle-btn { position:fixed; top:10px; right:10px; z-index:20; border:none; background:var(--accent); color:#fff; padding:8px 12px; border-radius:6px; }
.toc { display:none; }
.toc.is-open { display:block; position:fixed; top:0; right:0; height:100%; width:min(280px,85vw); background:var(--panel-bg); color:var(--text); z-index:30; box-shadow:-2px 0 8px rgba(0,0,0,0.2); padding:12px; overflow-y:auto; }
.toc__header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.toc a { display:block; padding:4px 0; font-size:0.85rem; color:var(--accent); text-decoration:none; }
.toc__section-title { font-size:0.78rem; color:var(--text-faint); margin:14px 0 6px; }
.toc-empty-note { font-size:0.85rem; color:var(--text-faint); }
@media (min-width:900px) {
  .toc-toggle-btn { display:none; }
  .toc { display:block; width:280px; flex-shrink:0; background:var(--panel-bg); border-radius:8px; padding:12px; position:sticky; top:12px; }
}
.npc-card { border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:12px; background:var(--panel-bg); }
.npc-card__name { font-weight:bold; font-size:1rem; margin-bottom:4px; }
.npc-card__profile { font-size:0.85rem; color:var(--text-muted); white-space:pre-wrap; margin:0 0 8px; }
.npc-card__section { margin-bottom:8px; }
.npc-card__section-title { font-size:0.78rem; color:var(--text-faint); margin-bottom:4px; }
.npc-card__stat-grid { display:flex; flex-wrap:wrap; gap:4px 8px; }
.npc-card__stat-cell { font-size:0.8rem; background:var(--bg); border-radius:4px; padding:2px 6px; }
.npc-card__skills { display:flex; flex-direction:column; gap:2px; }
.npc-card__skill-line { font-size:0.78rem; font-family:monospace; }
.npc-card__actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.npc-card--highlight { outline:3px solid var(--accent); outline-offset:2px; }
.int-link { color:var(--accent); text-decoration:underline; }
.toast { position:fixed; bottom:70px; left:50%; transform:translateX(-50%); background:#263238; color:#fff; padding:8px 18px; border-radius:20px; font-size:0.85rem; z-index:50; box-shadow:0 2px 8px rgba(0,0,0,0.3); max-width:90vw; text-align:center; }
.toast.is-error { background:var(--danger); }
`;

const STANDALONE_JS = `
function jumpToHeading(id) {
  var target = document.getElementById(id);
  if (!target) return;
  var d = target.tagName === 'DETAILS' ? target : target.closest('details');
  while (d) { d.open = true; d = d.parentElement ? d.parentElement.closest('details') : null; }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
var toastTimer = null;
function showToast(message, isError) {
  var t = document.getElementById('toast');
  t.textContent = message;
  t.classList.toggle('is-error', !!isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2000);
}
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.cp-btn');
  if (!btn) return;
  var text = btn.getAttribute('data-copy-text') || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      function () { showToast('コピーしました'); },
      function () { fallbackCopy(text); }
    );
  } else {
    fallbackCopy(text);
  }
});
function fallbackCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      showToast('コピーしました');
    } else {
      showToast('コピーに失敗しました', true);
    }
  } catch (e) {
    showToast('コピーに失敗しました', true);
  }
}
document.getElementById('btn-toc-open').addEventListener('click', function () {
  document.getElementById('toc-panel').classList.add('is-open');
});
document.getElementById('btn-toc-close').addEventListener('click', function () {
  document.getElementById('toc-panel').classList.remove('is-open');
});
document.addEventListener('click', function (e) {
  var link = e.target.closest('.int-link');
  if (!link) return;
  e.preventDefault();
  var type = link.getAttribute('data-link-type');
  var target = link.getAttribute('data-target');
  if (type === 'heading') {
    jumpToHeading(target);
  } else if (type === 'npc') {
    var panel = document.getElementById('toc-panel');
    if (getComputedStyle(panel).display === 'none') {
      panel.classList.add('is-open');
    }
    var card = panel.querySelector('[data-npc-id="' + target + '"]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.add('npc-card--highlight');
      setTimeout(function () { card.classList.remove('npc-card--highlight'); }, 1500);
    }
  }
});
`;

/* ============================================================
 * Markdown・TXT書き出し(5.14-2・5.14-3)
 * HTML書き出しとは別に、見出し・本文を「見出し段落は独立している」という
 * 前提(applyHeadingMark参照)にもとづき木構造化して書き出す。
 * NPCカード・コピー&ペーストボタンは記録用途に不要のため出力に含めない。
 * ========================================================== */

function getHeadingTextByHid(hid) {
  const mark = getHeadingMarks().find((m) => m.dataset.hid === hid);
  return mark ? mark.textContent : "";
}

// 見出しへの内部リンク(5.13)をMarkdownのアンカーリンク`[text](#slug)`に変換するための
// スラッグ生成。Notion実際のアンカー生成規則そのものではなく、GitHub等で一般的な
// slug化ルール(小文字化・空白をハイフンに・記号除去、日本語はそのまま残す)にもとづく
// 暫定実装(推測です)。11章7番の検証は英単語見出し1件のみのため、日本語見出しでの
// 実際の動作(Notion側のアンカーと一致するか)は未検証。
function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, "")
    .replace(/\s+/g, "-");
}

// 見出し段落をもとに、本文全体を{level, heading, bodyNodes, children}の木構造にする。
// buildToggleTree(HTML書き出し用)と同じ「見出しは独立した段落」という前提を使うが、
// 見出しレベルごとに出力形式が異なるMarkdown/TXTでは木構造のまま持っておく必要があるため
// 別関数として用意している。
function buildSectionTree(rootEl) {
  const root = { level: 0, heading: null, bodyNodes: [], children: [] };
  const stack = [root];

  Array.from(rootEl.childNodes).forEach((child) => {
    let markEl = null;
    if (child.nodeType === 1) {
      markEl = child.classList && child.classList.contains("h-mark")
        ? child
        : child.querySelector && child.querySelector(":scope > .h-mark");
    }

    if (markEl) {
      const level = parseInt(markEl.dataset.level || "1", 10);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const node = { level, heading: markEl, bodyNodes: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].bodyNodes.push(child);
    }
  });

  return root;
}

// 段落内のHTML(装飾・コピペボタン)をMarkdown用のインライン記法に変換する。
// 太字→**text**、イタリック→*text*、下線→<u>text</u>(5.6参照)。
// コピペボタンは記録用途に不要のため、対象テキストだけ残してボタンは除去する。
function convertInlineToMarkdown(node) {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.classList && child.classList.contains("cp-btn")) {
        return;
      }
      const tag = child.tagName;
      if (tag === "STRONG" || tag === "B") {
        out += "**" + convertInlineToMarkdown(child) + "**";
      } else if (tag === "EM" || tag === "I") {
        out += "*" + convertInlineToMarkdown(child) + "*";
      } else if (tag === "U") {
        out += "<u>" + convertInlineToMarkdown(child) + "</u>";
      } else if (child.classList && child.classList.contains("int-link")) {
        const label = convertInlineToMarkdown(child);
        if (child.dataset.linkType === "heading") {
          const headingText = getHeadingTextByHid(child.dataset.target);
          out += `[${label}](#${slugifyHeading(headingText)})`;
        } else {
          // NPCカードは記録用途に不要のためMarkdown出力に含めない(5.10)。リンク先が
          // 存在しないため、リンクにはせずラベルのテキストだけ残す。
          out += label;
        }
      } else {
        out += convertInlineToMarkdown(child);
      }
    }
  });
  return out;
}

function bodyParagraphsAsMarkdown(bodyNodes) {
  return bodyNodes
    .filter((n) => n.nodeType === 1 && n.tagName === "P")
    .map((p) => convertInlineToMarkdown(p).trim())
    .filter((t) => t !== "")
    .join("\n\n");
}

function renderMarkdownNode(node) {
  let out = "";
  const bodyText = bodyParagraphsAsMarkdown(node.bodyNodes);

  if (node.heading) {
    const headingText = convertInlineToMarkdown(node.heading).trim();
    // 全階層をトグルリスト形式(<details><summary>、11章7番参照)で出力する。
    // 以前は最上位の見出しだけ通常の見出し4(トグルなし)にしていたが(貼り付け経由では
    // トグル見出しのショートカットが機能しなかったため)、折りたたみを優先したいとの
    // 要望を受け、最上位も含めて統一した(2026-07-24、Mikoto要望)。
    out += "<details>\n<summary>" + headingText + "</summary>\n\n";
    if (bodyText) out += bodyText + "\n\n";
    node.children.forEach((child) => { out += renderMarkdownNode(child); });
    out += "</details>\n\n";
  } else {
    if (bodyText) out += bodyText + "\n\n";
    node.children.forEach((child) => { out += renderMarkdownNode(child); });
  }
  return out;
}

function buildMarkdownExport() {
  const clone = el.editorBody.cloneNode(true);
  const tree = buildSectionTree(clone);
  return renderMarkdownNode(tree).trim() + "\n";
}

// TXT書き出し(Claude判断で暫定決定、5.14-3参照): 記号・Markdown記法を使わず、
// 見出しは階層レベルに応じたインデントを付けて改行区切りで並べ、本文を続ける。
// コピペボタン(<button class="cp-btn">)のラベル文字は本文ではないため、
// textContentを取る前に取り除く。
function plainTextExcludingCopyButtons(p) {
  const clone = p.cloneNode(true);
  clone.querySelectorAll(".cp-btn").forEach((btn) => btn.remove());
  return (clone.textContent || "").trim();
}

function renderTxtNode(node) {
  let out = "";
  if (node.heading) {
    const indent = "  ".repeat(Math.max(node.level - 1, 0));
    out += indent + (node.heading.textContent || "").trim() + "\n";
  }
  const bodyText = node.bodyNodes
    .filter((n) => n.nodeType === 1 && n.tagName === "P")
    .map((p) => plainTextExcludingCopyButtons(p))
    .filter((t) => t !== "")
    .join("\n");
  if (bodyText) out += bodyText + "\n";
  node.children.forEach((child) => { out += renderTxtNode(child); });
  if (node.heading) out += "\n";
  return out;
}

function buildTxtExport() {
  const clone = el.editorBody.cloneNode(true);
  const tree = buildSectionTree(clone);
  return renderTxtNode(tree).trim() + "\n";
}

function downloadFile(content, mimeType, fileName) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

el.btnExportDownload.addEventListener("click", () => {
  const base = (state.meta.sourceFileName || "シナリオ").replace(/\.[^.]+$/, "");
  const format = el.exportFormatSelect.value;

  if (format === "markdown") {
    downloadFile(buildMarkdownExport(), "text/markdown", base + "_記録用.md");
  } else if (format === "text") {
    downloadFile(buildTxtExport(), "text/plain", base + "_記録用.txt");
  } else {
    downloadFile(buildStandaloneHtml(), "text/html", base + "_整形.html");
  }
});
