/*
 * 지로 자동기안 핵심 로직 (run.js CLI와 server.js 브릿지 서버가 공용으로 사용).
 * Step01~04 셀렉터는 2026-07-20 실제 DOM recon으로 확인한 값이다(diagnose17~29.js 참고).
 * 타입별 메뉴:
 *   지로번호      -> 일반지로요금 (Step01~04, #gironum + #num)
 *   고객번호      -> 전기요금/수신료 (Step01~03, #number_2)
 *   전자납부번호  -> KT통신요금 (Step01~03, #number)
 * 이미 기안 완료된 건은 Step03에서 "상세보기" 버튼이 사라지므로(중복 기안 방지를 위해) 그 경우
 * 자동으로 실패 처리하고 건너뛴다.
 */
const path = require('path');
const { chromium } = require('playwright');
const { parseGiroExcel } = require('./giro-parse-excel');

const HANDLED_TYPES = ['지로번호', '고객번호', '전자납부번호'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 로그인 과정에서 탭이 새로 열리거나 기존 탭이 닫히는 경우가 있어, 매번 살아있는 탭을 다시 찾는다
// (한 번 잡은 page 참조를 계속 쓰면 "Target page ... has been closed" 오류가 날 수 있음)
function allGiroPages(browser) {
  const pages = [];
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.isClosed() && page.url().includes('giro.or.kr')) pages.push(page);
    }
  }
  return pages;
}

async function findGiroPage(browser) {
  const pages = allGiroPages(browser);
  if (pages.length > 0) return pages[pages.length - 1]; // 가장 최근에 열린(새로 뜬) 탭을 우선한다
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.isClosed()) return page;
    }
  }
  throw new Error('연결된 Chrome에서 열린 탭을 찾지 못했습니다. Chrome 창이 열려있는지 확인해주세요.');
}

// 이 사이트는 프레임을 많이 써서(로그인 폼도 하위 프레임에 있었음), 최상위 page만 보면 놓치는 요소가
// 많다. 모든 프레임(top 포함)을 순서대로 뒤져서 처음 매치되는 걸 쓰는 헬퍼들.
function allFrames(page) {
  return [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
}

async function locateVisibleInFrames(page, buildLocator) {
  for (const frame of allFrames(page)) {
    try {
      const loc = buildLocator(frame);
      const count = await loc.count();
      for (let i = 0; i < count; i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) return el;
      }
    } catch (e) {
      // 프레임이 막 사라졌거나 접근 불가하면 다음 프레임으로 넘어간다
    }
  }
  return null;
}

// "로그아웃"이 <a>/<button> 텍스트일 수도, <input value="로그아웃"> 버튼일 수도 있어 둘 다 본다
// (input의 value는 text= 로케이터로 안 잡힘)
async function isLoggedIn(page) {
  // 실제로는 텍스트 버튼이 아니라 <a onclick="logOut()"><img alt="로그아웃"></a> 형태였음
  // (2026-07-16 recon 때는 text=로그아웃이 아예 안 잡혀서 10분 타임아웃 나던 버그)
  const el = await locateVisibleInFrames(page, (f) =>
    f.locator(
      'button:has-text("로그아웃"), a:has-text("로그아웃"), input[type="button"][value="로그아웃"], input[type="submit"][value="로그아웃"], input[value="로그아웃"], img[alt="로그아웃"], a[onclick*="logOut"]'
    )
  );
  return !!el;
}

async function waitForLogin(browser, log, maxSeconds = 600) {
  log('로그인을 기다리는 중입니다 — 열린 Chrome 창에서 biz.giro.or.kr에 직접 로그인해주세요...');
  for (let i = 0; i < maxSeconds; i++) {
    // 로그인 과정에서 새 탭이 열릴 수 있어, giro.or.kr로 열린 탭을 전부 확인해서
    // 실제로 로그인된 탭을 찾는다 (findGiroPage 하나만 보면 엉뚱한 탭을 볼 수 있음)
    const pages = allGiroPages(browser);
    for (const page of pages) {
      if (await isLoggedIn(page).catch(() => false)) return page;
    }
    await sleep(1000);
  }
  throw new Error('로그인 대기 시간이 초과되었습니다 (10분).');
}

