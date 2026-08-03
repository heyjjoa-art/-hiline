/*
 * HIMS/지로와 동일한 패턴: 하이웍스 일정 전용 Chrome 프로필을 새로 띄운다.
 * 평소 쓰는 Chrome의 로그인/쿠키와는 완전히 분리되어 있고, 로그인은 항상 사용자가
 * 이 창에서 직접 한다(자동 로그인 없음).
 */
const { spawn } = require('child_process');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(__dirname, '..', 'chrome-profile-hiworks');
const CDP_PORT = 9224;
const START_URL = 'https://scheduler.office.hiworks.com/calendar/checked';

async function isChromeRunning(cdpUrl = `http://127.0.0.1:${CDP_PORT}`) {
  try {
    const res = await fetch(`${cdpUrl}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function launchChrome() {
  const child = spawn(
    CHROME_PATH,
    [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE_DIR}`, START_URL],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

module.exports = { isChromeRunning, launchChrome, CDP_PORT };
