/*
 * 지로청구서 자동기안 (CLI, 문제 진단용)
 * 사용법:
 *   1) launch-chrome-giro.bat 을 실행해서 전용 Chrome을 띄운다 (한 번만 하면 됨, 창은 열어둔 채로 둔다)
 *   2) 그 Chrome 창에서 https://biz.giro.or.kr 에 직접 로그인한다
 *   3) node run-giro.js <지정일자>   (예: node run-giro.js 20   또는   node run-giro.js 말일)
 *
 * 로그인이 끝나는 걸 자동으로 감지한 뒤, 엑셀에서 해당 날짜의 항목들을 타입별로 알맞은 메뉴
 * (일반지로요금/전기요금·수신료/KT통신요금)로 순회하며 기안까지 진행한다. "상신"은 누르지 않는다.
 *
 * 평소에는 index.html의 "지로청구서 자동기안" 메뉴에서 날짜 선택 후 버튼 클릭으로 실행한다
 * (이 경우 server.js 통합 도우미 서버가 이 스크립트와 같은 로직 lib/giro-draft-runner.js를
 * 사용해 Chrome 실행부터 기안까지 자동으로 처리한다). 이 CLI는 서버 없이 직접 실행해 문제를
 * 진단하고 싶을 때 쓴다.
 *
 * 실제 셀렉터 구현은 lib/giro-draft-runner.js에 있다 (2026-07-20 실제 DOM recon).
 */
const path = require('path');
const fs = require('fs');
const { runForDate } = require('./lib/giro-draft-runner');

async function main() {
  const targetDate = process.argv[2];
  const maxCount = process.argv[3] ? parseInt(process.argv[3], 10) : null;
  if (!targetDate) {
    console.error('사용법: node run-giro.js <지정일자> [최대건수]   예) node run-giro.js 20   또는  node run-giro.js 20 1');
    process.exit(1);
  }

  const configPath = path.join(__dirname, 'giro-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('giro-config.json이 없습니다. giro-config.example.json을 복사해서 만들어주세요.');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const excelPath = path.resolve(__dirname, config.excelPath);

  await runForDate(targetDate, { excelPath, maxCount, log: console.log });
}

main().catch((e) => {
  console.error('오류:', e);
  process.exit(1);
});