// Step01~04는 전부 'view' iframe 안에서 일어난다 (2026-07-20 recon으로 실제 DOM 확인).
// "조회" 같은 흔한 단어는 페이지 전체에 부분일치가 여러 개 있어(예: 상단 메뉴 "내역조회") text=
// 매칭이 엉뚱한 링크(다른 메뉴)를 클릭하는 사고가 있었음 — 반드시 실제 확인된 클래스/전용 텍스트로만 찾는다.
function getViewFrame(page) {
  const vf = page.frames().find((f) => f.name() === 'view');
  if (!vf) throw new Error('view 프레임을 찾지 못했습니다.');
  return vf;
}

// 좌측 메뉴는 로그인 직후 홈 화면(index.do)에는 없고, 상단 마우스오버 드롭다운(평소엔 display:none)
// 안에만 메뉴 링크가 있어 클릭 자동화가 불안정했다(숨은 요소 클릭 실패가 반복되면 사이트가 세션을
// 끊는 것으로 보임). 그 링크들은 실제로는 onclick="GoUrl('코드')" 형태의 JS 호출이라, DOM 클릭 대신
// 이 함수를 직접 호출하면 화면 표시 여부와 무관하게 안전하게 이동된다.
async function goToMenu(page, gourl, waitSelector) {
  const viewFrame = getViewFrame(page);
  await viewFrame.evaluate((code) => {
    // eslint-disable-next-line no-undef
    GoUrl(code);
  }, gourl);
  await sleep(1500);
  await getViewFrame(page).locator(waitSelector).first().waitFor({ state: 'visible', timeout: 15000 });
}

const goToGeneralGiro = (page) => goToMenu(page, 'mPayGiro', '#gironum');
const goToKepco = (page) => goToMenu(page, 'mPayKepco', '#number_2');
const goToKtcomm = (page) => goToMenu(page, 'mPayKtcomm', '#number');

// Step03(간략조회 결과) -> "상세보기" -> Step04(상세조회 결과 및 기안) -> 기안하기/계속 기안하기
// 세 메뉴(일반지로요금/전기요금/KT통신요금) 모두 이 부분은 동일한 구조를 쓴다.
async function clickDetailThenDraft(page, label, isLast) {
  let vf = getViewFrame(page);
  const detailBtn = vf.locator('button:has-text("상세보기")');
  if ((await detailBtn.count()) === 0) {
    throw new Error(`"상세보기" 버튼이 없습니다 — ${label}은 이미 기안 완료된 것으로 보입니다. 중복 기안을 막기 위해 건너뜁니다.`);
  }
  await detailBtn.first().click();
  await sleep(2500);

  vf = getViewFrame(page);
  const draftLabel = isLast ? '기안하기' : '계속 기안하기';
  await vf.locator(`a:has-text("${draftLabel}")`).first().click();
  await sleep(1500);
}

// 일반지로요금: Step01(지로번호 입력) -> Step02(전자납부번호 입력) -> Step03 -> Step04
async function draftGiro(page, row, isLast) {
  let vf = getViewFrame(page);
  await vf.locator('#gironum').fill(row.value);
  await sleep(500);
  await vf.locator('#divGiroSearchButton').click();
  await sleep(2000);
  const searchResult = await vf
    .evaluate(() => document.getElementById('divGiroSearchResult')?.innerText || '')
    .catch(() => '');
  if (!searchResult.trim()) {
    throw new Error(`지로번호 ${row.value}에 대한 이용기관 확인 결과가 없습니다.`);
  }
  await vf.locator('a:has-text("다음")').first().click();
  await sleep(2000);

  vf = getViewFrame(page);
  await vf.locator('#num').fill(row.epay);
  await sleep(500);
  // '조회' 버튼은 상단 메뉴 "내역조회" 등과 텍스트가 겹쳐 그냥 text=로 찾으면 엉뚱한 링크를
  // 클릭한 적이 있어(2026-07-20), 실제 확인된 클래스(.btn_ty8_03)로만 찾는다.
  await vf.locator('a.btn_ty8_03:has-text("조회")').first().click();
  await sleep(2500);

  await clickDetailThenDraft(page, `지로번호 ${row.value}/전자납부번호 ${row.epay}`, isLast);
}

