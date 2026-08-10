/*
 * HIMS 요금납부정보(청구기준일/상태/회사입금일)와 대리점 수수료 정산 표를 대조해서
 * 월별 칸(m1~m12)에 채울 값을 계산하는 순수 로직 (DOM/네트워크 의존 없음, 유닛테스트 가능).
 *
 * 규칙(2026-07-23 사용자 확정, 2026-08-04 총지급금액/범위 규칙 추가, 2026-08-04 고객번호 단독매칭/종료행 제외 추가):
 *  - HIMS 요금납부정보 매칭은 기본적으로 고객번호로 한다(계약번호가 갱신 등으로 표와 HIMS에서
 *    달라져도 매칭되도록 함). 단, 코아시스템즈처럼 같은 고객번호에 계약이 2개 이상인 경우를 위해
 *    같은 고객번호·같은 달에 청구건이 여러 개면: (1) 계약번호가 정확히 일치하는 건을 먼저 쓰고,
 *    (2) 없으면 아직 다른 표 행에 쓰이지 않은 건 중 하나를 쓴다(같은 건이 두 계약 행에 중복
 *    반영되지 않도록 사용된 건은 표시해둠) — 이렇게 해야 한 고객의 계약 여러 개가 각각 입금됐는지
 *    따로 확인된다.
 *  - 화면에서 "종료" 체크된 행(rec.closed)은 계약이 끝난 것으로 보고 동기화(HIMS 조회/칸 계산) 대상에서
 *    아예 제외한다 — 블록의 이월금/총지급금액 완전동기화 판정에도 영향을 주지 않는다(있는 것처럼도,
 *    없는 것처럼 실패로도 취급하지 않고 그냥 건너뜀).
 *  - 단, 한 블록의 일반행이 전부 "종료" 체크되면(대리점 전체 종료) 그 블록은 이월금/총지급금액도
 *    아예 손대지 않는다 — 전부 건너뛰면 누적치가 0이 되어 기존 값을 빈 문자열로 덮어썼을 뻔한
 *    문제가 있어(2026-08-04 발견), 이런 블록은 skippedBlocks와 별도로 closedBlocks로 보고하고
 *    carryUpdates/totalUpdates에서 완전히 제외한다.
 *  - 완납 && 회사입금일 월 == 청구기준일 월  → 해당 월 칸 = 月정산액(정해진 수당) 그대로
 *  - 완납 && 회사입금일 월 != 청구기준일 월(늦게 입금) → 해당 월 칸 = "{입금월}.{입금일}/月정산액",
 *    그리고 "이월금" 행의 [실제 입금된 달] 칸에 그 月정산액을 합산 (같은 블록 내 여러 건이면 합산)
 *  - 미납(아직 입금 안 됨) → 해당 월 칸 = "미납/月정산액" (화면에서 빨간색으로 표시)
 *  - "이월금" 행은 그 블록의 모든 대리점행이 전부 HIMS 조회에 성공했을 때만 통째로 재계산한다
 *    (일부 계약을 못 찾은 블록은 이월금을 건드리지 않고 건너뛴다 — 부분 합계로 잘못 덮어쓰지 않기 위함).
 *  - "총지급금액" 행(각 블록에서 "이월금" 바로 다음 행) = 그 달에 실제로 입금된 총액
 *    (그 달 정상 청구분 중 그 달에 완납된 금액 + 그 달 이월금 칸 값), 미납액은 합계에서 제외.
 *    이월금과 같은 조건(블록 전체 동기화 성공 시에만)으로 재계산한다.
 *  - 원본 파일에 이미 1~6월 데이터가 채워져 있어(수기 확정값), 동기화는 7~12월만 대상으로 한다 —
 *    1~6월 칸은 조회도, 재계산도 하지 않고 그대로 둔다(이월금/총지급금액 행도 마찬가지).
 */

