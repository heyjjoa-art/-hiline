/*
 * 메일 수신함 — eunhye@hilineisp.net Gmail 수신함 목록 보기.
 * IMAP 접속은 브라우저 페이지에서 직접 할 수 없어(외부 사이트 계정 인증을 다뤄야 함),
 * tools/helper-server/server.js(로컬 Node + IMAP 통합 도우미 서버)가 담당한다. 이 화면은 그 서버가
 * 돌려주는 목록을 표시만 한다.
 */
(function () {
  const HELPER_URL = "http://localhost:8787";

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function renderList(messages) {
    if (messages.length === 0) {
      return `<p class="desc">받은 메일이 없습니다.</p>`;
    }
    const rows = messages
      .map((m) => `
        <tr style="${m.unread ? "font-weight:700;" : "color:var(--text-dim);"}">
          <td style="white-space:nowrap;">${m.unread ? "● " : ""}${escapeHtml(m.from)}</td>
          <td>${escapeHtml(m.subject)}</td>
          <td style="white-space:nowrap; text-align:right;">${formatDate(m.date)}</td>
        </tr>`)
      .join("");
    return `<table class="wf-table" style="width:100%;">
      <thead><tr><th>보낸사람</th><th>제목</th><th>받은 날짜</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function initMailInboxTool(root) {
    const statusEl = root.querySelector("#mail-status");
    const listEl = root.querySelector("#mail-list");
    const refreshBtn = root.querySelector("#mail-refresh-btn");

    function setStatus(msg, isError) {
      statusEl.textContent = msg;
      statusEl.style.color = isError ? "#b91c1c" : "#374151";
    }

    async function refresh() {
      refreshBtn.disabled = true;
      setStatus("불러오는 중...");
      try {
        const res = await fetch(`${HELPER_URL}/mail/messages?limit=30`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          throw new Error(body.error || `요청 실패 (${res.status})`);
        }
        listEl.innerHTML = renderList(body.messages);
        const unreadCount = body.messages.filter((m) => m.unread).length;
        setStatus(`최신 ${body.messages.length}건 (안읽음 ${unreadCount}건) — 방금 갱신됨`);
      } catch (err) {
        if (err.message && err.message.includes("fetch")) {
          setStatus('도우미 서버에 연결할 수 없습니다. tools/helper-server/start-server-now.bat을 실행해주세요.', true);
        } else {
          setStatus("불러오기 실패: " + err.message, true);
        }
      } finally {
        refreshBtn.disabled = false;
      }
    }

    refreshBtn.addEventListener("click", refresh);
    refresh();
  }

  window.HilineMailInboxTool = { init: initMailInboxTool };
})();
