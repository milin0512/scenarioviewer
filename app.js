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
  btnUndo: document.getElementById("btn-undo"),
  btnFindToggle: document.getElementById("btn-find-toggle"),
  btnRemoveEmptyLines: document.getElementById("btn-remove-empty-lines"),
  findBar: document.getElementById("find-bar"),
  findInput: document.getElementById("find-input"),
  btnFindRun: document.getElementById("btn-find-run"),
  btnFindPrev: document.getElementById("btn-find-prev"),
  btnFindNext: document.getElementById("btn-find-next"),
  btnFindClose: document.getElementById("btn-find-close"),
  replaceInput: document.getElementById("replace-input"),
  btnReplaceAll: document.getElementById("btn-replace-all"),
  findStatus: document.getElementById("find-status"),
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

// 複数ファイルの同時読み込みに対応する(2026-07-27、Mikoto要望)。シナリオがシーンごとに
// 複数のTXTに分かれて書かれている場合があるため、選んだ順に上から連結して1本の本文にする。
// 読み込み済みの状態からさらに追加したい場合のために、置き換え(replace)と末尾追加(append)の
// 2モードを持たせている(サイドバー最下部のボタンから呼ぶ。5.1参照)。
let pendingLoadMode = "replace";

el.fileInput.addEventListener("change", () => {
  const files = Array.from(el.fileInput.files || []);
  const mode = pendingLoadMode;
  pendingLoadMode = "replace";
  // 同じファイルを続けて選び直せるよう、値をクリアしておく(changeイベントが発火しなくなるため)。
  el.fileInput.value = "";
  if (files.length === 0) return;
  loadFiles(files, mode);
});

async function loadFiles(files, mode) {
  el.loadStatus.textContent =
    files.length > 1 ? `${files.length}件のファイルを読み込んでいます…` : "ファイルを読み込んでいます…";
  const parts = [];
  for (const file of files) {
    try {
      parts.push(await readFileAsPart(file));
    } catch (e) {
      console.error(e);
      el.loadStatus.textContent = `「${file.name}」の読み込みに失敗しました: ${e.message}`;
      return;
    }
  }
  applyLoadedParts(parts, mode);
}

// 1ファイルを読み込み、本文HTML・NPC・表示用のラベルに変換する(実際の反映はapplyLoadedParts)。
async function readFileAsPart(file) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  if (isPdf) {
    const text = await extractPdfText(file);
    return { fileName: file.name, kind: "PDF", html: plainTextToParagraphsHtml(text), npcs: [] };
  }

  const buffer = await file.arrayBuffer();
  const text = decodeTextFile(buffer);
  const isHtml = /\.html?$/i.test(file.name) || /<html[\s>]/i.test(text.slice(0, 500));
  if (isHtml) {
    const data = parseToolExportedHtml(text);
    return {
      fileName: file.name,
      kind: "本ツールで書き出したHTML",
      html: data.bodyHtml || "",
      npcs: Array.isArray(data.npcs) ? data.npcs : [],
      meta: data,
    };
  }
  return { fileName: file.name, kind: "TXT", html: plainTextToParagraphsHtml(text), npcs: [] };
}

function applyLoadedParts(parts, mode) {
  const html = parts.map((p) => p.html).join("\n");
  const npcs = parts.reduce((acc, p) => acc.concat(p.npcs), []);
  const names = parts.map((p) => p.fileName).join(" / ");

  if (mode === "append") {
    // 追加読み込みは「元に戻す」で取り消せるようにする(2026-07-27)。
    pushUndoSnapshot();
    el.editorBody.innerHTML = el.editorBody.innerHTML + "\n" + html;
    state.npcs = state.npcs.concat(npcs);
    state.meta.sourceFileName = state.meta.sourceFileName
      ? `${state.meta.sourceFileName} / ${names}`
      : names;
    el.loadStatus.textContent = `読み込み済み: ${state.meta.sourceFileName}`;
    clearSearchHighlights();
    syncAllHeadingIndents();
    scheduleAutoRender();
    renderSidebarBody();
    showToast(`${parts.length}件のファイルを末尾に追加しました。`);
    return;
  }

  el.editorBody.innerHTML = html;
  // 本ツールで書き出したHTMLが含まれる場合は、その保存情報を引き継ぐ(複数ある場合は最初のもの)。
  const exported = parts.find((p) => p.meta);
  state.meta = {
    schemaVersion: (exported && exported.meta.schemaVersion) || SCHEMA_VERSION,
    savedAt: (exported && exported.meta.savedAt) || null,
    sourceFileName: names,
  };
  state.npcs = npcs;
  const kindLabel = parts.length > 1 ? `${parts.length}ファイルを連結` : parts[0].kind;
  finishLoad(names, kindLabel);
}

function plainTextToParagraphsHtml(text) {
  // 空行は&nbsp;(実体は半角スペース相当の文字)ではなく<br>で高さを保持する。
  // &nbsp;だと選択・コピー・NPC自動抽出時などに余分な空白文字として残ってしまうため
  // (2026-07-24、Mikoto報告)。
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("\n");
}

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

async function extractPdfText(file) {
  el.loadStatus.textContent = `PDF「${file.name}」を解析しています…`;
  if (!window.pdfjsLib) throw new Error("pdf.jsの読み込みに失敗しています。");
  const pdfjsLib = window.pdfjsLib;
  const arrayBuffer = await file.arrayBuffer();
  // isEvalSupported:false は CVE-2024-4367(pdf.js 4.2.67未満で、細工したPDFのFontMatrix
  // 経由で任意のJavaScriptが実行される問題)に対する公式の回避策。同梱しているpdf.jsは
  // 3.11.174で影響範囲に入るため明示的に無効化する(2026-07-27のセキュリティ点検)。
  // 本ツールはテキスト抽出しか行わず描画しないため、無効化による実害はない。
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    isEvalSupported: false,
  }).promise;

  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    pageTexts.push(buildPdfPageText(textContent, viewport.height));
  }
  return pageTexts.join("\n\n");
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

