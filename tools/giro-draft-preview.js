/*
 * 지로청구서 자동기안 — 오늘 기안 대상 미리보기
 * etc/지로납부번호.xlsx를 한 번 업로드해두면 브라우저(localStorage)에 저장해두고, 그 다음부터는
 * 매번 업로드할 필요 없이 열 때마다 오늘 날짜(10일/20일/25일/말일)에 해당하는 항목을 자동으로 보여준다.
 * 엑셀 내용이 바뀐 경우에만 "다시 업로드"로 갱신하면 된다.
 * 로그인·실제 기안 자동화는 브라우저 페이지에서 할 수 없어(외부 사이트 로그인 세션을 다뤄야 함),
 * tools/helper-server/server.js(로컬 Node + Playwright 통합 도우미 서버)가 담당한다. 이 화면은 미리보기만 한다.
 */
(function () {
  const STORAGE_KEY = "hiline-giro-rows-v1";
  const STORAGE_META_KEY = "hiline-giro-meta-v1";

  function cleanNumberStr(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/[\t\s]/g, "").trim();
  }

  function normalizeRowDate(v) {
    return String(v || "").trim().replace(/자$/, "");
  }

  // 오늘이 10일/20일/25일/말일 중 하나면 "10일"/"20일"/"25일"/"말일"을, 아니면 null을 반환
  function todayTargetDate() {
    const today = new Date();
    const dom = today.getDate();
    const lastDom = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    if (dom === lastDom) return "말일";
    if (dom === 10 || dom === 20 || dom === 25) return `${dom}일`;
    return null;
  }

  // 날짜 필터 없이 시트의 모든 행을 파싱해서 저장해둔다 (매번 업로드하지 않고도 다른 날짜를 다시 계산할 수 있도록)
  async function parseAllRows(file) {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];

    const rows = [];
    let lastVendor = "";
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const dateVal = row.getCell(1).value;
      if (!dateVal) continue;

      let vendor = row.getCell(2).value;
      vendor = vendor ? String(vendor).trim() : "";
      if (vendor) lastVendor = vendor;
      else vendor = lastVendor;

      const amount = Number(row.getCell(3).value) || 0;
      const giroNo = cleanNumberStr(row.getCell(4).value);
      const epayNo = cleanNumberStr(row.getCell(5).value);

      let type, value;
      if (giroNo) {
        type = "지로번호";
        value = giroNo;
      } else if (vendor === "전기요금") {
        type = "고객번호";
        value = epayNo;
      } else {
        type = "전자납부번호";
        value = epayNo;
      }

      rows.push({ 납부일자: normalizeRowDate(dateVal), 거래처: vendor, 금액: amount, type, value });
    }
    return rows;
  }

  function saveRows(rows, fileName) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ fileName, savedAt: new Date().toISOString() }));
  }

  function loadRows() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function loadMeta() {
    try {
      const raw = localStorage.getItem(STORAGE_META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function renderTable(rows) {
    if (rows.length === 0) {
      return `<p class="desc">해당 날짜에 등록할 항목이 없습니다.</p>`;
    }
    const body = rows
      .map((r) => {
        const auto = r.type === "지로번호" || r.type === "고객번호" || r.type === "전자납부번호";
        const tag = auto
          ? `<span class="badge" style="background:#dcfce7; color:#166534;">자동 기안 대상</span>`
          : `<span class="badge">수동(추후 지원)</span>`;
        return `<tr>
          <td>${r.거래처}</td>
          <td>${r.type}=${r.value}</td>
          <td style="text-align:right;">${r.금액.toLocaleString()}원</td>
          <td>${tag}</td>
        </tr>`;
      })
      .join("");
    const total = rows.reduce((s, r) => s + r.금액, 0);
    return `<table class="wf-table" style="width:100%;">
      <thead><tr><th>거래처</th><th>번호</th><th>금액</th><th>처리</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="desc" style="margin-top:8px;">총 ${rows.length}건 / 합계 ${total.toLocaleString()}원</p>`;
  }

  const HELPER_URL = "http://localhost:8787";
  const BUSY_STATES = ["launching-chrome", "waiting-login", "running"];
  const STATE_LABEL = {
    idle: "대기 중",
    "launching-chrome": "Chrome 실행 중...",
    "waiting-login": "로그인 대기 중 — 열린 Chrome 창에서 biz.giro.or.kr에 로그인해주세요",
    running: "자동 기안 진행 중...",
    done: "완료",
    error: "오류 발생",
  };

  async function fetchHelperStatus() {
    const res = await fetch(`${HELPER_URL}/giro/status`, { cache: "no-store" });
    if (!res.ok) throw new Error("status fetch failed");
    return res.json();
  }

  function initGiroDraftTool(root) {
    const dropZone = root.querySelector("#gd-dropzone");
    const fileInput = root.querySelector("#gd-file-input");
    const status = root.querySelector("#gd-status");
    const resultEl = root.querySelector("#gd-result");
    const metaEl = root.querySelector("#gd-meta");
    const dateSelect = root.querySelector("#gd-date-select");
    const runBtn = root.querySelector("#gd-run-btn");
    const helperStatusEl = root.querySelector("#gd-helper-status");
    const runStatusEl = root.querySelector("#gd-run-status");
    const runLogEl = root.querySelector("#gd-run-log");
    const unregisteredEl = root.querySelector("#gd-unregistered");
    const unregisteredListEl = root.querySelector("#gd-unregistered-list");
    const retryBtn = root.querySelector("#gd-retry-btn");
    const abortWarningEl = root.querySelector("#gd-abort-warning");

    const autoTarget = todayTargetDate();
    let pollTimer = null;
    let lastJob = null;

    function currentTarget() {
      const picked = dateSelect.value;
      return picked === "auto" ? autoTarget : picked;
    }

    function setStatus(msg, isError) {
      status.textContent = msg;
      status.style.color = isError ? "#b91c1c" : "#374151";
    }

    function renderFromCache() {
      const target = currentTarget();
      const isManualPick = dateSelect.value !== "auto";

      const rows = loadRows();
      const meta = loadMeta();
      metaEl.textContent = meta
        ? `마지막 업로드: ${meta.fileName} (${new Date(meta.savedAt).toLocaleString("ko-KR")})`
        : "아직 업로드된 엑셀이 없습니다.";

      if (!rows) {
        resultEl.innerHTML = "";
        setStatus("지로납부번호.xlsx를 아직 업로드하지 않았습니다. 아래 \"다시 업로드\"를 열어서 한 번만 올려주세요.", true);
        return;
      }
      if (!target) {
        resultEl.innerHTML = "";
        setStatus("오늘은 지정된 지로 납부일(10일/20일/25일/말일)이 아닙니다. 위에서 날짜를 직접 골라 확인할 수 있습니다.");
        return;
      }
      const targetRows = rows.filter((r) => r.납부일자 === target);
      resultEl.innerHTML = renderTable(targetRows);
      const label = isManualPick ? `선택한 날짜(${target})` : `오늘(${target})`;
      setStatus(`${label} 대상 ${targetRows.length}건 (저장된 엑셀 기준)`);
    }

    async function handleFile(file) {
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name)) {
        setStatus("xlsx 파일만 업로드할 수 있습니다.", true);
        return;
      }
      setStatus("확인 중...");
      try {
        const rows = await parseAllRows(file);
        saveRows(rows, file.name);
        renderFromCache();
      } catch (err) {
        console.error(err);
        setStatus("확인 실패: " + err.message, true);
      }
    }

    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

    ["dragenter", "dragover"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
      })
    );
    dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

    dateSelect.addEventListener("change", renderFromCache);

    function renderJob(job) {
      lastJob = job;
      const busy = BUSY_STATES.includes(job.state);
      runBtn.disabled = busy;
      runBtn.textContent = busy ? "진행 중..." : "자동 기안 시작";
      retryBtn.disabled = busy;

      runStatusEl.textContent = STATE_LABEL[job.state] || job.state;
      runStatusEl.style.color = job.state === "error" ? "#b91c1c" : "#374151";

      unregisteredEl.style.display = "none";
      abortWarningEl.style.display = "none";
      if (job.state === "done" && job.summary) {
        const unregistered = job.summary.unregistered || [];
        runStatusEl.textContent = `완료 — 등록 확인 ${job.summary.success}건 / 미등록 ${unregistered.length}건. "기안문서 관리" 화면에서 확인 후 상신해주세요.`;
        runStatusEl.style.color = unregistered.length > 0 ? "#b91c1c" : "#166534";
        if (job.summary.abortedEarly) {
          abortWarningEl.style.display = "block";
          abortWarningEl.textContent = `⚠ 안전 중단됨: ${job.summary.abortedEarly}`;
        }
        if (unregistered.length > 0) {
          unregisteredEl.style.display = "block";
          unregisteredListEl.innerHTML = unregistered
            .map((r) => `<div>- ${r.거래처} | ${r.type}=${r.value}${r.epay ? ` | 전자납부번호=${r.epay}` : ""} | ${r.금액.toLocaleString()}원</div>`)
            .join("");
        }
      }
      if (job.state === "error") {
        runStatusEl.textContent = `오류: ${job.error}`;
      }

      if (job.log && job.log.length > 0) {
        runLogEl.style.display = "block";
        runLogEl.textContent = job.log.join("\n");
        runLogEl.scrollTop = runLogEl.scrollHeight;
      }
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPolling() {
      stopPolling();
      pollTimer = setInterval(async () => {
        try {
          const job = await fetchHelperStatus();
          renderJob(job);
          if (!BUSY_STATES.includes(job.state)) stopPolling();
        } catch (err) {
          stopPolling();
          helperStatusEl.textContent = "도우미 서버와 연결이 끊겼습니다.";
          helperStatusEl.style.color = "#b91c1c";
        }
      }, 1500);
    }

    async function checkHelper({ silent } = {}) {
      try {
        const job = await fetchHelperStatus();
        helperStatusEl.textContent = "";
        runBtn.disabled = BUSY_STATES.includes(job.state);
        renderJob(job);
        if (BUSY_STATES.includes(job.state)) startPolling();
        return true;
      } catch (err) {
        if (!silent) {
          helperStatusEl.innerHTML =
            '도우미 서버에 연결할 수 없습니다. PC를 재시작하면 자동으로 켜지며, 지금 바로 쓰려면 <code>tools/helper-server/start-server-now.bat</code>을 실행해주세요.';
          helperStatusEl.style.color = "#b91c1c";
        }
        runBtn.disabled = false;
        return false;
      }
    }

    async function triggerRun(target, onlyRows) {
      runBtn.disabled = true;
      retryBtn.disabled = true;
      runStatusEl.textContent = onlyRows ? "미등록 건 재등록 요청을 보내는 중..." : "요청을 보내는 중...";
      runStatusEl.style.color = "#374151";
      runLogEl.style.display = "none";
      runLogEl.textContent = "";
      unregisteredEl.style.display = "none";
      try {
        const res = await fetch(`${HELPER_URL}/giro/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(onlyRows ? { date: target, onlyRows } : { date: target }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `요청 실패 (${res.status})`);
        }
        startPolling();
      } catch (err) {
        runBtn.disabled = false;
        retryBtn.disabled = false;
        if (err.message.includes("fetch")) {
          checkHelper();
        } else {
          runStatusEl.textContent = "실행 실패: " + err.message;
          runStatusEl.style.color = "#b91c1c";
        }
      }
    }

    retryBtn.addEventListener("click", () => {
      if (!lastJob || !lastJob.summary || !lastJob.summary.unregistered || lastJob.summary.unregistered.length === 0) return;
      const rowNumbers = lastJob.summary.unregistered.map((r) => r.row);
      triggerRun(lastJob.date, rowNumbers);
    });

    runBtn.addEventListener("click", () => {
      const target = currentTarget();
      if (!target) {
        runStatusEl.textContent = "먼저 확인할 날짜를 골라주세요.";
        runStatusEl.style.color = "#b91c1c";
        return;
      }
      triggerRun(target);
    });

    checkHelper({ silent: true });
    renderFromCache();
  }

  window.HilineGiroDraftTool = { init: initGiroDraftTool };
})();
