# 하이라인닷넷 통합 도우미 서버

`index.html`은 브라우저 페이지라 외부 사이트 로그인 세션을 다루거나(지로/HIMS) IMAP 소켓에
직접 접속할 수 없다(메일). 이 로컬 도우미 서버가 그 대신 처리하고, `index.html`은 이 서버를
HTTP로 호출해서 결과만 화면에 표시한다.

원래 지로 자동기안(포트 8787) / 메일 수신함(포트 8788) / HIMS 동기화(포트 8790) 세 서버로
나뉘어 있던 것을 **경로 기반 라우팅**으로 합쳐서 포트 하나(8787)만 켜두면 세 메뉴가 전부
동작하도록 통합했다(2026-07-28). 시작프로그램 등록도 하나(`hiline-helper-server.vbs`)로 관리한다.

## 실행

```
cd tools/helper-server
npm install    # node_modules가 없을 때만 (이미 포함된 상태라면 생략 가능)
node server.js
```

- PC 시작 시 자동 실행되도록 하려면 `node install-startup.js`를 한 번 실행해두면 된다
  (Windows 시작프로그램 폴더에 콘솔 창 없이 실행되는 스크립트를 등록).
- 지금 바로 켜고 싶으면 `start-server-now.bat` 실행.
- 서버가 꺼져 있으면 `index.html`의 해당 메뉴에서 "도우미 서버에 연결할 수 없습니다"라고 표시된다.
- 8787을 다른 프로그램이 쓰고 있으면 `HILINE_PORT` 환경변수로 포트를 바꿀 수 있다
  (예: `set HILINE_PORT=8899 && node server.js`).

## 화면(허브)도 이 서버로 연다 — 권장

이 서버는 API뿐 아니라 **프로젝트 폴더 전체를 정적 파일로 서빙**한다. 즉 `index.html`을
파일로 직접 여는 대신 **http://localhost:8787/** 로 열 수 있다.

**`start-server-now.bat`(= `node server.js --open`) 하나만 실행하면** 서버를 켜고 브라우저까지
띄운다. 서버가 이미 실행 중이면 새로 띄우지 않고 브라우저만 열기 때문에 여러 번 눌러도 안전하다.
(시작프로그램으로 자동 실행되는 쪽은 `--open` 없이 돌아서, 부팅할 때마다 브라우저가 뜨지는 않는다.)

- 포트를 이미 쓰고 있는 것이 **정적 서빙이 없는 옛 버전 서버**면, 그냥 열었을 때 404만 보여서
  원인을 알기 어렵다. 그래서 `/__hiline/health`로 새 버전인지 먼저 확인하고, 옛 버전이면
  "기존 Node 프로세스를 종료하고 다시 실행하라"는 안내를 콘솔에 띄운다.

`file://`로 직접 열면 브라우저가 그 문서의 origin을 `null`(불투명 origin)로 취급해서 제약이 붙는다.
`http://localhost`로 열면 아래가 전부 풀린다.

| 항목 | `file://`로 열 때 | `http://localhost`로 열 때 |
|---|---|---|
| 필요서류의 PDF 인쇄 | 새 탭에서 `Ctrl+P` 해야 함 (blob URL이 교차 출처라 스크립트로 인쇄 불가) | 버튼 한 번으로 인쇄 |
| 필요서류 보관 | IndexedDB가 막히면 localStorage(약 5MB)로 떨어짐 | IndexedDB 정상 사용 |
| 로컬 파일 `fetch` | 차단됨 (그래서 엑셀 템플릿을 base64로 embed해 둠) | 가능 |

- 기존처럼 `index.html`을 파일로 직접 여는 방식도 **그대로 동작한다** — 위 제약이 붙을 뿐이다.
- 정적 서빙은 프로젝트 폴더 밖으로 나가는 경로(`..` 등)를 막아두었고, `127.0.0.1`에만
  바인딩되어 있어 외부에서는 접속할 수 없다.

## 엔드포인트

| 메뉴 | 경로 | 설명 |
|---|---|---|
| 지로청구서 자동기안 | `GET /giro/status`, `POST /giro/run` | biz.giro.or.kr 기안 자동화 (전용 Chrome, 포트 9222) |
| 메일 | `GET /mail/messages?limit=N` | 메일플러그 IMAP 수신함 조회 |
| 대리점 수수료 정산(HIMS 동기화) | `GET /hims/status`, `POST /hims/sync` | hims.hilineisp.net 요금납부정보 대조 (전용 Chrome, 포트 9223) |
| 연차/복지제도의 하이웍스 일정 동기화 | `GET /hiworks/status`, `POST /hiworks/sync` | scheduler.office.hiworks.com "[연차휴가] 이름" 일정 연동 (전용 Chrome, 포트 9224) |

## 기능별 설정

### 지로 자동기안
- `giro-config.json` 필요 (`giro-config.example.json` 복사 후 `excelPath`만 채우면 됨 —
  `loginId`/`loginPw`는 로그인을 자동화하지 않으므로 현재 사용되지 않음).
- 로그인은 `launch-chrome-giro.bat`으로 띄운 전용 Chrome(`chrome-profile-giro/`, 포트 9222)에서
  사용자가 직접 한다. 계정 잠김 위험이 있는 사이트라 로그인 자동화는 하지 않는다.