// 本ツールで書き出したHTML(隠しJSONつき、5.15)から編集データを取り出す。
function parseToolExportedHtml(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, "text/html");
  const scriptEl = doc.getElementById(STATE_SCRIPT_ID);
  if (!scriptEl) {
    throw new Error("本ツールで書き出した編集用データを含んでいないHTMLです");
  }
  let data;
  try {
    data = JSON.parse(scriptEl.textContent);
  } catch (e) {
    throw new Error("編集データの解析に失敗しました");
  }
  // 読み込んだHTMLは第三者が作った可能性のある外部データとして扱い、必ず洗浄する
  // (2026-07-27のセキュリティ点検で、細工したHTMLを読み込ませると本文中の
  // イベントハンドラ属性(<img onerror=...>など)が実行できてしまうことを確認したため)。
  data.bodyHtml = sanitizeLoadedBodyHtml(data.bodyHtml || "");
  data.npcs = sanitizeLoadedNpcs(data.npcs);
  return data;
}

/* ============================================================
 * 読み込んだHTMLの洗浄(2026-07-27、セキュリティ点検にもとづく対策)
 *
 * 本文は innerHTML で流し込むため、外部ファイル由来のHTMLをそのまま入れると
 * イベントハンドラ属性による任意コード実行(XSS)が成立してしまう。さらに、
 * 汚染された本文はそのまま書き出しファイルにも引き継がれ、卓のメンバーへ配布した
 * 先でも実行されうる。そこで、本ツールが実際に生成しうるタグ・属性だけを許可する
 * ホワイトリスト方式で洗浄する(許可外は削除。未知のタグは中身のテキストを残して
 * タグだけ剥がすので、シナリオ本文が失われることはない)。
 * ========================================================== */

// 本ツールが本文中に生成するタグ(5.4・5.6・5.12・5.13で使うもの)
const ALLOWED_BODY_TAGS = new Set([
  "P", "DIV", "BR", "SPAN", "STRONG", "EM", "B", "I", "U", "A", "BUTTON",
]);

// 中身ごと捨てるタグ(テキストとして残すとかえって不自然・危険なもの)
const DROPPED_BODY_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "BASE",
  "FORM", "INPUT", "TEXTAREA", "SELECT", "OPTION", "IMG", "SVG", "MATH",
  "VIDEO", "AUDIO", "SOURCE", "TRACK", "CANVAS", "TEMPLATE", "NOSCRIPT",
]);

// 本ツールが使う属性(これ以外はon*属性含めすべて削除する)
const ALLOWED_BODY_ATTRS = new Set([
  "class", "style", "type",
  "data-hid", "data-level", "data-cpid", "data-link-type", "data-target", "data-copy-text",
]);

// data-hid / data-cpid などのIDは、後でセレクタや書き出しの属性値に埋め込まれるため、
// 英数字・ハイフン・アンダースコアだけに正規化する(引用符などを混ぜられないようにする)。
function safeIdValue(value, fallbackPrefix) {
  const cleaned = String(value == null ? "" : value).replace(/[^A-Za-z0-9_-]/g, "");
  return cleaned || uid(fallbackPrefix);
}

// styleは本ツール自身がmargin-left/margin-bottomを書き込むため属性ごとは消せない。
// url()など外部参照を招く記法を含むものだけ落とす。
function safeStyleValue(value) {
  const v = String(value || "");
  if (/url\s*\(|expression\s*\(|javascript:|@import|<|\\/i.test(v)) return "";
  return v;
}

function sanitizeLoadedBodyHtml(htmlString) {
  const doc = new DOMParser().parseFromString(
    "<div id=\"__root\">" + String(htmlString || "") + "</div>",
    "text/html"
  );
  const root = doc.getElementById("__root");
  if (!root) return "";

  // 子孫を書き換えながら走査するため、先に配列化してから処理する。
  Array.from(root.querySelectorAll("*")).forEach((node) => {
    if (!node.isConnected) return; // 親ごと削除済み

    if (DROPPED_BODY_TAGS.has(node.tagName)) {
      node.remove();
      return;
    }

    if (!ALLOWED_BODY_TAGS.has(node.tagName)) {
      // 未知のタグは中身(本文テキスト)だけ残してタグを剥がす。
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_BODY_ATTRS.has(name)) {
        // on*属性・src・formactionなどはここですべて落ちる。
        node.removeAttribute(attr.name);
        return;
      }
      if (name === "style") {
        const safe = safeStyleValue(attr.value);
        if (safe) node.setAttribute("style", safe);
        else node.removeAttribute("style");
      } else if (name === "data-hid") {
        node.setAttribute("data-hid", safeIdValue(attr.value, "h"));
      } else if (name === "data-cpid") {
        node.setAttribute("data-cpid", safeIdValue(attr.value, "cp"));
      } else if (name === "data-target") {
        node.setAttribute("data-target", safeIdValue(attr.value, "t"));
      } else if (name === "data-level") {
        node.setAttribute("data-level", String(clampLevel(parseInt(attr.value, 10) || 1)));
      }
    });

    // 内部リンクのhrefは同一ページ内アンカーだけに限定する(javascript:等を排除)。
    if (node.tagName === "A") {
      const target = node.getAttribute("data-target");
      node.setAttribute("href", "#" + (target || ""));
    }
    // ボタンはtype="button"以外にしない(フォーム送信等を起こさせない)。
    if (node.tagName === "BUTTON") node.setAttribute("type", "button");
  });

  return root.innerHTML;
}