// 전기요금/수신료: Step01(고객번호 입력) -> Step02 -> Step03 (지로요금과 달리 3단계뿐)
async function draftKepco(page, row, isLast) {
  const vf = getViewFrame(page);
  await vf.locator('#number_2').fill(row.value);
  await sleep(500);
  await vf.locator('a.btn_ty8_03:has-text("조회")').first().click();
  await sleep(2500);
  await clickDetailThenDraft(page, `전기요금 고객번호 ${row.value}`, isLast);
}

// KT통신요금: Step01(전자납부번호/전화번호 라디오, 전자납부번호가 기본 선택) -> Step02 -> Step03
async function draftKtcomm(page, row, isLast) {
  const vf = getViewFrame(page);
  await vf.locator('#number').fill(row.value);
  await sleep(500);
  // 이 화면은 "전자납부번호"/"전화번호" 두 줄 다 조회 버튼(같은 클래스)이 있어 .first()로
  // 기본 선택된(전자납부번호) 줄의 버튼을 집는다.
  await vf.locator('a.btn_ty8_03:has-text("조회")').first().click();
  await sleep(2500);
  await clickDetailThenDraft(page, `KT 전자납부번호 ${row.value}`, isLast);
}

const TYPE_HANDLERS = {
  지로번호: { goTo: goToGeneralGiro, draft: draftGiro },
  고객번호: { goTo: goToKepco, draft: draftKepco },
  전자납부번호: { goTo: goToKtcomm, draft: draftKtcomm },
};

function describeRow(row) {
  if (row.type === '지로번호') return `${row.거래처} | 지로번호=${row.value} | 전자납부번호=${row.epay} | 금액=${row.금액.toLocaleString()}원`;
  return `${row.거래처} | ${row.type}=${row.value} | 금액=${row.금액.toLocaleString()}원`;
}

// 기안문서 관리 목록에는 지로번호가 아니라 "고객번호" 컬럼에 건별 식별번호(지로: 전자납부번호,
// 전기요금: 고객번호, KT: 전자납부번호)가 표시된다 — 이 값으로 실제 등록 여부를 확인한다.
function identifierOf(row) {
  return row.type === '지로번호' ? row.epay : row.value;
}

