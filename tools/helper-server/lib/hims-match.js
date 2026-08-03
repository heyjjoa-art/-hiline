/*
 * HIMS 요금납부정보(청구기준일/상태/회사입금일)와 대리점 수수료 정산 표를 대조해서
 * 월별 칸(m1~m12)에 채울 값을 계산하는 순수 로직 (DOM/네트워크 의존 없음, 유닛테스트 가능).
 *
 * 규칙(2026-07-23 사용자 확정):
 *  - 완납 && 회사입금일 월 == 청구기준일 월  → 해당 월 칸 = 月정산액(정해진 수당) 그대로
 *  - 완납 && 회사입금일 월 != 청구기준일 월(늦게 입금) → 해당 월 칸 = "{입금월}.{입금일}/月정산액",
 *    그리고 "이월금" 행의 [실제 입금된 달] 칸에 그 月정산액을 합산 (같은 블록 내 여러 건이면 합산)
 *  - 미납(아직 입금 안 됨) → 해당 월 칸 = "미납/月정산액" (화면에서 빨간색으로 표시)
 *  - "이월금" 행은 그 블록의 모든 대리점행이 전부 HIMS 조회에 성공했을 때만 통째로 재계산한다
 *    (일부 계약을 못 찾은 블록은 이월금을 건드리지 않고 건너뛴다 — 부분 합계로 잘못 덮어쓰지 않기 위함).
 */

function rowType(rec) {
  const c = (rec.customerNo || "").trim();
  if (c.includes("이월금")) return "carry";
  if (c.includes("총지급금액")) return "total";
  const keys = ["dealer", "note", "customerNo", "contractNo", "company", "startDate", "contractDate", "expireDate", "endStatus", "revenue", "sales", "monthlyFee", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"];
  const allBlank = keys.every((k) => !(rec[k] || "").toString().trim());
  return allBlank ? "blank" : "normal";
}

function toHimsCustNo(customerNo) {
  const c = (customerNo || "").trim();
  if (!c) return null;
  return c.toUpperCase().startsWith("HI") ? c : "HI" + c;
}

function parseYmd(s) {
  const m = String(s || "").trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

function parseAmount(s) {
  const n = parseInt(String(s || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function formatAmount(n) {
  return n.toLocaleString("ko-KR");
}

// 블록 = "이월금" 행 바로 앞에 연속된 normal 행들의 묶음 (blank/total 행을 만나면 누적 초기화)
function buildBlocks(records) {
  const blocks = [];
  let pending = [];
  records.forEach((rec, i) => {
    const t = rowType(rec);
    if (t === "normal") pending.push(i);
    else if (t === "carry") { blocks.push({ carryIndex: i, normalIndices: pending }); pending = []; }
    else pending = [];
  });
  return blocks;
}

/**
 * @param {Array} records 대리점 수수료 정산 표의 전체 행 배열 (agency-commission.js의 data와 동일 구조)
 * @param {number} year 대상 연도 (예: 2026)
 * @param {Map<string, Array>} feeRowsByCustNo HIMS 고객번호("HI..") → 요금납부정보 행 배열
 *        (각 행: {contractNo, billMonth, status, companyPayDate})
 * @returns {{cellUpdates: Array, carryUpdates: Array, notFoundCustomers: string[], skippedBlocks: string[]}}
 */
function computeSync(records, year, feeRowsByCustNo) {
  const cellUpdates = [];
  const notFoundCustomers = new Set();
  const noContractMatch = []; // 고객은 조회됐지만 이 계약번호로 대상 연도 청구건을 하나도 못 찾은 행
  const blocks = buildBlocks(records);
  const blockByNormalIndex = new Map();
  blocks.forEach((b) => b.normalIndices.forEach((idx) => blockByNormalIndex.set(idx, b)));

  // 블록별 이월금 누적: Map<carryIndex, {1:amount,...12:amount}>
  const carryAcc = new Map();
  // 블록별 완전 동기화 여부: Map<carryIndex, boolean>
  const blockFullySynced = new Map();
  blocks.forEach((b) => { carryAcc.set(b.carryIndex, {}); blockFullySynced.set(b.carryIndex, b.normalIndices.length > 0); });

  records.forEach((rec, i) => {
    if (rowType(rec) !== "normal") return;
    const customerNo = (rec.customerNo || "").trim();
    const contractNo = (rec.contractNo || "").trim();
    const block = blockByNormalIndex.get(i);
    if (!customerNo || !contractNo) return; // 상품권 등 HIMS 대상 아닌 특이 행 — 건너뜀 (블록 완전동기화 판정에서도 제외 안 함, 그대로 무시)

    const himsCustNo = toHimsCustNo(customerNo);
    const feeRows = feeRowsByCustNo.get(himsCustNo);
    if (!feeRows) {
      notFoundCustomers.add(himsCustNo);
      if (block) blockFullySynced.set(block.carryIndex, false);
      return;
    }

    const monthlyFeeNum = parseAmount(rec.monthlyFee);
    let matchedAnyMonth = false;

    for (let month = 1; month <= 12; month++) {
      const feeRow = feeRows.find((r) => {
        if ((r.contractNo || "").trim() !== contractNo) return false;
        const bd = parseYmd(r.billMonth);
        return bd && bd.year === year && bd.month === month;
      });
      if (!feeRow) continue; // 해당 월 청구 데이터가 HIMS에 없음 — 기존 값 유지(건드리지 않음)
      matchedAnyMonth = true;

      const field = "m" + month;
      if (feeRow.status === "완납") {
        const payDate = parseYmd(feeRow.companyPayDate);
        if (payDate && payDate.year === year && payDate.month === month) {
          cellUpdates.push({ rowId: rec._id, field, value: rec.monthlyFee || "", isUnpaid: false });
        } else if (payDate) {
          cellUpdates.push({
            rowId: rec._id, field,
            value: `${payDate.month}.${payDate.day}/${rec.monthlyFee || ""}`,
            isUnpaid: false,
          });
          if (payDate.year === year && block) {
            const acc = carryAcc.get(block.carryIndex);
            acc[payDate.month] = (acc[payDate.month] || 0) + monthlyFeeNum;
          }
        }
      } else {
        cellUpdates.push({ rowId: rec._id, field, value: `미납/${rec.monthlyFee || ""}`, isUnpaid: true });
      }
    }

    if (!matchedAnyMonth) {
      // 고객은 HIMS에 있지만 이 계약번호로는 대상 연도 청구건이 하나도 없음 — 계약이 이미
      // 해지됐거나(정상) 갱신되며 계약번호가 바뀌었는데 표에는 옛 번호가 남아있는 경우(확인 필요)
      noContractMatch.push({ rowId: rec._id, customerNo, contractNo, company: rec.company || "" });
    }
  });

  const carryUpdates = [];
  const skippedBlocks = [];
  blocks.forEach((b) => {
    if (!blockFullySynced.get(b.carryIndex)) {
      skippedBlocks.push(records[b.carryIndex]._id);
      return;
    }
    const acc = carryAcc.get(b.carryIndex);
    for (let month = 1; month <= 12; month++) {
      const amount = acc[month] || 0;
      carryUpdates.push({
        rowId: records[b.carryIndex]._id,
        field: "m" + month,
        value: amount > 0 ? formatAmount(amount) : "",
      });
    }
  });

  return { cellUpdates, carryUpdates, notFoundCustomers: [...notFoundCustomers], skippedBlocks, noContractMatch };
}

module.exports = { computeSync, rowType, toHimsCustNo, parseYmd, parseAmount, formatAmount, buildBlocks };