// NPCカードのデータは表示時にテキストとして扱われるため中身の文字列は問題ないが、
// idだけはセレクタ・属性値に埋め込まれるため正規化する。
function sanitizeLoadedNpcs(npcs) {
  if (!Array.isArray(npcs)) return [];
  return npcs.map((npc) => {
    const safe = Object.assign({}, npc);
    safe.id = safeIdValue(npc && npc.id, "npc");
    return safe;
  });
}

function finishLoad(fileName, kindLabel) {
  state.loaded = true;
  el.loadStatus.textContent = `読み込み済み: ${fileName}(${kindLabel})`;
  el.sectionLoad.hidden = true;
  el.modeSwitch.hidden = false;
  el.exportBar.hidden = false;
  el.sidebarOpenBtn.hidden = false;
  clearSearchHighlights();
  syncAllHeadingIndents();
  // 新しいファイルを読み込んだら、それ以前の編集内容に戻れても意味がないため
  // 元に戻す履歴もリセットする(2026-07-25)。
  undoStack = [];
  updateUndoButton();
  setMode("edit");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // シングルクォートも落とす(属性値を'...'で囲む箇所に備えた保険。2026-07-27)
    .replace(/'/g, "&#39;");
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
  updateRibbonVisibility();
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
    // 旧「編集ツール」セクション(空行削除・検索・一括置換)は、サイドバーが長くなりすぎたため
    // 上部リボンと検索バーへ移した(2026-07-27、Mikoto要望。5.3・5.16参照)。
    el.sidebarBody.appendChild(buildSidebarSection("アウトライン", renderOutlineView));
    el.sidebarBody.appendChild(buildSidebarSection("NPC管理", renderNpcManageView));
  } else {
    el.sidebarBody.appendChild(buildSidebarSection("目次", renderTocList));
    el.sidebarBody.appendChild(buildSidebarSection("NPCカード", renderNpcCardView));
  }
  // ファイル操作はメニューの最下部に置く(2026-07-27、Mikoto要望)。
  el.sidebarBody.appendChild(buildSidebarSection("ファイル", renderFileToolsView));
}

// ホーム画面に追加した状態(スタンドアロン表示)ではブラウザのリロードが使えず、
// 一度ファイルを読み込むと別のファイルに切り替えられなくなるため、メニュー最下部から
// 読み込み直せるようにする(2026-07-27、Mikoto要望)。あわせて、シーンごとに分かれた
// TXTを後から継ぎ足せるよう「追加で読み込む」も用意している。
function renderFileToolsView(container) {
  const current = document.createElement("p");
  current.className = "edit-tools__note";
  current.textContent = state.meta.sourceFileName
    ? `現在: ${state.meta.sourceFileName}`
    : "現在: (ファイル未読み込み)";
  container.appendChild(current);

  const appendBtn = document.createElement("button");
  appendBtn.type = "button";
  appendBtn.className = "btn btn--secondary btn--block";
  // ラベルはボタン内で折り返さない長さに収める(2026-07-27、Mikoto要望)。
  // 「末尾に追加」「入れ替え」の違いは、この2つを並べた対比で伝わるようにしている。
  appendBtn.textContent = "ファイルを追加で読み込む";
  appendBtn.addEventListener("click", () => {
    pendingLoadMode = "append";
    el.fileInput.click();
  });
  container.appendChild(appendBtn);

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "btn btn--secondary btn--block";
  reloadBtn.textContent = "別のファイルに入れ替える";
  reloadBtn.addEventListener("click", () => {
    const ok = window.confirm(
      "現在の編集内容を破棄して、別のファイルを読み込み直します。よろしいですか?\n" +
        "(書き出していない見出し・NPC・装飾はすべて失われます)"
    );
    if (!ok) return;
    pendingLoadMode = "replace";
    el.fileInput.click();
  });
  container.appendChild(reloadBtn);
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

/* ============================================================
 * 空行の一括削除(5章UI要望、2026-07-24)
 * 段落単位の空<p>のみを対象とし、見出しや本文が入っている段落は
 * (テキストが残るため)誤って消えないようにする。
 * サイドバーが長くなりすぎたためリボンへ移した(2026-07-27、Mikoto要望)。
 * ========================================================== */

el.btnRemoveEmptyLines.addEventListener("click", () => {
  const paragraphs = Array.from(el.editorBody.children).filter((n) => n.tagName === "P");
  const emptyParagraphs = paragraphs.filter((p) => p.textContent.trim() === "");
  if (emptyParagraphs.length === 0) {
    showToast("削除できる空行はありませんでした。");
    return;
  }
  pushUndoSnapshot();
  emptyParagraphs.forEach((p) => p.remove());
  scheduleAutoRender();
  showToast(`空行を${emptyParagraphs.length}件削除しました。`);
});

/* ============================================================
 * 検索・一括置換バー(5.16)
 * リボンの🔍で開閉する。検索と一括置換はボタンを分けたまま扱う
 * (2026-07-27、Mikoto要望により統合しない)。
 * ========================================================== */

function updateFindBarStatus() {
  if (searchHits.length === 0) {
    el.findStatus.textContent = lastSearchFoundNone ? "一致する箇所はありません。" : "";
  } else {
    el.findStatus.textContent = `「${lastSearchTerm}」${searchHits.length}件中 ${searchHitIndex + 1}件目`;
  }
  el.btnFindPrev.disabled = searchHits.length === 0;
  el.btnFindNext.disabled = searchHits.length === 0;
}

function setFindBarOpen(open) {
  el.findBar.hidden = !open;
  el.btnFindToggle.classList.toggle("is-active", open);
  if (open) {
    el.findInput.value = lastSearchTerm;
    updateFindBarStatus();
    el.findInput.focus();
    el.findInput.select();
  } else {
    clearSearchHighlights();
  }
}

el.btnFindToggle.addEventListener("click", () => setFindBarOpen(el.findBar.hidden));
el.btnFindClose.addEventListener("click", () => setFindBarOpen(false));

function runFind() {
  const searchTerm = el.findInput.value;
  if (!searchTerm) {
    showToast("検索する文字列を入力してください。", true);
    return;
  }
  const count = highlightAllMatches(searchTerm);
  if (count === 0) {
    updateFindBarStatus();
    showToast(`「${searchTerm}」は見つかりませんでした。`);
    return;
  }
  focusSearchHit(0);
  updateFindBarStatus();
  showToast(`「${searchTerm}」が${count}件見つかりました。`);
}

el.btnFindRun.addEventListener("click", runFind);

// 入力欄でEnter(iOSのソフトキーボードの「検索」「改行」含む)でも検索できるようにする。
el.findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runFind();
  }
});

