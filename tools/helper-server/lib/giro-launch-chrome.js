/*
 * launch-chrome-giro.bat과 동일한 동작을 코드로 구현 (server.js에서 버튼 클릭만으로 Chrome을 띄우기 위함).
 * chrome-profile 폴더는 이 용도로만 쓰는 새 프로필이라 평소 쓰는 Chrome의 로그인/쿠키/저장된
 * 비밀번호와는 완전히 분리되어 있다.
 */
const { spawn } = require('child_process');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = path.join(__dirname, '..', 'chrome-profile-giro');
const CDP_PORT = 9222;

async function isChromeRunning(cdpUrl = `http://localhost:${CDP_PORT}`) {
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
    [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE_DIR}`, 'https://biz.giro.or.kr'],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

module.exports = { isChromeRunning, launchChrome, CDP_PORT };
