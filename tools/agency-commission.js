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

  let data = [];

  // ── 공용 유틸 ───────────────────────────────────────────
  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function blankRecord() {
    const r = { _id: newId() };
    COLUMNS.forEach((c) => { r[c.key] = ""; });
    return r;
  }

  function rowType(rec) {
    const c = (rec.customerNo || "").trim();
    if (c.includes("이월금")) return "carry";
    if (c.includes("총지급금액")) return "total";
    const allBlank = COLUMNS.every((col) => !(rec[col.key] || "").toString().trim());
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
  function applyUnpaidStyle(input, value) {
    input.classList.toggle("ac-unpaid", /^미납\//.test((value || "").trim()));
  }

  function cellInput(rec, col) {
    const td = document.createElement("td");
    const input = document.createElement(col.multiline ? "textarea" : "input");
    if (!col.multiline) input.type = "text";
    else { input.rows = 2; }
    input.value = rec[col.key] || "";
    applyUnpaidStyle(input, input.value);
    input.addEventListener("change", () => {
      rec[col.key] = input.value.trim();
      applyUnpaidStyle(input, rec[col.key]);
      save();
      applyRowType(td.parentElement, rec);
    });
    td.appendChild(input);
    return td;
  }

  function applyRowType(tr, rec) {
    tr.classList.remove("ac-row-carry", "ac-row-total", "ac-row-blank");
    const type = rowType(rec);
    if (type === "carry") tr.classList.add("ac-row-carry");
    if (type === "total") tr.classList.add("ac-row-total");
    if (type === "blank") tr.classList.add("ac-row-blank");
  }

  function appendRow(tbody, rec) {
    const tr = document.createElement("tr");
    COLUMNS.forEach((col) => tr.appendChild(cellInput(rec, col)));

    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "wf-del-btn";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      if (!confirm("이 행을 삭제할까요?")) return;
      data = data.filter((r) => r._id !== rec._id);
      tr.remove();
      save();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    applyRowType(tr, rec);
    tbody.appendChild(tr);
  }

  function renderTable(container) {
    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "wf-table ac-table";
    const thead = document.createElement("thead");
    const headTr = document.createElement("tr");
    COLUMNS.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      headTr.appendChild(th);
    });
    headTr.appendChild(document.createElement("th"));
    thead.appendChild(headTr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    data.forEach((rec) => appendRow(tbody, rec));
    container.appendChild(table);

    const btnRow = document.createElement("div");
    btnRow.style.marginTop = "12px";

    const addBtn = document.createElement("button");
    addBtn.className = "btn wf-add-btn";
    addBtn.textContent = "+ 행 추가";
    addBtn.style.marginRight = "8px";
    addBtn.addEventListener("click", () => {
      const rec = blankRecord();
      data.push(rec);
      appendRow(tbody, rec);
      save();
    });
    btnRow.appendChild(addBtn);
    container.appendChild(btnRow);
  }

  // ── 초기화 ──────────────────────────────────────────────
  function init(root) {
    loadFromStorage();

    const container = root.querySelector("#ac-table-container");
    renderTable(container);

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
      parts.push(`<p>칸 ${result.cellUpdates.length}건 갱신, 이월금 ${result.carryUpdates.filter((u) => u.value).length}건 반영됨.</p>`);
      if (result.notFoundCustomers.length) {
        parts.push(`<p style="color:#b91c1c;">HIMS에서 못 찾은 고객번호(${result.notFoundCustomers.length}건): ${result.notFoundCustomers.join(", ")}</p>`);
      }
      if (result.noContractMatch.length) {
        const items = result.noContractMatch.map((m) => `${m.company || m.customerNo}(${m.contractNo})`).join(", ");
        parts.push(`<p style="color:#b45309;">2026년 청구건을 못 찾은 계약(계약번호가 바뀌었을 수 있음, ${result.noContractMatch.length}건): ${items}</p>`);
      }
      if (result.skippedBlocks.length) {
        parts.push(`<p style="color:#6b7280;">일부 계약을 못 찾아 이월금 계산을 건너뛴 대리점 블록: ${result.skippedBlocks.length}개</p>`);
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
              const applied = applyCellUpdates(job.result.cellUpdates) + applyCellUpdates(job.result.carryUpdates);
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