// "완료"라고 로그를 남겼어도 실제로 저장 안 됐을 수 있고(사이트 쪽 지연 등), 반대로 예외가 나서
// "실패"로 남았어도 사실 이전 실행에서 이미 등록된 것일 수 있다(예: "이미 기안 완료" 스킵).
// 그래서 try/catch 결과를 그대로 믿지 않고, 끝난 뒤 기안문서 관리 화면을 실제로 읽어서
// 각 건이 진짜로 등록됐는지 확인한다.
// 목록에 페이지네이션이 있어(한 페이지에 10건, goPage('N')으로 이동) 첫 페이지만 읽으면 뒤 페이지에
// 있는 건들을 "미등록"으로 잘못 판정하는 버그가 있었다(2026-07-21, 실제 16건 중 뒤 6건 오판 발견)
// — 그래서 페이지 링크를 전부 찾아서 끝까지 순회하며 모은다.
async function fetchRegisteredIdentifiers(page) {
  const vf0 = getViewFrame(page);
  await vf0.evaluate(() => {
    // eslint-disable-next-line no-undef
    GoUrl('mPayGianDoc');
  });
  await sleep(1500);

  const ids = new Set();
  const collectFromCurrentPage = async () => {
    const text = await getViewFrame(page).evaluate(() => document.body.innerText);
    for (const n of text.match(/\d{7,}/g) || []) ids.add(n);
  };
  await collectFromCurrentPage();

  const maxPage = await getViewFrame(page).evaluate(() => {
    let max = 1;
    document.querySelectorAll('a[onclick*="goPage"]').forEach((a) => {
      const m = a.getAttribute('onclick').match(/goPage\('?(\d+)'?\)/);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return max;
  });

  for (let p = 2; p <= maxPage; p++) {
    const vf = getViewFrame(page);
    await vf.evaluate((n) => {
      // eslint-disable-next-line no-undef
      goPage(String(n));
    }, p);
    await sleep(1200);
    await collectFromCurrentPage();
  }

  return ids;
}

/*
 * targetDate의 대상 항목을 파싱해서 타입별로 알맞은 메뉴를 자동 순회하며 기안까지 진행한다.
 * opts.log(msg)로 진행 상황을 알린다(기본은 console.log). opts.cdpUrl 기본은 launch-chrome-giro.bat/
 * giro-launch-chrome.js가 띄우는 포트(9222). opts.maxCount는 테스트용으로 앞에서 N건만 처리.
 * opts.onlyRows(엑셀 행번호 배열)을 주면 그 행들만 처리한다(미등록 건만 재등록할 때 사용).
 *
 * 스크립트가 예외 없이 "완료"라고 로그를 남겨도 사이트 쪽 지연 등으로 실제로는 저장이 안 됐을 수
 * 있고, 반대로 "이미 기안 완료"로 실패 처리된 건은 사실 이전 실행에서 이미 등록된 것일 수 있다.
 * 그래서 끝난 뒤 기안문서 관리 화면을 실제로 읽어서 각 건의 진짜 등록 여부를 확인한다(unregistered).
 *
 * 반환값: { targetDate, total, skipped, success, unregistered }
 * (unregistered: 실제로 기안문서 관리에서 확인 안 된 행들 — 이 값을 다시 onlyRows로 넘기면 재시도된다)
 */
async function runForDate(targetDate, opts = {}) {
  const { excelPath, maxCount = null, cdpUrl = 'http://localhost:9222', log = console.log, debugDir = __dirname, onlyRows = null } = opts;
  if (!excelPath) throw new Error('excelPath가 필요합니다.');

  const allRows = await parseGiroExcel(excelPath, targetDate);
  let rows = allRows.filter((r) => HANDLED_TYPES.includes(r.type));
  const skipped = allRows.filter((r) => !HANDLED_TYPES.includes(r.type));
  if (onlyRows && onlyRows.length > 0) {
    const onlySet = new Set(onlyRows);
    rows = rows.filter((r) => onlySet.has(r.row));
    log(`(재등록 모드) 지정된 ${rows.length}건만 처리합니다.`);
  }
  if (maxCount && maxCount > 0 && rows.length > maxCount) {
    log(`(테스트 모드) 대상 ${rows.length}건 중 처음 ${maxCount}건만 처리합니다.`);
    rows = rows.slice(0, maxCount);
  }

  log(`[${targetDate}] 자동 기안 대상 ${rows.length}건:`);
  for (const r of rows) log(`  - ${describeRow(r)}`);
  if (skipped.length > 0) {
    log(`(참고) ${skipped.length}건은 처리 대상 타입이 아니라 건너뜁니다:`);
    for (const r of skipped) log(`  - ${describeRow(r)}`);
  }
  if (rows.length === 0) {
    log('자동 기안할 항목이 없습니다. 종료합니다.');
    return { targetDate, total: 0, skipped: skipped.length, success: 0, unregistered: [] };
  }

  log(`Chrome(${cdpUrl})에 연결합니다...`);
  const browser = await chromium.connectOverCDP(cdpUrl).catch((e) => {
    throw new Error(`Chrome에 연결하지 못했습니다. Chrome이 원격 디버깅 포트로 열려있는지 확인해주세요. (${e.message})`);
  });

  let unregistered = [];
  let abortedEarly = null;
  try {
    let page = await waitForLogin(browser, log);
    await page.bringToFront().catch(() => {});
    log('로그인을 확인했습니다. 자동 기안을 시작합니다.');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      log(`[처리 중] ${describeRow(row)}`);
      let draftedOk = false;
      try {
        page = await findGiroPage(browser); // 탭이 바뀌었을 수 있으니 매 항목마다 살아있는 탭을 다시 찾는다
        const handler = TYPE_HANDLERS[row.type];
        await handler.goTo(page);
        await handler.draft(page, row, i === rows.length - 1);
        log('  -> 완료');
        draftedOk = true;
      } catch (e) {
        log(`  -> 실패: ${e.message}`);
        const shotPath = path.join(debugDir, `debug-fail-row${row.row}.png`);
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        log(`  실패 화면 저장: ${shotPath}`);
      }

      // 첫 건만 "안전핀"으로 확인한다: 정상이라면 상신 전까지는 "기안문서 관리"에 대기 상태로
      // 남아있어야 하는데, 만약 곧바로 사라져 있으면(계정 설정 등으로 자동 상신/승인까지
      // 넘어갔을 가능성) 나머지 건을 계속 처리하지 않고 여기서 멈춘다(2026-07-21 16건이
      // 의도치 않게 전부 상신된 사고 이후 추가한 안전장치).
      if (i === 0 && draftedOk) {
        log('안전 확인: 첫 건이 "기안문서 관리"에 대기 상태로 잘 남아있는지 확인합니다...');
        try {
          page = await findGiroPage(browser);
          const idsAfterFirst = await fetchRegisteredIdentifiers(page);
          if (!idsAfterFirst.has(identifierOf(row))) {
            abortedEarly = `첫 건(${describeRow(row)})이 "기안문서 관리"에서 확인되지 않습니다 — 예상과 달리 이미 상신/처리된 것으로 보입니다. 의도치 않은 접수를 막기 위해 나머지 항목 처리를 중단합니다. 이 건의 실제 상태를 "내역조회 > 진행상황 보기"에서 직접 확인해주세요.`;
            log(`*** 안전 중단: ${abortedEarly} ***`);
            break;
          }
          log('안전 확인 통과 — 나머지 항목을 계속 처리합니다.');
        } catch (e) {
          log(`안전 확인 중 오류(계속 진행합니다): ${e.message}`);
        }
      }
    }

    // 마지막 항목이 "기안하기"로 끝나면 자동으로 기안문서 관리로 이동하지만, 마지막 항목이 실패/건너뜀
    // 이었던 경우 등은 엉뚱한 화면에 남아있을 수 있다. 여기서 기안문서 관리로 이동해서 목록을 읽어
    // 각 건이 실제로 등록됐는지 직접 확인한다(로그에 찍힌 성공/실패보다 이 결과를 우선한다).
    log('"기안문서 관리" 화면에서 실제 등록 여부를 확인합니다...');
    page = await findGiroPage(browser);
    const registeredIds = await fetchRegisteredIdentifiers(page);
    unregistered = rows.filter((r) => !registeredIds.has(identifierOf(r)));

    log('=== 자동 기안 종료 ===');
    if (abortedEarly) log(`*** 안전 중단으로 일부만 처리했습니다: ${abortedEarly} ***`);
    log(`등록 확인됨: ${rows.length - unregistered.length}건 / 미등록: ${unregistered.length}건`);
    if (unregistered.length > 0) {
      log('미등록 항목(기안문서 관리에서 확인되지 않음):');
      for (const r of unregistered) log(`  - ${describeRow(r)}`);
    }
    log('이 스크립트는 "상신"을 누르지 않습니다 — 실제로 납부를 진행할 준비가 됐을 때만');
    log('"기안문서 관리" 화면에서 직접 상신하세요. 상신하면 실제로 접수되고, 취소는 승인자');
    log('계정에서만 가능합니다. 그냥 두면(상신 안 하면) 당일 안에 자동으로 사라지니, 테스트로');
    log('실행했거나 다시 확인이 필요하면 상신하지 말고 그대로 두는 게 안전합니다.');
  } finally {
    // connectOverCDP로 연결만 한 것이므로 close()해도 사용자의 실제 Chrome 창은 닫히지 않고
    // 이 스크립트 쪽 연결(CDP 세션)만 정리된다. 이걸 안 하면 다음 실행 때 이전 연결의 이벤트
    // 리스너가 남아있다가 서버 프로세스 전체가 죽는 문제가 있었다(다이얼로그 이벤트 경합, 2026-07-20).
    await browser.close().catch(() => {});
  }

  return {
    targetDate,
    total: rows.length,
    skipped: skipped.length,
    success: rows.length - unregistered.length,
    unregistered,
    abortedEarly,
  };
}

module.exports = { runForDate };
