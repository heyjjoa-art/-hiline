/*
 * etc/지로납부번호.xlsx 파싱
 * 컬럼: A=납부일자(10일자/20일자/25일자/말일자), B=거래처, C=금액, D=지로번호, E=전자납부번호
 * 규칙:
 *   - 거래처(B)가 비어있으면 바로 위 행의 거래처를 이어받는다 (병합 관행)
 *   - 지로번호(D)가 있으면 '지로번호' 방식으로 등록 — 이 경우 지로번호(기관 고유번호, "일반지로요금"
 *     화면 Step01에서 사용)와 전자납부번호(건별 고유번호, Step02에서 사용)가 둘 다 필요해서 같이 담는다
 *   - 지로번호가 없고 거래처가 '전기요금'이면 전자납부번호(E) 값을 '고객번호'로 등록 (다른 메뉴, 추후 별도 처리)
 *   - 지로번호가 없고 그 외(KT 등)면 전자납부번호(E) 값을 '전자납부번호'로 등록 (KT는 형식이 달라 추후 별도 처리)
 */
const ExcelJS = require('exceljs');

// 시트의 납부일자는 "10일자"/"20일자"/"25일자"/"말일자" 형태 -> 끝의 "자"만 제거해 "10일"/"말일"로 통일
function normalizeRowDate(v) {
  return String(v || '').trim().replace(/자$/, '');
}

// 사용자가 지정하는 날짜는 "10", "10일", "말일" 등 다양한 형태를 허용
function normalizeTargetDate(v) {
  const s = String(v || '').trim();
  if (/^\d+$/.test(s)) return s + '일';
  return s.replace(/자$/, '');
}

function cleanNumberStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\t\s]/g, '').trim();
}

async function parseGiroExcel(filePath, targetDate) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const target = normalizeTargetDate(targetDate);
  const rows = [];
  let lastVendor = '';

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const dateVal = row.getCell(1).value;
    if (!dateVal) continue;

    let vendor = row.getCell(2).value;
    vendor = vendor ? String(vendor).trim() : '';
    if (vendor) lastVendor = vendor;
    else vendor = lastVendor;

    const amount = Number(row.getCell(3).value) || 0;
    const giroNo = cleanNumberStr(row.getCell(4).value);
    const epayNo = cleanNumberStr(row.getCell(5).value);

    if (normalizeRowDate(dateVal) !== target) continue;

    let type, value, epay;
    if (giroNo) {
      type = '지로번호';
      value = giroNo;
      epay = epayNo; // Step02(납부정보 입력)에서 필요한 건별 전자납부번호
    } else if (vendor === '전기요금') {
      type = '고객번호';
      value = epayNo;
    } else {
      type = '전자납부번호';
      value = epayNo;
    }

    rows.push({ row: r, 납부일자: String(dateVal).trim(), 거래처: vendor, 금액: amount, type, value, epay });
  }

  return rows;
}

module.exports = { parseGiroExcel, normalizeRowDate, normalizeTargetDate };
