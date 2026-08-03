/*
 * 통합 도우미 서버(server.js)를 Windows 로그인 시 자동으로(콘솔 창 없이 백그라운드)
 * 실행되도록 등록한다. 한 번만 실행하면 된다: node install-startup.js
 *
 * 방식: Windows 시작프로그램 폴더(%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup)에
 * vbs 스크립트를 하나 넣어둔다. 이 폴더 안의 스크립트는 로그인할 때마다 Windows가 자동으로 실행한다.
 * vbs는 WScript.Shell.Run(..., 0, false)로 콘솔 창을 숨긴 채 "node server.js"를 실행한다.
 *
 * 제거하려면: node install-startup.js --uninstall
 */
const fs = require('fs');
const path = require('path');

const PROJECT_DIR = __dirname;
const STARTUP_DIR = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const VBS_PATH = path.join(STARTUP_DIR, 'hiline-helper-server.vbs');

const vbsContent = `' 하이라인닷넷 통합 도우미 서버 자동 실행 (지로 자동기안 / 메일 / HIMS 동기화 공용)
' install-startup.js가 생성한 파일. 삭제하려면 이 파일을 지우거나 "node install-startup.js --uninstall"을 실행하세요.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "${PROJECT_DIR.replace(/\\/g, '\\\\')}"
shell.Run "cmd /c node server.js > server-log.txt 2>&1", 0, False
`;

function install() {
  if (!fs.existsSync(STARTUP_DIR)) {
    console.error(`시작프로그램 폴더를 찾지 못했습니다: ${STARTUP_DIR}`);
    process.exit(1);
  }
  fs.writeFileSync(VBS_PATH, vbsContent, 'utf8');
  console.log(`등록 완료: ${VBS_PATH}`);
  console.log('다음 Windows 로그인부터 통합 도우미 서버가 자동으로(콘솔 창 없이) 실행됩니다.');
  console.log('지금 바로 쓰려면 start-server-now.bat을 실행하거나 "node server.js"를 실행해주세요.');
}

function uninstall() {
  if (fs.existsSync(VBS_PATH)) {
    fs.unlinkSync(VBS_PATH);
    console.log(`등록 해제 완료: ${VBS_PATH} 삭제됨`);
  } else {
    console.log('등록된 파일이 없습니다.');
  }
}

if (process.argv.includes('--uninstall')) {
  uninstall();
} else {
  install();
}
