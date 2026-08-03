/*
 * scheduler.office.hiworks.com에서 "[연차휴가] 이름" 형식으로 등록된 일정을 읽어온다.
 * 로그인은 사용자가 launch-chrome-hiworks.bat으로 띄운 전용 Chrome 창에서 직접 하고,
 * 이 모듈은 chromium.connectOverCDP로 그 브라우저에 연결해서 화면을 읽기만 한다.
 *
 * 2026-07-29: 원래 월간 그리드(달력) 화면을 긁었는데, 일정이 많은 날은 화면이 텍스트 대신
 * 색깔 점(dot)만 표시하는 "요약 모드"로 바뀌어서 그 날의 일정을 아예 못 읽는 문제가 있었다
 * (창 크기와는 무관하게 발생, 정확한 트리거는 못 찾음). 대신 하이웍스 자체 "목록보기"
 * (표 형태로 일정을 나열하는 뷰)로 전환해서 읽으면 이 문제가 없다:
 *   - 모든 일정이 항상 텍스트로 표시됨(요약/점 모드 없음)
 *   - 여러 날짜에 걸친 일정은 하이웍스가 걸친 날짜 수만큼 "행"을 각각 만들어주고
 *     제목에 "(2/6일)"처럼 진행률을 붙여준다 — 그래서 "(7/30-8/4)" 같은 범위 텍스트를
 *     직접 파싱해서 날짜를 펼칠 필요가 없다. 각 행 자체의 날짜를 그대로 쓰면 된다.
 *     (제목에 범위 표기가 아예 없는 경우도 있는데— 예: "윤현호 (5/5일)" — 이 경우도
 *     행은 정상적으로 날짜별로 나뉘어 있어서 문제없다)
 *   - 하이웍스 자체 날짜 수 카운트(예: "이정화(7.31-8.5) (1/6일)")는 토/일요일도 그대로
 *     포함해서 세므로(연차는 주말엔 안 쓰는데도), 주말 제외는 여전히 우리 쪽에서 걸러야 한다.
 *
 * 공휴일 제외는 하지 않는다(2026-07-29 시도했다가 제거): "캘린더" 열이 "법정기념일"인
 * 날짜를 전부 제외했더니, 실제 공휴일이 아닌 "어버이날"(법정 휴일 아님, 정상 근무일)에
 * 등록된 진짜 연차(최호 5/8)까지 같이 걸러져버렸다. "법정기념일" 캘린더에는 실제 공휴일
 * (신정, 성탄절 등)과 단순 기념일(어버이날, 제헌절 등)이 구분 없이 섞여 있어서 이 열만으로는
 * 안전하게 판단할 수 없다 — 정확한 공휴일 목록을 따로 유지하지 않는 한, 공휴일에 연차를
 * 등록하는 경우 자체가 실무상 거의 없으므로 주말 제외만 하는 게 더 안전하다.
 *
 * 태그 오타 대응: 실제 일정 중 "[연차휴가]"를 "[연챠휴가]"로 잘못 입력한 사례가 확인됨
 * (권은혜 4/13~4/15, 권준범 4/13). "차"/"챠"는 인접 모음 오타로 흔할 수 있어 정규식으로
 * 관대하게 매칭한다.
 *
 * 이름 파싱 시 주의할 실제 표기 변형:
 *   - 이름 뒤에 직급이 붙기도 함: "[연차휴가]윤현호 이사(4/20~4/21)"
 *   - 한 일정에 여러 명이 쉼표로 같이 적히기도 함(그 날 하루만 해당):
 *     "[연차휴가] 권은혜,이종창", "[연차휴가] 최호,김정환, 이정화, 이종창"
 *   - 앞에 시간 표시가 붙기도 함: "오후 01:30 ~ 오전 12:00" (목록보기는 별도 "시간" 열이라
 *     제목 자체에는 안 섞여 나옴 — 그리드뷰에 있던 시간 접두 제거 로직은 더 이상 필요 없음)
 */

const LEAVE_TAG_PATTERN = "\\[연[차챠]휴가\\]";

