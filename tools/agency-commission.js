/*
 * 대리점 수수료 정산
 * "2026년_대리점수당.xls"의 '2026' 시트(대리점별 정산 원장)를 브라우저 안에서 관리하고,
 * 필요할 때 같은 컬럼 구성의 xlsx로 다운로드한다. 데이터는 서버로 전송되지 않고
 * localStorage에만 저장된다.
 * 원본 시트는 대리점 블록마다 "이월금"/"총지급금액(실제지급달)계산서" 요약 행과 빈 구분 행이
 * 섞여 있고, 금액 칸에도 "미납/61,160", "2.3/200,000", "해지" 같은 자유텍스트 메모가 섞여있어
 * 숫자로 재계산하지 않고 원본 셀 값을 그대로 보존하는 방식으로 관리한다(엑셀 형식을 최대한 그대로 유지).
 * 원본이 .xls라 업로드 파싱에는 SheetJS(vendor/xlsx.full.min.js), 다운로드는 서식을 위해
 * ExcelJS(vendor/exceljs.min.js)를 사용한다.
 * 월별 금액은 2026년 1월~12월을 관리한다(원본 파일에는 2026.1~6월까지만 있고, 나머지는
 * HIMS 동기화로 이후 채워진다). "HIMS 동기화" 기능(tools/helper-server/의 /hims/* 경로)을 사용하면
 * hims.hilineisp.net 요금납부정보와 대조해서 완납/미납/이월 여부를 자동으로 채울 수 있다.
 */
