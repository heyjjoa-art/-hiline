/*
 * 세금계산서 양식수정
 * 전양식(원본 발행건 xlsx) -> 후양식(대량등록 양식 정발행 xlsx) 변환
 * 처리는 전부 브라우저 안에서 이뤄지며(ExcelJS), 서버로 파일이 전송되지 않는다.
 * SheetJS 무료판은 셀 스타일(배경색/테두리) 저장을 지원하지 않아 ExcelJS로 전환함.
 */
(function () {
  const DATA_START_ROW = 4; // 실제 4번째 줄부터 데이터 (1-indexed)
  const DATA_FONT = { name: "맑은 고딕", size: 10 };

  const REMARK_TEXT = "입금계좌 - 국민은행 519701-01-220702";

  // file:// 로 index.html을 직접 열면 fetch()로 로컬 파일을 읽을 수 없어(브라우저 보안 제한),
  // 템플릿 xlsx를 base64로 인코딩해 tools/templates/template-data.js에 내장해두고 여기서 디코딩한다.
  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // 전양식 컬럼 (1-indexed)
  const SRC = {
    year: 2, month: 3, day: 4,
    regNo: 5, subBizNo: 6,
    name: 7, ceo: 8, addr: 9, bizType: 10, item: 11,
    manager1: 12, tel1: 13, mobile1: 14, email1: 15,
    manager2: 16, tel2: 17, mobile2: 18, email2: 19,
    supplyAmt: 20, taxAmt: 21,
    remark: 22,
    cash: 23, check: 24, note: 25, credit: 26,
    billType: 27,
    item1Name: 30, item1Spec: 31, item1Qty: 32, item1Price: 33, item1Supply: 34, item1Tax: 35,
    item2Name: 39, item2Spec: 40, item2Qty: 41, item2Price: 42, item2Supply: 43, item2Tax: 44,
    item3Name: 48, item3Spec: 49, item3Qty: 50, item3Price: 51, item3Supply: 52, item3Tax: 53,
    item4Name: 57, item4Spec: 58, item4Qty: 59, item4Price: 60, item4Supply: 61, item4Tax: 62,
  };

  // 후양식 컬럼 (1-indexed)
  const DST = {
    taxType: 1, bizType: 2, billType: 3, docDate: 4,
    supplyAmt: 5, taxAmt: 6, totalAmt: 7,
    regNo: 8, subBizNo: 9,
    name: 10, ceo: 11, addr: 12, biz: 13, item: 14,
    manager1: 15, email1: 16, tel1: 17, mobile1: 18,
    manager2: 19, email2: 20, tel2: 21, mobile2: 22,
    item1Date: 23, item1Name: 24, item1Spec: 25, item1Qty: 26, item1Price: 27, item1Supply: 28, item1Tax: 29,
    item2Date: 31, item2Name: 32, item2Spec: 33, item2Qty: 34, item2Price: 35, item2Supply: 36, item2Tax: 37,
    item3Date: 39, item3Name: 40, item3Spec: 41, item3Qty: 42, item3Price: 43, item3Supply: 44, item3Tax: 45,
    item4Date: 47, item4Name: 48, item4Spec: 49, item4Qty: 50, item4Price: 51, item4Supply: 52, item4Tax: 53,
    remark: 59,
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function digitsOnly(v) {
    if (v === undefined || v === null) return "";
    return String(v).replace(/[^0-9]/g, "");
  }

  function cellVal(ws, r, c) {
    const v = ws.getCell(r, c).value;
    return v === null || v === undefined ? "" : v;
  }

  function setCell(ws, r, c, value) {
    if (value === "" || value === undefined || value === null) return;
    const cell = ws.getCell(r, c);
    cell.value = value;
    cell.font = DATA_FONT;
  }

  function readSourceRows(ws, lastRow) {
    const rows = [];
    for (let r = DATA_START_ROW; r <= lastRow; r++) {
      if (cellVal(ws, r, SRC.regNo) !== "") rows.push(r);
    }
    return rows;
  }

  function convertRow(srcWs, srcRow, dstWs, dstRow) {
    const g = (col) => cellVal(srcWs, srcRow, col);

    // 1. 등록번호 (하이픈 제거, 숫자만)
    setCell(dstWs, dstRow, DST.regNo, digitsOnly(g(SRC.regNo)));
    // 종사업장번호는 규칙에 없어 공란으로 둔다

    // 2. 상호~담당자1 (이메일/연락처/휴대폰 순서 맞춰서)
    setCell(dstWs, dstRow, DST.name, g(SRC.name));
    setCell(dstWs, dstRow, DST.ceo, g(SRC.ceo));
    setCell(dstWs, dstRow, DST.addr, g(SRC.addr));
    setCell(dstWs, dstRow, DST.biz, g(SRC.bizType));
    setCell(dstWs, dstRow, DST.item, g(SRC.item));
    setCell(dstWs, dstRow, DST.manager1, g(SRC.manager1));
    setCell(dstWs, dstRow, DST.email1, g(SRC.email1));
    setCell(dstWs, dstRow, DST.tel1, g(SRC.tel1));
    setCell(dstWs, dstRow, DST.mobile1, g(SRC.mobile1));

    // 담당자2 정보는 규칙에 없어 공란으로 둔다

    // 3. 공급가액/세액/합계액(수식 없이 숫자)
    const supplyAmt = Number(g(SRC.supplyAmt)) || 0;
    const taxAmt = Number(g(SRC.taxAmt)) || 0;
    setCell(dstWs, dstRow, DST.supplyAmt, supplyAmt);
    setCell(dstWs, dstRow, DST.taxAmt, taxAmt);
    setCell(dstWs, dstRow, DST.totalAmt, supplyAmt + taxAmt);

    // 4. 작성일자 yyyymmdd
    const year = g(SRC.year), month = g(SRC.month), day = g(SRC.day);
    const docDate = year ? `${year}${pad2(month)}${pad2(day)}` : "";
    setCell(dstWs, dstRow, DST.docDate, docDate);

    // 5. 과세/사업자 고정값
    setCell(dstWs, dstRow, DST.taxType, "과세");
    setCell(dstWs, dstRow, DST.bizType, "사업자");

    // 6. 청구영수 C/R -> 청구/영수
    const bt = g(SRC.billType);
    setCell(dstWs, dstRow, DST.billType, bt === "C" ? "청구" : bt === "R" ? "영수" : "");

    // 전체 비고: 입금계좌 안내 문구를 항상 채워 넣는다. 현금/수표/어음/외상미수금은 규칙에 없어 공란으로 둔다
    setCell(dstWs, dstRow, DST.remark, REMARK_TEXT);

    // 7~9. 품목1~4 (내용 있으면 품목일자 = 작성일자). 비고1~4는 규칙에 없어 공란으로 둔다
    const items = [
      { name: SRC.item1Name, spec: SRC.item1Spec, qty: SRC.item1Qty, price: SRC.item1Price, supply: SRC.item1Supply, tax: SRC.item1Tax,
        dName: DST.item1Name, dSpec: DST.item1Spec, dQty: DST.item1Qty, dPrice: DST.item1Price, dSupply: DST.item1Supply, dTax: DST.item1Tax, dDate: DST.item1Date },
      { name: SRC.item2Name, spec: SRC.item2Spec, qty: SRC.item2Qty, price: SRC.item2Price, supply: SRC.item2Supply, tax: SRC.item2Tax,
        dName: DST.item2Name, dSpec: DST.item2Spec, dQty: DST.item2Qty, dPrice: DST.item2Price, dSupply: DST.item2Supply, dTax: DST.item2Tax, dDate: DST.item2Date },
      { name: SRC.item3Name, spec: SRC.item3Spec, qty: SRC.item3Qty, price: SRC.item3Price, supply: SRC.item3Supply, tax: SRC.item3Tax,
        dName: DST.item3Name, dSpec: DST.item3Spec, dQty: DST.item3Qty, dPrice: DST.item3Price, dSupply: DST.item3Supply, dTax: DST.item3Tax, dDate: DST.item3Date },
      { name: SRC.item4Name, spec: SRC.item4Spec, qty: SRC.item4Qty, price: SRC.item4Price, supply: SRC.item4Supply, tax: SRC.item4Tax,
        dName: DST.item4Name, dSpec: DST.item4Spec, dQty: DST.item4Qty, dPrice: DST.item4Price, dSupply: DST.item4Supply, dTax: DST.item4Tax, dDate: DST.item4Date },
    ];

    for (const it of items) {
      const nameVal = g(it.name);
      setCell(dstWs, dstRow, it.dName, nameVal);
      setCell(dstWs, dstRow, it.dSpec, g(it.spec));
      setCell(dstWs, dstRow, it.dQty, Number(g(it.qty)) || undefined);
      setCell(dstWs, dstRow, it.dPrice, Number(g(it.price)) || undefined);
      setCell(dstWs, dstRow, it.dSupply, Number(g(it.supply)) || undefined);
      setCell(dstWs, dstRow, it.dTax, Number(g(it.tax)) || undefined);
      if (nameVal) setCell(dstWs, dstRow, it.dDate, docDate);
    }
  }

  async function convert(file) {
    if (!window.HILINE_TAX_INVOICE_TEMPLATE_B64) {
      throw new Error("템플릿 데이터(tools/templates/template-data.js)를 불러오지 못했습니다.");
    }
    const srcBuf = await file.arrayBuffer();
    const tplBuf = base64ToArrayBuffer(window.HILINE_TAX_INVOICE_TEMPLATE_B64);

    const srcWb = new ExcelJS.Workbook();
    await srcWb.xlsx.load(srcBuf);
    const srcWs = srcWb.worksheets[0];
    const rows = readSourceRows(srcWs, srcWs.rowCount);
    if (rows.length === 0) throw new Error("변환할 데이터 행을 찾지 못했습니다 (E열 등록번호 확인).");

    const dstWb = new ExcelJS.Workbook();
    await dstWb.xlsx.load(tplBuf);
    const dstWs = dstWb.worksheets[0];

    let dstRow = DATA_START_ROW;
    for (const srcRow of rows) {
      convertRow(srcWs, srcRow, dstWs, dstRow);
      dstRow++;
    }

    return { workbook: dstWb, count: rows.length };
  }

  async function downloadWorkbook(wb, filename) {
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function initTaxInvoiceTool(root) {
    const dropZone = root.querySelector("#ti-dropzone");
    const fileInput = root.querySelector("#ti-file-input");
    const status = root.querySelector("#ti-status");
    let pendingFile = null;

    function setStatus(msg, isError) {
      status.textContent = msg;
      status.style.color = isError ? "#b91c1c" : "#374151";
    }

    function handleFile(file) {
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name)) {
        setStatus("xlsx 파일만 업로드할 수 있습니다.", true);
        return;
      }
      pendingFile = file;
      setStatus(`선택된 파일: ${file.name} — 변환 버튼을 눌러주세요.`);
    }

    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

    ["dragenter", "dragover"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      })
    );
    dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

    root.querySelector("#ti-convert-btn").addEventListener("click", async () => {
      if (!pendingFile) {
        setStatus("먼저 전양식 파일을 선택하세요.", true);
        return;
      }
      setStatus("변환 중...");
      try {
        const { workbook, count } = await convert(pendingFile);
        const today = new Date();
        const stamp = `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(today.getDate())}`;
        await downloadWorkbook(workbook, `대량등록_양식_정발행_${stamp}.xlsx`);
        setStatus(`변환 완료 — ${count}건 처리되어 다운로드되었습니다.`);
      } catch (err) {
        console.error(err);
        setStatus("변환 실패: " + err.message, true);
      }
    });
  }

  window.HilineTaxInvoiceTool = { init: initTaxInvoiceTool };
})();
