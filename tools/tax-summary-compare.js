/*
 * 세금계산서 합계표 비교
 * 하이웍스 대량등록 파일 <-> 국세청(홈택스) 매출 전자세금계산서 목록조회 파일을 월별로 대조한다.
 * 두 사이트 로그인은 사용자가 직접 하고, 내려받은 파일만 여기에 올리는 방식이라 서버가 필요 없다.
 *
 * 파일 읽기는 SheetJS(vendor/xlsx.full.min.js)를 쓴다 — 두 파일 다 진짜 BIFF8 .xls(구형 엑셀)이라
 * ExcelJS로는 못 읽는다. 결과 엑셀 다운로드는 서식이 필요하므로 ExcelJS를 쓴다.
 *
 * 대조 규칙(사용자 확정):
 *  - 비교 단위는 월별 1:1 (하이웍스 파일 1개 + 국세청 파일 1개)
 *  - 청구/영수 구분은 비교하지 않음
 *  - 수정세금계산서는 원건과 상계하지 않고 각각 별도 1건으로 취급(금액이 음수로 들어옴)
 *  - 하이웍스에서 주민번호 발행건을 엑셀로 뽑으면 자릿수가 밀려 나오는 알려진 버그가 있어
 *    (예: 651029-1069113 -> 651029-9106911), 사업자번호가 안 맞으면 상호+금액으로 폴백 매칭한다.
 */