(function () {
  const STORAGE_KEY = "hiline_agency_commission_v1";
  const SHEET_NAME = "2026";
  const SYNC_YEAR = 2026;
  const SYNC_SERVER = "http://localhost:8787";

  // 원본 시트 컬럼(0-based) → 우리 필드 매핑. 12~17(2025.7~2025.12)은 건너뛴다.
  // m7~m12(2026.7~12월)는 원본 파일에 없는 컬럼이라 srcCol을 범위 밖 값으로 둬서(항상 빈 값)
  // 업로드 시에는 비어있게 시작하고, 실제 값은 헤더 텍스트 매칭(detectColumnIndexes)이나
  // HIMS 동기화로 채워진다.
  const COLUMNS = [
    { key: "dealer", label: "대리점", srcCol: 0 },
    { key: "note", label: "비고", srcCol: 1, multiline: true },
    { key: "customerNo", label: "고객번호", srcCol: 2 },
    { key: "contractNo", label: "계약번호", srcCol: 3 },
    { key: "company", label: "상호", srcCol: 4 },
    { key: "startDate", label: "개통일\n정산시작일", srcCol: 5 },
    { key: "contractDate", label: "계약일", srcCol: 6 },
    { key: "expireDate", label: "계약만료일", srcCol: 7 },
    { key: "endStatus", label: "계약종료\n정산종료", srcCol: 8 },
    { key: "revenue", label: "수익금액", srcCol: 9 },
    { key: "sales", label: "매출액\n(VAT별도)", srcCol: 10 },
    { key: "monthlyFee", label: "月정산액", srcCol: 11 },
    { key: "m1", label: "2026.1월", srcCol: 18 },
    { key: "m2", label: "2026.2월", srcCol: 19 },
    { key: "m3", label: "2026.3월", srcCol: 20 },
    { key: "m4", label: "2026.4월", srcCol: 21 },
    { key: "m5", label: "2026.5월", srcCol: 22 },
    { key: "m6", label: "2026.6월", srcCol: 23 },
    { key: "m7", label: "2026.7월", srcCol: 24 },
    { key: "m8", label: "2026.8월", srcCol: 25 },
    { key: "m9", label: "2026.9월", srcCol: 26 },
    { key: "m10", label: "2026.10월", srcCol: 27 },
    { key: "m11", label: "2026.11월", srcCol: 28 },
    { key: "m12", label: "2026.12월", srcCol: 29 },
  ];

  // 화면 표에는 대리점명/고객번호/계약번호/상호와 월별 금액만 항상 보여주고, 나머지(비고/일자/
  // 계약종료/수익금액/매출액/月정산액)는 행마다 "상세" 토글로 접어둔다 — 컬럼이 24개나 돼서
  // 좁은 칸에 글씨가 잘려 보이는 문제(사용자 피드백)를 컬럼 수 자체를 줄여서 해결.
  // 엑셀 다운로드/업로드(COLUMNS 순서·전체 필드)는 그대로 유지, 화면 표시 방식만 바뀐다.
  const MAIN_KEYS = [
    "dealer", "customerNo", "contractNo", "company",
    "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12",
  ];
  const MAIN_COLUMNS = MAIN_KEYS.map((k) => COLUMNS.find((c) => c.key === k));
  const DETAIL_COLUMNS = COLUMNS.filter((c) => !MAIN_KEYS.includes(c.key));
  const MAIN_COLUMN_WIDTH = {
    dealer: 100, customerNo: 120, contractNo: 100, company: 170,
    m1: 78, m2: 78, m3: 78, m4: 78, m5: 78, m6: 78, m7: 78, m8: 78, m9: 78, m10: 78, m11: 78, m12: 78,
  };

  // 전체 계약이 종료된 상호는 불러올 때 자동으로 "종료" 표시(rec.closed=true)해서 회색 처리 +
  // HIMS 동기화 대상에서 제외한다(2026-08-04 사용자 요청). 나머지 행(예: 일부 계약만 종료된 경우)은
  // 화면의 "종료" 체크박스로 직접 표시하면 된다. rec.closed는 엑셀 컬럼(COLUMNS)에 없는 이 도구
  // 전용 표시라 엑셀 다운로드/업로드에는 반영되지 않는다 — 파일을 다시 업로드하면 아래 목록에 없는
  // 회사의 수동 "종료" 표시는 초기화되니 참고.
  const CLOSED_COMPANIES = ["바시스", "동서한방병원", "아이티센씨티에스", "인탑", "스냅컴퍼니"];

  function applyClosedDefaults(records) {
    records.forEach((rec) => {
      if (rec.closed === undefined) rec.closed = CLOSED_COMPANIES.includes((rec.company || "").trim());
    });
  }

  let data = [];

  // "상태" 필터(유지/전체/종료) — 화면 표만 걸러 보여주고 data 자체는 건드리지 않는다. 기본값은
  // "유지"(종료 처리된 행은 평소엔 숨김) — rowEls는 renderTable이 만든 각 행(rec/tr/detailTr)을
  // 필터 재적용 때 다시 순회하기 위한 참조.
  let currentFilter = "active";
  let rowEls = [];

  function matchesFilter(rec) {
    if (currentFilter === "active") return !rec.closed;
    if (currentFilter === "closed") return !!rec.closed;
    return true;
  }

  function applyFilter() {
    rowEls.forEach(({ rec, tr, detailTr }) => {
      const show = matchesFilter(rec);
      tr.style.display = show ? "" : "none";
      if (detailTr) detailTr.style.display = show && tr.dataset.detailOpen === "1" ? "" : "none";
    });
  }

  // ── 공용 유틸 ───────────────────────────────────────────
  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  // kind: "normal"을 넘기면 값이 하나도 없어도 rowType()이 "비고"(blank)가 아니라 "normal"(계약행)로
  // 판정하도록 _rowKind 표시를 붙인다. 새 계약행을 만들 때 쓰고, 비고행을 만들 때는 생략한다.
  function blankRecord(kind) {
    const r = { _id: newId(), closed: false };
    COLUMNS.forEach((c) => { r[c.key] = ""; });
    if (kind === "normal") r._rowKind = "normal";
    return r;
  }

  // "blank" 판정에서 note(비고)와 dealer(대리점, 세로 병합 때문에 빈 행에도 값이 써질 수 있음)는
  // 제외한다 — 총지급금액 다음 빈 행에 비고를 채우거나 대리점명이 병합돼 들어가도 여전히
  // "blank"로 취급되어야 블록 경계/스타일링(이월금·총지급금액과 함께 종료 표시 등)이 깨지지 않는다.
  // _rowKind: "normal"은 "+ 계약" 등으로 방금 추가돼 아직 아무 값도 안 채워진 새 계약행을 위한
  // 명시적 표시(2026-08-05) — 값만으로 타입을 추론하면 빈 계약행이 "비고"(blank)로 오분류돼
  // 화면에 "비고"로 보이고, HIMS 동기화 쪽 블록 경계까지 잘못 끊기는 문제가 있었음. COLUMNS(엑셀
  // 컬럼)에 없는 이 도구 전용 표시라 다운로드/재업로드 시엔 사라짐(closed와 같은 패턴).
  function rowType(rec) {
    const c = (rec.customerNo || "").trim();
    if (c.includes("이월금")) return "carry";
    if (c.includes("총지급금액")) return "total";
    if (rec._rowKind === "normal") return "normal";
    const allBlank = COLUMNS.every((col) => col.key === "note" || col.key === "dealer" || !(rec[col.key] || "").toString().trim());
    return allBlank ? "blank" : "normal";
  }

  // ── 저장/불러오기 (localStorage) ───────────────────────
  function loadFromStorage() {
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
      console.error(e);
      data = [];
    }
    applyClosedDefaults(data);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // ── 업로드 파일 파싱 (SheetJS) ──────────────────────────
  // 원본 파일(24컬럼, 2025.7~2026.6 월별)과 이 도구가 만든 다운로드 파일(18컬럼, 2026.1~6만)은
  // 컬럼 위치가 다르므로, 고정 위치(srcCol) 대신 헤더 텍스트로 실제 컬럼 위치를 매번 찾는다.
  const FIXED_LABEL_MAP = {
    dealer: "대리점", note: "비고", customerNo: "고객번호", contractNo: "계약번호", company: "상호",
    startDate: "개통일", contractDate: "계약일", expireDate: "계약만료일", endStatus: "계약종료",
    revenue: "수익금액", sales: "매출액", monthlyFee: "月정산액",
  };
  function normalizeHeader(s) {
    return String(s || "").split("\n")[0].replace(/\s+/g, "").toLowerCase();
  }

  function detectColumnIndexes(headerRow) {
    const idx = {};
    headerRow.forEach((cellText, i) => {
      const text = String(cellText || "");
      const monthMatch = text.match(/2026\.\s*(\d{1,2})\s*월/);
      if (monthMatch) {
        const m = parseInt(monthMatch[1], 10);
        if (m >= 1 && m <= 6 && idx["m" + m] == null) idx["m" + m] = i;
        return;
      }
      Object.keys(FIXED_LABEL_MAP).forEach((key) => {
        if (idx[key] == null && normalizeHeader(text).startsWith(normalizeHeader(FIXED_LABEL_MAP[key]))) {
          idx[key] = i;
        }
      });
    });
    // 헤더에서 못 찾은 컬럼은 원본 파일 기준 고정 위치로 보완
    COLUMNS.forEach((col) => { if (idx[col.key] == null) idx[col.key] = col.srcCol; });
    return idx;
  }

  function parseSheet(ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
    const colIndex = detectColumnIndexes(rows[0] || []);
    const out = [];
    for (let i = 1; i < rows.length; i++) { // 0행은 헤더
      const r = rows[i];
      const rec = { _id: newId() };
      COLUMNS.forEach((col) => { rec[col.key] = String(r[colIndex[col.key]] ?? "").trim(); });
      out.push(rec);
    }
    return out;
  }

  function parseWorkbook(wb) {
    const ws = wb.Sheets[SHEET_NAME] || wb.Sheets[wb.SheetNames[0]];
    return parseSheet(ws);
  }

  // ── 다운로드용 워크북 생성 (ExcelJS) ────────────────────
  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
  const CARRY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  const THIN = { style: "thin" };
  const BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const HEADER_FONT = { name: "맑은 고딕", size: 10, bold: true };
  const DATA_FONT = { name: "맑은 고딕", size: 10 };

  function setColumnWidths(ws) {
    const widthMap = {
      dealer: 14, note: 26, customerNo: 16, contractNo: 14, company: 22,
      startDate: 12, contractDate: 12, expireDate: 12, endStatus: 12,
      revenue: 11, sales: 11, monthlyFee: 11,
      m1: 11, m2: 11, m3: 11, m4: 11, m5: 11, m6: 11,
    };
    COLUMNS.forEach((col, i) => { ws.getColumn(i + 1).width = widthMap[col.key] || 12; });
  }

  async function buildWorkbook(records) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAME);

    const headerRow = ws.addRow(COLUMNS.map((c) => c.label));
    headerRow.eachCell((cell) => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.border = BORDERS;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    headerRow.height = 28;

    records.forEach((rec) => {
      const type = rowType(rec);
      const row = ws.addRow(COLUMNS.map((c) => rec[c.key] || ""));
      row.eachCell((cell) => {
        cell.font = DATA_FONT;
        cell.border = BORDERS;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        if (type === "carry") cell.fill = CARRY_FILL;
        if (type === "total") cell.fill = TOTAL_FILL;
      });
    });

    setColumnWidths(ws);
    return wb;
  }

  // ── DOM 렌더링 ──────────────────────────────────────────
  // 미납("미납/금액")은 빨간 폰트, 미납금을 늦게 납부한 경우("6.30/금액" — HIMS 동기화의 이월금
  // 케이스와 같은 형식)는 노란 셀로 구분 표시한다.
  const LATE_PAID_RE = /^\d{1,2}\.\d{1,2}\/.+/;
  function applyCellStatusStyle(input, value) {
    const v = (value || "").trim();
    input.classList.toggle("ac-unpaid", /^미납\//.test(v));
    input.classList.toggle("ac-late-paid", LATE_PAID_RE.test(v));
  }

  function buildFieldInput(rec, col, onChange) {
    const input = document.createElement(col.multiline ? "textarea" : "input");
    if (!col.multiline) input.type = "text";
    else { input.rows = 2; }
    input.value = rec[col.key] || "";
    input.title = input.value;
    applyCellStatusStyle(input, input.value);
    input.addEventListener("change", () => {
      rec[col.key] = input.value.trim();
      input.title = rec[col.key];
      applyCellStatusStyle(input, rec[col.key]);
      save();
      if (onChange) onChange();
    });
    return input;
  }

  function cellInput(rec, col, onChange) {
    const td = document.createElement("td");
    td.appendChild(buildFieldInput(rec, col, onChange));
    return td;
  }

  function applyRowType(tr, detailTr, rec) {
    [tr, detailTr].forEach((el) => {
      if (!el) return;
      el.classList.remove("ac-row-carry", "ac-row-total", "ac-row-blank");
    });
    const type = rowType(rec);
    if (type === "carry" || type === "total" || type === "blank") {
      const cls = "ac-row-" + type;
      tr.classList.add(cls);
      if (detailTr) detailTr.classList.add(cls);
    }
    [tr, detailTr].forEach((el) => {
      if (!el) return;
      el.classList.toggle("ac-row-closed", !!rec.closed);
    });
  }

  // 이월금/총지급금액/빈 행에는 "종료" 체크박스가 없지만(정상 고객행에만 있음), 한 블록의 정상행이
  // 전부 종료되면(대리점 전체 종료) 그 블록의 이월금/총지급금액/빈 행도 같이 회색 처리한다
  // (사용자 요청, 2026-08-04). 블록 구성은 hims-match.js의 buildBlocks와 동일한 규칙(정상행들 →
  // 이월금 → 총지급금액 → 빈행)을 따른다.
  function buildBlocksForStyling(records) {
    const blocks = [];
    let pending = [];
    let lastBlock = null;
    records.forEach((rec, i) => {
      const t = rowType(rec);
      if (t === "normal") {
        pending.push(i);
        lastBlock = null;
      } else if (t === "carry") {
        const block = { carryIndex: i, totalIndex: null, blankIndex: null, normalIndices: pending };
        blocks.push(block);
        lastBlock = block;
        pending = [];
      } else if (t === "total") {
        if (lastBlock && lastBlock.totalIndex == null) lastBlock.totalIndex = i;
        pending = [];
      } else {
        if (lastBlock && lastBlock.blankIndex == null) lastBlock.blankIndex = i;
        pending = [];
        lastBlock = null;
      }
    });
    return blocks;
  }

  // 대리점 칸 세로 병합 정보: 블록(정상행들→이월금→총지급금액→비고행, buildBlocksForStyling과 동일
  // 경계) 단위로 먼저 나누고, 그 블록 안의 정상행들을 다시 "대리점명이 실제로 바뀌는 지점" 기준
  // 서브 구간으로 쪼갠다. 이월금/총지급금액/비고 행은 그 블록의 마지막 서브 구간에만 붙인다.
  // - 블록 경계를 절대 넘지 않으므로, 예를 들어 에이치플러스 양지 블록처럼 대리점명이 아예 없는
  //   블록도 그 블록 자기 범위(정상행~비고)만큼만 "빈 대리점" 한 칸으로 병합되고, 절대 이전
  //   블록(예: 삼일제약)의 rowspan에 잘못 이어붙지 않는다(2026-08-04 실사용 스크린샷에서 발견 —
  //   이전 버전은 블록 경계를 무시한 채 "정상행에 새 대리점명이 있을 때만" 런을 끊어서, 다음 블록의
  //   첫 행이 대리점명 없이 시작하면 이전 블록 rowspan에 흡수돼 대리점 칸이 아예 안 그려지고 그
  //   행 전체가 한 칸씩 밀려 보이는 버그가 있었음).
  // - 한 블록 안에 서로 다른 대리점(예: 박천홍 팀장/이일웅 본부장)이 섞여 있으면 대리점명이 바뀌는
  //   지점에서 서브 구간이 나뉘고, 마지막 서브 구간(가장 최근 대리점)만 그 블록의
  //   이월금/총지급금액/비고 행을 포함한다.
  function computeDealerMergeInfo(records) {
    const blocks = buildBlocksForStyling(records);
    const skip = new Set();
    const spanStart = new Map();

    blocks.forEach((b) => {
      const tailIndices = [];
      if (b.carryIndex != null) tailIndices.push(b.carryIndex);
      if (b.totalIndex != null) tailIndices.push(b.totalIndex);
      if (b.blankIndex != null) tailIndices.push(b.blankIndex);

      const subSpans = [];
      let current = null;
      b.normalIndices.forEach((idx) => {
        const ownDealer = (records[idx].dealer || "").trim();
        if (!current || (ownDealer && ownDealer !== current.value)) {
          current = { value: ownDealer, indices: [idx] };
          subSpans.push(current);
        } else {
          current.indices.push(idx);
        }
      });

      if (tailIndices.length > 0) {
        if (subSpans.length > 0) {
          subSpans[subSpans.length - 1].indices.push(...tailIndices);
        } else {
          subSpans.push({ value: "", indices: tailIndices.slice() });
        }
      }

      subSpans.forEach((span) => {
        const minIdx = Math.min(...span.indices);
        spanStart.set(minIdx, { rowSpan: span.indices.length, value: span.value, memberIndices: span.indices.slice() });
        span.indices.forEach((idx) => { if (idx !== minIdx) skip.add(idx); });
      });
    });

    return { spanStart, skip };
  }

  // 총지급금액 행은 있는데 그 블록에 비고(빈) 행이 없는 경우의 totalIndex 집합 — "+ 비고 행 추가"
  // 버튼을 보여줄지 판단하는 데 쓴다(이런 블록은 대리점 세로 병합이 총지급금액에서 끊긴 채로 보임).
  function computeMissingBlankTotals(records) {
    const blocks = buildBlocksForStyling(records);
    const set = new Set();
    blocks.forEach((b) => {
      if (b.totalIndex != null && b.blankIndex == null) set.add(b.totalIndex);
    });
    return set;
  }

  function applyBlockClosedStyling() {
    const records = rowEls.map((e) => e.rec);
    const blocks = buildBlocksForStyling(records);
    const closedIdx = new Set();
    blocks.forEach((b) => {
      const allClosed = b.normalIndices.length > 0 && b.normalIndices.every((idx) => !!records[idx].closed);
      if (!allClosed) return;
      [b.carryIndex, b.totalIndex, b.blankIndex].forEach((idx) => { if (idx != null) closedIdx.add(idx); });
    });
    rowEls.forEach(({ rec, tr, detailTr }, i) => {
      if (rowType(rec) === "normal") return; // 정상행 자체의 종료 표시는 applyRowType이 따로 관리
      const shouldClose = closedIdx.has(i);
      tr.classList.toggle("ac-row-closed", shouldClose);
      if (detailTr) detailTr.classList.toggle("ac-row-closed", shouldClose);
    });
  }

  // 접혀있는 "상세" 정보(비고/일자/계약종료/수익금액/매출액/月정산액)를 행 아래에 라벨+입력칸
  // 그리드로 펼쳐 보여준다. 토글 열림/닫힘은 appendRow에서 관리.
  function buildDetailRow(rec, onChange, colSpan) {
    const tr = document.createElement("tr");
    tr.className = "ac-detail-row";
    tr.style.display = "none";

    const td = document.createElement("td");
    td.colSpan = colSpan;
    const grid = document.createElement("div");
    grid.className = "ac-detail-grid";
    DETAIL_COLUMNS.forEach((col) => {
      const field = document.createElement("label");
      field.className = "ac-detail-field";
      if (col.multiline) field.classList.add("ac-detail-field-wide");
      const label = document.createElement("span");
      label.className = "ac-detail-label";
      label.textContent = col.label.replace(/\n/g, " ");
      field.appendChild(label);
      field.appendChild(buildFieldInput(rec, col, onChange));
      grid.appendChild(field);
    });
    td.appendChild(grid);
    tr.appendChild(td);
    return tr;
  }

  function appendRow(tbody, rec, index, dealerMergeInfo, moveRow, insertBlankAfter, missingBlankTotals) {
    dealerMergeInfo = dealerMergeInfo || { spanStart: new Map(), skip: new Set() };
    const tr = document.createElement("tr");
    const type = rowType(rec);
    // "종료" 체크박스/"상세" 토글은 실제 고객 행(고객번호가 있는 normal 행)에만 의미가 있어서,
    // 이월금/총지급금액/빈 행에는 아예 넣지 않는다(사용자 요청, 2026-08-04).
    const isNormal = type === "normal";
    const isBlank = type === "blank";
    let detailTr = null; // normal 행만 buildDetailRow가 아래에서 채워줌 — 클로저로 참조

    function handleChange() {
      applyRowType(tr, detailTr, rec);
    }

    // 대리점 칸: 한 블록(정상행들~이월금~총지급금액~비고행) 전체를 세로로 병합해서 한 번만 보여준다
    // (사용자 요청, 2026-08-04 — 계약이 여러 건이어도 대리점명은 통합 표시).
    if (dealerMergeInfo.skip.has(index)) {
      // 이 행은 블록 첫 행의 rowspan 안에 포함되므로 대리점 칸을 그리지 않음
    } else if (dealerMergeInfo.spanStart.has(index)) {
      const info = dealerMergeInfo.spanStart.get(index);
      const td = document.createElement("td");
      td.rowSpan = info.rowSpan;
      td.className = "ac-dealer-merged";
      const input = document.createElement("input");
      input.type = "text";
      input.value = info.value;
      input.title = info.value;
      input.addEventListener("change", () => {
        const v = input.value.trim();
        info.memberIndices.forEach((idx) => { if (data[idx]) data[idx].dealer = v; });
        input.title = v;
        save();
      });
      td.appendChild(input);
      tr.appendChild(td);
    } else {
      tr.appendChild(cellInput(rec, MAIN_COLUMNS[0], handleChange));
    }

    // 나머지 메인 칸(고객번호~월별). 고객번호/계약번호/상호(왼쪽 2~4번째 칸) 3개를 합쳐서:
    // 빈 행은 "비고", 이월금/총지급금액 행은 그 customerNo 값("이월금"/"총지급금액...")을 3칸에
    // 걸쳐 텍스트로만 보여준다(비고와 동일하게 입력칸 없이 — 사용자 요청, 2026-08-04). 셋 다
    // 가운데 정렬. customerNo는 rowType 판정에 쓰이는 값이라 편집칸을 없애 실수로 안 바뀌게 함.
    if (isBlank) {
      const mergedTd = document.createElement("td");
      mergedTd.colSpan = 3;
      mergedTd.className = "ac-blank-note-td";
      mergedTd.textContent = "비고";
      tr.appendChild(mergedTd);
      MAIN_COLUMNS.slice(4).forEach((col) => tr.appendChild(cellInput(rec, col, handleChange)));
    } else if (type === "carry" || type === "total") {
      const mergedTd = document.createElement("td");
      mergedTd.colSpan = 3;
      mergedTd.className = "ac-carrytotal-label-td";
      const label = document.createElement("span");
      label.textContent = rec.customerNo || "";
      mergedTd.appendChild(label);
      // 총지급금액 다음에 비고(빈) 행이 없는 블록은 대리점/비고 병합이 이 행에서 끊긴 채로 보임
      // (예: 이일웅 본부장, 운현호 건) — 클릭 한 번으로 비고 행을 끼워넣을 수 있게 버튼 제공.
      if (type === "total" && missingBlankTotals && missingBlankTotals.has(index) && insertBlankAfter) {
        const addNoteBtn = document.createElement("button");
        addNoteBtn.type = "button";
        addNoteBtn.className = "wf-link-btn ac-add-note-btn";
        addNoteBtn.textContent = "+ 비고 행 추가";
        addNoteBtn.title = "이 블록에 비고(빈) 행이 없어서 대리점 병합이 여기서 끊깁니다. 클릭하면 바로 아래에 비고 행을 추가합니다.";
        addNoteBtn.addEventListener("click", () => insertBlankAfter(index));
        mergedTd.appendChild(addNoteBtn);
      }
      tr.appendChild(mergedTd);
      MAIN_COLUMNS.slice(4).forEach((col) => tr.appendChild(cellInput(rec, col, handleChange)));
    } else {
      MAIN_COLUMNS.slice(1).forEach((col) => tr.appendChild(cellInput(rec, col, handleChange)));
    }

    const closeTd = document.createElement("td");
    if (isNormal) {
      const closeLabel = document.createElement("label");
      closeLabel.className = "ac-close-toggle";
      const closeCb = document.createElement("input");
      closeCb.type = "checkbox";
      closeCb.checked = !!rec.closed;
      closeCb.title = "체크하면 이 행은 회색 처리되고 다음 HIMS 동기화 대상에서 제외됩니다.";
      closeCb.addEventListener("change", () => {
        rec.closed = closeCb.checked;
        save();
        applyRowType(tr, detailTr, rec);
        applyBlockClosedStyling();
        applyFilter();
      });
      closeLabel.appendChild(closeCb);
      closeLabel.appendChild(document.createTextNode("종료"));
      closeTd.appendChild(closeLabel);
    }
    tr.appendChild(closeTd);

    const toggleTd = document.createElement("td");
    let toggleBtn = null;
    if (isNormal) {
      toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "wf-link-btn ac-toggle-btn";
      toggleBtn.textContent = "상세 ▾";
      toggleTd.appendChild(toggleBtn);
    }
    tr.appendChild(toggleTd);

    const moveTd = document.createElement("td");
    if (moveRow && index != null) {
      moveTd.className = "ac-move-cell";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "wf-link-btn ac-move-btn";
      upBtn.textContent = "▲";
      upBtn.disabled = index <= 0;
      upBtn.addEventListener("click", () => moveRow(index, -1));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "wf-link-btn ac-move-btn";
      downBtn.textContent = "▼";
      downBtn.disabled = index >= data.length - 1;
      downBtn.addEventListener("click", () => moveRow(index, 1));
      moveTd.appendChild(upBtn);
      moveTd.appendChild(downBtn);
    }
    tr.appendChild(moveTd);

    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "wf-del-btn";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      if (!confirm("이 행을 삭제할까요?")) return;
      data = data.filter((r) => r._id !== rec._id);
      rowEls = rowEls.filter((e) => e.rec._id !== rec._id);
      tr.remove();
      if (detailTr) detailTr.remove();
      applyBlockClosedStyling();
      save();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    if (isNormal) {
      detailTr = buildDetailRow(rec, handleChange, MAIN_COLUMNS.length + 3);
      tr.dataset.detailOpen = "0";
      toggleBtn.addEventListener("click", () => {
        const isOpen = detailTr.style.display !== "none";
        const nextOpen = !isOpen;
        tr.dataset.detailOpen = nextOpen ? "1" : "0";
        detailTr.style.display = nextOpen ? "" : "none";
        toggleBtn.textContent = nextOpen ? "상세 ▴" : "상세 ▾";
      });
    }

    applyRowType(tr, detailTr, rec);
    tbody.appendChild(tr);
    if (detailTr) tbody.appendChild(detailTr);
    rowEls.push({ rec, tr, detailTr });
  }

  function renderTable(container) {
    container.innerHTML = "";
    rowEls = [];
    const table = document.createElement("table");
    table.className = "wf-table ac-table";

    const colgroup = document.createElement("colgroup");
    MAIN_COLUMNS.forEach((col) => {
      const c = document.createElement("col");
      c.style.width = (MAIN_COLUMN_WIDTH[col.key] || 78) + "px";
      colgroup.appendChild(c);
    });
    const closeCol = document.createElement("col");
    closeCol.style.width = "52px";
    colgroup.appendChild(closeCol);
    const toggleCol = document.createElement("col");
    toggleCol.style.width = "56px";
    colgroup.appendChild(toggleCol);
    const moveCol = document.createElement("col");
    moveCol.style.width = "40px";
    colgroup.appendChild(moveCol);
    const delCol = document.createElement("col");
    delCol.style.width = "48px";
    colgroup.appendChild(delCol);
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headTr = document.createElement("tr");
    MAIN_COLUMNS.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      headTr.appendChild(th);
    });
    const closeTh = document.createElement("th");
    closeTh.textContent = "상태표시";
    headTr.appendChild(closeTh);
    const detailTh = document.createElement("th");
    detailTh.textContent = "상세";
    headTr.appendChild(detailTh);
    const moveTh = document.createElement("th");
    moveTh.textContent = "이동";
    headTr.appendChild(moveTh);
    headTr.appendChild(document.createElement("th"));
    thead.appendChild(headTr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    const dealerMergeInfo = computeDealerMergeInfo(data);
    const missingBlankTotals = computeMissingBlankTotals(data);

    // 행 순서 바꾸기: data 배열에서 두 행을 맞바꾸고 표 전체를 다시 그린다(대리점 세로 병합 등이
    // 얽혀있어 DOM을 부분만 손대는 것보다 통째로 다시 그리는 게 안전함).
    function moveRow(index, delta) {
      const target = index + delta;
      if (target < 0 || target >= data.length) return;
      const tmp = data[index];
      data[index] = data[target];
      data[target] = tmp;
      save();
      renderTable(container);
    }

    function insertBlankAfter(index) {
      data.splice(index + 1, 0, blankRecord());
      save();
      renderTable(container);
    }

    data.forEach((rec, i) => appendRow(tbody, rec, i, dealerMergeInfo, moveRow, insertBlankAfter, missingBlankTotals));
    applyBlockClosedStyling();
    applyFilter();
    container.appendChild(table);

    const btnRow = document.createElement("div");
    btnRow.style.marginTop = "12px";

    // "대리점 추가": 계약행 2개(대부분 대리점 블록에 계약이 2건 이상이라 기본 2줄로 시작) +
    // 이월금 + 총지급금액 + 비고행을 한 세트로 새로 만든다. 계약행이 더 필요하면 이 버튼으로
    // 세트를 하나 더 만든 뒤 "이동" 버튼으로 원하는 블록 안에 끼워 넣으면 됨(대리점 칸의
    // "+ 계약" 버튼은 2026-08-05 삭제됨).
    const addDealerBtn = document.createElement("button");
    addDealerBtn.className = "btn wf-add-btn";
    addDealerBtn.textContent = "+ 대리점 추가";
    addDealerBtn.style.marginRight = "8px";
    addDealerBtn.addEventListener("click", () => {
      const normalRec1 = blankRecord("normal");
      const normalRec2 = blankRecord("normal");
      const carryRec = blankRecord();
      carryRec.customerNo = "이월금";
      const totalRec = blankRecord();
      totalRec.customerNo = "총지급금액";
      const blankRec = blankRecord();
      data.push(normalRec1, normalRec2, carryRec, totalRec, blankRec);
      save();
      renderTable(container);
    });
    btnRow.appendChild(addDealerBtn);

    container.appendChild(btnRow);
  }

  // ── 초기화 ──────────────────────────────────────────────
  function init(root) {
    loadFromStorage();
    currentFilter = "active";

    // 탭(정산요약/매월 수수료/매월 상품권/당월 상품권) — 지금은 "매월 수수료"만 실제 내용이 있고
    // 나머지 3개는 준비 중 안내만 표시(2026-08-04, welfare-management.js의 탭 패턴과 동일).
    const tabs = root.querySelectorAll(".wf-tab");
    const panels = {
      summary: root.querySelector("#ac-panel-summary"),
      "monthly-fee": root.querySelector("#ac-panel-monthly-fee"),
      "monthly-gift": root.querySelector("#ac-panel-monthly-gift"),
      "current-gift": root.querySelector("#ac-panel-current-gift"),
    };
    function showTab(id) {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
      Object.keys(panels).forEach((k) => { panels[k].style.display = k === id ? "" : "none"; });
    }
    tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

    const container = root.querySelector("#ac-table-container");
    renderTable(container);

    const filterSelect = root.querySelector("#ac-filter-select");
    filterSelect.value = currentFilter;
    filterSelect.addEventListener("change", () => {
      currentFilter = filterSelect.value;
      applyFilter();
    });

    const status = root.querySelector("#ac-status");
    function setStatus(msg, isError) {
      status.textContent = msg;
      status.style.color = isError ? "#b91c1c" : "#374151";
    }

    const dropZone = root.querySelector("#ac-dropzone");
    const fileInput = root.querySelector("#ac-file-input");

    function handleFile(file) {
      if (!file) return;
      if (!/\.(xls|xlsx)$/i.test(file.name)) {
        setStatus("xls 또는 xlsx 파일만 업로드할 수 있습니다.", true);
        return;
      }
      if (!confirm("업로드한 파일 내용으로 현재 관리 중인 데이터를 덮어씁니다. 계속할까요?")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          data = parseWorkbook(wb);
          applyClosedDefaults(data);
          save();
          renderTable(container);
          setStatus(`업로드 완료 — ${data.length}행 불러왔습니다.`);
        } catch (err) {
          console.error(err);
          setStatus("업로드 실패: " + err.message, true);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((evt) => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); }));
    dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

    root.querySelector("#ac-download-btn").addEventListener("click", async () => {
      setStatus("다운로드 준비 중...");
      try {
        const wb = await buildWorkbook(data);
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const today = new Date();
        const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
        a.href = url;
        a.download = `대리점수당_2026_${stamp}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus("다운로드되었습니다.");
      } catch (err) {
        console.error(err);
        setStatus("다운로드 실패: " + err.message, true);
      }
    });

    // ── HIMS 동기화 ────────────────────────────────────────
    const syncBtn = root.querySelector("#ac-sync-btn");
    const syncStatus = root.querySelector("#ac-sync-status");
    const syncResult = root.querySelector("#ac-sync-result");
    const SYNC_BUSY_STATES = ["connecting", "fetching", "computing"];
    let syncPollTimer = null;

    function applyCellUpdates(updates) {
      let applied = 0;
      updates.forEach((u) => {
        const rec = data.find((r) => r._id === u.rowId);
        if (!rec) return;
        rec[u.field] = u.value;
        applied++;
      });
      return applied;
    }

    function renderSyncResult(result) {
      if (!result) { syncResult.innerHTML = ""; return; }
      const parts = [];
      const totalUpdates = result.totalUpdates || [];
      parts.push(`<p>칸 ${result.cellUpdates.length}건 갱신, 이월금 ${result.carryUpdates.filter((u) => u.value).length}건·` +
        `총지급금액 ${totalUpdates.filter((u) => u.value).length}건 반영됨.</p>`);
      if (result.notFoundCustomers.length) {
        parts.push(`<p style="color:#b91c1c;">HIMS에서 못 찾은 고객번호(${result.notFoundCustomers.length}건): ${result.notFoundCustomers.join(", ")}</p>`);
      }
      if (result.noContractMatch.length) {
        const items = result.noContractMatch.map((m) => `${m.company || m.customerNo}(${m.contractNo})`).join(", ");
        parts.push(`<p style="color:#b45309;">고객번호는 찾았지만 7~12월 청구건이 하나도 없는 행(해지됐거나 아직 청구 전일 수 있음, ${result.noContractMatch.length}건): ${items}</p>`);
      }
      if (result.skippedBlocks.length) {
        parts.push(`<p style="color:#6b7280;">일부 계약을 못 찾아 이월금·총지급금액 계산을 건너뛴 대리점 블록: ${result.skippedBlocks.length}개</p>`);
      }
      if (result.closedBlocks && result.closedBlocks.length) {
        parts.push(`<p style="color:#6b7280;">전체 종료 처리된 대리점 블록이라 이월금·총지급금액을 건드리지 않음: ${result.closedBlocks.length}개</p>`);
      }
      if (result.blocksWithoutTotalRow && result.blocksWithoutTotalRow.length) {
        parts.push(`<p style="color:#6b7280;">"총지급금액" 행을 찾지 못해 건너뛴 대리점 블록: ${result.blocksWithoutTotalRow.length}개(이월금 행 바로 다음에 총지급금액 행이 있는지 확인해주세요)</p>`);
      }
      syncResult.innerHTML = parts.join("");
    }

    function stopSyncPolling() {
      if (syncPollTimer) { clearInterval(syncPollTimer); syncPollTimer = null; }
    }

    function startSyncPolling() {
      stopSyncPolling();
      syncPollTimer = setInterval(async () => {
        try {
          const res = await fetch(`${SYNC_SERVER}/hims/status`, { cache: "no-store" });
          const job = await res.json();
          if (job.log && job.log.length) syncStatus.textContent = job.log[job.log.length - 1];
          if (!SYNC_BUSY_STATES.includes(job.state)) {
            stopSyncPolling();
            if (job.state === "done" && job.result) {
              const applied = applyCellUpdates(job.result.cellUpdates)
                + applyCellUpdates(job.result.carryUpdates)
                + applyCellUpdates(job.result.totalUpdates || []);
              save();
              renderTable(container);
              renderSyncResult(job.result);
              setStatus(`HIMS 동기화 완료 — ${applied}개 칸을 갱신했습니다.`);
            } else if (job.state === "error") {
              setStatus("HIMS 동기화 실패: " + job.error, true);
            }
          }
        } catch (err) {
          stopSyncPolling();
          setStatus("동기화 상태 확인 실패: " + err.message, true);
        }
      }, 1500);
    }

    syncBtn.addEventListener("click", async () => {
      syncResult.innerHTML = "";
      syncStatus.textContent = "동기화 요청 중...";
      try {
        const res = await fetch(`${SYNC_SERVER}/hims/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: data, year: SYNC_YEAR }),
        });
        if (res.status === 409) {
          syncStatus.textContent = "이미 진행 중인 동기화가 있습니다.";
          startSyncPolling();
          return;
        }
        if (!res.ok) throw new Error("동기화 요청이 실패했습니다.");
        startSyncPolling();
      } catch (err) {
        console.error(err);
        syncStatus.textContent =
          "HIMS 동기화 도우미 서버에 연결할 수 없습니다. tools/helper-server/start-server-now.bat을 실행해주세요.";
      }
    });
  }

  window.HilineAgencyCommissionTool = { init };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseWorkbook, rowType, buildWorkbook, COLUMNS };
  }
})();