function isWeekend(monthDay, year) {
  const [m, d] = monthDay.split("/").map(Number);
  const dow = new Date(year, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

// "일정 표시 방법" 드롭다운에서 "목록보기"를 선택한다(이미 선택돼 있어도 무해함).
async function switchToListView(page) {
  await page.evaluate(() => {
    const input = document.querySelector("input.mantine-Input-input");
    if (input) input.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[role="option"], [class*="Combobox"] *'));
    const target = items.find((el) => el.children.length === 0 && el.innerText.trim() === "목록보기");
    if (target) target.click();
  });
  await page.waitForTimeout(600);
}

async function gotoMonthHeaderText(page) {
  return page.evaluate(() => {
    const header = document.querySelector('[class*="CalendarHeader"]');
    return header ? header.innerText : null;
  });
}

function parseMonthTitle(headerText) {
  const m = headerText && headerText.match(/(\d{4})년\s*(\d{1,2})월/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

async function clickMonthNav(page, direction) {
  const idx = direction === "next" ? 1 : 0;
  await page.evaluate((btnIdx) => {
    const header = document.querySelector('[class*="CalendarHeader"]');
    const btns = Array.from(header.querySelectorAll("button._icon-button_1g9pw_216"));
    if (btns[btnIdx]) btns[btnIdx].click();
  }, idx);
  await page.waitForTimeout(700);
}

// 목록보기 표에서 현재 달의 행을 읽는다. 날짜가 있는 행(하루의 첫 일정, 4칸: 날짜/시간/
// 캘린더/제목)과 같은 날짜의 추가 일정 행(3칸: 시간/캘린더/제목, 날짜 칸은 rowspan으로
// 생략됨)을 구분해서 각 일정에 실제 날짜를 붙여준다.
async function extractMonthListRows(page) {
  return page.evaluate(() => {
    const tables = document.querySelectorAll("table.TableCalendar_table__E2v8X");
    const bodyTable = tables[1];
    if (!bodyTable) return [];
    const out = [];
    let currentDateLabel = null;
    Array.from(bodyTable.querySelectorAll("tr")).forEach((tr) => {
      const cells = Array.from(tr.children).map((td) => (td.innerText || "").trim());
      let calendarName, title;
      if (cells.length === 4) {
        currentDateLabel = cells[0];
        calendarName = cells[2];
        title = cells[3];
      } else if (cells.length === 3) {
        calendarName = cells[1];
        title = cells[2];
      } else {
        return;
      }
      if (title) out.push({ dateLabel: currentDateLabel, calendarName, title });
    });
    return out;
  });
}

/**
 * year 전체(1~12월)를 "목록보기"로 순회하며 "[연차휴가]" 일정과 공휴일을 모은 뒤,
 * 이름별 날짜 목록으로 합친다(주말·공휴일 제외).
 * @param {import('playwright').Page} page CDP로 연결한 로그인된 하이웍스 일정 탭
 * @param {number} year
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<Map<string,string[]>>} 이름 -> 정렬된 "M/D" 날짜 배열
 */
async function fetchYearLeaveEvents(page, year, log = () => {}) {
  if (/login\.office\.hiworks\.com/i.test(page.url())) {
    throw new Error("하이웍스 로그인이 필요합니다. 열린 창에서 직접 로그인해주세요.");
  }

  await switchToListView(page);

  const headerNow = await gotoMonthHeaderText(page);
  const startMonth = parseMonthTitle(headerNow);
  if (!startMonth) throw new Error("하이웍스 일정 화면 구조를 인식하지 못했습니다(달력 제목을 찾을 수 없음).");
  let { year: curYear, month: curMonth } = startMonth;

  while (curYear !== year || curMonth !== 1) {
    await clickMonthNav(page, curYear > year || (curYear === year && curMonth > 1) ? "prev" : "next");
    const t = parseMonthTitle(await gotoMonthHeaderText(page));
    curYear = t.year;
    curMonth = t.month;
  }

  // 1단계: 1~12월의 원본 행(날짜/캘린더/제목)을 모두 모은다.
  const allRows = [];
  for (let month = 1; month <= 12; month++) {
    const rows = await extractMonthListRows(page);
    rows.forEach((r) => allRows.push(r));
    log(`${year}년 ${month}월 — 일정 ${rows.length}행 읽음`);
    if (month < 12) await clickMonthNav(page, "next");
  }

  // 2단계: 연차휴가 행 파싱 + 주말 제외 + 이름별 집계(중복 제거)
  const tagRe = new RegExp(LEAVE_TAG_PATTERN);
  const seen = new Set(); // `${name}::${date}` 중복 제거용
  const byName = new Map();
  allRows.forEach(({ dateLabel, title }) => {
    const dm = dateLabel.match(/^(\d{1,2})\.(\d{1,2})/);
    const tagMatch = title.match(tagRe);
    if (!dm || !tagMatch) return;
    const monthDay = `${Number(dm[1])}/${Number(dm[2])}`;
    if (isWeekend(monthDay, year)) return;

    let rest = title.slice(tagMatch.index + tagMatch[0].length).trim();
    const parenIdx = rest.indexOf("(");
    if (parenIdx !== -1) rest = rest.slice(0, parenIdx).trim();
    const names = rest
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/)[0])
      .filter(Boolean);

    names.forEach((name) => {
      const key = `${name}::${monthDay}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(monthDay);
    });
  });

  byName.forEach((dates) => {
    dates.sort((a, b) => {
      const [am, ad] = a.split("/").map(Number);
      const [bm, bd] = b.split("/").map(Number);
      return am - bm || ad - bd;
    });
  });

  return byName;
}

module.exports = { fetchYearLeaveEvents, extractMonthListRows, switchToListView };