(function () {
  // ---------- 공통 유틸 ----------

  function digitsOnly(v) {
    return v === undefined || v === null ? "" : String(v).replace(/[^0-9]/g, "");
  }

  function normName(v) {
    // 상호 비교용 정규화 — 공백/괄호/"주식회사"·"(주)" 표기 차이를 흡수한다
    return String(v === undefined || v === null ? "" : v)
      .replace(/\s+/g, "")
      .replace(/주식회사/g, "")
      .replace(/\(주\)|\（주\）/g, "")
      .toLowerCase();
  }

  function toNumber(v) {
    if (v === undefined || v === null || v === "") return 0;
    const n = Number(String(v).replace(/[,\s원]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatWon(n) {
    return (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("ko-KR") + "원";
  }

  function pad2(v) {
    return String(v).padStart(2, "0");
  }

  // "2026-07-31" / "2026.7.31" / Date 어느 쪽으로 들어와도 "20260731"로 맞춘다
  function normDate(v) {
    const d = digitsOnly(v);
    return d.length >= 8 ? d.slice(0, 8) : d;
  }

  function readWorkbook(arrayBuffer) {
    // cellNF/cellText 옵션은 이 .xls들에서 셀 값이 엉뚱하게 읽히는 경우가 있어 쓰지 않는다.
    return XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  }

  // 엑셀에서 "웹 페이지(*.htm)"로 저장하면 확장자가 .xls여도 알맹이는 프레임셋 HTML 한 장이고,
  // 실제 데이터는 옆의 "<파일명>.files\sheet001.htm"으로 빠진다. 엑셀에서 열면 멀쩡해 보여서
  // 원인을 찾기 어려우므로 따로 감지해 안내한다.
  function isWebPageStub(arrayBuffer) {
    const head = new Uint8Array(arrayBuffer).subarray(0, 4096);
    let s = "";
    for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
    return /<html/i.test(s) && /fnBuildFrameset|frScroll|\.files/i.test(s);
  }

  function sheetRows(wb, sheetName) {
    const ws = wb.Sheets[sheetName || wb.SheetNames[0]];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: true });
  }

  // 시트가 여러 개인 파일(안내 시트가 앞에 오는 경우 등)도 있어서 첫 시트만 보지 않고
  // 헤더 행이 있는 시트를 찾아 쓴다. 못 찾으면 나중에 진단 메시지를 만들 수 있게 후보를 모아둔다.
  function findSheet(wb, headerMatcher, maxScanRows) {
    const seen = [];
    for (const name of wb.SheetNames) {
      const rows = sheetRows(wb, name);
      for (let i = 0; i < Math.min(rows.length, maxScanRows); i++) {
        if (headerMatcher(rows[i])) return { rows, headerRow: i, sheetName: name };
      }
      seen.push({ name, rows });
    }
    return { rows: null, seen };
  }

  // 형식이 안 맞을 때 "왜 안 맞는지"를 사용자가 바로 알 수 있게 실제로 읽힌 내용을 붙여준다
  function describeSheets(seen) {
    return seen.map(({ name, rows }) => {
      const first = (rows || []).find(r => r.some(c => String(c).trim())) || [];
      const preview = first.slice(0, 6).map(c => String(c).replace(/\s+/g, " ").slice(0, 20)).filter(Boolean).join(" / ");
      return `[${name}] ${rows ? rows.length : 0}행` + (preview ? ` — 첫 내용: ${preview}` : " — 내용 없음");
    }).join(" · ");
  }

  // ---------- 하이웍스 파일 파싱 ----------
  // 대량등록 양식과 같은 구조. 1행이 헤더(63열), 2행부터 데이터, 1행 = 계산서 1건.
  // 열(0-indexed): 1 년 / 2 월 / 3 일 / 4 등록번호 / 6 상호 / 19 공급가액 / 20 세액

  const HW = { year: 1, month: 2, day: 3, bizNo: 4, name: 6, supply: 19, tax: 20 };

  // 헤더 문구가 양식 버전마다 조금씩 다를 수 있어 한 단어에만 의존하지 않는다
  function isHiworksHeader(row) {
    const j = row.join("").replace(/\s+/g, "");
    return (j.includes("과세유형") && j.includes("공급받는자")) ||
           (j.includes("공급받는자") && j.includes("공급가액") && j.includes("세액")) ||
           (j.includes("작성일자") && j.includes("등록번호") && j.includes("공급가액"));
  }

  function parseHiworks(wb) {
    const found = findSheet(wb, isHiworksHeader, 20);
    if (!found.rows) {
      throw new Error(
        "하이웍스 파일에서 헤더 행을 찾지 못했습니다 (‘과세유형/공급받는자/공급가액’이 있는 행이 없습니다). " +
        "읽힌 내용: " + describeSheets(found.seen)
      );
    }
    const { rows, headerRow } = found;

    const list = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      const bizNo = digitsOnly(r[HW.bizNo]);
      if (!bizNo) continue; // 등록번호가 없으면 빈 행으로 본다
      const year = digitsOnly(r[HW.year]);
      if (!year) continue;
      list.push({
        bizNo,
        name: String(r[HW.name] || "").trim(),
        date: year + pad2(digitsOnly(r[HW.month])) + pad2(digitsOnly(r[HW.day])),
        supply: toNumber(r[HW.supply]),
        tax: toNumber(r[HW.tax]),
        row: i + 1,
      });
    }
    return list;
  }

  // ---------- 국세청 파일 파싱 ----------
  // 시트 "세금계산서". 위쪽에 사업자정보/총계/제목 행이 있고 헤더 행이 6행쯤에 있다(고정으로 보지 않고 찾는다).
  // 1행 = 계산서 1건(승인번호가 유니크). 품목은 "대표 품목" 1개만 실려 있어 품목 단위 대조는 불가능하다.
  // 주의: "상호" 컬럼이 공급자·공급받는자 두 번 나오므로 공급받는자 등록번호 뒤쪽 것을 써야 한다.

  function isHometaxHeader(row) {
    const j = row.join("").replace(/\s+/g, "");
    return j.includes("승인번호") && j.includes("공급받는자사업자등록번호");
  }

  function parseHometax(wb) {
    const found = findSheet(wb, isHometaxHeader, 30);
    if (!found.rows) {
      throw new Error(
        "국세청 파일에서 헤더 행을 찾지 못했습니다 (‘승인번호/공급받는자사업자등록번호’가 있는 행이 없습니다). " +
        "읽힌 내용: " + describeSheets(found.seen)
      );
    }
    const { rows, headerRow } = found;

    const hdr = rows[headerRow].map(h => String(h).replace(/\s+/g, ""));
    const idx = name => hdr.indexOf(name);
    const iApproval = idx("승인번호");
    const iDate = idx("작성일자");
    const iBizNo = idx("공급받는자사업자등록번호");
    const iSupply = idx("공급가액");
    const iTax = idx("세액");
    const iKind = idx("전자세금계산서분류");
    // 공급받는자 상호 = 등록번호 뒤에 나오는 첫 번째 "상호"
    let iName = -1;
    for (let c = iBizNo + 1; c < hdr.length; c++) {
      if (hdr[c] === "상호") { iName = c; break; }
    }
    if (iSupply < 0 || iTax < 0 || iBizNo < 0) {
      throw new Error("국세청 파일에서 공급받는자등록번호/공급가액/세액 컬럼을 찾지 못했습니다.");
    }

    const list = [];
    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!String(r[iApproval] || "").trim()) continue;
      list.push({
        approvalNo: String(r[iApproval]).trim(),
        bizNo: digitsOnly(r[iBizNo]),
        name: iName >= 0 ? String(r[iName] || "").trim() : "",
        date: normDate(r[iDate]),
        supply: toNumber(r[iSupply]),
        tax: toNumber(r[iTax]),
        kind: iKind >= 0 ? String(r[iKind] || "").trim() : "",
        row: i + 1,
      });
    }
    return list;
  }

  // ---------- 대조 ----------

  // 하이웍스 쪽을 키별 목록으로 담아두고, 국세청 건을 하나씩 훑으면서 아직 안 쓴 건을 꺼내 짝지운다.
  // 같은 거래처에 같은 날 같은 금액 계산서가 2건 있어도 각각 따로 소진되도록 Set으로 사용 여부를 관리한다.
  function buildIndex(list, keyFn) {
    const map = new Map();
    list.forEach((rec, i) => {
      const k = keyFn(rec);
      if (k === null) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    });
    return map;
  }

  const KEY = {
    exact: r => r.bizNo + "|" + r.date + "|" + r.supply + "|" + r.tax,
    byName: r => (normName(r.name) ? normName(r.name) + "|" + r.date + "|" + r.supply + "|" + r.tax : null),
    bizDate: r => r.bizNo + "|" + r.date,
    nameDate: r => (normName(r.name) ? normName(r.name) + "|" + r.date : null),
  };

  function compare(hometax, hiworks) {
    const usedHw = new Set();
    const matchedNt = new Set();
    const pairs = []; // 짝이 지어진 건 (금액이 다를 수도 있음)

    // 1) 사업자번호+작성일자+공급가액+세액 완전 일치
    // 2) 상호+작성일자+금액 (하이웍스 주민번호 자릿수 밀림 대응)
    // 3) 사업자번호+작성일자 (금액 차이)
    // 4) 상호+작성일자 (금액 차이)
    const passes = [KEY.exact, KEY.byName, KEY.bizDate, KEY.nameDate];
    for (const keyFn of passes) {
      const index = buildIndex(hiworks, keyFn);
      hometax.forEach((nt, ni) => {
        if (matchedNt.has(ni)) return;
        const k = keyFn(nt);
        if (k === null) return;
        const bucket = index.get(k);
        if (!bucket) return;
        const hi = bucket.find(i => !usedHw.has(i));
        if (hi === undefined) return;
        matchedNt.add(ni);
        usedHw.add(hi);
        pairs.push({ nt, hw: hiworks[hi] });
      });
    }

    // 짝이 맞은 건까지 포함한 전체 대조 내역(rows) — 차이가 없어도 비교자료로 받아볼 수 있게
    // 여기서 한 번에 만들어두고, 차이 목록(diffs)은 여기서 걸러 쓴다.
    const rows = [];
    for (const { nt, hw } of pairs) {
      const same = nt.supply === hw.supply && nt.tax === hw.tax;
      rows.push({
        type: same ? "일치" : "금액 차이",
        date: nt.date, name: nt.name || hw.name, bizNo: nt.bizNo,
        ntSupply: nt.supply, ntTax: nt.tax,
        hwSupply: hw.supply, hwTax: hw.tax,
        kind: nt.kind,
      });
    }
    hometax.forEach((nt, i) => {
      if (matchedNt.has(i)) return;
      rows.push({
        type: "하이웍스 누락",
        date: nt.date, name: nt.name, bizNo: nt.bizNo,
        ntSupply: nt.supply, ntTax: nt.tax,
        hwSupply: null, hwTax: null,
        kind: nt.kind,
      });
    });
    hiworks.forEach((hw, i) => {
      if (usedHw.has(i)) return;
      rows.push({
        type: "국세청 누락",
        date: hw.date, name: hw.name, bizNo: hw.bizNo,
        ntSupply: null, ntTax: null,
        hwSupply: hw.supply, hwTax: hw.tax,
        kind: "",
      });
    });

    // 전체 대조 내역은 작성일자 → 상호 순
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    // 차이 목록은 누락 먼저, 그 다음 금액 차이, 각각 작성일자 순
    const order = { "하이웍스 누락": 0, "국세청 누락": 1, "금액 차이": 2 };
    const diffs = rows.filter(r => r.type !== "일치")
      .sort((a, b) => (order[a.type] - order[b.type]) || a.date.localeCompare(b.date));

    const sum = (list, f) => list.reduce((a, r) => a + f(r), 0);
    return {
      rows,
      diffs,
      matchedCount: rows.filter(r => r.type === "일치").length,
      summary: {
        ntCount: hometax.length, hwCount: hiworks.length,
        ntSupply: sum(hometax, r => r.supply), hwSupply: sum(hiworks, r => r.supply),
        ntTax: sum(hometax, r => r.tax), hwTax: sum(hiworks, r => r.tax),
      },
      months: {
        nt: [...new Set(hometax.map(r => r.date.slice(0, 6)))].sort(),
        hw: [...new Set(hiworks.map(r => r.date.slice(0, 6)))].sort(),
      },
    };
  }

  // ---------- 결과 엑셀 ----------

  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
  const THIN = { style: "thin", color: { argb: "FFB8C4D9" } };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  const DETAIL_COLS = [
    { header: "구분", width: 14 },
    { header: "작성일자", width: 12 },
    { header: "상호", width: 30 },
    { header: "사업자번호", width: 16 },
    { header: "국세청 공급가액", width: 16 },
    { header: "국세청 세액", width: 14 },
    { header: "하이웍스 공급가액", width: 18 },
    { header: "하이웍스 세액", width: 16 },
    { header: "공급가액 차이", width: 15 },
    { header: "비고", width: 22 },
  ];

  function styleHeader(row) {
    row.eachCell(cell => {
      cell.fill = HEADER_FILL;
      cell.border = BORDER;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
  }

  function fmtDate(d) {
    return d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
  }

  // 차이 목록/전체 대조 내역 시트는 같은 컬럼 구성을 쓴다
  function addDetailSheet(wb, name, list, emptyNote) {
    const ws = wb.addWorksheet(name);
    ws.columns = DETAIL_COLS.map(c => ({ width: c.width }));
    styleHeader(ws.addRow(DETAIL_COLS.map(c => c.header)));

    if (!list.length && emptyNote) {
      const row = ws.addRow([emptyNote]);
      ws.mergeCells(row.number, 1, row.number, DETAIL_COLS.length);
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(1).font = { color: { argb: "FF16A34A" }, bold: true };
      return ws;
    }

    for (const d of list) {
      const row = ws.addRow([
        d.type,
        fmtDate(d.date),
        d.name,
        d.bizNo,
        d.ntSupply, d.ntTax, d.hwSupply, d.hwTax,
        (d.ntSupply || 0) - (d.hwSupply || 0),
        d.kind && d.kind.includes("수정") ? "수정세금계산서" : "",
      ]);
      row.eachCell(cell => { cell.border = BORDER; });
      [5, 6, 7, 8, 9].forEach(c => {
        row.getCell(c).numFmt = "#,##0";
        row.getCell(c).alignment = { horizontal: "right" };
      });
      // 차이 나는 건은 눈에 띄게 (전체 대조 내역에서 섞여 있을 때 찾기 쉽도록)
      if (d.type !== "일치") {
        row.getCell(1).font = { color: { argb: "FFB91C1C" }, bold: true };
      }
    }
    return ws;
  }

  async function buildResultWorkbook(result) {
    const wb = new ExcelJS.Workbook();
    const s = result.summary;

    // 1) 요약 — 차이가 없어도 이 시트만으로 대조 결과를 보고할 수 있게
    const ws = wb.addWorksheet("요약");
    ws.columns = [{ width: 18 }, { width: 20 }, { width: 20 }, { width: 18 }];
    styleHeader(ws.addRow(["구분", "국세청", "하이웍스", "차이"]));
    const addNum = (label, a, b, fmt) => {
      const row = ws.addRow([label, a, b, a - b]);
      row.eachCell(cell => { cell.border = BORDER; });
      [2, 3, 4].forEach(c => {
        row.getCell(c).numFmt = fmt;
        row.getCell(c).alignment = { horizontal: "right" };
      });
      if (a !== b) row.getCell(4).font = { color: { argb: "FFB91C1C" }, bold: true };
    };
    addNum("건수", s.ntCount, s.hwCount, '#,##0"건"');
    addNum("공급가액", s.ntSupply, s.hwSupply, '#,##0"원"');
    addNum("세액", s.ntTax, s.hwTax, '#,##0"원"');

    ws.addRow([]);
    const info = [
      ["귀속월", `국세청 ${result.months.nt.join(", ") || "-"} / 하이웍스 ${result.months.hw.join(", ") || "-"}`],
      ["짝이 맞은 건", `${result.matchedCount.toLocaleString()}건`],
      ["차이", `${result.diffs.length.toLocaleString()}건`],
      ["비교 일시", new Date().toLocaleString("ko-KR")],
    ];
    for (const [k, v] of info) {
      const row = ws.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      ws.mergeCells(row.number, 2, row.number, 4);
    }

    // 2) 차이 목록 (차이가 없으면 "차이 없음"이라고 명시해서 빈 시트로 보이지 않게)
    addDetailSheet(wb, "차이목록", result.diffs, "차이 없음 — 두 파일이 완전히 일치합니다.");

    // 3) 전체 대조 내역 (짝이 맞은 건 포함) — 차이가 없어도 받아볼 비교자료
    addDetailSheet(wb, "전체대조", result.rows, "");

    return wb;
  }

  // ---------- 화면 ----------

  function init(root) {
    const els = {
      hwZone: root.querySelector("#tsc-hw-dropzone"),
      hwInput: root.querySelector("#tsc-hw-file"),
      ntZone: root.querySelector("#tsc-nt-dropzone"),
      ntInput: root.querySelector("#tsc-nt-file"),
      compareBtn: root.querySelector("#tsc-compare-btn"),
      downloadBtn: root.querySelector("#tsc-download-btn"),
      status: root.querySelector("#tsc-status"),
      result: root.querySelector("#tsc-result"),
    };
    if (!els.compareBtn) return;

    const files = { hw: null, nt: null };
    let lastResult = null;

    function setStatus(msg, kind) {
      els.status.textContent = msg;
      els.status.style.color = kind === "error" ? "#dc2626" : kind === "ok" ? "#16a34a" : "";
    }

    // 드롭존 하나를 파일 선택/드래그&드롭 양쪽에 연결한다
    function wireZone(zone, input, which, label) {
      const show = file => {
        files[which] = file;
        zone.innerHTML = `📄 <strong>${file.name}</strong><br><span style="font-size:12px;">다른 파일로 바꾸려면 다시 클릭하세요</span>`;
        els.downloadBtn.style.display = "none";
        lastResult = null;
      };
      zone.addEventListener("click", () => input.click());
      input.addEventListener("change", () => { if (input.files[0]) show(input.files[0]); });
      zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      zone.addEventListener("drop", e => {
        e.preventDefault();
        zone.classList.remove("dragover");
        if (e.dataTransfer.files[0]) show(e.dataTransfer.files[0]);
      });
      zone.dataset.label = label;
    }
    wireZone(els.hwZone, els.hwInput, "hw", "하이웍스");
    wireZone(els.ntZone, els.ntInput, "nt", "국세청");

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`${file.name} 파일을 읽지 못했습니다.`));
        reader.readAsArrayBuffer(file);
      });
    }

    els.compareBtn.addEventListener("click", async () => {
      if (!files.hw || !files.nt) {
        setStatus("하이웍스 파일과 국세청 파일을 각각 하나씩 올려주세요.", "error");
        return;
      }
      setStatus("비교하는 중...");
      els.result.innerHTML = "";
      els.downloadBtn.style.display = "none";
      try {
        const [hwBuf, ntBuf] = await Promise.all([readFile(files.hw), readFile(files.nt)]);
        for (const [buf, file] of [[hwBuf, files.hw], [ntBuf, files.nt]]) {
          if (isWebPageStub(buf)) {
            throw new Error(
              `${file.name}은(는) 엑셀에서 "웹 페이지"로 저장된 파일이라 데이터가 들어있지 않습니다 ` +
              `(실제 내용은 옆의 "${file.name.replace(/\.[^.]+$/, "")}.files" 폴더로 빠져 있습니다). ` +
              `내려받은 원본 파일을 그대로 올리거나, 엑셀에서 "다른 이름으로 저장 > Excel 통합 문서(.xlsx)"로 다시 저장해서 올려주세요.`
            );
          }
        }
        const hiworks = parseHiworks(readWorkbook(hwBuf));
        const hometax = parseHometax(readWorkbook(ntBuf));
        if (!hiworks.length) throw new Error("하이웍스 파일에서 데이터 행을 찾지 못했습니다.");
        if (!hometax.length) throw new Error("국세청 파일에서 데이터 행을 찾지 못했습니다.");
        lastResult = compare(hometax, hiworks);
        renderResult(lastResult);
        const n = lastResult.diffs.length;
        setStatus(n === 0 ? "차이 없음 — 두 파일이 완전히 일치합니다." : `차이 ${n}건을 찾았습니다.`,
          n === 0 ? "ok" : "error");
        // 차이가 없어도 비교자료(요약/전체대조)는 받아볼 수 있어야 하므로 항상 노출한다
        els.downloadBtn.style.display = "inline-block";
      } catch (err) {
        console.error(err);
        setStatus(err.message || "비교 중 오류가 발생했습니다.", "error");
      }
    });

    els.downloadBtn.addEventListener("click", async () => {
      if (!lastResult) return;
      try {
        const wb = await buildResultWorkbook(lastResult);
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const month = (lastResult.months.nt[0] || "").replace(/^(\d{4})(\d{2})$/, "$1-$2");
        a.href = url;
        a.download = `세금계산서_비교결과${month ? "_" + month : ""}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error(err);
        setStatus("결과 엑셀을 만들지 못했습니다: " + err.message, "error");
      }
    });

    function renderResult(result) {
      const s = result.summary;
      const warn = [];
      if (result.months.hw.length > 1) {
        warn.push(`하이웍스 파일에 여러 달(${result.months.hw.join(", ")})이 섞여 있습니다 — 월별 비교 전제입니다.`);
      }
      if (result.months.nt.length > 1) {
        warn.push(`국세청 파일에 여러 달(${result.months.nt.join(", ")})이 섞여 있습니다 — 월별 비교 전제입니다.`);
      }
      if (result.months.hw.length === 1 && result.months.nt.length === 1 &&
          result.months.hw[0] !== result.months.nt[0]) {
        warn.push(`두 파일의 귀속월이 다릅니다 (하이웍스 ${result.months.hw[0]} / 국세청 ${result.months.nt[0]}).`);
      }

      const rows = result.diffs.map(d => `
        <tr>
          <td><span class="tsc-tag tsc-tag-${d.type === "금액 차이" ? "diff" : "missing"}">${d.type}</span></td>
          <td>${d.date ? `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}` : ""}</td>
          <td>${d.name || ""}${d.kind && d.kind.includes("수정") ? ' <span class="tsc-tag tsc-tag-fix">수정</span>' : ""}</td>
          <td>${d.bizNo || ""}</td>
          <td class="tsc-num">${d.ntSupply === null ? "—" : formatWon(d.ntSupply)}</td>
          <td class="tsc-num">${d.hwSupply === null ? "—" : formatWon(d.hwSupply)}</td>
          <td class="tsc-num">${d.ntTax === null ? "—" : formatWon(d.ntTax)}</td>
          <td class="tsc-num">${d.hwTax === null ? "—" : formatWon(d.hwTax)}</td>
        </tr>`).join("");

      els.result.innerHTML = `
        ${warn.map(w => `<p class="tsc-warn">⚠ ${w}</p>`).join("")}
        <table class="tsc-summary">
          <tr><th></th><th>국세청</th><th>하이웍스</th><th>차이</th></tr>
          <tr><th>건수</th><td>${s.ntCount.toLocaleString()}건</td><td>${s.hwCount.toLocaleString()}건</td>
              <td class="${s.ntCount === s.hwCount ? "" : "tsc-mismatch"}">${(s.ntCount - s.hwCount).toLocaleString()}건</td></tr>
          <tr><th>공급가액</th><td>${formatWon(s.ntSupply)}</td><td>${formatWon(s.hwSupply)}</td>
              <td class="${s.ntSupply === s.hwSupply ? "" : "tsc-mismatch"}">${formatWon(s.ntSupply - s.hwSupply)}</td></tr>
          <tr><th>세액</th><td>${formatWon(s.ntTax)}</td><td>${formatWon(s.hwTax)}</td>
              <td class="${s.ntTax === s.hwTax ? "" : "tsc-mismatch"}">${formatWon(s.ntTax - s.hwTax)}</td></tr>
        </table>
        <p class="desc" style="margin:12px 0 0;">짝이 맞은 건 ${result.matchedCount.toLocaleString()}건 · 차이 ${result.diffs.length.toLocaleString()}건</p>
        ${result.diffs.length === 0 ? '<p class="tsc-ok">✅ 차이가 없습니다.</p>' : `
        <div class="tsc-table-wrap">
          <table class="tsc-table">
            <thead>
              <tr>
                <th>구분</th><th>작성일자</th><th>상호</th><th>사업자번호</th>
                <th>국세청 공급가액</th><th>하이웍스 공급가액</th>
                <th>국세청 세액</th><th>하이웍스 세액</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`}
      `;
    }
  }

  window.HilineTaxSummaryCompareTool = {
    init,
    _internal: { parseHiworks, parseHometax, compare, normName, buildResultWorkbook },
  };
})();
