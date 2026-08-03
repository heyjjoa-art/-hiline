/*
 * 하이라인닷넷 통합 도우미 서버.
 * 예전엔 지로 자동기안(8787)/메일 수신함(8788)/HIMS 동기화(8790) 세 서버가 따로 떠 있었는데,
 * 포트 하나(8787)에 경로 기반 라우팅(/giro/*, /mail/*, /hims/*, /hiworks/*)으로 합쳤다.
 * 시작프로그램 등록도 install-startup.js 하나로 통합.
 *
 * index.html의 메뉴들이 각각 이 서버를 호출한다:
 *   - "지로청구서 자동기안": GET /giro/status, POST /giro/run
 *   - "메일": GET /mail/messages
 *   - "대리점 수수료 정산"의 HIMS 동기화: GET /hims/status, POST /hims/sync
 *   - "연차/복지제도"의 하이웍스 일정 동기화: GET /hiworks/status, POST /hiworks/sync
 *
 * 새 외부 사이트 연동을 추가할 때의 패턴: lib/<서비스명>-launch-chrome.js로 전용 Chrome
 * 프로필+CDP 포트를 만들고(로그인은 항상 사용자가 그 창에서 직접 함), lib/<서비스명>-scrape.js로
 * chromium.connectOverCDP해서 화면을 읽고, 여기 server.js에 상태/실행 라우트 두 개를 추가하면
 * 별도 서버·포트 없이 이 통합 서버에 합류한다.
 *
 * 실행: node server.js (포그라운드, 콘솔에 로그 표시)
 *   - PC 시작 시 자동 실행되도록 하려면 install-startup.js로 한 번 등록해두면 된다
 *     (Windows 시작프로그램 폴더에 숨김 실행 스크립트를 넣어둠).
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const { runForDate } = require('./lib/giro-draft-runner');
const { launchChrome: launchGiroChrome, isChromeRunning: isGiroChromeRunning } = require('./lib/giro-launch-chrome');
const { fetchInbox } = require('./lib/mail');
const { fetchFeeRows } = require('./lib/hims-scrape');
const { computeSync, rowType, toHimsCustNo } = require('./lib/hims-match');
const { launchChrome: launchHimsChrome, isChromeRunning: isHimsChromeRunning, CDP_PORT: HIMS_CDP_PORT } = require('./lib/hims-launch-chrome');
const { launchChrome: launchHiworksChrome, isChromeRunning: isHiworksChromeRunning, CDP_PORT: HIWORKS_CDP_PORT } = require('./lib/hiworks-launch-chrome');
const { fetchYearLeaveEvents } = require('./lib/hiworks-scrape');
const { computeHiworksSync } = require('./lib/hiworks-match');

const PORT = 8787;

let giroJob = { state: 'idle', log: [] };
let himsJob = { state: 'idle', log: [] };
let hiworksJob = { state: 'idle', log: [] };

// 세 기능(특히 지로/HIMS의 Playwright/CDP 쪽)에서 가끔 예기치 못한 비동기 오류(다이얼로그 이벤트
// 경합 등)가 나면 그걸로 프로세스 전체가 죽어서 세 메뉴 전부 "연결할 수 없음"이 되는 문제가 있었다
// (2026-07-20, 지로 서버 단독 운영 시 확인됨). 통합 후에는 한쪽 문제가 서버 전체를 죽이면
// 영향 범위가 더 커지므로, 최상위에서 잡아서 서버는 계속 띄워두고 활성 작업만 오류 처리한다.
process.on('uncaughtException', (err) => {
  console.error('처리되지 않은 오류(서버는 계속 실행됩니다):', err);
  markActiveJobsError(err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('처리되지 않은 Promise 거부(서버는 계속 실행됩니다):', err);
  markActiveJobsError(err instanceof Error ? err.message : String(err));
});
function markActiveJobsError(message) {
  [giroJob, himsJob, hiworksJob].forEach((job) => {
    if (job.state !== 'idle' && job.state !== 'done' && job.state !== 'error') {
      job.state = 'error';
      job.error = message;
      job.finishedAt = Date.now();
    }
  });
}

function isBusy(job) {
  return job.state !== 'idle' && job.state !== 'done' && job.state !== 'error';
}

// ───────────────────────── 지로 자동기안 ─────────────────────────

function pushGiroLog(msg) {
  const line = `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`;
  console.log('[giro]', line);
  giroJob.log.push(line);
  if (giroJob.log.length > 500) giroJob.log.shift();
}

async function startGiroJob(targetDate, onlyRows) {
  giroJob = { state: 'launching-chrome', date: targetDate, onlyRows: onlyRows || null, log: [], startedAt: Date.now() };
  pushGiroLog(
    onlyRows && onlyRows.length > 0
      ? `날짜 [${targetDate}] 미등록 ${onlyRows.length}건 재등록을 시작합니다.`
      : `날짜 [${targetDate}] 자동 기안을 시작합니다.`
  );
  try {
    const configPath = path.join(__dirname, 'giro-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('giro-config.json이 없습니다. giro-config.example.json을 복사해서 만들어주세요.');
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const excelPath = path.resolve(__dirname, config.excelPath);

    if (await isGiroChromeRunning()) {
      pushGiroLog('이미 실행 중인 Chrome(디버깅 포트 9222)에 연결합니다.');
    } else {
      pushGiroLog('전용 Chrome을 새로 실행합니다...');
      launchGiroChrome();
    }
    giroJob.state = 'waiting-login';

    const summary = await runForDate(targetDate, {
      excelPath,
      debugDir: __dirname,
      onlyRows,
      log: (msg) => {
        pushGiroLog(msg);
        if (giroJob.state === 'waiting-login' && msg.includes('로그인을 확인했습니다')) {
          giroJob.state = 'running';
        }
      },
    });

    giroJob.state = 'done';
    giroJob.summary = summary;
    giroJob.finishedAt = Date.now();
  } catch (e) {
    giroJob.state = 'error';
    giroJob.error = e.message;
    giroJob.finishedAt = Date.now();
    pushGiroLog(`오류: ${e.message}`);
  }
}

// ───────────────────────── HIMS 동기화 ─────────────────────────

function pushHimsLog(msg) {
  const line = `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`;
  console.log('[hims]', line);
  himsJob.log.push(line);
  if (himsJob.log.length > 500) himsJob.log.shift();
}

async function runHimsSync(records, year) {
  himsJob = { state: 'connecting', log: [], startedAt: Date.now() };
  pushHimsLog(`대리점 수수료 정산(${year}년) HIMS 동기화를 시작합니다.`);
  try {
    if (!(await isHimsChromeRunning())) {
      pushHimsLog('전용 Chrome이 꺼져있어 새로 실행합니다. 창이 뜨면 HIMS에 로그인해주세요...');
      launchHimsChrome();
      throw new Error('전용 Chrome을 새로 띄웠습니다. 로그인 후 다시 동기화를 눌러주세요.');
    }

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${HIMS_CDP_PORT}`);
    const contexts = browser.contexts();
    const pages = contexts[0] ? contexts[0].pages() : [];
    const page = pages[pages.length - 1];
    if (!page) throw new Error('전용 Chrome 창을 찾을 수 없습니다. launch-chrome-hims.bat을 다시 실행해주세요.');

    himsJob.state = 'fetching';
    const custNos = [...new Set(
      records.filter((r) => rowType(r) === 'normal' && r.customerNo && r.contractNo).map((r) => toHimsCustNo(r.customerNo))
    )];
    pushHimsLog(`대상 고객 ${custNos.length}명의 요금납부정보를 조회합니다...`);

    const feeRowsByCustNo = new Map();
    for (let i = 0; i < custNos.length; i++) {
      const custNo = custNos[i];
      try {
        const rows = await fetchFeeRows(page, custNo);
        feeRowsByCustNo.set(custNo, rows);
        pushHimsLog(`(${i + 1}/${custNos.length}) ${custNo} — ${rows.length}건 조회됨`);
      } catch (e) {
        if (/로그인이 필요합니다/.test(e.message)) throw e; // 로그인 풀림 — 전체 중단
        pushHimsLog(`(${i + 1}/${custNos.length}) ${custNo} — 조회 실패: ${e.message}`);
      }
    }

    himsJob.state = 'computing';
    const result = computeSync(records, year, feeRowsByCustNo);
    pushHimsLog(
      `계산 완료 — 칸 ${result.cellUpdates.length}건 갱신 대상, 이월금 ${
        result.carryUpdates.filter((u) => u.value).length
      }건, 조회 실패 고객 ${result.notFoundCustomers.length}명, 이월금 계산 생략된 블록 ${
        result.skippedBlocks.length
      }개, 대상연도 청구건 못 찾은 계약 ${result.noContractMatch.length}건`
    );

    await browser.close(); // CDP 연결만 해제 (사용자의 실제 Chrome 창은 닫히지 않음)

    himsJob.state = 'done';
    himsJob.result = result;
    himsJob.finishedAt = Date.now();
  } catch (e) {
    himsJob.state = 'error';
    himsJob.error = e.message;
    himsJob.finishedAt = Date.now();
    pushHimsLog(`오류: ${e.message}`);
  }
}

// ───────────────────────── 하이웍스 일정(연차휴가) 동기화 ─────────────────────────
// scheduler.office.hiworks.com 캘린더에 "[연차휴가] 이름" 형식으로 등록된 일정을 읽어서
// 연차/복지제도의 연차사용내역에 없는 날짜만 채워 넣는다(있는 날짜는 건드리지 않고,
// 앱에만 있고 하이웍스엔 없는 날짜도 지우지 않음 — 삭제는 사용자가 직접 함).

function pushHiworksLog(msg) {
  const line = `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`;
  console.log('[hiworks]', line);
  hiworksJob.log.push(line);
  if (hiworksJob.log.length > 500) hiworksJob.log.shift();
}

async function runHiworksSync(records, year, leaveSlotCount) {
  hiworksJob = { state: 'connecting', log: [], startedAt: Date.now() };
  pushHiworksLog(`하이웍스 일정(${year}년) 동기화를 시작합니다.`);
  try {
    if (!(await isHiworksChromeRunning())) {
      pushHiworksLog('전용 Chrome이 꺼져있어 새로 실행합니다. 창이 뜨면 하이웍스에 로그인해주세요...');
      launchHiworksChrome();
      throw new Error('전용 Chrome을 새로 띄웠습니다. 로그인 후 다시 동기화를 눌러주세요.');
    }

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${HIWORKS_CDP_PORT}`);
    const contexts = browser.contexts();
    const pages = contexts[0] ? contexts[0].pages() : [];
    const page = pages[pages.length - 1];
    if (!page) throw new Error('전용 Chrome 창을 찾을 수 없습니다. launch-chrome-hiworks.bat을 다시 실행해주세요.');

    hiworksJob.state = 'fetching';
    const byNameDates = await fetchYearLeaveEvents(page, year, pushHiworksLog);

    await browser.close(); // CDP 연결만 해제 (사용자의 실제 Chrome 창은 닫히지 않음)

    hiworksJob.state = 'computing';
    const result = computeHiworksSync(records, byNameDates, leaveSlotCount, year);
    pushHiworksLog(
      `계산 완료 — ${result.updates.length}명 갱신 대상, 이름 매칭 실패 ${result.unmatchedNames.length}건, ` +
      `앱에만 있는 날짜(참고용) ${result.appOnlyByName.length}명`
    );

    hiworksJob.state = 'done';
    hiworksJob.result = result;
    hiworksJob.finishedAt = Date.now();
  } catch (e) {
    hiworksJob.state = 'error';
    hiworksJob.error = e.message;
    hiworksJob.finishedAt = Date.now();
    pushHiworksLog(`오류: ${e.message}`);
  }
}

// ───────────────────────── HTTP 라우팅 ─────────────────────────

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ── 지로 자동기안 ──
  if (req.method === 'GET' && pathname === '/giro/status') {
    sendJson(res, 200, giroJob);
    return;
  }
  if (req.method === 'POST' && pathname === '/giro/run') {
    if (isBusy(giroJob)) {
      sendJson(res, 409, { error: '이미 진행 중인 작업이 있습니다. 완료 후 다시 시도해주세요.' });
      return;
    }
    readJsonBody(req).then((parsed) => {
      const targetDate = parsed.date;
      const onlyRows = Array.isArray(parsed.onlyRows) ? parsed.onlyRows : null;
      if (!targetDate) {
        sendJson(res, 400, { error: 'date가 필요합니다.' });
        return;
      }
      startGiroJob(targetDate, onlyRows); // fire-and-forget
      sendJson(res, 202, { ok: true });
    });
    return;
  }

  // ── 메일 수신함 ──
  if (req.method === 'GET' && pathname === '/mail/messages') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);
    const configPath = path.join(__dirname, 'mail-config.json');
    fetchInbox(limit, configPath)
      .then((messages) => sendJson(res, 200, { ok: true, messages }))
      .catch((err) => {
        console.error('[mail]', err);
        sendJson(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  // ── HIMS 동기화 ──
  if (req.method === 'GET' && pathname === '/hims/status') {
    sendJson(res, 200, himsJob);
    return;
  }
  if (req.method === 'POST' && pathname === '/hims/sync') {
    if (isBusy(himsJob)) {
      sendJson(res, 409, { error: '이미 진행 중인 동기화가 있습니다. 완료 후 다시 시도해주세요.' });
      return;
    }
    readJsonBody(req).then((parsed) => {
      const records = Array.isArray(parsed.records) ? parsed.records : null;
      const year = parsed.year || new Date().getFullYear();
      if (!records) {
        sendJson(res, 400, { error: 'records가 필요합니다.' });
        return;
      }
      runHimsSync(records, year); // fire-and-forget
      sendJson(res, 202, { ok: true });
    });
    return;
  }

  // ── 하이웍스 일정(연차휴가) 동기화 ──
  if (req.method === 'GET' && pathname === '/hiworks/status') {
    sendJson(res, 200, hiworksJob);
    return;
  }
  if (req.method === 'POST' && pathname === '/hiworks/sync') {
    if (isBusy(hiworksJob)) {
      sendJson(res, 409, { error: '이미 진행 중인 작업이 있습니다. 완료 후 다시 시도해주세요.' });
      return;
    }
    readJsonBody(req).then((parsed) => {
      const records = Array.isArray(parsed.records) ? parsed.records : null;
      const year = parsed.year || new Date().getFullYear();
      const leaveSlotCount = parsed.leaveSlotCount || 25;
      if (!records) {
        sendJson(res, 400, { error: 'records가 필요합니다.' });
        return;
      }
      runHiworksSync(records, year, leaveSlotCount); // fire-and-forget
      sendJson(res, 202, { ok: true });
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`하이라인닷넷 통합 도우미 서버 실행 중: http://localhost:${PORT}`);
  console.log('이 창은 "메일" / "대리점 수수료 정산(HIMS 동기화)" / "지로청구서 자동기안" 메뉴가 동작하는 동안 계속 열려있어야 합니다.');
});