- 대상 파일: `etc/지로납부번호.xlsx`. 처리 범위/기안·상신 관련 주의사항은 `index.html`의
  지로 메뉴 안내 참고.
- 문제 진단용 CLI: `node run-giro.js <지정일자>` (서버 없이 단독 실행).

### 메일
- `mail-config.json` 필요 (`mail-config.example.json` 참고) — 메일플러그 계정의 **앱 비밀번호**
  (그룹웨어 로그인 비밀번호 아님)를 채워야 한다. 발급 방법 등 자세한 설정은 과거
  `tools/mail-inbox/README.md`에 정리돼 있던 내용을 참고(진단 기록 포함, 아래 "이전 히스토리" 참고).

### HIMS 동기화
- 별도 설정 파일 없음. 로그인은 `launch-chrome-hims.bat`으로 띄운 전용 Chrome
  (`chrome-profile-hims/`, 포트 9223)에서 사용자가 직접 한다.
- 첫 동기화 시도는 전용 Chrome이 꺼져있으면 새로 띄우기만 하고 실패로 끝난다(의도된 동작) —
  로그인 후 다시 "동기화" 버튼을 눌러야 한다.

### 하이웍스 일정(연차휴가) 동기화
- 별도 설정 파일 없음. 로그인은 `launch-chrome-hiworks.bat`으로 띄운 전용 Chrome
  (`chrome-profile-hiworks/`, 포트 9224)에서 사용자가 직접 한다.
- scheduler.office.hiworks.com 캘린더(FullCalendar)에서 "[연차휴가] 이름" 형식으로 등록된
  일정을 연간(1~12월) 훑어서 이름별 사용 날짜를 모은다. 제목에 날짜 범위가 붙는 경우
  ("(7/30-8/4)", "(7.31-8.5)", "(4/20~4/21)", 끝쪽이 "(7/30-31)"처럼 일(day)만 적힌 경우도
  같은 달로 처리)와 한 일정에 여러 명이 쉼표로 같이 적힌 경우("[연차휴가] 권은혜,이종창")도
  대응한다. 이름 뒤에 직급이 붙는 경우("윤현호 이사")는 직급을 무시하고 이름만 쓴다.
- "연차/복지제도" 화면의 연차내역 데이터(이름 기준)와 매칭해서, **없는 날짜만 채워 넣는다**
  (이미 있는 날짜는 건드리지 않고, 앱에는 있는데 하이웍스엔 없는 날짜도 지우지 않음 — 그런
  건 참고용으로만 화면에 표시되고 삭제는 사용자가 직접 함). 앱에서 이름을 못 찾은 경우와
  연차사용내역 칸(25개)이 부족해서 못 채운 날짜도 결과에 함께 표시된다.
- 로직: `lib/hiworks-scrape.js`(화면 읽기·파싱), `lib/hiworks-match.js`(연차내역과 대조).

## 통합하며 바뀐 점 (2026-07-28)

- 포트: 8787 하나로 통일(기존 8787/8788/8790 → `/giro`, `/mail`, `/hims` 경로로 구분).
- `chrome-profile` → `chrome-profile-giro`(지로) / `chrome-profile-hims`(HIMS)로 이름 분리해서
  한 폴더에 공존 (로그인 세션은 폴더 이동만 했으므로 그대로 유지됨, 재로그인 불필요).
- `uncaughtException`/`unhandledRejection` 방어 코드를 서버 전체에 공용으로 적용 — 예전에
  메일 서버에는 이 방어가 없었는데, 통합하면서 지로/HIMS와 동일하게 보호되도록 함.
- HIMS 쪽 `rowType`/`toHimsCustNo` 로직이 `server.js`와 `lib/hims-match.js`에 중복 정의돼 있던 것을
  `lib/hims-match.js` 한 곳만 쓰도록 정리.
- `tools/giro-auto-draft/`, `tools/mail-inbox/`, `tools/hims-payment-sync/` 세 디렉터리는 이
  통합 서버로 대체되어 삭제됨 — 관련 프론트엔드(`tools/giro-draft-preview.js`,
  `tools/mail-inbox-preview.js`, `tools/agency-commission.js`)도 새 포트/경로를 쓰도록 갱신함.

## 알아두면 좋은 것들 (기존 서버들에서 겪었던 문제)

- **지로 로그인 자동화는 시도하지 않는다**: nppfs 보안모듈이 자동화 브라우저를 감지해서 막고,
  Chrome 기본 프로필은 CDP 원격 디버깅 자체를 거부한다. 그래서 로그인은 항상 사용자가 전용
  Chrome 창에서 직접 한다.
- **지로 "상신"은 자동으로 하지 않는다**: 실제 접수 행위라 취소가 어렵다(승인자 계정에서만
  가능). "기안하기"까지만 자동 진행하고, 상신은 사용자가 "기안문서 관리" 화면에서 직접 한다.
- **메일플러그 IMAP은 `loginMethod: 'LOGIN'`을 강제해야 한다**: 기본 SASL(`AUTH=PLAIN`) 방식은
  메일플러그 서버가 `"2 BAD invalid command"`로 거부해서 응답 없이 멈춘다.