el.btnFindNext.addEventListener("click", () => {
  if (searchHits.length === 0) return;
  focusSearchHit(searchHitIndex + 1);
  updateFindBarStatus();
});

el.btnFindPrev.addEventListener("click", () => {
  if (searchHits.length === 0) return;
  focusSearchHit(searchHitIndex - 1);
  updateFindBarStatus();
});

// 一括置換(2026-07-24、Mikoto要望)。例: 本文中の「KPC」を一括で「{KPC}」に置換したい、など。
// 検索欄の文字列をそのまま使うため、検索した後に置換したくなっても入力し直す必要がない
// (2026-07-27、Mikoto要望)。ボタンは検索とは別のまま。
el.btnReplaceAll.addEventListener("click", () => {
  const searchTerm = el.findInput.value;
  const replaceTerm = el.replaceInput.value;
  if (!searchTerm) {
    showToast("検索する文字列を入力してください。", true);
    return;
  }
  // 検索マークが残っているとテキストノードが分割され、置換の一致判定が崩れるため
  // 先に解除する(2026-07-27)。
  clearSearchHighlights();
  pushUndoSnapshot();
  const count = findAndReplaceInEditor(searchTerm, replaceTerm);
  if (count === 0) {
    undoStack.pop();
    updateUndoButton();
    updateFindBarStatus();
    showToast("一致する文字列が見つかりませんでした。");
    return;
  }
  lastSearchFoundNone = false;
  updateFindBarStatus();
  scheduleAutoRender();
  showToast(`「${searchTerm}」を${count}件、「${replaceTerm}」に置換しました。`);
});

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ============================================================
 * 検索マーク(5.16)
 * 一致箇所をすべて<span class="search-hit">で囲んで色づけし、「次の一致箇所へ」で
 * 順番に巡回できるようにする(2026-07-27、Mikoto要望。当初は先頭1件を選択するだけだった)。
 *
 * このマークはあくまで一時的な表示用で、本文データの一部ではない。そのため、
 * 本文を読み書きする操作(プレビュー描画・書き出し・元に戻す・一括置換・本文の直接編集など)の
 * 前には必ずclearSearchHighlights()で取り除き、書き出したファイルやUndo履歴に
 * 混入しないようにしている。
 * ========================================================== */

let searchHits = [];
let searchHitIndex = 0;
let lastSearchTerm = "";
// 直前の検索が「0件」だったかどうか。本文を編集してマークが外れただけの状態と、
// 検索した結果1件も無かった状態を、メニューの表示で区別するために持っている。
let lastSearchFoundNone = false;

function clearSearchHighlights() {
  const marks = Array.from(el.editorBody.querySelectorAll(".search-hit"));
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    // 分割されたテキストノードを結合し直し、次回の検索・置換が正しく一致するようにする。
    parent.normalize();
  });
  searchHits = [];
  searchHitIndex = 0;
  lastSearchFoundNone = false;
  updateFindBarStatus();
}

// 一致箇所をすべて<span class="search-hit">で包み、その件数を返す。
function highlightAllMatches(searchTerm) {
  clearSearchHighlights();
  lastSearchTerm = searchTerm;
  if (!searchTerm) return 0;

  const walker = document.createTreeWalker(el.editorBody, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  const re = new RegExp(escapeRegExp(searchTerm), "g");
  textNodes.forEach((tn) => {
    // 検索マーク自身の中身を二重に包まないようにする。
    if (tn.parentElement && tn.parentElement.classList.contains("search-hit")) return;
    const value = tn.nodeValue;
    re.lastIndex = 0;
    const ranges = [];
    let match;
    while ((match = re.exec(value))) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    if (ranges.length === 0) return;

    // 1つのテキストノード内の複数一致に対応するため、後ろから切り出していく。
    const frag = document.createDocumentFragment();
    let cursor = 0;
    ranges.forEach((r) => {
      if (r.start > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, r.start)));
      const mark = document.createElement("span");
      mark.className = "search-hit";
      mark.textContent = value.slice(r.start, r.end);
      frag.appendChild(mark);
      cursor = r.end;
    });
    if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)));
    tn.parentNode.replaceChild(frag, tn);
  });

  searchHits = Array.from(el.editorBody.querySelectorAll(".search-hit"));
  searchHitIndex = 0;
  lastSearchFoundNone = searchHits.length === 0;
  return searchHits.length;
}

