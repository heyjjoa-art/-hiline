/*
 * hims.hilineisp.net에서 고객번호별 "요금납부정보"(청구기준일/상태/회사입금일)를 읽어온다.
 * 로그인은 사용자가 launch-chrome-hims.bat으로 띄운 전용 Chrome 창에서 직접 하고,
 * 이 모듈은 chromium.connectOverCDP로 그 브라우저에 연결해서 화면을 읽기만 한다
 * (로그인 폼에 아무 값도 입력하지 않음 — 지로 사이트 자동화 때 겪은 계정 잠김/봇 탐지 위험 회피).
 */
const BASE_URL = "http://hims.hilineisp.net";

async function extractFeeTablePage(page) {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll("table"));
    const target = tables.find(
      (t) => t.rows[0] && Array.from(t.rows[0].cells).some((td) => td.innerText.trim() === "계약번호")
    );
    if (!target) return [];
    const rows = Array.from(target.rows)
      .slice(1)
      .map((r) => Array.from(r.cells).map((c) => c.innerText.trim()));
    return rows
      .filter((r) => r.length >= 15 && r[1])
      .map((r) => ({
        no: r[0], contractNo: r[1], billType: r[2], billMonth: r[3], useStart: r[4],
        billAmount: r[5], vat: r[6], finalAmount: r[7], lateFee: r[8], status: r[9],
        custPayDate: r[10], companyPayDate: r[11], paidAmount: r[12], prepaid: r[13], payMethod: r[14],
      }));
  });
}

async function gotoPage(page, pageNum) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: 20000 }),
    page.evaluate((n) => {
      // eslint-disable-next-line no-undef
      goList(n);
    }, pageNum),
  ]);
}

/**
 * HIMS의 "요금납부정보" 표는 계약번호별로 청구서 번호가 따로 매겨져 있어(전역 시간순이 아님),
 * 페이지마다 어떤 계약의 어느 시기 데이터가 나올지 예측할 수 없다. 그래서 "이 페이지는
 * 전부 대상 연도보다 오래됐으니 그만 찾자"는 식의 조기 종료는 하지 않고, maxPages까지는
 * 항상 끝까지 훑는다(오래돼서 이미 해지된 계약은 어차피 대상 연도 데이터가 없으므로
 * 못 찾아도 정상 — 그 경우 해당 계약번호는 "찾지 못함"으로 보고됨).
 *
 * @param {import('playwright').Page} page CDP로 연결한 로그인된 HIMS 탭
 * @param {string} himsCustNo "HI205663" 형식
 * @param {{maxPages?: number}} opts
 * @returns {Promise<Array>} 요금납부정보 행 배열 (최신순)
 */
async function fetchFeeRows(page, himsCustNo, opts = {}) {
  const maxPages = opts.maxPages || 6;

  await page.goto(`${BASE_URL}/Customer/CustomFeeList.aspx?cno=${encodeURIComponent(himsCustNo)}`, {
    waitUntil: "load",
    timeout: 20000,
  });

  if (/Login\.aspx/i.test(page.url())) {
    throw new Error("HIMS 로그인이 필요합니다. launch-chrome-hims.bat으로 연 창에서 직접 로그인해주세요.");
  }

  let allRows = [];
  for (let p = 1; p <= maxPages; p++) {
    if (p > 1) await gotoPage(page, p);
    const rows = await extractFeeTablePage(page);
    if (!rows.length) break;
    allRows = allRows.concat(rows);
  }
  return allRows;
}

module.exports = { fetchFeeRows, extractFeeTablePage };
