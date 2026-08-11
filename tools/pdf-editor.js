/*
 * PDF 파일 편집기
 * PDF를 올려서 (1) 한 장씩 낱장 파일로 분할하거나, (2) 원하는 페이지만 골라 한 파일로 합친다.
 *
 * 처리는 전부 브라우저 안에서 이뤄지고(pdf-lib), 파일은 서버로 전송되지 않는다.
 * 낱장 분할은 파일이 여러 개 나오는데 브라우저가 연속 다운로드를 막는 경우가 있어
 * JSZip으로 ZIP 하나로 묶어서 내려준다.
 *
 * 미리보기(썸네일)는 pdf.js가 필요한데, index.html을 file://로 직접 여는 이 프로젝트 특성상
 * 워커 로딩이 막혀서 쓰기 어렵다. 그래서 페이지 선택은 번호 체크박스 + 범위 입력으로 한다.
 */
(function () {
  // ---------- 페이지 범위 문자열 파싱 ----------

  // "1-3, 5, 7-" 같은 입력을 [1,2,3,5,7,8,...] 로 바꾼다.
  // 잘못된 부분은 통째로 실패시키지 않고 errors에 모아 사용자에게 알려준다.
  function parsePageRange(text, pageCount) {
    const pages = new Set();
    const errors = [];
    const cleaned = String(text || "").replace(/[\s]/g, "");
    if (!cleaned) return { pages: [], errors: [] };

    for (const part of cleaned.split(",")) {
      if (!part) continue;
      const m = part.match(/^(\d+)(?:(-)(\d*))?$/);
      if (!m) { errors.push(`"${part}"은(는) 알아볼 수 없는 형식입니다`); continue; }

      const start = Number(m[1]);
      // "7-"처럼 끝을 비우면 마지막 페이지까지로 본다
      const end = m[2] === undefined ? start : (m[3] === "" ? pageCount : Number(m[3]));

      if (start < 1 || start > pageCount) { errors.push(`${start}쪽은 범위를 벗어납니다 (1~${pageCount}쪽)`); continue; }
      if (end < 1 || end > pageCount) { errors.push(`${end}쪽은 범위를 벗어납니다 (1~${pageCount}쪽)`); continue; }
      if (end < start) { errors.push(`"${part}"은(는) 시작쪽이 끝쪽보다 큽니다`); continue; }

      for (let p = start; p <= end; p++) pages.add(p);
    }
    return { pages: [...pages].sort((a, b) => a - b), errors };
  }

  // 선택된 페이지 목록을 "1-3, 5, 7-9" 같은 짧은 표기로 되돌린다(화면 표시용)
  function formatPageRange(pages) {
    if (!pages.length) return "";
    const sorted = [...pages].sort((a, b) => a - b);
    const parts = [];
    let start = sorted[0], prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const cur = sorted[i];
      if (cur !== prev + 1) {
        parts.push(start === prev ? String(start) : `${start}-${prev}`);
        start = cur;
      }
      prev = cur;
    }
    return parts.join(", ");
  }

  // ---------- PDF 처리 ----------

  async function loadPdf(arrayBuffer) {
    // 암호가 걸린 PDF도 페이지를 복사할 수 있게 무시하고 연다(안 되면 에러가 그대로 올라온다)
    return PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  }

  // 고른 페이지만 담은 새 PDF 하나를 만든다. pages는 1부터 시작하는 쪽번호.
  async function extractPages(srcDoc, pages) {
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(srcDoc, pages.map(p => p - 1));
    copied.forEach(page => out.addPage(page));
    return out.save();
  }

  // 파일명에 쓸 수 없는 문자를 정리하고 확장자를 떼어낸다
  function baseName(fileName) {
    return String(fileName || "document")
      .replace(/\.pdf$/i, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "document";
  }

  function pad(n, width) {
    return String(n).padStart(width, "0");
  }

  // 낱장 분할 — 페이지마다 PDF를 하나씩 만들어 ZIP으로 묶는다.
  // onProgress(현재, 전체)로 진행 상황을 알려준다(페이지가 많으면 시간이 걸려서).
  async function splitToZip(arrayBuffer, fileName, pages, onProgress) {
    const src = await loadPdf(arrayBuffer);
    const zip = new JSZip();
    const base = baseName(fileName);
    const width = String(pages[pages.length - 1]).length;

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const bytes = await extractPages(src, [p]);
      zip.file(`${base}_${pad(p, width)}.pdf`, bytes);
      if (onProgress) {
        onProgress(i + 1, pages.length);
        // 진행 표시가 화면에 반영되도록 이벤트 루프를 한 번 넘겨준다
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return zip.generateAsync({ type: "blob" });
  }

  async function mergeToOne(arrayBuffer, pages) {
    const src = await loadPdf(arrayBuffer);
    const bytes = await extractPages(src, pages);
    return new Blob([bytes], { type: "application/pdf" });
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- 화면 ----------

  function init(root) {
    const els = {
      zone: root.querySelector("#pdf-dropzone"),
      input: root.querySelector("#pdf-file"),
      panel: root.querySelector("#pdf-panel"),
      info: root.querySelector("#pdf-info"),
      grid: root.querySelector("#pdf-page-grid"),
      rangeInput: root.querySelector("#pdf-range"),
      selectAllBtn: root.querySelector("#pdf-select-all"),
      clearBtn: root.querySelector("#pdf-select-none"),
      selected: root.querySelector("#pdf-selected"),
      splitBtn: root.querySelector("#pdf-split-btn"),
      mergeBtn: root.querySelector("#pdf-merge-btn"),
      status: root.querySelector("#pdf-status"),
    };
    if (!els.zone) return;

    const labelEl = els.zone.querySelector(".pdf-zone-label");
    const defaultLabel = labelEl.innerHTML;

    let current = null; // { buffer, name, pageCount }
    let selected = new Set();
    let busy = false;

    function setStatus(msg, kind) {
      els.status.textContent = msg;
      els.status.style.color = kind === "error" ? "#dc2626" : kind === "ok" ? "#16a34a" : "";
    }

    function setBusy(on) {
      busy = on;
      els.splitBtn.disabled = on;
      els.mergeBtn.disabled = on;
    }

    // 선택 상태가 바뀔 때마다 체크박스·범위칸·버튼 라벨을 한 번에 맞춘다
    function syncSelection(updateRangeInput) {
      els.grid.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.checked = selected.has(Number(cb.value));
      });
      const list = [...selected].sort((a, b) => a - b);
      if (updateRangeInput) els.rangeInput.value = formatPageRange(list);
      els.selected.textContent = list.length
        ? `${list.length}쪽 선택됨 (${formatPageRange(list)})`
        : "선택된 쪽이 없습니다";
      els.mergeBtn.textContent = list.length
        ? `선택한 ${list.length}쪽을 한 파일로 저장`
        : "선택한 쪽을 한 파일로 저장";
    }

    function buildGrid(pageCount) {
      els.grid.innerHTML = "";
      for (let p = 1; p <= pageCount; p++) {
        const label = document.createElement("label");
        label.className = "pdf-page-chip";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = String(p);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(p); else selected.delete(p);
          syncSelection(true);
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(String(p)));
        els.grid.appendChild(label);
      }
    }

    function resetZone() {
      current = null;
      selected = new Set();
      els.input.value = "";
      labelEl.innerHTML = defaultLabel;
      els.panel.style.display = "none";
      els.grid.innerHTML = "";
      els.rangeInput.value = "";
    }

    async function loadFile(file) {
      if (busy) return;
      if (!/\.pdf$/i.test(file.name)) {
        setStatus("PDF 파일(.pdf)만 올릴 수 있습니다.", "error");
        return;
      }
      setStatus("파일을 읽는 중...");
      try {
        const buffer = await file.arrayBuffer();
        const doc = await loadPdf(buffer);
        const pageCount = doc.getPageCount();
        if (!pageCount) throw new Error("페이지가 없는 PDF입니다.");

        current = { buffer, name: file.name, pageCount };
        selected = new Set();
        for (let p = 1; p <= pageCount; p++) selected.add(p); // 기본은 전체 선택

        labelEl.innerHTML = `📄 <strong>${file.name}</strong><br><span style="font-size:12px;">다른 파일로 바꾸려면 다시 클릭하세요</span>`;
        els.info.textContent = `${file.name} · 총 ${pageCount}쪽`;
        els.panel.style.display = "";
        buildGrid(pageCount);
        syncSelection(true);
        els.splitBtn.textContent = `전체 ${pageCount}쪽을 낱장으로 분할 (ZIP)`;
        setStatus(`${pageCount}쪽을 읽었습니다. 낱장으로 분할하거나, 원하는 쪽만 골라 한 파일로 저장하세요.`, "ok");
      } catch (err) {
        console.error(err);
        resetZone();
        setStatus("PDF를 열지 못했습니다: " + (err.message || err), "error");
      }
    }

    els.zone.addEventListener("click", () => { if (!busy) els.input.click(); });
    els.input.addEventListener("change", () => { if (els.input.files[0]) loadFile(els.input.files[0]); });
    els.zone.addEventListener("dragover", e => { e.preventDefault(); els.zone.classList.add("dragover"); });
    els.zone.addEventListener("dragleave", () => els.zone.classList.remove("dragover"));
    els.zone.addEventListener("drop", e => {
      e.preventDefault();
      els.zone.classList.remove("dragover");
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    // 범위 입력칸("1-3, 5")과 체크박스는 서로 반영된다
    els.rangeInput.addEventListener("input", () => {
      if (!current) return;
      const { pages, errors } = parsePageRange(els.rangeInput.value, current.pageCount);
      selected = new Set(pages);
      syncSelection(false); // 입력 중이므로 입력칸 자체는 건드리지 않는다
      setStatus(errors.length ? errors.join(" / ") : "", errors.length ? "error" : "");
    });

    els.selectAllBtn.addEventListener("click", () => {
      if (!current) return;
      selected = new Set();
      for (let p = 1; p <= current.pageCount; p++) selected.add(p);
      syncSelection(true);
    });

    els.clearBtn.addEventListener("click", () => {
      if (!current) return;
      selected = new Set();
      syncSelection(true);
    });

    els.splitBtn.addEventListener("click", async () => {
      if (!current || busy) return;
      const pages = [];
      for (let p = 1; p <= current.pageCount; p++) pages.push(p);
      setBusy(true);
      try {
        setStatus("분할하는 중...");
        const blob = await splitToZip(current.buffer, current.name, pages,
          (done, total) => setStatus(`분할하는 중... ${done}/${total}쪽`));
        downloadBlob(blob, `${baseName(current.name)}_낱장.zip`);
        setStatus(`${pages.length}개 파일을 ZIP으로 저장했습니다.`, "ok");
      } catch (err) {
        console.error(err);
        setStatus("분할에 실패했습니다: " + (err.message || err), "error");
      } finally {
        setBusy(false);
      }
    });

    els.mergeBtn.addEventListener("click", async () => {
      if (!current || busy) return;
      const pages = [...selected].sort((a, b) => a - b);
      if (!pages.length) {
        setStatus("한 파일로 저장할 쪽을 하나 이상 골라주세요.", "error");
        return;
      }
      setBusy(true);
      try {
        setStatus("파일을 만드는 중...");
        const blob = await mergeToOne(current.buffer, pages);
        downloadBlob(blob, `${baseName(current.name)}_선택${pages.length}쪽.pdf`);
        setStatus(`${pages.length}쪽을 한 파일로 저장했습니다 (${formatPageRange(pages)}).`, "ok");
      } catch (err) {
        console.error(err);
        setStatus("저장에 실패했습니다: " + (err.message || err), "error");
      } finally {
        setBusy(false);
      }
    });
  }

  window.HilinePdfEditorTool = {
    init,
    _internal: { parsePageRange, formatPageRange, splitToZip, mergeToOne, baseName, extractPages, loadPdf },
  };
})();