// 指定した順番の一致箇所へスクロールし、そこだけ強調表示にする。
function focusSearchHit(index) {
  if (searchHits.length === 0) return;
  searchHitIndex = ((index % searchHits.length) + searchHits.length) % searchHits.length;
  searchHits.forEach((hit, i) => {
    hit.classList.toggle("search-hit--current", i === searchHitIndex);
  });
  searchHits[searchHitIndex].scrollIntoView({ behavior: "smooth", block: "center" });
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
 * 本文選択 → 編集用リボン(5.3)
 * 以前は選択範囲に追従する浮動ミニツールバーだったが、iPhone/iPad実機で
 * OS標準のコピー&ペーストポップアップと重なってタップできなくなる不具合が
 * 判明したため(2026-07-25、Mikoto報告)、画面上部に常時ドッキングする
 * リボン形式に変更した。選択範囲の捕捉方式(mousedown+preventDefault、
 * selectionchangeでの常時バックアップ)自体はiOS Safari実機検証で確認済みの
 * ものをそのまま踏襲し、位置計算だけをやめて、ボタンの有効/無効切り替えに用途を変える。
 * ========================================================== */

let savedRange = null;

const ribbonActionBtns = Array.from(el.miniToolbar.querySelectorAll("button[data-action]"));

document.addEventListener("selectionchange", () => {
  captureCurrentSelectionIfAny();
  updateRibbonActionButtons();
});

function captureCurrentSelectionIfAny() {
  if (state.mode !== "edit") return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    // 開始点(anchorNode)だけでなく終了点もeditorBody内にあることを確認する。
    // 本文の外(書き出しバーなど)まではみ出した選択は対象外にする。
    if (el.editorBody.contains(range.startContainer) && el.editorBody.contains(range.endContainer)) {
      savedRange = range.cloneRange();
      return;
    }
  }
  savedRange = null;
}

// リボンは編集モード中は常時表示し、選択範囲の有無でボタンの有効/無効だけを切り替える。
function updateRibbonActionButtons() {
  const enabled = state.mode === "edit" && !!savedRange;
  ribbonActionBtns.forEach((btn) => { btn.disabled = !enabled; });
}

function updateRibbonVisibility() {
  el.miniToolbar.hidden = state.mode !== "edit";
  // 検索・置換は編集モード専用のため、プレビューに切り替えたら閉じる(2026-07-27)。
  if (state.mode !== "edit" && !el.findBar.hidden) setFindBarOpen(false);
  savedRange = null;
  updateRibbonActionButtons();
  updateUndoButton();
}

// 貼り付けは常にプレーンテキストとして扱う(2026-07-27のセキュリティ点検にもとづく対策)。
// contenteditableの既定では書式付き(HTML)で貼り付くため、悪意あるWebページからコピーした
// 場合にイベントハンドラ属性などが本文に混入し、書き出しファイルにまで残る可能性がある。
// シナリオ本文の整形が目的で書式ごと貼り付ける必要もないため、テキストだけを挿入する。
el.editorBody.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  if (!text) return;
  pushUndoSnapshot();
  // 改行を含む貼り付けでも段落構造が壊れないよう、execCommandの標準的な挿入に委ねる。
  document.execCommand("insertText", false, text);
  scheduleAutoRender();
});

// 本文に触り始めた時点で検索マークを外す(2026-07-27)。
//
// マーク解除はDOM(テキストノードの分割)を書き換えるため、選択が確定した後に行うと
// 控えておいた選択範囲(savedRange)が無効になってしまう。そこで、選択が始まる前の
// mousedown/touchstart/keydownの時点で外し、以降の選択・編集は必ずマークのない
// きれいな本文に対して行われるようにしている。
// (サイドバーの「検索する」「次の一致箇所へ」は本文外の操作なので、これらでは消えない)
["mousedown", "touchstart", "keydown"].forEach((type) => {
  el.editorBody.addEventListener(type, () => {
    if (searchHits.length > 0) clearSearchHighlights();
  });
});

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
 * 元に戻す(Undo、2026-07-25、Mikoto要望)
 * 本文(editorBody)のHTMLとNPC一覧(state.npcs)をまとめてスナップショットし、
 * 直前の状態に戻す。ネイティブのUndo(Ctrl+Z等)はDOM操作(見出し化・NPC追加等)を
 * 追跡できないため、操作の起点ごとに明示的にスナップショットを取る方式にした。
 * ========================================================== */

const UNDO_STACK_LIMIT = 20;
let undoStack = [];

function pushUndoSnapshot() {
  // 検索マークは表示用の一時的なものなので、履歴に混入させない(2026-07-27)。
  clearSearchHighlights();
  undoStack.push({
    html: el.editorBody.innerHTML,
    npcs: JSON.parse(JSON.stringify(state.npcs)),
  });
  if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
  updateUndoButton();
}

function updateUndoButton() {
  el.btnUndo.disabled = undoStack.length === 0;
}

function performUndo() {
  const snapshot = undoStack.pop();
  if (!snapshot) {
    showToast("これ以上元に戻せません。");
    return;
  }
  el.editorBody.innerHTML = snapshot.html;
  state.npcs = snapshot.npcs;
  searchHits = [];
  searchHitIndex = 0;
  window.getSelection().removeAllRanges();
  savedRange = null;
  updateRibbonActionButtons();
  updateUndoButton();
  syncAllHeadingIndents();
  scheduleAutoRender();
  renderSidebarBody();
  showToast("元に戻しました。");
}

