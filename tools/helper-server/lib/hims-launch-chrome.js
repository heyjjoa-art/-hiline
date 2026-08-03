/*
 * launch-chrome-hims.bat과 동일한 동작을 코드로 구현 (server.js에서 버튼 클릭만으로 Chrome을 띄우기 위함).
 * chrome-profile 폴더는 이 용도로만 쓰는 새 프로필이라 평소 쓰는 Chrome의 로그인/쿠키/저장된
 * 비밀번호와는 완전히 분리되어 있다. 로그인은 항상 사용자가 이 창에서 직접 한다(자동 로그인 없음).
 */
const { spawn } = require('child_process');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(__dirname, '..', 'chrome-profile-hims');
const CDP_PORT = 9223;
const START_URL = 'http://hims.hilineisp.net/Login.aspx?ReturnUrl=%2fMain.aspx';

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