// "blank" 판정에서 note(비고)와 dealer(대리점, 화면에서 블록 단위로 세로 병합돼 빈 행에도 값이
// 써질 수 있음)는 제외한다 — 값이 채워져도 여전히 "blank"(블록 경계)로 취급돼야 한다.
// _rowKind: "normal"은 화면(agency-commission.js)에서 "+ 계약"으로 방금 추가돼 아직 값이 없는
// 새 계약행에 붙는 표시(2026-08-05) — 이게 없으면 빈 계약행이 "blank"로 오분류돼 buildBlocks의
// 블록 경계가 그 자리에서 끊겨, 그 앞뒤 정상행이 이월금/총지급금액과 다른 블록으로 갈라지는
// 문제가 있었음.
function rowType(rec) {
  const c = (rec.customerNo || "").trim();
  if (c.includes("이월금")) return "carry";
  if (c.includes("총지급금액")) return "total";
  if (rec._rowKind === "normal") return "normal";
  const keys = ["customerNo", "contractNo", "company", "startDate", "contractDate", "expireDate", "endStatus", "revenue", "sales", "monthlyFee", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12"];
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

const SYNC_MONTHS = [7, 8, 9, 10, 11, 12]; // 1~6월은 원본 수기 확정값이라 동기화 대상에서 제외

// 블록 = "이월금" 행 바로 앞에 연속된 normal 행들의 묶음 (blank 행을 만나면 누적 초기화).
// "총지급금액" 행은 그 직전 "이월금" 행과 같은 블록에 속하는 것으로 보고(중간에 normal 행이
// 끼면 별개로 취급) totalIndex로 함께 기록한다.
function buildBlocks(records) {
  const blocks = [];
  let pending = [];
  let lastBlock = null;
  records.forEach((rec, i) => {
    const t = rowType(rec);
    if (t === "normal") {
      pending.push(i);
      lastBlock = null;
    } else if (t === "carry") {
      const block = { carryIndex: i, totalIndex: null, normalIndices: pending };
      blocks.push(block);
      lastBlock = block;
      pending = [];
    } else if (t === "total") {
      if (lastBlock && lastBlock.totalIndex == null) lastBlock.totalIndex = i;
      pending = [];
    } else {
      pending = [];
      lastBlock = null;
    }
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
  const usedFeeRows = new Set(); // 이미 다른 표 행에 배정된 HIMS 청구건(같은 고객번호 다계약 중복 배정 방지)
  const blocks = buildBlocks(records);
  const blockByNormalIndex = new Map();
  blocks.forEach((b) => b.normalIndices.forEach((idx) => blockByNormalIndex.set(idx, b)));

  // 블록별 이월금 누적: Map<carryIndex, {7:amount,...12:amount}>
  const carryAcc = new Map();
  // 블록별 "그 달에 정상 청구·정상 완납"된 금액 누적(총지급금액 계산용): Map<carryIndex, {7:amount,...}>
  const onTimeAcc = new Map();
  // 블록별 완전 동기화 여부: Map<carryIndex, boolean>
  const blockFullySynced = new Map();
  // 블록별 "종료" 체크된 일반행 개수: Map<carryIndex, number> — 블록 전체 종료 판정에 사용
  const blockClosedCount = new Map();
  blocks.forEach((b) => {
    carryAcc.set(b.carryIndex, {});
    onTimeAcc.set(b.carryIndex, {});
    blockFullySynced.set(b.carryIndex, b.normalIndices.length > 0);
    blockClosedCount.set(b.carryIndex, 0);
  });

  records.forEach((rec, i) => {
    if (rowType(rec) !== "normal") return;
    const block = blockByNormalIndex.get(i);
    if (rec.closed) {
      // 종료 표시된 행은 동기화 대상에서 제외. 블록 전체 종료 판정을 위해 개수만 셈.
      if (block) blockClosedCount.set(block.carryIndex, blockClosedCount.get(block.carryIndex) + 1);
      return;
    }
    const customerNo = (rec.customerNo || "").trim();
    const contractNo = (rec.contractNo || "").trim();
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

    for (const month of SYNC_MONTHS) {
      const billedThisMonth = (r) => {
        const bd = parseYmd(r.billMonth);
        return bd && bd.year === year && bd.month === month;
      };
      // 같은 고객번호·같은 달에 청구건이 여러 개(다계약 고객)일 수 있으므로, 계약번호가 정확히
      // 일치하는 건을 먼저 찾고, 없으면 아직 다른 행이 쓰지 않은 건 중 하나를 쓴다.
      const feeRow =
        feeRows.find((r) => !usedFeeRows.has(r) && (r.contractNo || "").trim() === contractNo && billedThisMonth(r)) ||
        feeRows.find((r) => !usedFeeRows.has(r) && billedThisMonth(r));
      if (!feeRow) continue; // 해당 월 청구 데이터가 HIMS에 없음(또는 이미 다른 계약 행에 배정됨) — 기존 값 유지
      usedFeeRows.add(feeRow);
      matchedAnyMonth = true;

      const field = "m" + month;
      if (feeRow.status === "완납") {
        const payDate = parseYmd(feeRow.companyPayDate);
        if (payDate && payDate.year === year && payDate.month === month) {
          cellUpdates.push({ rowId: rec._id, field, value: rec.monthlyFee || "", isUnpaid: false });
          if (block) {
            const tAcc = onTimeAcc.get(block.carryIndex);
            tAcc[month] = (tAcc[month] || 0) + monthlyFeeNum;
          }
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
  const totalUpdates = [];
  const skippedBlocks = [];
  const closedBlocks = [];
  const blocksWithoutTotalRow = [];
  blocks.forEach((b) => {
    if (b.normalIndices.length > 0 && blockClosedCount.get(b.carryIndex) === b.normalIndices.length) {
      // 블록의 일반행 전체가 "종료" 체크됨(대리점 전체 종료) — 이월금/총지급금액을 0으로 덮어쓰지
      // 않도록 아예 건드리지 않는다.
      closedBlocks.push(records[b.carryIndex]._id);
      return;
    }
    if (!blockFullySynced.get(b.carryIndex)) {
      skippedBlocks.push(records[b.carryIndex]._id);
      return;
    }
    const acc = carryAcc.get(b.carryIndex);
    const tAcc = onTimeAcc.get(b.carryIndex);
    // 1~6월은 동기화 대상이 아니므로(SYNC_MONTHS) 건드리지 않는다 — 7~12월만 값을 채우거나 비운다.
    for (const month of SYNC_MONTHS) {
      const carryAmount = acc[month] || 0;
      carryUpdates.push({
        rowId: records[b.carryIndex]._id,
        field: "m" + month,
        value: carryAmount > 0 ? formatAmount(carryAmount) : "",
      });
    }
    if (b.totalIndex == null) {
      blocksWithoutTotalRow.push(records[b.carryIndex]._id);
      return;
    }
    // 총지급금액[월] = 그 달 정상청구·정상완납분 + 그 달 이월금(다른 달 청구건이 이 달에 입금된 것).
    // 미납분은 애초에 두 누적치 어디에도 더해지지 않으므로 자동으로 합계에서 빠진다.
    for (const month of SYNC_MONTHS) {
      const totalAmount = (tAcc[month] || 0) + (acc[month] || 0);
      totalUpdates.push({
        rowId: records[b.totalIndex]._id,
        field: "m" + month,
        value: totalAmount > 0 ? formatAmount(totalAmount) : "",
      });
    }
  });

  return {
    cellUpdates, carryUpdates, totalUpdates,
    notFoundCustomers: [...notFoundCustomers], skippedBlocks, closedBlocks, noContractMatch, blocksWithoutTotalRow,
  };
}

module.exports = { computeSync, rowType, toHimsCustNo, parseYmd, parseAmount, formatAmount, buildBlocks, SYNC_MONTHS };