el.btnUndo.addEventListener("click", performUndo);

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

// 解除対象のマークを探す。基本は上記の「祖先を辿る」判定だが、それだけでは
// トリプルクリック等で段落全体を選んだ場合に解除できなかった(2026-07-27、修正)。
// このとき選択範囲の境界は<p>自身になり、マークは<p>の「子孫」にあるため、
// 祖先を辿るだけでは見つからず、解除されずに同じマークが二重に入れ子で
// 作られてしまっていた(見出しの二重登録・装飾の二重適用の原因)。
//
// そこで、祖先に見つからない場合に限り「選択範囲がマーク要素をまるごと
// 覆っているか」も判定する。部分的に重なっているだけの選択(装飾の途中から
// 外にはみ出した選択など)では解除しないよう、完全に覆っている場合だけ対象とする。
function findMarkToToggle(range, lookupNode, matchFn) {
  const ancestor = findAncestorMark(lookupNode, matchFn);
  if (ancestor) return ancestor;

  const container = range.commonAncestorContainer;
  if (container.nodeType !== 1) return null;

  const covered = Array.from(container.children).filter((child) => {
    if (!matchFn(child)) return false;
    const childRange = document.createRange();
    childRange.selectNodeContents(child);
    const startsAtOrBefore = range.compareBoundaryPoints(Range.START_TO_START, childRange) <= 0;
    const endsAtOrAfter = range.compareBoundaryPoints(Range.END_TO_END, childRange) >= 0;
    return startsAtOrBefore && endsAtOrAfter;
  });
  return covered.length === 1 ? covered[0] : null;
}

// 見出しの「ラベル文字」を取り出す。見出しにした段落にコピペボタンが設置されていると、
// 素のtextContentにはボタンのラベル(「📋コピー」)まで含まれてしまい、アウトライン・
// 目次・書き出しの見出し名に混入していた(2026-07-27、修正)。さらにアウトラインの
// 名前欄はその文字列を初期値にしていたため、名前を編集しなくてもフォーカスを外すだけで
// ボタンが「📋コピー」という文字に化けて壊れていた。
function headingLabelText(markEl) {
  if (!markEl) return "";
  const clone = markEl.cloneNode(true);
  clone.querySelectorAll(".cp-btn").forEach((btn) => btn.remove());
  return (clone.textContent || "").trim();
}

