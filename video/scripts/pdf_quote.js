// 논문 PDF 에서 문장을 찾아, 그 페이지를 그림(PNG)으로 뽑고 문장이 있는 줄들의 위치를 알려준다 → 영상 '진짜 논문 화면'(scenes.jsx Citation) 용.
// 맥에 기본으로 있는 PDFKit 을 osascript(JavaScript)로 씀 — 설치 없음. (swift 는 이 맥의 개발도구 충돌로 안 돌아서 2026-10-30 이걸로)
//
// 사용법: osascript -l JavaScript video/scripts/pdf_quote.js <논문.pdf> <찾을 문장> <저장할.png>
// 출력(JSON 한 줄): {"page":0,"w":612,"h":792,"found":"quote|title|none","marks":[[x,y,w,h],...]}   (marks 는 페이지 기준 0~1, 위가 0)
// 문장을 못 찾으면 앞 12단어 → 8단어 → 첫 페이지 제목 줄 순서로 물러난다.
ObjC.import("PDFKit");
ObjC.import("AppKit");

function run(argv) {
  const [pdf, quote, out] = argv;
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdf));
  if (!doc || doc.isNil()) throw new Error("PDF 를 못 엶: " + pdf);
  // 페이지 글자에서 직접 찾는다 (줄바꿈·하이픈 끊김 무시) — findString 은 줄이 바뀌는 곳을 못 넘어서
  const norm = (t) => { let o = "", map = []; for (let i = 0; i < t.length; i++) { const c = t[i];
    if (c === "-" && /\s/.test(t[i + 1] || "")) { while (/\s/.test(t[i + 1] || "")) i++; continue; }
    if (/\s/.test(c)) { if (o.endsWith(" ")) continue; o += " "; } else o += c.toLowerCase(); map.push(i); } return { o, map }; };
  const words = quote.toLowerCase().split(/\s+/).filter(Boolean);
  let sel = null, found = "none";
  for (let p = 0; p < Math.min(15, doc.pageCount) && !sel; p++) {
    const pg = doc.pageAtIndex(p);
    const { o, map } = norm(ObjC.unwrap(pg.string) || "");
    for (const n of [words.length, 12, 8]) {
      if (n > words.length || n < Math.min(words.length, 5)) continue;
      const k = o.indexOf(words.slice(0, n).join(" "));
      if (k < 0) continue;
      const end = map[k + words.slice(0, n).join(" ").length - 1];
      sel = pg.selectionForRange($.NSMakeRange(map[k], end - map[k] + 1));
      found = "quote";
      break;
    }
  }
  const page = sel ? sel.pages.objectAtIndex(0) : doc.pageAtIndex(0);
  const box = page.boundsForBox(0); // 0 = mediaBox
  const bw = box.size.width, bh = box.size.height;
  let lines = [];
  const byLine = (s) => { const l = s.selectionsByLine; const o = []; for (let i = 0; i < l.count; i++) o.push(l.objectAtIndex(i).boundsForPage(page)); return o; };
  if (sel) lines = byLine(sel);
  if (!lines.length) {
    // 제목: 첫 페이지 위쪽 절반에서 글자가 가장 큰(줄 높이가 가장 큰) 20자 넘는 줄
    const all = page.selectionForRect(box);
    if (all && !all.isNil()) {
      const l = all.selectionsByLine;
      let best = null;
      for (let i = 0; i < l.count; i++) {
        const t = ObjC.unwrap(l.objectAtIndex(i).string) || "";
        const b = l.objectAtIndex(i).boundsForPage(page);
        if (t.trim().length > 20 && b.origin.y > box.origin.y + bh / 2 && (!best || b.size.height > best.size.height)) best = b;
      }
      if (best) { lines = [best]; found = "title"; }
    }
  }
  // 2배 크기로 렌더 (thumbnail 은 흰 바탕으로 그려줌)
  const img = page.thumbnailOfSizeForBox($.NSMakeSize(bw * 2, bh * 2), 0);
  const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
  rep.representationUsingTypeProperties(4, $()).writeToFileAtomically(out, true); // 4 = PNG
  const r = (v) => Math.round(v * 1000) / 1000;
  const x0 = box.origin.x, y0 = box.origin.y;
  const marks = lines.map((b) => [r((b.origin.x - x0) / bw), r((y0 + bh - (b.origin.y + b.size.height)) / bh), r(b.size.width / bw), r(b.size.height / bh)]);
  return JSON.stringify({ page: Number(doc.indexForPage(page)), w: r(bw), h: r(bh), found, marks });
}
