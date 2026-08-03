/*
 * 복지제도 관리
 * "2026 복지제도 지원현황-하이라인닷넷.xls" (연차내역 / 복지포인트 내역 / 개인별지원사항 3개 시트)를
 * 브라우저 안에서 관리(추가/수정/삭제)하고, 필요할 때 같은 컬럼 구성의 xlsx로 다운로드한다.
 * 데이터는 서버로 전송되지 않고 이 브라우저의 localStorage에만 저장된다.
 * .xls 원본을 읽어야 해서 SheetJS(vendor/xlsx.full.min.js)를 사용하고,
 * 다운로드 시 서식 저장을 위해 ExcelJS(vendor/exceljs.min.js)를 사용한다.
 */
(function () {
  const STORAGE_KEYS = {
    leave: "hiline_welfare_leave_v2",
    points: "hiline_welfare_points_v1",
    individual: "hiline_welfare_individual_v1",
    year: "hiline_welfare_year_v1",
  };

  const LEAVE_SLOT_COUNT = 25; // "연차 사용내역" 칸 수 — 각 칸에는 실제 사용한 날짜(예: "6/1")를 입력

  // 저장된 연차내역이 없을 때(최초 로드) 채워 넣는 실제 데이터
  const DEFAULT_LEAVE_DATA = [
    { team: "대표이사", name: "정연경", position: "사장", hireDate: "00-01-17", tenure: "26", baseline: 22, usageSlots: [] },
    { team: "대표이사", name: "조현덕", position: "부사장", hireDate: "21-09-01", tenure: "5", baseline: 17, usageSlots: [] },
    { team: "경영지원팀", name: "윤현호", position: "이사", hireDate: "01-01-29", tenure: "25", baseline: 22,
      usageSlots: ["1/22", "3/5", "3/18", "3/19", "4/20", "4/21", "4/28", "6/1", "6/2", "7/20"] },
    { team: "경영지원팀", name: "이정화", position: "부장", hireDate: "01-01-26", tenure: "25", baseline: 22,
      usageSlots: ["1/7", "1/28", "4/2", "4/17", "4/22", "7/7", "7/31", "8/3", "8/4", "8/5"] },
    { team: "경영지원팀", name: "오정은", position: "부장", hireDate: "01-02-02", tenure: "25", baseline: 22, family: 2,
      usageSlots: ["1/23", "3/17", "3/20", "4/20", "4/21", "4/22", "4/23", "4/24", "5/4", "5/11", "5/14"] },
    { team: "경영지원팀", name: "권은혜", position: "과장", hireDate: "06-02-20", tenure: "20", baseline: 22, family: 2,
      usageSlots: ["1/5", "1/6", "1/7", "1/8", "1/21", "1/29", "2/25", "2/26", "3/16", "3/18", "4/13", "4/14", "4/15", "5/26", "5/27", "6/24", "7/27", "7/30"] },
    { team: "NS사업부", name: "함동재", position: "상무", hireDate: "22-02-03", tenure: "4", baseline: 16, usageSlots: [] },
    { team: "IT사업본부", name: "김정환", position: "차장", hireDate: "04-06-23", tenure: "22", baseline: 22,
      usageSlots: ["2/27", "3/25", "4/17", "5/4", "7/10", "7/30", "7/31"] },
    { team: "IT사업본부", name: "김세한", position: "과장", hireDate: "07-07-23", tenure: "19", baseline: 22,
      usageSlots: ["1/30", "3/11", "3/12", "3/13", "4/2", "4/30", "5/4", "7/27", "7/28", "7/29"] },
    { team: "IT사업본부", name: "정원빈", position: "대리", hireDate: "17-10-23", tenure: "9", baseline: 19, family: 2,
      usageSlots: ["1/26", "2/13", "3/23", "4/10", "6/29", "7/16", "8/10", "8/11", "8/12", "8/13", "8/14"] },
    { team: "IT사업본부", name: "이종창", position: "대리", hireDate: "18-12-17", tenure: "8", baseline: 18, reserve: 1,
      usageSlots: ["1/19", "1/29", "3/4", "4/17", "4/22", "5/4", "6/11", "6/16", "7/24", "8/4", "8/5"] },
    { team: "IT사업본부", name: "최호", position: "대리", hireDate: "19-03-22", tenure: "7", baseline: 18,
      usageSlots: ["3/10", "3/12", "4/17", "4/22", "4/23", "4/24", "4/30", "5/8", "5/21", "6/2", "6/10", "6/19", "9/1", "9/2", "9/3"] },
    { team: "IT사업본부", name: "최윤주", position: "사원", hireDate: "21-10-12", tenure: "5", baseline: 17,
      usageSlots: ["1/30", "3/16", "3/17", "3/18", "3/19", "3/20", "6/19", "7/3"] },
    { team: "IT사업본부", name: "권준범", position: "사원", hireDate: "22-07-04", tenure: "4", baseline: 16,
      usageSlots: ["4/13", "5/29", "7/30", "7/31", "8/3", "8/4"] },
    { team: "IT사업본부", name: "김다운", position: "사원", hireDate: "23-02-13", tenure: "3", baseline: 16,
      usageSlots: ["2/9", "3/30", "3/31", "4/23", "4/24", "6/8", "7/6", "8/3"] },
    { team: "IT사업본부", name: "장성근", position: "이사", hireDate: "17-10-01", tenure: "9", baseline: 19,
      usageSlots: ["5/13", "5/14"], resignDate: "26-07-29" },
  ];

  let data = { leave: [], points: [] };
  let currentYear = 2026; // loadFromStorage()가 항상 이 값으로 다시 맞추지만, 로드 전 기본값도 맞춰둔다

  // ── 공용 유틸 ───────────────────────────────────────────
  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function parseNum(v) {
    if (v === undefined || v === null || v === "") return 0;
    const s = String(v).replace(/[^0-9.-]/g, "");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  // 복지포인트 관련 금액은 전부 "1,000원"처럼 천단위 콤마 + "원"으로 표기한다
  // (지급포인트/잔여한도/사용내역의 금액 칸 공용).
  function formatWon(n) {
    return (Number(n) || 0).toLocaleString("ko-KR") + "원";
  }

  // 원본 엑셀에서 팀명 칸을 병합하는 대신 "◎"/"〃" 같은 반복부호(ditto mark)를 그대로 써둔 경우,
  // 빈 칸과 마찬가지로 취급해서 바로 위 행의 실제 팀명을 이어받아야 한다(안 그러면 팀명이
  // "◎" 문자 그대로 저장돼서 화면에 이상하게 표시되고, 위 행과 값이 달라서 팀명 병합도 안 됨).
  const DITTO_MARKS = new Set(["◎", "〃", "″", "仝", "同"]);
  function isDittoLike(s) {
    return !s || DITTO_MARKS.has(s);
  }

  // ── 데이터 모델 ─────────────────────────────────────────
  function blankLeaveRecord() {
    const r = {
      _id: newId(), team: "", name: "", position: "", hireDate: "", tenure: "",
      usageSlots: [], baseline: 0,
      longService: 0, reserve: 0, family: 0, wedding: 0, maternity: 0, etc: 0, note: "",
      resignDate: "", // 값이 있으면 퇴사자로 취급 — 연차내역 표/엑셀에서 해당 행이 회색으로 표시됨
    };
    recalcLeave(r);
    return r;
  }

  function blankPointsRecord() {
    const r = {
      _id: newId(), team: "", name: "", position: "", hireDate: "", tenure: "", grantPoint: 0, entries: [],
      longService5: "", longService10: "", checkup41: "", parentCheckup: "",
    };
    recalcPoints(r);
    return r;
  }

  // "6/1" 같은 문자열을 정렬/인접일 비교가 가능한 타임스탬프로(연도 정보가 없어 임의 연도 사용 —
  // 순서·하루 간격 판단에만 쓰이므로 실제 연도가 몇 년인지는 상관없음)
  function parseSlotDate(str) {
    const m = String(str || "").trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
    if (!m) return null;
    const t = new Date(2000, Number(m[1]) - 1, Number(m[2])).getTime();
    return Number.isNaN(t) ? null : t;
  }

  // 매년 같은 날짜인 공휴일만(음력 기반 설날/추석/부처님오신날 등은 연도마다 날짜가 달라 정확한
  // 값을 모른 채 잘못 제외하는 위험이 있어 뺐다 — 필요하면 이 목록에 직접 추가해서 쓸 것)
  const FIXED_HOLIDAYS = new Set(["1/1", "3/1", "5/5", "6/6", "8/15", "10/3", "10/9", "12/25"]);

  // 주말(토/일)이거나 고정 공휴일이면 연차사용내역에 반영하지 않는다(카운트뿐 아니라 칸 자체에도
  // 남기지 않음 — 입력/동기화 등 어떤 경로로 들어와도 normalizeUsageSlots에서 자동으로 걸러진다).
  function isCountableUsageDate(monthDaySlash) {
    const m = String(monthDaySlash || "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return true;
    const normalized = `${Number(m[1])}/${Number(m[2])}`;
    if (FIXED_HOLIDAYS.has(normalized)) return false;
    const dow = new Date(currentYear, Number(m[1]) - 1, Number(m[2])).getDay();
    return dow !== 0 && dow !== 6;
  }

  // usageSlots를 "값이 있고, 주말/공휴일이 아닌 것만, 날짜순 정렬"된 상태로 정리한다. 연이은
  // 날짜가 표에서 항상 인접한 칸에 오게 하기 위한 정규화 — 이래야 연속 구간을 셀 병합으로
  // 보여줄 수 있다. 주말/공휴일은 여기서 걸러지므로 애초에 칸에 남지 않는다.
  function normalizeUsageSlots(usageSlots) {
    const filled = (usageSlots || [])
      .filter((v) => String(v || "").trim() !== "")
      .filter(isCountableUsageDate);
    filled.sort((a, b) => {
      const ta = parseSlotDate(a);
      const tb = parseSlotDate(b);
      if (ta === null || tb === null) return 0;
      return ta - tb;
    });
    return filled;
  }

  function recalcLeave(rec) {
    rec.usageSlots = normalizeUsageSlots(rec.usageSlots);
    rec.used = rec.usageSlots.length;
    rec.remaining = (Number(rec.baseline) || 0) - rec.used;
    rec.yearTotal = rec.used
      + (Number(rec.longService) || 0) + (Number(rec.reserve) || 0) + (Number(rec.family) || 0)
      + (Number(rec.wedding) || 0) + (Number(rec.maternity) || 0) + (Number(rec.etc) || 0);
  }

  function recalcPoints(rec) {
    const usageSum = (rec.entries || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    rec.remainingLimit = (Number(rec.grantPoint) || 0) - usageSum;
  }

  // ── 저장/불러오기 (localStorage) ───────────────────────
  // 연차내역/복지포인트는 연도별로 완전히 분리해서 저장한다(연차는 매년 새로 시작하는 값이라
  // 연도를 바꿔도 서로 다른 데이터를 관리할 수 있어야 함). 개인별지원사항(장기근속/검진)은
  // 연도와 무관하게 한 번 관리하는 값이라 이전과 동일하게 연도 구분 없이 공용으로 둔다.
  function leaveStorageKey(year) { return `${STORAGE_KEYS.leave}_${year}`; }
  function pointsStorageKey(year) { return `${STORAGE_KEYS.points}_${year}`; }

  // 2027년 이후 저장된 데이터가 없는 새해를 처음 열 때, 그 이전 연도 중 가장 최근에 저장된
  // 연차내역에서 재직자 명단(퇴사자는 resignDate로 걸러냄)을 가져온다 — 연차내역이 "직원리스트"의
  // 기준(퇴사 여부를 판단할 수 있는 유일한 곳)이라 복지포인트 쪽도 이걸 그대로 따라간다.
  // 빈 배열(길이 0)로 저장된 연도는 "아직 채워진 적 없음"으로 보고 건너뛰고 더 이전 연도를 찾는다
  // (이 롤오버 기능이 생기기 전에는 데이터 없는 연도를 열면 빈 배열이 그대로 저장됐었다).
  function findPriorActiveRoster(year) {
    for (let y = year - 1; y >= 2026; y--) {
      const stored = localStorage.getItem(leaveStorageKey(y));
      if (!stored) continue;
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.filter((r) => !r.resignDate);
        }
      } catch {
        // 손상된 데이터면 더 이전 연도를 계속 찾아본다
      }
    }
    return null;
  }

  // 근속년수는 "26"처럼 단순 정수 문자열로 관리되므로 해가 바뀌면 1을 더해준다.
  // 정수로 못 읽는 값(공란 등)은 건드리지 않고 그대로 둔다.
  function rolloverTenure(tenure) {
    const n = parseInt(tenure, 10);
    return Number.isFinite(n) ? String(n + 1) : tenure;
  }

  function rosterFields(r) {
    return { team: r.team, name: r.name, position: r.position, hireDate: r.hireDate, tenure: rolloverTenure(r.tenure) };
  }

  // 이름으로 매칭하는 모든 곳(퇴사여부/팀명 동기화/중복 제거 등)에서 공통으로 쓰는 정규화.
  // 1) 유니코드 정규화 형태 차이(NFC vs NFD — 자모가 분리 저장된 한글 등, 다른 프로그램에서
  //    붙여넣은 경우 흔함)와 2) 이름 중간에 실수로 들어간 공백(예: "최 호" vs "최호")은 둘 다
  // 화면엔 똑같이 보이거나 거의 안 보이는데도 ===로는 다른 문자열로 판정돼 "같은 사람인데
  // 다른 사람"으로 취급되면서 중복 레코드가 생기는 원인이었다. 매칭 전에 항상 이 함수로
  // 정규화한다(공백을 전부 제거하므로 이름에 공백이 들어갈 일이 없는 한국어 인명 특성상 안전).
  function normName(name) {
    return String(name || "").normalize("NFC").replace(/\s+/g, "");
  }

  // 연차내역이 재직/퇴사 여부의 기준이다 — 복지포인트/개인별지원사항은 자체적으로 퇴사 여부를
  // 저장하지 않고, 표를 그릴 때마다 이름으로 연차내역을 찾아 퇴사 여부를 그대로 따라간다.
  function isResignedName(name) {
    const target = normName(name);
    if (!target) return false;
    return data.leave.some((r) => normName(r.name) === target && r.resignDate);
  }

  // 팀명/성명/직급/입사일/근속 연수는 연차내역이 기준이다 — 연차내역에서 수정하면 그 값을
  // 복지포인트의 같은 사람 레코드에도 바로 밀어넣어(자동반영) 두 표가 어긋나지 않게 한다.
  // 성명이 바뀐 경우는 oldName(수정 직전 이름)으로 복지포인트 쪽 레코드를 찾아야 한다
  // (안 그러면 새 이름으로는 매칭이 안 돼서 그 사람의 복지포인트 레코드를 못 찾음).
  function syncPointsRoster(rec, oldName) {
    const lookupName = normName(oldName !== undefined ? oldName : rec.name);
    if (!lookupName) return;
    const pr = data.points.find((p) => normName(p.name) === lookupName);
    if (!pr) return;
    pr.team = rec.team;
    pr.name = rec.name;
    pr.position = rec.position;
    pr.hireDate = rec.hireDate;
    pr.tenure = rec.tenure;
    savePoints();
  }

  // syncPointsRoster는 연차내역에서 실제로 "수정"(change 이벤트)이 일어난 사람만 복지포인트에
  // 반영한다 — 이 동기화 기능이 생기기 전에 이미 어긋나 있던 값(예: 복지포인트 쪽 팀명이
  // 비어있거나 예전 값 그대로인 경우)은 연차내역 쪽 값이 그대로라 change가 안 일어나서 영원히
  // 안 고쳐진다. 그래서 데이터를 불러올 때마다 이름이 같은 사람 전원을 통째로 다시 맞춰준다.
  function syncAllPointsRoster() {
    let changed = false;
    data.points.forEach((pr) => {
      const prName = normName(pr.name);
      if (!prName) return;
      const lr = data.leave.find((r) => normName(r.name) === prName);
      if (!lr) return;
      if (pr.team !== lr.team || pr.position !== lr.position || pr.hireDate !== lr.hireDate || pr.tenure !== lr.tenure) {
        pr.team = lr.team;
        pr.position = lr.position;
        pr.hireDate = lr.hireDate;
        pr.tenure = lr.tenure;
        changed = true;
      }
    });
    if (changed) savePoints();
  }

  // parseLeaveSheet의 ditto-mark 처리는 새로 업로드할 때만 적용된다 — 이미 예전에 "◎" 같은
  // 반복부호가 팀명으로 그대로 저장돼버린 기존 데이터(예: 최호)는 다시 업로드하지 않는 한
  // 안 고쳐진다. 그래서 데이터를 불러올 때마다 저장된 연차내역도 한 번 훑어서, 반복부호로
  // 보이는 팀명을 바로 위 재직자의 실제 팀명으로 바꿔준다.
  function normalizeDittoTeams(records) {
    let lastTeam = "";
    let changed = false;
    records.forEach((rec) => {
      if (isDittoLike(rec.team)) {
        if (lastTeam && rec.team !== lastTeam) {
          rec.team = lastTeam;
          changed = true;
        }
      } else {
        lastTeam = rec.team;
      }
    });
    return changed;
  }

  // 팀명이 연속으로 같은 값이면 rowSpan으로 한 칸에 병합한다(연차사용내역의 날짜 colspan
  // 병합과 같은 개념). 퇴사자는 재직자와 팀이 같아도 같은 칸으로 묶이면 안 되므로(이미
  // 팀 배치가 끝난 사람이라 별도로 구분돼야 함) 항상 병합 대상에서 제외하고 단독 칸으로 둔다.
  // 연차내역처럼 표 구조가 고정된 곳에서만 안전하다 — tbody에 토글 가능한 상세행이 섞여 있는
  // 표(복지포인트의 "사용내역")에는 쓰면 안 된다(아래 fakeTeamMerge 주석 참고).
  function mergeTeamRowspan(rows, records, teamValueFn, isResignedFn) {
    let i = 0;
    while (i < rows.length) {
      const cell = rows[i].children[0];
      const rec = records[i];
      if (!cell || !rec) { i++; continue; }
      const value = teamValueFn(rec);
      const resigned = isResignedFn(rec);
      let span = 1;
      if (value && !resigned) {
        while (
          i + span < rows.length &&
          records[i + span] &&
          teamValueFn(records[i + span]) === value &&
          !isResignedFn(records[i + span])
        ) {
          const nextCell = rows[i + span].children[0];
          if (nextCell) nextCell.remove();
          span++;
        }
      }
      if (span > 1) cell.rowSpan = span;
      i += span;
    }
  }

  // mergeTeamRowspan과 같은 목적(연속된 같은 팀명을 병합해 보이게 함)이지만, 실제 rowSpan을
  // 걸거나 셀을 지우지 않고 CSS로만 "병합된 것처럼" 보이게 한다. 복지포인트 표는 각 직원 행
  // 사이에 "사용내역" 클릭으로 열고 닫히는 상세행(숨김 상태로 시작)이 끼어있는데, 진짜
  // rowSpan을 쓰면 그 상세행을 펼치는 순간 표의 열 배치 계산이 rowSpan과 충돌해서 뒤따르는
  // 행들이 밀리는 오류가 있었다(예: 최윤주 상세를 열면 김다운 행이 팀명 칸으로 밀려 보임).
  // 행마다 자기 <td>를 그대로 유지하는 이 방식은 상세행이 열리고 닫혀도 표 구조에 영향이 없다.
  // rows[i]~rows[j] 그룹 전체 높이(사이에 펼쳐진 상세행이 있으면 그만큼 포함)의 정중앙에
  // 라벨(div.wf-team-merge-label)이 오도록 절대좌표로 배치한다. 상세행을 열고 닫아 그룹의
  // 실제 세로 길이가 바뀔 때마다 다시 불러야 하므로 groups를 클로저에 담아 반환한다.
  function makeTeamLabelRecompute(groups) {
    return function recompute() {
      groups.forEach(({ startRow, endRow, label }) => {
        if (!label || !startRow || !endRow || !startRow.isConnected) return;
        const top = startRow.getBoundingClientRect().top;
        const bottom = endRow.getBoundingClientRect().bottom;
        label.style.height = Math.max(0, bottom - top) + "px";
      });
    };
  }

  function fakeTeamMerge(rows, records, teamValueFn, isResignedFn) {
    const groups = [];
    let i = 0;
    while (i < rows.length) {
      const rec = records[i];
      const cell = rows[i] && rows[i].children[0];
      if (!cell || !rec) { i++; continue; }
      const value = teamValueFn(rec);
      const resigned = isResignedFn(rec);
      if (!value || resigned) { i++; continue; }
      let j = i;
      while (
        j + 1 < rows.length &&
        records[j + 1] &&
        teamValueFn(records[j + 1]) === value &&
        !isResignedFn(records[j + 1])
      ) {
        j++;
      }
      // i~j가 같은 팀명 그룹. border-collapse에서는 위 셀의 아래쪽 테두리가 남아있으면 그 줄이
      // 그대로 보이므로, 그룹 내부 경계는 위/아래 테두리를 둘 다 없애야 진짜 rowSpan 병합처럼
      // 끊김 없이 이어져 보인다(그룹의 맨 위/맨 아래 바깥쪽 테두리는 그대로 둔다).
      const firstCell = rows[i].children[0];
      for (let k = i; k <= j; k++) {
        const kCell = rows[k].children[0];
        if (!kCell) continue;
        kCell.textContent = "";
        kCell.classList.toggle("wf-team-merged", k > i);
        kCell.classList.toggle("wf-team-merge-bottom", k < j);
      }
      if (j === i) {
        firstCell.textContent = value;
      } else {
        // 여러 행 병합 — 실제 rowSpan처럼 그룹 전체 높이의 세로 정중앙에 라벨을 절대배치한다
        // (상세행이 끼어있어도 시작/끝 행의 실제 화면 위치로 계산하므로 자동으로 반영됨).
        firstCell.classList.add("wf-team-merge-host");
        const label = document.createElement("div");
        label.className = "wf-team-merge-label";
        label.textContent = value;
        firstCell.appendChild(label);
        groups.push({ startRow: rows[i], endRow: rows[j], label });
      }
      i = j + 1;
    }
    const recompute = makeTeamLabelRecompute(groups);
    recompute();
    // 폰트 로딩 등으로 다음 프레임에 실제 높이가 바뀌는 경우까지 한 번 더 보정
    if (groups.length) requestAnimationFrame(recompute);
    return recompute;
  }

  function loadLeaveForYear(year) {
    const key = leaveStorageKey(year);
    let stored = localStorage.getItem(key);
    // 마이그레이션: 연도별 키를 쓰기 전(예전) 데이터가 남아있으면 2026년 데이터로 그대로 가져온다
    if (!stored && year === 2026) {
      const legacy = localStorage.getItem(STORAGE_KEYS.leave);
      if (legacy) {
        stored = legacy;
        localStorage.setItem(key, legacy);
      }
    }
    let parsed = null;
    if (stored) {
      try { parsed = JSON.parse(stored); } catch { parsed = null; }
    }
    // 빈 배열이 저장돼 있어도(롤오버 기능 생기기 전에 빈 채로 저장된 연도) "아직 초기화 안 됨"으로
    // 보고 롤오버를 다시 시도한다 — 그래야 예전에 한 번 빈 채로 열어본 연도도 자동으로 채워진다.
    const hasRealData = Array.isArray(parsed) && parsed.length > 0;
    if (hasRealData) {
      data.leave = parsed;
    } else if (year === 2026) {
      data.leave = DEFAULT_LEAVE_DATA.map((d) => Object.assign(blankLeaveRecord(), d));
    } else {
      // 재직자 명단(팀명/성명/직급/입사일/근속년수)은 그대로 가져오고, 연차 사용내역/기준일수 등
      // 그 해에만 유효한 값은 blankLeaveRecord() 기본값(전부 초기화)을 그대로 쓴다.
      const roster = findPriorActiveRoster(year);
      data.leave = roster ? roster.map((r) => Object.assign(blankLeaveRecord(), rosterFields(r))) : [];
    }
    data.leave.forEach(recalcLeave);
    const dittoFixed = normalizeDittoTeams(data.leave);
    dedupeLeaveByName();
    if (!hasRealData || dittoFixed) saveLeave();
  }

  // 일회성 데이터 보정: 같은 이름의 연차내역 레코드가 실수로 중복 생성된 경우(예: 이름에
  // 공백이 잘못 들어간 "최 호"가 진짜 "최호"와 따로 남아있던 경우) 하나로 합친다. 실제 연차
  // 사용내역(usageSlots)이 있는 쪽을 "진짜" 레코드로 남기고, 없는 쪽에만 있던 값만 옮겨온 뒤
  // 나머지는 지운다.
  function dedupeLeaveByName() {
    const byName = new Map();
    const keep = [];
    let changed = false;
    data.leave.forEach((rec) => {
      const name = normName(rec.name);
      if (!name) { keep.push(rec); return; }
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, rec);
        keep.push(rec);
        return;
      }
      changed = true;
      const existingHasUsage = (existing.usageSlots || []).some((v) => v);
      const recHasUsage = (rec.usageSlots || []).some((v) => v);
      if (!existingHasUsage && recHasUsage) {
        const idx = keep.indexOf(existing);
        keep[idx] = rec;
        byName.set(name, rec);
      } else {
        ["team", "position", "hireDate", "tenure"].forEach((f) => {
          if (!existing[f] && rec[f]) existing[f] = rec[f];
        });
      }
    });
    if (changed) {
      data.leave = keep;
      saveLeave();
    }
  }

  // 장기근속/검진 완료 표시는 예전엔 "개인별지원사항"이라는 별도 시트에서 연도 구분 없이
  // 관리했다. 이제 복지포인트 표 안에 합쳐졌지만 한 번 "완료"로 표시된 값은 새해가 와도 그대로
  // 유지돼야 하므로(한 번 달성하면 계속 유효), 새 연도를 만들 때 이전 연도들의 복지포인트에서
  // 이름으로 찾아 이어받는다.
  //
  // ⚠ 예전엔 "가장 최근에 저장된 연도 하나만 보면 충분하다"고 보고 그 연도를 찾자마자 바로
  // return했는데, 이게 실제 버그의 원인이었다: 예를 들어 2027년이 (이 함수의 옛날 버전 때문에)
  // 이미 빈 값으로 저장돼있으면, 2028년을 계산할 때 "가장 최근 저장된 연도"인 2027년을 찾아서
  // 그 빈 값을 그대로 쓰고 멈춰버려서 2026년의 진짜 값까지는 절대 못 갔다 — 한 번 비면 그 뒤로
  // 영원히 빈 채로 이어지는 문제. 그래서 하나 찾았다고 멈추지 않고 2026년까지 전부 훑어서,
  // 각 항목은 "가장 최근에 채워진 값"을 쓰도록(연도가 최신일수록 먼저 처리되므로 이미 채워진
  // 칸은 안 덮어씀) 병합한다.
  function findPriorPointsMilestones(year) {
    const byName = new Map();
    for (let y = year - 1; y >= 2026; y--) {
      const stored = localStorage.getItem(pointsStorageKey(y));
      if (!stored) continue;
      let parsed;
      try { parsed = JSON.parse(stored); } catch { continue; }
      if (!Array.isArray(parsed) || !parsed.length) continue;
      parsed.forEach((r) => {
        // .trim()만으로는 "최 호"처럼 이름 중간에 공백이 낀 경우(복사/붙여넣기, 엑셀 셀 서식
        // 등으로 실제로 생김) "최호"와 다른 사람으로 취급돼 매칭이 안 된다 — normName으로
        // 중간 공백까지 다 제거하고 매칭해야 한다.
        const name = normName(r.name);
        if (!name) return;
        // 같은 이름의 레코드가 실수로 중복 생성된 경우(최호 사례, dedupePointsByName 주석 참고)
        // 뒤에 나온 빈 중복 레코드가 덮어써서 앞선 진짜 값을 지워버리면 안 되므로,
        // 이미 채워진 값이 있으면 유지하고 빈 칸만 새 레코드 값으로 채운다.
        const prev = byName.get(name) || { longService5: "", longService10: "", checkup41: "", parentCheckup: "" };
        byName.set(name, {
          longService5: prev.longService5 || r.longService5 || "",
          longService10: prev.longService10 || r.longService10 || "",
          checkup41: prev.checkup41 || r.checkup41 || "",
          parentCheckup: prev.parentCheckup || r.parentCheckup || "",
        });
      });
      // 여기서 return하지 않는다 — 계속 더 이전 연도로 내려가면서 아직 안 채워진 칸이 있으면
      // 마저 채운다(위 병합 로직이 이미 채워진 값은 안 덮어쓰므로 최신 연도 값이 항상 우선함).
    }
    return byName;
  }

  // "개인별지원사항" 탭이 따로 있던 시절 저장된 값이 남아있으면 이름으로 대조해서 복지포인트로
  // 옮겨온다(비어있는 칸만 채움 — 이미 값이 있으면 덮어쓰지 않음). 원본은 그대로 남겨둔다.
  function migrateLegacyIndividualIntoPoints() {
    const legacy = localStorage.getItem(STORAGE_KEYS.individual);
    if (!legacy) return;
    let records;
    try { records = JSON.parse(legacy); } catch { return; }
    if (!Array.isArray(records) || !records.length) return;
    const byName = new Map(records.map((r) => [r.name, r]));
    let changed = false;
    data.points.forEach((rec) => {
      const legacyRec = byName.get(rec.name);
      if (!legacyRec) return;
      ["longService5", "longService10", "checkup41", "parentCheckup"].forEach((f) => {
        if (!rec[f] && legacyRec[f]) { rec[f] = legacyRec[f]; changed = true; }
      });
    });
    if (changed) savePoints();
  }

  // 일회성 데이터 보정: 같은 이름의 복지포인트 레코드가 실수로 중복 생성된 경우(예: 최호가
  // 맨 아래에 하나 더 있음) 하나로 합친다. 먼저 나온 레코드를 남기고, 중복 레코드에만 있던
  // 값(지급포인트/사용내역/장기근속 등 — 먼저 나온 쪽이 비어있는 항목만)을 옮겨온 뒤 지운다.
  function dedupePointsByName() {
    const byName = new Map();
    const keep = [];
    let changed = false;
    data.points.forEach((rec) => {
      const name = normName(rec.name);
      if (!name) { keep.push(rec); return; }
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, rec);
        keep.push(rec);
        return;
      }
      changed = true;
      ["team", "position", "hireDate", "tenure"].forEach((f) => {
        if (!existing[f] && rec[f]) existing[f] = rec[f];
      });
      if (!existing.grantPoint && rec.grantPoint) existing.grantPoint = rec.grantPoint;
      if ((!existing.entries || !existing.entries.length) && rec.entries && rec.entries.length) {
        existing.entries = rec.entries;
      }
      ["longService5", "longService10", "checkup41", "parentCheckup"].forEach((f) => {
        if (!existing[f] && rec[f]) existing[f] = rec[f];
      });
    });
    if (changed) {
      data.points = keep;
      savePoints();
    }
  }

  // 일회성 데이터 보정: findPriorPointsMilestones가 예전엔 중복 레코드를 병합하지 않고
  // .set()으로 덮어쓰기만 해서, 이미 2027년 등으로 넘어가버린 사람(최호 사례)의 장기근속/검진
  // 완료 표시가 빈 채로 저장된 경우가 있다. 이미 만들어진 연도라도 다시 열 때마다 비어있는
  // 칸만 이전 연도 값으로 채워 넣는다(값이 있는 칸은 건드리지 않음).
  function backfillMissingMilestones(year) {
    const fields = ["longService5", "longService10", "checkup41", "parentCheckup"];
    if (!data.points.some((r) => fields.some((f) => !r[f]))) return;
    const milestones = findPriorPointsMilestones(year);
    let changed = false;
    data.points.forEach((rec) => {
      const name = normName(rec.name);
      if (!name) return;
      const m = milestones.get(name);
      if (!m) return;
      fields.forEach((f) => {
        if (!rec[f] && m[f]) {
          rec[f] = m[f];
          changed = true;
        }
      });
    });
    if (changed) savePoints();
  }

  // "완료표시 복구" 버튼용 — backfillMissingMilestones는 지금 보고 있는 연도 하나만 고치는데,
  // 개발자도구를 못 쓰는 사용자가 화면에서 바로 실행하고 결과를 눈으로 확인할 수 있도록,
  // localStorage에 저장된 모든 연도를 한 번에 훑어서 고치고 결과를 요약해 돌려준다.
  function repairAllYearsMilestones() {
    const prefix = STORAGE_KEYS.points + "_";
    const years = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf(prefix) === 0) {
        const y = parseInt(key.slice(prefix.length), 10);
        if (Number.isFinite(y)) years.push(y);
      }
    }
    years.sort((a, b) => a - b);
    const fields = ["longService5", "longService10", "checkup41", "parentCheckup"];
    const fixedDetails = [];
    years.forEach((y) => {
      const stored = localStorage.getItem(pointsStorageKey(y));
      if (!stored) return;
      let parsed;
      try { parsed = JSON.parse(stored); } catch { return; }
      if (!Array.isArray(parsed) || !parsed.length) return;
      const milestones = findPriorPointsMilestones(y);
      let changed = false;
      parsed.forEach((rec) => {
        const name = normName(rec.name);
        if (!name) return;
        const m = milestones.get(name);
        if (!m) return;
        fields.forEach((f) => {
          if (!rec[f] && m[f]) {
            rec[f] = m[f];
            changed = true;
            fixedDetails.push(`${y}년 ${rec.name} ${f}`);
          }
        });
      });
      if (changed) localStorage.setItem(pointsStorageKey(y), JSON.stringify(parsed));
    });
    return { years, fixedDetails };
  }

  // 일회성 데이터 보정: 예전 "+ 직원 추가"(현재는 삭제됨) 버튼으로 이름 없이 추가됐던
  // 복지포인트 레코드를 장성근(연차내역에는 있지만 복지포인트엔 매칭이 안 돼있던 사람)으로
  // 채워 넣는다. 한 번 채워지면 빈 이름 레코드가 없어지므로 그 다음부터는 아무 일도 안 한다.
  function fixOrphanBlankPointsRecord() {
    const blank = data.points.find((p) => !normName(p.name));
    if (!blank) return;
    const jang = data.leave.find((r) => normName(r.name) === "장성근");
    if (!jang) return;
    blank.team = jang.team;
    blank.name = jang.name;
    blank.position = jang.position;
    blank.hireDate = jang.hireDate;
    blank.tenure = jang.tenure;
    savePoints();
  }

  // syncAllPointsRoster(아래)는 "이름이 이미 양쪽에 다 있는" 사람만 맞춰준다 — 연차내역에는
  // 있는데 복지포인트 레코드 자체가 아예 없던 사람(예: "+ 직원 추가" 기능이 생기기 전에 연차
  // 쪽에만 입력됐던 직원)은 그 함수로는 못 잡는다. 그런 사람을 찾아서 복지포인트에 새로 만들어준다
  // (rosterFields는 연도 넘어갈 때 근속연수를 +1 하므로 같은 해 안에서 채워 넣을 땐 쓰지 않는다).
  function ensurePointsRecordsForAllLeave() {
    let changed = false;
    data.leave.forEach((lv) => {
      const lvName = normName(lv.name);
      if (!lvName) return;
      if (data.points.some((p) => normName(p.name) === lvName)) return;
      const rec = Object.assign(blankPointsRecord(), {
        team: lv.team, name: lv.name, position: lv.position, hireDate: lv.hireDate, tenure: lv.tenure,
      });
      data.points.push(rec);
      changed = true;
    });
    if (changed) savePoints();
  }

  function loadPointsForYear(year) {
    const key = pointsStorageKey(year);
    let stored = localStorage.getItem(key);
    if (!stored && year === 2026) {
      const legacy = localStorage.getItem(STORAGE_KEYS.points);
      if (legacy) {
        stored = legacy;
        localStorage.setItem(key, legacy);
      }
    }
    let parsed = null;
    if (stored) {
      try { parsed = JSON.parse(stored); } catch { parsed = null; }
    }
    const hasRealData = Array.isArray(parsed) && parsed.length > 0;
    if (hasRealData) {
      data.points = parsed;
    } else if (year === 2026) {
      data.points = [];
    } else {
      // 복지포인트도 연차내역과 같은 재직자 명단을 따라가되, 지급포인트/사용내역은 새해라 초기화한다.
      const roster = findPriorActiveRoster(year);
      const milestones = findPriorPointsMilestones(year);
      data.points = roster ? roster.map((r) => {
        const rec = Object.assign(blankPointsRecord(), rosterFields(r));
        const m = milestones.get(r.name);
        if (m) Object.assign(rec, m);
        return rec;
      }) : [];
    }
    migrateLegacyIndividualIntoPoints();
    fixOrphanBlankPointsRecord();
    ensurePointsRecordsForAllLeave();
    dedupePointsByName();
    if (hasRealData) backfillMissingMilestones(year);
    data.points.forEach(recalcPoints);
    if (!hasRealData) savePoints();
  }

  function loadFromStorage() {
    try {
      // 마지막으로 보던 연도를 기억하지 않고, 다시 접속할 때마다 항상 2026년 기준으로 연다.
      currentYear = 2026;
      loadLeaveForYear(currentYear);
      loadPointsForYear(currentYear);
      syncAllPointsRoster();
    } catch (e) {
      console.error(e);
    }
  }

  function saveLeave() { localStorage.setItem(leaveStorageKey(currentYear), JSON.stringify(data.leave)); }
  function savePoints() { localStorage.setItem(pointsStorageKey(currentYear), JSON.stringify(data.points)); }
  function saveYear(y) { currentYear = y; localStorage.setItem(STORAGE_KEYS.year, String(y)); }

  // ── 업로드 파일 파싱 (SheetJS) ──────────────────────────
  // 원본 파일은 헤더가 3~4줄에 걸쳐 병합되어 있고, 우리 다운로드 파일은 헤더가 1줄이라
  // "성명" 헤더가 있는 행을 찾아 그 다음줄부터를 데이터로 취급해 두 형식 모두 대응한다.
  function sheetRows(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  }

  // "성명" 헤더 행을 찾은 뒤, 그 아래로 실제 "성명" 값이 채워진 첫 행을 데이터 시작으로 본다.
  // (연차내역 시트는 "성명" 헤더 행 바로 다음에 날짜 슬롯 하위헤더 행이 하나 더 있어
  //  단순히 +1행을 데이터 시작으로 보면 안 된다)
  function findDataStart(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      if (String(rows[i][1] || "").trim() === "성명") {
        for (let j = i + 1; j < rows.length; j++) {
          if (String(rows[j][1] || "").trim() !== "") return j;
        }
        return i + 1;
      }
    }
    return 0;
  }

  function parseLeaveSheet(ws) {
    const rows = sheetRows(ws);
    const start = findDataStart(rows);
    const out = [];
    let lastTeam = "";
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[1] || "").trim();
      if (!name) continue;
      const team = String(r[0] || "").trim();
      if (!isDittoLike(team)) lastTeam = team;
      const usageSlots = [];
      for (let c = 0; c < LEAVE_SLOT_COUNT; c++) usageSlots.push(String(r[5 + c] || "").trim());
      const rec = {
        _id: newId(), team: isDittoLike(team) ? lastTeam : team, name, position: String(r[2] || "").trim(),
        hireDate: String(r[3] || "").trim(), tenure: String(r[4] || "").trim(),
        usageSlots,
        baseline: parseNum(r[30]),
        longService: parseNum(r[33]), reserve: parseNum(r[34]), family: parseNum(r[35]),
        wedding: parseNum(r[36]), maternity: parseNum(r[37]), etc: parseNum(r[38]),
        note: String(r[40] || "").trim(),
      };
      recalcLeave(rec);
      out.push(rec);
    }
    return out;
  }

  // 복지포인트 시트는 이제 사용내역을 요약 텍스트로만 담아서(상세 건별 금액/내역/지급일 없음),
  // 다시 불러올 때 entries는 복원할 수 없다 — 지급포인트/잔여한도/장기근속 등 나머지 값만
  // 정확히 읽어온다(사용내역 상세는 애초에 필요 없다는 요청에 따른 것).
  function parsePointsSheet(ws) {
    const rows = sheetRows(ws);
    const start = findDataStart(rows);
    const out = [];
    let lastTeam = "";
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[1] || "").trim();
      if (!name) continue;
      const team = String(r[0] || "").trim();
      if (!isDittoLike(team)) lastTeam = team;
      const rec = {
        _id: newId(), team: isDittoLike(team) ? lastTeam : team, name, position: String(r[2] || "").trim(),
        hireDate: String(r[3] || "").trim(), tenure: String(r[4] || "").trim(),
        grantPoint: parseNum(r[5]), entries: [],
        longService5: String(r[8] || "").trim(), longService10: String(r[9] || "").trim(),
        checkup41: String(r[10] || "").trim(), parentCheckup: String(r[11] || "").trim(),
      };
      recalcPoints(rec);
      out.push(rec);
    }
    return out;
  }

  function parseWorkbookToData(wb) {
    const result = {};
    if (wb.SheetNames.includes("연차내역")) result.leave = parseLeaveSheet(wb.Sheets["연차내역"]);
    if (wb.SheetNames.includes("복지포인트 내역")) result.points = parsePointsSheet(wb.Sheets["복지포인트 내역"]);
    return result;
  }

  // ── 다운로드용 워크북 생성 (ExcelJS) ────────────────────
  // 복지포인트 내역/개인별지원사항 시트는 헤더를 한 줄로 펼쳐서 표기하지만,
  // 연차내역 시트는 원본 엑셀 서식(제목/그룹헤더/색상)을 그대로 재현한다.
  const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
  const THIN = { style: "thin" };
  const BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  const HEADER_FONT = { name: "맑은 고딕", size: 10, bold: true };
  const DATA_FONT = { name: "맑은 고딕", size: 10 };

  // 연차내역 시트 전용 색상 — 실제 연차관리 엑셀 서식 색상을 그대로 재현
  const LEAVE_PINK_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF99CC" } };
  const LEAVE_GREEN_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8E4BC" } };
  const LEAVE_GRAY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  const LEAVE_YELLOW_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFCC" } };
  const LEAVE_PALE_YELLOW_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFCE6" } };
  const LEAVE_SALMON_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCCCC" } };

  // 복지포인트 내역 시트 색상 — 인덱스 페이지의 wf-points-green/wf-points-sky와 동일한 색
  const POINTS_GREEN_FILL = LEAVE_GREEN_FILL; // #d8e4bc, 인덱스와 동일 색
  const POINTS_SKY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE8F5" } };

  // 인덱스 페이지의 mergeTeamRowspan/fakeTeamMerge와 같은 목적 — 팀명이 연속으로 같은
  // 데이터 행은 엑셀에서도 한 칸으로 병합한다(1열 = 팀명). 퇴사자는 팀이 같아도 재직자와
  // 묶이면 안 되므로 병합 대상에서 제외하고 항상 단독 칸으로 둔다.
  function mergeConsecutiveTeamCells(ws, rows, records, teamValueFn, isResignedFn) {
    let i = 0;
    while (i < rows.length) {
      const rec = records[i];
      if (!rec) { i++; continue; }
      const value = teamValueFn(rec);
      const resigned = isResignedFn(rec);
      if (!value || resigned) { i++; continue; }
      let j = i;
      while (
        j + 1 < rows.length &&
        records[j + 1] &&
        teamValueFn(records[j + 1]) === value &&
        !isResignedFn(records[j + 1])
      ) {
        j++;
      }
      if (j > i) {
        ws.mergeCells(rows[i].number, 1, rows[j].number, 1);
        for (let k = i + 1; k <= j; k++) rows[k].getCell(1).value = "";
      }
      i = j + 1;
    }
  }

  function writeHeaderRow(ws, headers) {
    const row = ws.addRow(headers);
    row.eachCell((cell) => {
      cell.font = HEADER_FONT;
      cell.fill = HEADER_FILL;
      cell.border = BORDERS;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    row.height = 24;
  }

  function writeDataRow(ws, values) {
    const row = ws.addRow(values);
    row.eachCell((cell) => {
      cell.font = DATA_FONT;
      cell.border = BORDERS;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    return row;
  }

  // ws.columns 는 ExcelJS 버전/환경에 따라 addRow 이후에도 null일 수 있어(브라우저 번들 vs npm 패키지
  // 동작 차이 확인됨), getColumn()으로 직접 폭을 지정한다.
  function setColumnWidths(ws, count, widthFn) {
    for (let i = 0; i < count; i++) ws.getColumn(i + 1).width = widthFn(i);
  }

  // 연차내역 시트는 다른 시트와 달리 컬럼별로 색상이 다른(핑크/연두/회색) 실제 서식을
  // 그대로 재현해야 해서, 공용 writeHeaderRow 대신 컬럼 구간별로 직접 스타일을 지정한다.
  function styleLeaveHeaderRange(row, colStart, colEnd, fill) {
    for (let c = colStart; c <= colEnd; c++) {
      const cell = row.getCell(c);
      cell.font = HEADER_FONT;
      if (fill) cell.fill = fill;
      cell.border = BORDERS;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    }
  }

  function addLeaveSheet(wb, leaveData) {
    const ws = wb.addWorksheet("연차내역");
    // 팀명~근속년수(5) + 사용내역 날짜 슬롯(LEAVE_SLOT_COUNT) + 기준/사용/잔여(3)
    // + 10주년 장기근속~기타휴가(6) + 연간합계(1) + 비고(1)
    const USAGE_START = 6;
    const USAGE_END = USAGE_START + LEAVE_SLOT_COUNT - 1;
    const BASELINE_COL = USAGE_END + 1;
    const USED_COL = BASELINE_COL + 1;
    const REMAIN_COL = BASELINE_COL + 2;
    const LONG_SERVICE_COL = REMAIN_COL + 1;
    const RESERVE_COL = LONG_SERVICE_COL + 1;
    const FAMILY_COL = LONG_SERVICE_COL + 2;
    const WEDDING_COL = LONG_SERVICE_COL + 3;
    const MATERNITY_COL = LONG_SERVICE_COL + 4;
    const ETC_COL = LONG_SERVICE_COL + 5;
    const YEAR_TOTAL_COL = ETC_COL + 1;
    const NOTE_COL = YEAR_TOTAL_COL + 1;
    const TOTAL_COLS = NOTE_COL;

    const titleRow = ws.addRow([]);
    titleRow.getCell(1).value = `${currentYear}년 휴가내역 관리\n13년도 이전입사자는 홀수년도에 1일추가`;
    ws.mergeCells(1, 1, 1, TOTAL_COLS);
    titleRow.getCell(1).font = { name: "맑은 고딕", size: 10, bold: true };
    titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    titleRow.height = 34;

    const groupRow = ws.addRow([]);
    groupRow.getCell(1).value = "직원리스트";
    groupRow.getCell(USAGE_START).value = "정기휴가";
    groupRow.getCell(LONG_SERVICE_COL).value = "비정기휴가";
    ws.mergeCells(2, 1, 2, 5);
    ws.mergeCells(2, USAGE_START, 2, REMAIN_COL);
    ws.mergeCells(2, LONG_SERVICE_COL, 2, YEAR_TOTAL_COL);
    [[1, 5], [USAGE_START, REMAIN_COL], [LONG_SERVICE_COL, YEAR_TOTAL_COL]].forEach(([s, e]) => {
      for (let c = s; c <= e; c++) {
        const cell = groupRow.getCell(c);
        cell.font = { name: "맑은 고딕", size: 10, bold: true };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = { bottom: THIN };
      }
    });

    const subRow = ws.addRow([]);
    const labelRow = ws.addRow([]);
    subRow.getCell(1).value = "팀명";
    subRow.getCell(2).value = "성명";
    subRow.getCell(3).value = "직급";
    subRow.getCell(4).value = "입사일";
    subRow.getCell(5).value = "근속 연수";
    subRow.getCell(USAGE_START).value = "연차사용내역";
    subRow.getCell(BASELINE_COL).value = "정기휴가 합계";
    subRow.getCell(LONG_SERVICE_COL).value = "10주년 장기근속(5일)";
    subRow.getCell(RESERVE_COL).value = "예비군 민방위";
    subRow.getCell(FAMILY_COL).value = "경조";
    subRow.getCell(WEDDING_COL).value = "결혼";
    subRow.getCell(MATERNITY_COL).value = "출산";
    subRow.getCell(ETC_COL).value = "기타";
    subRow.getCell(YEAR_TOTAL_COL).value = "연간합계";
    subRow.getCell(NOTE_COL).value = "비고";

    // 날짜 슬롯 헤더는 번호를 매기지 않고 빈 칸으로 둔다(실제 사용 날짜만 셀에 기재)
    labelRow.getCell(BASELINE_COL).value = "기준";
    labelRow.getCell(USED_COL).value = "사용";
    labelRow.getCell(REMAIN_COL).value = "잔여";

    ws.mergeCells(3, 1, 4, 1);
    ws.mergeCells(3, 2, 4, 2);
    ws.mergeCells(3, 3, 4, 3);
    ws.mergeCells(3, 4, 4, 4);
    ws.mergeCells(3, 5, 4, 5);
    ws.mergeCells(3, USAGE_START, 3, USAGE_END);
    ws.mergeCells(3, BASELINE_COL, 3, REMAIN_COL);
    ws.mergeCells(3, LONG_SERVICE_COL, 4, LONG_SERVICE_COL);
    ws.mergeCells(3, RESERVE_COL, 4, RESERVE_COL);
    ws.mergeCells(3, FAMILY_COL, 4, FAMILY_COL);
    ws.mergeCells(3, WEDDING_COL, 4, WEDDING_COL);
    ws.mergeCells(3, MATERNITY_COL, 4, MATERNITY_COL);
    ws.mergeCells(3, ETC_COL, 4, ETC_COL);
    ws.mergeCells(3, YEAR_TOTAL_COL, 4, YEAR_TOTAL_COL);
    ws.mergeCells(3, NOTE_COL, 4, NOTE_COL);

    styleLeaveHeaderRange(subRow, 1, USAGE_END, LEAVE_PINK_FILL);
    styleLeaveHeaderRange(labelRow, 1, USAGE_END, LEAVE_PINK_FILL);
    styleLeaveHeaderRange(subRow, BASELINE_COL, REMAIN_COL, LEAVE_GREEN_FILL);
    styleLeaveHeaderRange(labelRow, BASELINE_COL, REMAIN_COL, LEAVE_GREEN_FILL);
    styleLeaveHeaderRange(subRow, LONG_SERVICE_COL, LONG_SERVICE_COL, LEAVE_GRAY_FILL);
    styleLeaveHeaderRange(labelRow, LONG_SERVICE_COL, LONG_SERVICE_COL, LEAVE_GRAY_FILL);
    styleLeaveHeaderRange(subRow, RESERVE_COL, ETC_COL, LEAVE_PINK_FILL);
    styleLeaveHeaderRange(labelRow, RESERVE_COL, ETC_COL, LEAVE_PINK_FILL);
    styleLeaveHeaderRange(subRow, YEAR_TOTAL_COL, YEAR_TOTAL_COL, LEAVE_GREEN_FILL);
    styleLeaveHeaderRange(labelRow, YEAR_TOTAL_COL, YEAR_TOTAL_COL, LEAVE_GREEN_FILL);
    styleLeaveHeaderRange(subRow, NOTE_COL, NOTE_COL, null);
    styleLeaveHeaderRange(labelRow, NOTE_COL, NOTE_COL, null);
    subRow.height = 20;
    labelRow.height = 20;

    const dataRows = leaveData.map((rec) => {
      const slots = [];
      for (let i = 0; i < LEAVE_SLOT_COUNT; i++) slots.push(rec.usageSlots[i] || "");
      const row = writeDataRow(ws, [
        rec.team, rec.name, rec.position, rec.hireDate, rec.tenure,
        ...slots,
        rec.baseline || "", rec.used || "", rec.remaining || "",
        rec.longService || "", rec.reserve || "", rec.family || "", rec.wedding || "", rec.maternity || "", rec.etc || "",
        rec.yearTotal || "", rec.note || "",
      ]);
      row.getCell(USED_COL).fill = LEAVE_YELLOW_FILL;
      row.getCell(REMAIN_COL).fill = LEAVE_SALMON_FILL;
      row.getCell(LONG_SERVICE_COL).fill = LEAVE_GRAY_FILL;
      row.getCell(YEAR_TOTAL_COL).fill = LEAVE_YELLOW_FILL;

      // 연차사용내역 배경색 — 인덱스 페이지(웹 화면)와 동일하게: 1~15칸 연노랑, 16~25칸 노랑
      for (let i = 0; i < LEAVE_SLOT_COUNT; i++) {
        row.getCell(USAGE_START + i).fill = i < 15 ? LEAVE_PALE_YELLOW_FILL : LEAVE_YELLOW_FILL;
      }

      // 퇴사자는 인덱스 페이지와 동일하게 행 전체를 회색으로 덮는다(컬럼별 색상보다 우선)
      if (rec.resignDate) {
        for (let c = 1; c <= TOTAL_COLS; c++) row.getCell(c).fill = LEAVE_GRAY_FILL;
      }
      return row;
    });
    // 인덱스 페이지(mergeTeamRowspan)처럼 팀명이 연속으로 같으면 한 칸으로 병합한다.
    // 퇴사자는 재직자와 팀이 같아도 같은 칸으로 묶이지 않도록 병합 대상에서 제외한다.
    mergeConsecutiveTeamCells(ws, dataRows, leaveData, (r) => (r.team || "").trim(), (r) => !!r.resignDate);

    setColumnWidths(ws, TOTAL_COLS, (i) => {
      const col = i + 1;
      if (col === 1) return 8; // 팀명
      if (col === 2 || col === 3) return 6; // 성명/직급
      if (col === 4) return 9; // 입사일
      if (col === 5) return 5; // 근속 연수
      if (col <= USAGE_END) return 4; // 연차사용내역(날짜)
      if (col <= REMAIN_COL) return 5; // 기준/사용/잔여
      if (col === NOTE_COL) return 14; // 비고
      return 8; // 10주년 장기근속~연간합계
    });
  }

  // 인덱스 페이지의 복지포인트 표와 똑같은 순서/그룹/색으로 시트를 만든다(팀명~근속연수는
  // 분홍, 지급포인트~잔여한도는 초록 "복지포인트" 그룹, 장기근속~부모님검진은 하늘색
  // "개인별복지사항" 그룹). 사용내역은 인덱스 화면처럼 "N건 (합계 W원)" 요약만 적고, 건별
  // 상세(금액/내역/지급일)는 필요 없다는 요청에 따라 시트에는 담지 않는다.
  function addPointsSheet(wb, pointsData) {
    const ws = wb.addWorksheet("복지포인트 내역");
    const TOTAL_COLS = 12;

    // 팀명~근속연수는 세로로 2행 병합되므로(엑셀 병합 셀은 값이 맨 위 칸에 있어야 표시된다)
    // 값을 groupRow(1행)에 적는다. "복지포인트"/"개인별복지사항"은 가로로 병합된 그룹 제목.
    const groupRow = ws.addRow([]);
    groupRow.getCell(1).value = "팀명";
    groupRow.getCell(2).value = "성명";
    groupRow.getCell(3).value = "직급";
    groupRow.getCell(4).value = "입사일";
    groupRow.getCell(5).value = "근속 연수";
    groupRow.getCell(6).value = "복지포인트";
    groupRow.getCell(9).value = "개인별복지사항";
    ws.mergeCells(1, 1, 2, 1);
    ws.mergeCells(1, 2, 2, 2);
    ws.mergeCells(1, 3, 2, 3);
    ws.mergeCells(1, 4, 2, 4);
    ws.mergeCells(1, 5, 2, 5);
    ws.mergeCells(1, 6, 1, 8);
    ws.mergeCells(1, 9, 1, 12);
    styleLeaveHeaderRange(groupRow, 1, 5, LEAVE_PINK_FILL);
    styleLeaveHeaderRange(groupRow, 6, 8, POINTS_GREEN_FILL);
    styleLeaveHeaderRange(groupRow, 9, 12, POINTS_SKY_FILL);

    const subRow = ws.addRow([]);
    subRow.getCell(6).value = "지급포인트";
    subRow.getCell(7).value = "사용내역";
    subRow.getCell(8).value = "잔여한도";
    subRow.getCell(9).value = "장기근속(5주년)";
    subRow.getCell(10).value = "장기근속(10주년)";
    subRow.getCell(11).value = "41세검진";
    subRow.getCell(12).value = "부모님검진";
    styleLeaveHeaderRange(subRow, 1, 5, LEAVE_PINK_FILL); // 병합된 칸이라 안 보이지만 테두리/채우기를 맞춰둔다
    styleLeaveHeaderRange(subRow, 6, 8, POINTS_GREEN_FILL);
    styleLeaveHeaderRange(subRow, 9, 12, POINTS_SKY_FILL);
    [groupRow, subRow].forEach((row) => { row.height = 20; });

    const dataRows = pointsData.map((rec) => writeDataRow(ws, [
      rec.team, rec.name, rec.position, rec.hireDate, rec.tenure,
      rec.grantPoint || "", pointsSummaryText(rec), rec.remainingLimit || "",
      rec.longService5 || "", rec.longService10 || "", rec.checkup41 || "", rec.parentCheckup || "",
    ]));
    mergeConsecutiveTeamCells(ws, dataRows, pointsData, (r) => (r.team || "").trim(), (r) => isResignedName(r.name));
    setColumnWidths(ws, TOTAL_COLS, (i) => (i < 5 ? 12 : i === 6 ? 20 : 14));
  }

  async function buildWorkbook(d) {
    const wb = new ExcelJS.Workbook();
    addLeaveSheet(wb, d.leave);
    addPointsSheet(wb, d.points);
    return wb;
  }

  // ── DOM 렌더링 ──────────────────────────────────────────
  function textCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.addEventListener("change", () => onChange(input.value.trim()));
    td.appendChild(input);
    return td;
  }

  // readonlyCell과 같지만, 연차내역의 팀명~근속 연수 칸과 폭/폰트 크기를 맞추는 클래스
  // (wf-roster-col + 필드별 클래스)를 붙인다. 복지포인트 내역의 팀명~근속연수 칸에서 사용
  // — 이 값들은 연차내역이 기준이라(syncPointsRoster) 복지포인트 쪽에서는 읽기전용이다.
  function rosterReadonlyCell(fieldClass, value) {
    const td = readonlyCell(value || "");
    td.classList.add("wf-roster-col", fieldClass);
    return td;
  }

  // textCell과 같지만, 값이 "완료"거나 "2026 완료"처럼 앞에 연도가 붙은 "OO 완료" 형태면
  // 칸 배경을 회색으로, 완료가 아니면서 값에 올해 연도(currentYear)가 들어있으면(예: "2026 해당")
  // 노란색으로 표시한다(개인별지원사항의 완료 여부 칸용). 완료 표기가 우선한다.
  function completionCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    // 기본은 흰 칸. "완료"로 끝나면 회색(한 번 완료되면 연도가 바뀌어도 계속 회색으로 유지—
    // "완료" 여부만 보고 연도는 안 따지므로 자동으로 그렇게 된다). 완료가 아니면서 값에 올해
    // 연도가 들어있으면(예: "2027 해당") 노란색 — 아직 완료 전이지만 올 해가 마감 시한임을
    // 표시. 완료 전이고 올해 연도도 아니면(연도가 아직 안 왔거나 값이 아예 없으면) 흰 칸.
    function refreshBg() {
      const v = input.value.trim();
      if (/완료$/.test(v)) {
        td.style.background = "#d9d9d9";
      } else if (v.includes(String(currentYear))) {
        td.style.background = "#fef3c7";
      } else {
        // 빈 배경("")으로 두면, 잔여한도 0원이라 행 전체가 회색(tr.style.background)인 경우
        // 이 칸에 그 회색이 그대로 비쳐 보인다(칸 자신의 배경이 없으면 표 배경 규칙상 행
        // 배경이 통과됨) — 완료 전 칸은 항상 흰색이어야 하므로 명시적으로 흰색을 지정한다.
        td.style.background = "#fff";
      }
    }
    refreshBg();
    input.addEventListener("change", () => {
      onChange(input.value.trim());
      refreshBg();
    });
    td.appendChild(input);
    return td;
  }

  function numCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || 0;
    input.addEventListener("change", () => onChange(parseNum(input.value)));
    td.appendChild(input);
    return td;
  }

  // numCell과 같지만 "1,000원"처럼 콤마+원 단위로 표기한다(복지포인트의 지급포인트/사용내역
  // 금액 칸용). 편집 중에도 그대로 콤마+원이 보이는데, parseNum이 숫자 아닌 글자를 다 걸러내고
  // 읽으므로 편집에는 문제없다.
  function moneyCell(value, onChange) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.style.textAlign = "right";
    input.value = formatWon(value);
    input.addEventListener("change", () => {
      const n = parseNum(input.value);
      onChange(n);
      input.value = formatWon(n);
    });
    td.appendChild(input);
    return td;
  }

  function readonlyCell(text) {
    const td = document.createElement("td");
    td.className = "wf-readonly";
    td.textContent = text;
    return td;
  }

  function pointsSummaryText(rec) {
    const sum = (rec.entries || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    return `${(rec.entries || []).length}건 (합계 ${formatWon(sum)})`;
  }

  const POINTS_TABLE_COL_COUNT = 12;
  const ROSTER_COL_COUNT = 5; // 팀명/성명/직급/입사일/근속연수
  const INDIVIDUAL_COL_COUNT = 4; // 장기근속(5주년)/장기근속(10주년)/41세검진/부모님검진

  // 정렬된(날짜순) usageSlots를 하루 간격으로 붙어있는(연이은) 구간별로 묶는다.
  // 예: ["1/1","1/2","1/5"] → [["1/1","1/2"], ["1/5"]] — usageSlots는 recalcLeave에서
  // 이미 날짜순으로 정렬되므로, 연이은 날짜는 항상 배열에서도 서로 붙어있게 된다.
  // 주말/공휴일(카운트 안 되는 날짜)은 앞뒤 날짜와 절대 합쳐지지 않고 항상 단독 칸으로 둔다 —
  // 그래야 "7/31~8/5"처럼 사용일수에 안 들어가는 주말까지 병합된 것처럼 보이지 않는다.
  function groupConsecutiveRuns(sortedUsageSlots) {
    const DAY = 24 * 60 * 60 * 1000;
    const groups = [];
    sortedUsageSlots.forEach((date) => {
      const t = parseSlotDate(date);
      const countable = isCountableUsageDate(date);
      const last = groups[groups.length - 1];
      const canJoin = countable && last && last.countable && t !== null && last.lastT !== null && t - last.lastT === DAY;
      if (canJoin) {
        last.dates.push(date);
        last.lastT = t;
      } else {
        groups.push({ dates: [date], lastT: t, countable });
      }
    });
    return groups.map((g) => g.dates);
  }

  // "1/1~1/5" 범위를 주말(토/일)을 뺀 평일 날짜 배열로 펼친다(연도는 기준연도 기준).
  function expandWeekdayRange(startStr, endStr) {
    const sm = String(startStr).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    const em = String(endStr).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!sm || !em) return null;
    let cur = new Date(currentYear, Number(sm[1]) - 1, Number(sm[2]));
    const end = new Date(currentYear, Number(em[1]) - 1, Number(em[2]));
    if (end < cur) return null;
    const out = [];
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) out.push(`${cur.getMonth() + 1}/${cur.getDate()}`);
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    return out;
  }

  // 칸에 입력한 텍스트를 날짜 배열로 해석: "1/1~1/5"(범위, 주말 제외) 또는 "6/1"(단일 날짜)
  function parseUsageInput(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return [];
    const rangeMatch = trimmed.match(/^(\d{1,2}\/\d{1,2})\s*~\s*(\d{1,2}\/\d{1,2})$/);
    if (rangeMatch) return expandWeekdayRange(rangeMatch[1], rangeMatch[2]) || [];
    return parseSlotDate(trimmed) !== null ? [trimmed] : [];
  }

  function appendLeaveRow(tbody, rec, rerenderAll) {
    const tr = document.createElement("tr");

    const leaveTeamTd = textCell(rec.team, (v) => { rec.team = v; saveLeave(); syncPointsRoster(rec); rerenderAll(); });
    leaveTeamTd.classList.add("wf-roster-col", "wf-roster-team");
    tr.appendChild(leaveTeamTd);
    const leaveNameTd = textCell(rec.name, (v) => {
      const oldName = rec.name;
      rec.name = v;
      saveLeave();
      syncPointsRoster(rec, oldName);
      rerenderAll();
    });
    leaveNameTd.classList.add("wf-roster-col", "wf-roster-name");
    tr.appendChild(leaveNameTd);
    const leavePositionTd = textCell(rec.position, (v) => { rec.position = v; saveLeave(); syncPointsRoster(rec); rerenderAll(); });
    leavePositionTd.classList.add("wf-roster-col", "wf-roster-position");
    tr.appendChild(leavePositionTd);
    const leaveHireTd = textCell(rec.hireDate, (v) => { rec.hireDate = v; saveLeave(); syncPointsRoster(rec); rerenderAll(); });
    leaveHireTd.classList.add("wf-roster-col", "wf-roster-hire");
    tr.appendChild(leaveHireTd);
    const leaveTenureTd = textCell(rec.tenure, (v) => { rec.tenure = v; saveLeave(); syncPointsRoster(rec); rerenderAll(); });
    leaveTenureTd.classList.add("wf-roster-col", "wf-roster-tenure");
    tr.appendChild(leaveTenureTd);

    const onFieldChange = (field) => (v) => { rec[field] = v; recalcLeave(rec); refs.refresh(); saveLeave(); };

    // 연이은 날짜는 colspan으로 한 칸에 "1/1~1/5"처럼 병합해서 보여준다. 편집으로 그룹 구성이
    // 바뀔 수 있어(날짜 추가/삭제/재배치) 이 부분은 부분 갱신 대신 표 전체를 다시 그린다.
    function usageGroupCell(dates) {
      const td = document.createElement("td");
      td.className = "wf-usage-cell";
      td.colSpan = dates.length;
      const input = document.createElement("input");
      input.type = "text";
      input.value = dates.length > 1 ? `${dates[0]}~${dates[dates.length - 1]}` : dates[0];
      input.addEventListener("change", () => {
        const newDates = parseUsageInput(input.value);
        const removeSet = new Set(dates);
        rec.usageSlots = rec.usageSlots.filter((d) => !removeSet.has(d));
        rec.usageSlots.push(...newDates);
        recalcLeave(rec);
        saveLeave();
        rerenderAll();
      });
      td.appendChild(input);
      return td;
    }

    function usageEmptyCell() {
      const td = document.createElement("td");
      td.className = "wf-usage-cell";
      const input = document.createElement("input");
      input.type = "text";
      input.addEventListener("change", () => {
        const newDates = parseUsageInput(input.value);
        if (!newDates.length) return;
        rec.usageSlots.push(...newDates);
        recalcLeave(rec);
        saveLeave();
        rerenderAll();
      });
      td.appendChild(input);
      return td;
    }

    const groups = groupConsecutiveRuns(rec.usageSlots);
    groups.forEach((dates) => tr.appendChild(usageGroupCell(dates)));
    for (let i = rec.usageSlots.length; i < LEAVE_SLOT_COUNT; i++) tr.appendChild(usageEmptyCell());

    const baselineTd = numCell(rec.baseline, onFieldChange("baseline"));
    baselineTd.classList.add("wf-col-baseline");
    tr.appendChild(baselineTd);
    const usedTd = readonlyCell(rec.used);
    usedTd.classList.add("wf-col-used");
    tr.appendChild(usedTd);
    const remainTd = readonlyCell(rec.remaining);
    remainTd.classList.add("wf-col-remaining");
    tr.appendChild(remainTd);

    ["longService", "reserve", "family", "wedding", "maternity", "etc"].forEach((field) => {
      const cell = numCell(rec[field], onFieldChange(field));
      cell.classList.add(`wf-col-${field}`);
      tr.appendChild(cell);
    });

    const yearTotalTd = readonlyCell(rec.yearTotal);
    yearTotalTd.classList.add("wf-col-yeartotal");
    tr.appendChild(yearTotalTd);
    tr.appendChild(textCell(rec.note, (v) => { rec.note = v; saveLeave(); }));

    if (rec.resignDate) tr.classList.add("wf-resigned-row");

    const delTd = document.createElement("td");
    delTd.style.whiteSpace = "nowrap";
    const resignBtn = document.createElement("button");
    resignBtn.className = "wf-resign-btn" + (rec.resignDate ? " wf-resign-btn-restore" : "");
    resignBtn.textContent = rec.resignDate ? "복귀" : "퇴사";
    resignBtn.style.marginRight = "6px";
    delTd.appendChild(resignBtn);
    const delBtn = document.createElement("button");
    delBtn.className = "wf-del-btn";
    delBtn.textContent = "삭제";
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    const refs = {
      refresh() {
        usedTd.textContent = rec.used;
        remainTd.textContent = rec.remaining;
        yearTotalTd.textContent = rec.yearTotal;
      },
    };

    resignBtn.addEventListener("click", () => {
      if (rec.resignDate) {
        rec.resignDate = "";
      } else {
        const input = prompt(`${rec.name || "선택한"} 직원의 퇴사일을 입력해주세요 (예: 26-07-29)`, "");
        if (input === null) return; // 취소
        rec.resignDate = input.trim() || "미상";
      }
      saveLeave();
      rerenderAll();
    });

    delBtn.addEventListener("click", () => {
      if (!confirm(`${rec.name || "선택한"} 직원 데이터를 삭제할까요? (복지포인트에서도 함께 삭제됩니다)`)) return;
      data.leave = data.leave.filter((r) => r._id !== rec._id);
      if (normName(rec.name)) {
        const delName = normName(rec.name);
        data.points = data.points.filter((r) => normName(r.name) !== delName);
        savePoints();
      }
      saveLeave();
      rerenderAll();
    });

    tbody.appendChild(tr);
  }

  function renderLeaveTable(container, fullRerender) {
    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "wf-table wf-leave-table";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th>팀명</th><th>성명</th><th>직급</th><th>입사일</th><th>근속 연수</th>
      <th colspan="${LEAVE_SLOT_COUNT}">연차사용내역</th>
      <th>기준</th><th>사용</th><th>잔여</th>
      <th>10주년 장기근속(5일)</th><th>예비군 민방위</th><th>경조</th><th>결혼</th><th>출산</th><th>기타</th><th id="wf-yeartotal-th">연간합계</th>
      <th>비고</th><th></th>
    </tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    // 퇴사/삭제는 복지포인트·개인별지원사항 표에도 영향을 주므로, 넘겨받은 전체 재렌더 함수가
    // 있으면 그걸 쓰고(세 탭 다 다시 그림), 없으면(예: 이 함수를 독립적으로 부른 경우) 이 표만 다시 그린다.
    const rerenderAll = fullRerender || (() => renderLeaveTable(container));
    data.leave.forEach((rec) => appendLeaveRow(tbody, rec, rerenderAll));
    mergeTeamRowspan(Array.from(tbody.children), data.leave, (r) => (r.team || "").trim(), (r) => !!r.resignDate);
    container.appendChild(table);

    const addBtn = document.createElement("button");
    addBtn.className = "btn wf-add-btn";
    addBtn.textContent = "+ 직원 추가";
    addBtn.addEventListener("click", () => {
      const rec = blankLeaveRecord();
      data.leave.push(rec);
      data.points.push(blankPointsRecord());
      saveLeave();
      savePoints();
      rerenderAll();
    });
    container.appendChild(addBtn);
  }

  function buildPointsDetailRow(rec, mainRefs) {
    const tr = document.createElement("tr");
    tr.className = "wf-detail-row";
    tr.style.display = "none";
    // 사용내역 상세표는 표 전체 폭이 아니라 "복지포인트"(지급포인트/잔여한도/사용내역, 3칸)
    // 아래에만 보이도록, 앞뒤로 빈 칸을 두어 자리를 맞춘다(팀명~근속연수 5칸 + 장기근속~
    // 부모님검진 4칸 = 총 9칸, 나머지 3칸에 상세표를 넣음).
    const leftSpacer = document.createElement("td");
    leftSpacer.colSpan = ROSTER_COL_COUNT;
    tr.appendChild(leftSpacer);

    const td = document.createElement("td");
    td.colSpan = POINTS_TABLE_COL_COUNT - ROSTER_COL_COUNT - INDIVIDUAL_COL_COUNT;
    const miniTable = document.createElement("table");
    miniTable.className = "wf-mini-table";
    const head = document.createElement("tr");
    head.innerHTML = "<th>#</th><th>지급일</th><th>내역</th><th>금액</th><th></th>";
    miniTable.appendChild(head);

    function renderEntries() {
      Array.from(miniTable.querySelectorAll("tr.entry")).forEach((r) => r.remove());
      rec.entries.forEach((entry, idx) => {
        const r = document.createElement("tr");
        r.className = "entry";
        const idxTd = document.createElement("td");
        idxTd.textContent = idx + 1;

        const amountTd = document.createElement("td");
        const amountInput = document.createElement("input");
        amountInput.type = "text";
        amountInput.style.width = "90px";
        amountInput.style.textAlign = "right";
        amountInput.value = formatWon(entry.amount);
        amountInput.addEventListener("change", () => {
          entry.amount = parseNum(amountInput.value);
          amountInput.value = formatWon(entry.amount);
          recalcPoints(rec);
          mainRefs.refresh();
          savePoints();
        });
        amountTd.appendChild(amountInput);

        const descTd = document.createElement("td");
        const descInput = document.createElement("input");
        descInput.type = "text";
        descInput.style.width = "120px";
        descInput.value = entry.desc || "";
        descInput.addEventListener("change", () => { entry.desc = descInput.value.trim(); savePoints(); });
        descTd.appendChild(descInput);

        const dateTd = document.createElement("td");
        const dateInput = document.createElement("input");
        dateInput.type = "text";
        dateInput.style.width = "90px";
        dateInput.value = entry.date || "";
        dateInput.placeholder = "04월 03일";
        dateInput.addEventListener("change", () => { entry.date = dateInput.value.trim(); savePoints(); });
        dateTd.appendChild(dateInput);

        const delTd = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.className = "wf-del-btn";
        delBtn.textContent = "삭제";
        delBtn.addEventListener("click", () => {
          rec.entries.splice(idx, 1);
          recalcPoints(rec);
          mainRefs.refresh();
          renderEntries();
          savePoints();
        });
        delTd.appendChild(delBtn);

        r.appendChild(idxTd); r.appendChild(dateTd); r.appendChild(descTd); r.appendChild(amountTd); r.appendChild(delTd);
        miniTable.appendChild(r);
      });
    }
    renderEntries();

    const addBtn = document.createElement("button");
    addBtn.className = "btn wf-add-btn";
    addBtn.textContent = "+ 사용내역 추가";
    addBtn.addEventListener("click", () => {
      rec.entries.push({ amount: 0, desc: "", date: "" });
      recalcPoints(rec);
      mainRefs.refresh();
      renderEntries();
      savePoints();
    });

    td.appendChild(miniTable);
    td.appendChild(addBtn);
    tr.appendChild(td);

    const rightSpacer = document.createElement("td");
    rightSpacer.colSpan = INDIVIDUAL_COL_COUNT;
    tr.appendChild(rightSpacer);

    return tr;
  }

  function appendPointsRow(tbody, rec, openState, mergeState) {
    const tr = document.createElement("tr");
    tr.appendChild(rosterReadonlyCell("wf-roster-team", rec.team));
    tr.appendChild(rosterReadonlyCell("wf-roster-name", rec.name));
    tr.appendChild(rosterReadonlyCell("wf-roster-position", rec.position));
    tr.appendChild(rosterReadonlyCell("wf-roster-hire", rec.hireDate));
    tr.appendChild(rosterReadonlyCell("wf-roster-tenure", rec.tenure));
    tr.appendChild(moneyCell(rec.grantPoint, (v) => { rec.grantPoint = v; recalcPoints(rec); refs.refresh(); savePoints(); }));

    const usageTd = document.createElement("td");
    const usageBtn = document.createElement("button");
    usageBtn.className = "wf-link-btn";
    usageBtn.textContent = pointsSummaryText(rec);
    usageTd.appendChild(usageBtn);
    tr.appendChild(usageTd);

    const remainTd = readonlyCell(formatWon(rec.remainingLimit));
    remainTd.style.textAlign = "right";
    tr.appendChild(remainTd);

    tr.appendChild(completionCell(rec.longService5, (v) => { rec.longService5 = v; savePoints(); }));
    tr.appendChild(completionCell(rec.longService10, (v) => { rec.longService10 = v; savePoints(); }));
    tr.appendChild(completionCell(rec.checkup41, (v) => { rec.checkup41 = v; savePoints(); }));
    tr.appendChild(completionCell(rec.parentCheckup, (v) => { rec.parentCheckup = v; savePoints(); }));

    // 잔여한도가 0원이면 행 전체를 회색으로, 연차내역에서 퇴사 처리된 직원이면(이름으로 대조)
    // 그것도 회색으로 표시한다(wf-resigned-row — 퇴사가 우선). tr의 배경은 배경이 없는 셀엔
    // 그대로 비쳐 보이지만, remainTd는 .wf-readonly 클래스가 자체 배경(#fafafa)을 갖고 있어
    // 따로 덮어써야 한다.
    function refreshRowStyle() {
      const resigned = isResignedName(rec.name);
      tr.classList.toggle("wf-resigned-row", resigned);
      const isZero = !resigned && rec.remainingLimit === 0;
      tr.style.background = isZero ? "#d9d9d9" : "";
      remainTd.style.background = isZero || resigned ? "#d9d9d9" : "";
    }
    refreshRowStyle();

    const refs = {
      refresh() {
        remainTd.textContent = formatWon(rec.remainingLimit);
        usageBtn.textContent = pointsSummaryText(rec);
        refreshRowStyle();
      },
    };

    const detailTr = buildPointsDetailRow(rec, refs);
    usageBtn.addEventListener("click", () => {
      const isOpen = detailTr.style.display !== "none";
      if (openState && openState.current && openState.current !== detailTr) {
        openState.current.style.display = "none";
      }
      // 상세표는 지급포인트~사용내역(3칸, colspan) 칸 안에 가운데 정렬로 보이도록
      // buildPointsDetailRow에서 그 칸 폭을 맞춰뒀다(.wf-mini-table의 margin:auto로 가운데
      // 정렬) — 특정 칸 위치에 맞춰 밀어줄 필요가 없다.
      detailTr.style.display = isOpen ? "none" : "";
      if (openState) openState.current = isOpen ? null : detailTr;
      // 상세행이 열리고 닫히면 그 사이에 낀 팀명 병합 그룹의 실제 높이가 바뀌므로,
      // 세로 정중앙에 배치된 팀명 라벨 위치를 다시 계산해야 한다.
      if (mergeState) requestAnimationFrame(() => mergeState.recompute());
    });

    tbody.appendChild(tr);
    tbody.appendChild(detailTr);
    return tr;
  }

  function renderPointsTable(container) {
    container.innerHTML = "";
    const table = document.createElement("table");
    table.className = "wf-table";

    // table-layout:fixed의 컬럼 폭은 표 안에 헤더행이 몇 개든(그룹 제목행이 추가되든) 상관없이
    // colgroup/col로 지정해야 안정적으로 유지된다 — th에 폭을 걸면 "첫 번째 행" 기준이라
    // 그룹 제목행(위 개인별복지사항 colspan행) 같은 게 앞에 추가되는 순간 깨진다.
    const colgroup = document.createElement("colgroup");
    // 팀명/성명/직급/입사일/근속연수 — 연차내역(auto layout, 실제 렌더링된 폭)과 동일하게 맞춘 값.
    // 연차내역은 병합된 날짜·비고 등 내용에 따라 폭이 유동적이어야 해서 고정폭을 걸 수 없으므로,
    // (고정폭이어도 안전한) 복지포인트 쪽을 연차내역 렌더링 폭에 맞추는 방향으로 통일한다.
    const ROSTER_COL_WIDTHS = [75, 75, 53, 69, 69]; // index.html의 td.wf-roster-* width와 동일
    // 지급포인트/사용내역/잔여한도/장기근속(5·10주년)/41세검진/부모님검진 — 폭을 지정 안 하면
    // table-layout:fixed가 컨테이너의 남는 공간을 이 7칸에 다 나눠줘서 표가 불필요하게 넓어진다.
    const REST_COL_WIDTHS = [150, 200, 130, 150, 150, 130, 130]; // 지급포인트/사용내역/잔여한도 순서
    [...ROSTER_COL_WIDTHS, ...REST_COL_WIDTHS].forEach((w) => {
      const col = document.createElement("col");
      col.style.width = w + "px";
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th rowspan="2" class="wf-roster-col wf-roster-team">팀명</th>
      <th rowspan="2" class="wf-roster-col wf-roster-name">성명</th>
      <th rowspan="2" class="wf-roster-col wf-roster-position">직급</th>
      <th rowspan="2" class="wf-roster-col wf-roster-hire">입사일</th>
      <th rowspan="2" class="wf-roster-col wf-roster-tenure">근속 연수</th>
      <th colspan="3" class="wf-points-green" style="font-size:15px; font-weight:700;">복지포인트</th>
      <th colspan="4" class="wf-points-sky" style="font-size:15px; font-weight:700;">개인별복지사항</th>
    </tr><tr>
      <th class="wf-points-green">지급포인트</th><th class="wf-points-green">사용내역</th><th class="wf-points-green">잔여한도</th>
      <th class="wf-points-sky">장기근속(5주년)</th><th class="wf-points-sky">장기근속(10주년)</th><th class="wf-points-sky">41세검진</th><th class="wf-points-sky">부모님검진</th>
    </tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    // data.points는 저장된 순서 그대로라 연차내역과 사람 순서가 어긋날 수 있다(예: 예전에
    // 다른 순서로 입력/가져온 경우). 팀명 병합(fakeTeamMerge)은 "바로 위 행과 같은 값인가"만
    // 보므로, 순서가 어긋나면 연차내역에서는 같은 팀이 붙어 보여도 복지포인트에서는 병합이
    // 끊겨 보인다 — 그래서 복지포인트도 항상 연차내역과 같은 사람 순서로 그린다. 연차내역에
    // 없는 이름(예전 데이터의 잔존 레코드)은 지우지 않고 맨 뒤에 그대로 붙여준다.
    const orderedPoints = [];
    const used = new Set();
    data.leave.forEach((lv) => {
      const lvName = normName(lv.name);
      if (!lvName) return;
      const pr = data.points.find((p) => !used.has(p) && normName(p.name) === lvName);
      if (pr) { orderedPoints.push(pr); used.add(pr); }
    });
    data.points.forEach((p) => { if (!used.has(p)) orderedPoints.push(p); });

    const openState = { current: null };
    const mergeState = { recompute: () => {} };
    const mainRows = orderedPoints.map((rec) => appendPointsRow(tbody, rec, openState, mergeState));
    container.appendChild(table); // getBoundingClientRect로 실제 높이를 재려면 먼저 DOM에 붙어있어야 함
    mergeState.recompute = fakeTeamMerge(
      mainRows,
      orderedPoints,
      (r) => (r.team || "").trim(),
      (r) => isResignedName(r.name)
    );
    return mergeState.recompute;
  }

  // ── 초기화 ──────────────────────────────────────────────
  function init(root) {
    loadFromStorage();

    const tabs = root.querySelectorAll(".wf-tab");
    const panels = {
      leave: root.querySelector("#wf-panel-leave"),
      points: root.querySelector("#wf-panel-points"),
    };
    const headerControls = root.querySelector("#wf-header-controls");
    // 상단 컨트롤(기준연도~엑셀저장)의 오른쪽 끝을 연차내역 표의 "연간합계" 열 오른쪽 끝에
    // 맞춘다. 표는 auto layout이라(연차사용내역 병합에 따라) 폭이 매번 달라지므로 렌더 후
    // 매번 다시 측정해야 한다.
    function alignHeaderControls() {
      const th = panels.leave.querySelector("#wf-yeartotal-th");
      if (!th || panels.leave.style.display === "none") {
        headerControls.style.marginRight = "";
        return;
      }
      const rowRight = headerControls.parentElement.getBoundingClientRect().right;
      const thRight = th.getBoundingClientRect().right;
      const diff = rowRight - thRight;
      headerControls.style.marginRight = Math.max(0, diff) + "px";
    }
    window.addEventListener("resize", alignHeaderControls);

    // 복지포인트의 팀명 병합 라벨은 실제 화면 크기(getBoundingClientRect)로 위치를 계산하는데,
    // 탭이 display:none인 동안에는 크기가 전부 0으로 나온다 — 그래서 탭을 열 때(보이게 된
    // 직후) 반드시 다시 계산해줘야 처음 열었을 때 라벨이 찌그러져 보이지 않는다.
    let pointsRecompute = () => {};
    function showTab(id) {
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
      Object.keys(panels).forEach((k) => { panels[k].style.display = k === id ? "" : "none"; });
      alignHeaderControls();
      if (id === "points") requestAnimationFrame(() => pointsRecompute());
    }
    tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

    function renderAll() {
      renderLeaveTable(panels.leave, renderAll);
      pointsRecompute = renderPointsTable(panels.points) || (() => {});
      alignHeaderControls();
    }

    const yearInput = root.querySelector("#wf-year");
    yearInput.value = currentYear;
    yearInput.addEventListener("change", () => {
      const newYear = parseNum(yearInput.value) || currentYear;
      saveYear(newYear);
      loadLeaveForYear(newYear);
      loadPointsForYear(newYear);
      syncAllPointsRoster();
      renderAll();
    });

    renderAll();
    showTab("leave");

    const status = root.querySelector("#wf-status");
    function setStatus(msg, isError) {
      status.textContent = msg;
      status.style.color = isError ? "#b91c1c" : "#374151";
    }

    // 개발자도구(콘솔)를 못 쓰는 환경에서도 화면에서 바로 실행하고 결과를 눈으로 확인할 수 있게
    // 만든 버튼 — localStorage에 저장된 모든 연도의 장기근속/검진 완료표시를 이전 연도 값으로
    // 다시 채워 넣고(이미 값이 있는 칸은 안 건드림), 몇 명·몇 칸을 고쳤는지 화면에 그대로 보여준다.
    root.querySelector("#wf-repair-btn").addEventListener("click", () => {
      const result = repairAllYearsMilestones();
      if (result.fixedDetails.length === 0) {
        setStatus(`고칠 게 없습니다(확인한 연도: ${result.years.join(", ") || "없음"}).`);
      } else {
        setStatus(`${result.fixedDetails.length}칸 복구함 — ${result.fixedDetails.join(", ")}`);
      }
      loadLeaveForYear(currentYear);
      loadPointsForYear(currentYear);
      renderAll();
    });

    root.querySelector("#wf-download-btn").addEventListener("click", async () => {
      setStatus("다운로드 준비 중...");
      try {
        const wb = await buildWorkbook(data);
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const today = new Date();
        const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
        a.href = url;
        a.download = `복지제도_지원현황_${currentYear}_${stamp}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus("");
      } catch (err) {
        console.error(err);
        setStatus("다운로드 실패: " + err.message, true);
      }
    });

    // ── 하이웍스 일정(연차휴가) 동기화 ──
    const HIWORKS_SYNC_SERVER = "http://localhost:8787";
    const HIWORKS_BUSY_STATES = ["connecting", "fetching", "computing"];
    const hiworksBtn = root.querySelector("#wf-hiworks-sync-btn");
    const hiworksStatus = root.querySelector("#wf-hiworks-status");
    const hiworksResult = root.querySelector("#wf-hiworks-result");
    let hiworksPollTimer = null;

    function setHiworksStatus(msg, isError) {
      hiworksStatus.textContent = msg;
      hiworksStatus.style.color = isError ? "#b91c1c" : "#374151";
    }

    function applyHiworksUpdates(updates) {
      let appliedRecords = 0;
      let appliedDates = 0;
      updates.forEach((u) => {
        const rec = data.leave.find((r) => r._id === u._id);
        if (!rec) return;
        rec.usageSlots = u.usageSlots;
        recalcLeave(rec);
        appliedRecords++;
        appliedDates += u.addedDates.length;
      });
      return { appliedRecords, appliedDates };
    }

    function renderHiworksResult(result) {
      const parts = [];
      if (result.unmatchedNames.length) {
        parts.push(
          `<p style="color:#b91c1c;">앱에서 이름을 못 찾음: ${result.unmatchedNames
            .map((u) => `${u.name}(${u.dates.length}건)`)
            .join(", ")}</p>`
        );
      }
      const overflow = result.updates.filter((u) => u.overflowDates.length);
      if (overflow.length) {
        parts.push(
          `<p style="color:#b91c1c;">연차사용내역 칸(${LEAVE_SLOT_COUNT}개)이 부족해서 못 채운 날짜: ${overflow
            .map((u) => `${u.name}(${u.overflowDates.join(", ")})`)
            .join(" / ")}</p>`
        );
      }
      if (result.appOnlyByName.length) {
        parts.push(
          `<p style="color:var(--text-dim);">앱에는 있는데 하이웍스 일정엔 없는 날짜(참고용, 자동 삭제하지 않음): ${result.appOnlyByName
            .map((a) => `${a.name}(${a.dates.join(", ")})`)
            .join(" / ")}</p>`
        );
      }
      hiworksResult.innerHTML = parts.join("");
    }

    function stopHiworksPolling() {
      if (hiworksPollTimer) { clearInterval(hiworksPollTimer); hiworksPollTimer = null; }
    }

    function startHiworksPolling() {
      stopHiworksPolling();
      hiworksPollTimer = setInterval(async () => {
        try {
          const res = await fetch(`${HIWORKS_SYNC_SERVER}/hiworks/status`, { cache: "no-store" });
          const job = await res.json();
          if (job.log && job.log.length) setHiworksStatus(job.log[job.log.length - 1]);
          if (!HIWORKS_BUSY_STATES.includes(job.state)) {
            stopHiworksPolling();
            if (job.state === "done" && job.result) {
              const { appliedRecords, appliedDates } = applyHiworksUpdates(job.result.updates);
              saveLeave();
              renderLeaveTable(panels.leave);
              renderHiworksResult(job.result);
              setHiworksStatus(`동기화 완료 — ${appliedRecords}명, 날짜 ${appliedDates}건 추가했습니다.`);
            } else if (job.state === "error") {
              setHiworksStatus("동기화 실패: " + job.error, true);
            }
          }
        } catch (err) {
          stopHiworksPolling();
          setHiworksStatus("동기화 상태 확인 실패: " + err.message, true);
        }
      }, 1500);
    }

    hiworksBtn.addEventListener("click", async () => {
      hiworksResult.innerHTML = "";
      setHiworksStatus("동기화 요청 중...");
      try {
        const res = await fetch(`${HIWORKS_SYNC_SERVER}/hiworks/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: data.leave, year: currentYear, leaveSlotCount: LEAVE_SLOT_COUNT }),
        });
        if (res.status === 409) {
          setHiworksStatus("이미 진행 중인 동기화가 있습니다.");
          startHiworksPolling();
          return;
        }
        if (!res.ok) throw new Error("동기화 요청이 실패했습니다.");
        startHiworksPolling();
      } catch (err) {
        console.error(err);
        setHiworksStatus(
          "도우미 서버에 연결할 수 없습니다. tools/helper-server/start-server-now.bat을 실행해주세요.",
          true
        );
      }
    });
  }

  window.HilineWelfareTool = { init };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseWorkbookToData, recalcLeave, recalcPoints, buildWorkbook };
  }
})();