// 見出しのラベル文字だけを書き換える(コピペボタンは壊さずに残す)。
// ボタンはコピー範囲(.cp-target)の外側にあるため、ラベルの実体である
// .cp-target(なければ見出しマーク自身)のテキストだけを差し替える。
function setHeadingLabelText(markEl, text) {
  const container = markEl.querySelector(".cp-target") || markEl;
  container.textContent = text;
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
  if (!el.editorBody.contains(range.commonAncestorContainer)) { updateRibbonActionButtons(); return; }

  try {
    if (type === "heading") {
      const existing = findMarkToToggle(range, range.commonAncestorContainer, (n) => n.classList && n.classList.contains("h-mark"));
      pushUndoSnapshot();
      if (existing) {
        unwrapMarkElement(existing);
        syncAllHeadingIndents();
      } else {
        applyHeadingMark(range);
      }
    } else if (type === "copybtn") {
      // 複数段落にまたがる範囲の場合、段落ごとに個別の.cp-wrapが作られるため
      // (applyCopyButtonMark参照)、判定はcommonAncestorContainerではなく
      // 範囲の開始位置(startContainer)から見る(2026-07-25、Mikoto報告・修正)。
      const existing = findMarkToToggle(range, range.startContainer, (n) => n.classList && n.classList.contains("cp-wrap"));
      pushUndoSnapshot();
      if (existing) {
        removeCopyButtonMark(existing);
      } else {
        applyCopyButtonMark(range);
      }
    } else if (type === "npc") {
      pushUndoSnapshot();
      createNpcFromRange(range);
    } else if (type === "link") {
      openLinkPicker(range);
    } else {
      const tagName = DECORATION_TAGS[type];
      const existing = findMarkToToggle(range, range.commonAncestorContainer, (n) => n.tagName === tagName);
      pushUndoSnapshot();
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
  updateRibbonActionButtons();
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

function buildCpButton(cpId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cp-btn";
  btn.dataset.cpid = cpId;
  btn.textContent = "📋コピー";
  return btn;
}

function wrapAsCpTarget(fragment, cpId) {
  const wrapper = document.createElement("span");
  wrapper.className = "cp-wrap";
  wrapper.dataset.cpid = cpId;
  const target = document.createElement("span");
  target.className = "cp-target";
  target.dataset.cpid = cpId;
  target.appendChild(fragment);
  wrapper.appendChild(target);
  return wrapper;
}

// コピー範囲は引用ブロックのようにまとめて表示する(2026-07-23、Mikoto要望)。
// <span>のままdisplay:blockにすることで、<p>の中に入れてもHTMLとして不正にならない
// ようにしている(<div>を<p>の中に入れると構造が壊れるため)。
//
// 複数段落にまたがる選択の場合、1つの<span>で複数の<p>をまたいで包むと
// (extractContentsが返す複数の<p>を1つのspanに入れることになり)HTML構造が
// 壊れ、後から同じ範囲を選び直しても解除(トグルオフ)できなくなる不具合があった
// (2026-07-25、Mikoto報告)。そのため、段落ごとに個別の.cp-wrapで包み、
// 同じcpidを共有させることで「1つのコピー範囲」として扱う。コピーボタンは
// 最後の段落のwrapperにだけ設置する。
//
// ただし段落ごとに別々の.cp-wrapになったことで、見た目が1行ごとに区切られた
// 状態になってしまった(2026-07-25、Mikoto報告)。そのため各wrapperに
// cp-wrap--first/mid/lastを付けて継ぎ目なく連結して見えるようにし、さらに
// 最後の段落以外は<p>自体の下マージンを0にして段落間の隙間を消している
// (解除時はremoveCopyButtonMarkで元に戻す)。
function applyCopyButtonMark(range) {
  cpCounter++;
  const cpId = "cp_" + cpCounter + "_" + Date.now().toString(36);
  const paragraphs = getParagraphsInRange(range);

  if (paragraphs.length <= 1) {
    const wrapper = wrapAsCpTarget(range.extractContents(), cpId);
    wrapper.appendChild(buildCpButton(cpId));
    range.insertNode(wrapper);
    return;
  }

  const firstP = paragraphs[0];
  const lastP = paragraphs[paragraphs.length - 1];

  paragraphs.forEach((p) => {
    const subRange = document.createRange();
    subRange.setStart(p === firstP ? range.startContainer : p, p === firstP ? range.startOffset : 0);
    subRange.setEnd(p === lastP ? range.endContainer : p, p === lastP ? range.endOffset : p.childNodes.length);

    const wrapper = wrapAsCpTarget(subRange.extractContents(), cpId);
    if (p === firstP) wrapper.classList.add("cp-wrap--first");
    else if (p === lastP) wrapper.classList.add("cp-wrap--last");
    else wrapper.classList.add("cp-wrap--mid");

    if (p === lastP) {
      wrapper.appendChild(buildCpButton(cpId));
    } else {
      p.style.marginBottom = "0";
    }
    subRange.insertNode(wrapper);
  });
}

// 複数段落にまたがるコピー範囲は、同じcpidを持つ.cp-wrapが複数存在しうるため、
// 見つかった1つだけでなく同じcpidのものをすべて解除する(2026-07-25、Mikoto報告・修正)。
// applyCopyButtonMarkで0にした<p>の下マージンもここで元に戻す。
function removeCopyButtonMark(wrapperEl) {
  const cpId = wrapperEl.dataset.cpid;
  const wrappers = cpId
    ? Array.from(document.querySelectorAll(`.cp-wrap[data-cpid="${cpId}"]`))
    : [wrapperEl];
  wrappers.forEach((w) => {
    const target = w.querySelector(".cp-target");
    const parent = w.parentNode;
    if (target) {
      while (target.firstChild) parent.insertBefore(target.firstChild, w);
    }
    w.remove();
    if (parent && parent.style) parent.style.marginBottom = "";
  });
}

// コピペボタンのクリックはエディタ・プレビューどちらでも動作させる(委譲リスナー)。
// 複数段落にまたがる範囲は、同じcpidを持つ.cp-targetが複数あるため、すべて連結する。
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".cp-btn");
  if (!btn) return;
  let text;
  if (btn.dataset.copyText !== undefined) {
    text = btn.dataset.copyText;
  } else {
    const spans = document.querySelectorAll(`.cp-target[data-cpid="${btn.dataset.cpid}"]`);
    text = Array.from(spans).map((s) => s.textContent).join("\n");
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
      btn.textContent = headingLabelText(markEl);
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
  pushUndoSnapshot();
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
    textInput.value = headingLabelText(markEl);
    textInput.addEventListener("change", () => {
      pushUndoSnapshot();
      setHeadingLabelText(markEl, textInput.value);
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
        pushUndoSnapshot();
        moveHeadingUp(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));
      actions.appendChild(makeOutlineActionBtn("▼", "下へ移動", index < marks.length - 1, () => {
        pushUndoSnapshot();
        moveHeadingDown(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));
      actions.appendChild(makeOutlineActionBtn("◀", "上位階層にする", true, () => {
        pushUndoSnapshot();
        markEl.dataset.level = String(clampLevel(parseInt(markEl.dataset.level || "1", 10) - 1));
        updateHeadingIndent(markEl);
        renderOutlineView(container);
        scheduleAutoRender();
      }));
      actions.appendChild(makeOutlineActionBtn("▶", "下位階層にする", true, () => {
        pushUndoSnapshot();
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
// - 「回避：26％」「回避　32％」「＜回避＞32」のように判定コマンドが書かれていない行は、NPCごとに
//   手動設定したcommandPrefix(CCB=6版/CC=7版、Mikoto確認済み: バージョン判定は自動化せず手動設定に
//   委ねる方針)を使ってコマンドを組み立てる。数値の後にダイス表記が続く場合は、それを「ダメージ判定」
//   ラベルの別行として追加する(実例のチャットパレット記法で「1d3+1D4 【ダメージ判定】」という表記が
//   繰り返し使われていたのに合わせた)。
// - 「名詞＋パーセンテージ」表記(区切りは「：」「:」半角/全角スペース・区切りなしのいずれでもよい)を
//   本ツールが確実に認識する基準形とし、この形式に当てはまるようユーザー側で本文を調整する運用とする
//   (2026-07-25、Mikoto確認済み。他の表記ゆれをすべて自動対応することは目指さない)。
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
    const percentSkills = extractPercentSkillsFromLine(line);
    if (percentSkills.length > 0) {
      percentSkills.forEach((s) => pushSynthesized(s.name, s.percentage, s.trailing));
      return;
    }
    const m = line.match(angleLineRegex);
    if (m) {
      pushSynthesized(m[1], m[2], m[3]);
      return;
    }
  });
  return skills;
}

// 「名詞＋パーセンテージ」表記を1行の中から拾い出す(2026-07-25にMikotoと確認した基準形)。
//
// 当初は行全体に完全一致させる正規表現(/^(.+?)[：:\s]*([0-9０-９]+)％(?:\s+(\S.*))?$/)を
// 使っていたが、基準形どおりに書いていても認識されないケースがあるとの報告(2026-07-27、
// Mikoto)を受けて調査したところ、以下の4点が原因と判明したため、行全体への一致をやめ、
// 「数値＋％」のトークンを行内から走査して拾う方式に変更した。
//   1. 半角の「%」がまったく認識されなかった(全角の「％」しか許容していなかった)。
//      PDF・TXTのシナリオでは半角「%」も普通に使われるため、これが主因。
//   2. 数値と％の間に空白があると認識されなかった(例:「回避 32 ％」)。
//   3. ％の直後に空白なしで文字が続くと行全体が不一致になった(例:「回避 32％。」のように
//      句読点や閉じ括弧が付いている場合)。
//   4. 1行に複数の技能が並んでいると先頭の1件しか拾えなかった(例:「目星 25％ 聞き耳 30％」)。
//      PDFからの抽出で複数行が1行にまとまってしまう場合に該当する。
//
// 技能名は「直前の技能(または行頭)からその数値までの間のテキスト」とし、区切り文字を除去した
// ものを採用する。技能名自体に数字は含まれない前提で、名前の中に数字が残る場合(例:「STR 10
// 幸運 50%」のように同じ行に別のステータスが並んでいる場合)は、最後の数字より後ろだけを
// 技能名として扱う。
function extractPercentSkillsFromLine(line) {
  const tokenRegex = /([0-9０-９]+)\s*[%％]/g;
  const matches = [];
  let m;
  while ((m = tokenRegex.exec(line))) {
    matches.push({ percentage: m[1], start: m.index, end: tokenRegex.lastIndex });
  }

  const results = [];
  matches.forEach((match, i) => {
    const prevEnd = i === 0 ? 0 : matches[i - 1].end;
    let name = line.slice(prevEnd, match.start);
    // 名前の中に数字が残っている場合は、直前に別のステータス表記が並んでいるとみなし、
    // 最後の数字より後ろだけを技能名として扱う。
    const lastDigit = name.search(/[0-9０-９](?![\s\S]*[0-9０-９])/);
    if (lastDigit >= 0) name = name.slice(lastDigit + 1);
    // 区切り(コロン・スペース)や、前の技能から続く句読点・記号を落とす。
    name = name.replace(/^[\s、,。・／\/|｜]+/, "").replace(/[：:\s]+$/, "").trim();
    if (!name) return;
    // ダメージ表記(1d3+1D4など)を探す範囲は、この技能の直後から次の技能の手前まで。
    const trailing = line.slice(match.end, i + 1 < matches.length ? matches[i + 1].start : line.length);
    results.push({ name, percentage: match.percentage, trailing });
  });
  return results;
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
      if (!confirm(`NPC「${npc.name || "(名前未設定)"}」を削除します。よろしいですか？`)) return;
      pushUndoSnapshot();
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
    pushUndoSnapshot();
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
    a.textContent = headingLabelText(markEl);
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
  // 検索マークはプレビュー・書き出しには持ち込まない(2026-07-27)。
  clearSearchHighlights();
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
  clearSearchHighlights();

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
      // 以前はonclick属性にhidを生で埋めており、細工したhidでJSを注入できてしまっていた
      // (2026-07-27のセキュリティ点検で確認)。属性値としてエスケープして持たせ、
      // クリック処理は書き出し先のJS側でイベント委譲する方式に変更した。
      return `<a href="#${escapeHtml(m.dataset.hid)}" class="toc-link" data-hid="${escapeHtml(m.dataset.hid)}" style="padding-left:${(level - 1) * 14}px">${escapeHtml(headingLabelText(m))}</a>`;
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

  // 書き出したファイル自体にもCSPを付け、多層防御にする(2026-07-27のセキュリティ点検)。
  // nonceを付けた自前の<style>/<script>だけを許可するため、万一本文に
  // イベントハンドラ属性(on*)が紛れ込んでも、開いた先のブラウザ側で実行が止まる。
  // default-src 'none' により外部への通信・読み込みも一切行わない。
  const nonce = uid("n").replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(state.meta.sourceFileName || "シナリオ")}</title>
<style nonce="${nonce}">
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
<script nonce="${nonce}">
${STANDALONE_JS}
</script>
<script type="application/json" id="${STATE_SCRIPT_ID}" nonce="${nonce}">
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
  --accent:#ff9500; --danger:#c62828; --bg:#f4f4f2; --panel-bg:#ffffff;
  --border:#ddd6c4; --cp-bg:#ffe9cc; --text:#222222; --text-muted:#555555; --text-faint:#888888;
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent:#ff9f0a; --danger:#e57373; --bg:#1c1c1e; --panel-bg:#28282c;
    --border:#47453c; --cp-bg:#3d2b0a; --text:#e8e8e6; --text-muted:#b6b6b2; --text-faint:#8f8f8b;
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
// 目次リンクはonclick属性をやめ、data-hidを読むイベント委譲に変更(2026-07-27)
document.addEventListener('click', function (e) {
  var a = e.target.closest('.toc-link');
  if (!a) return;
  e.preventDefault();
  jumpToHeading(a.getAttribute('data-hid'));
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
  return headingLabelText(mark);
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
  clearSearchHighlights();
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
    out += indent + headingLabelText(node.heading) + "\n";
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
  clearSearchHighlights();
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
