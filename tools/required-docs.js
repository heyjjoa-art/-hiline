/*
 * 필요서류
 * 통장사본·사업자등록증처럼 자주 인쇄하거나 제출하는 파일을 등록해두고, 필요할 때 바로
 * 인쇄하거나 내려받는다. 여러 개를 골라 한 번에(한 PDF로 합쳐서) 인쇄·저장할 수도 있다.
 *
 * 보관 위치: 이 페이지를 file://로 여는 환경이라 서버가 없다. 브라우저 안에 저장하는데,
 *  - 우선 IndexedDB에 원본 그대로(Blob) 넣는다. 용량 제한이 넉넉하다.
 *  - IndexedDB가 막힌 환경이면 localStorage에 base64로 넣는다(용량이 5MB 남짓이라 좁다).
 * 어느 쪽을 쓰고 있는지는 화면에 표시해서, 좁은 쪽으로 떨어졌을 때 사용자가 알 수 있게 한다.
 *
 * 인쇄는 항상 PDF로 변환해서 한다 — 이미지를 그대로 인쇄하면 배율이 제각각이라,
 * pdf-merge의 mergeToPdf를 재사용해 A4에 맞춘 PDF로 만든 뒤 인쇄한다.
 */
(function () {
  const DB_NAME = "hiline-required-docs";
  const STORE = "docs";
  const LS_KEY = "hiline_required_docs";

  // ---------- 보관소 (IndexedDB 우선, 안 되면 localStorage) ----------

  let backend = null; // "idb" | "ls"

  function openDb() {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB를 열지 못했습니다."));
      req.onblocked = () => reject(new Error("IndexedDB가 다른 탭에서 잠겨 있습니다."));
    });
  }

  function idbRequest(store, fn) {
    return new Promise((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbTx(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("저장이 취소되었습니다."));
      });
    } finally {
      db.close();
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || "application/octet-stream" });
  }

  function lsRead() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch (err) {
      console.error("필요서류 목록을 읽지 못했습니다", err);
      return [];
    }
  }

  function lsWrite(list) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list));
    } catch (err) {
      throw new Error("브라우저 저장 공간이 가득 찼습니다. 필요 없는 서류를 지운 뒤 다시 시도해주세요.");
    }
  }

  // 어느 보관소를 쓸지 한 번만 정한다. IndexedDB는 열기 자체가 막히는 환경이 있어서
  // 실제로 열어보고 판단한다(브라우저마다 file:// 정책이 다름).
  async function pickBackend() {
    if (backend) return backend;
    try {
      const db = await openDb();
      db.close();
      backend = "idb";
    } catch (err) {
      console.warn("IndexedDB를 쓸 수 없어 localStorage로 대체합니다:", err && err.message);
      backend = "ls";
    }
    return backend;
  }

  const storage = {
    async list() {
      if (await pickBackend() === "idb") {
        const rows = await idbTx("readonly", store => idbRequest(store, s => s.getAll()));
        return (rows || []).sort((a, b) => a.addedAt - b.addedAt);
      }
      return lsRead().map(r => ({ ...r, blob: base64ToBlob(r.data, r.type) }));
    },

    async add(record) {
      if (await pickBackend() === "idb") {
        await idbTx("readwrite", store => idbRequest(store, s => s.add(record)));
        return;
      }
      const list = lsRead();
      list.push({
        id: Date.now() + Math.random(),
        name: record.name, type: record.type, size: record.size, addedAt: record.addedAt,
        data: await blobToBase64(record.blob),
      });
      lsWrite(list);
    },

    async remove(id) {
      if (await pickBackend() === "idb") {
        await idbTx("readwrite", store => idbRequest(store, s => s.delete(id)));
        return;
      }
      lsWrite(lsRead().filter(r => r.id !== id));
    },

    async rename(id, name) {
      if (await pickBackend() === "idb") {
        await idbTx("readwrite", async store => {
          const rec = await idbRequest(store, s => s.get(id));
          if (!rec) return;
          rec.name = name;
          await idbRequest(store, s => s.put(rec));
        });
        return;
      }
      const list = lsRead();
      const rec = list.find(r => r.id === id);
      if (rec) { rec.name = name; lsWrite(list); }
    },
  };

  // ---------- 인쇄 / 저장 ----------

  const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|avif)$/i;

  function kindOf(rec) {
    if (/\.pdf$/i.test(rec.name) || rec.type === "application/pdf") return "pdf";
    if (IMAGE_EXT.test(rec.name) || /^image\//.test(rec.type || "")) return "image";
    return "unknown";
  }

  // 고른 서류들을 PDF 1개로 만든다. 이미지는 A4에 맞춰 들어간다.
  // pdf-merge 도구의 mergeToPdf를 그대로 재사용한다(같은 규칙으로 처리되도록).
  async function buildPdf(records) {
    const merge = window.HilinePdfMergeTool && window.HilinePdfMergeTool._internal;
    if (!merge) throw new Error("PDF 변환 기능을 불러오지 못했습니다 (tools/pdf-merge.js 확인 필요).");
    const items = records.map(rec => ({
      file: new File([rec.blob], rec.name, { type: rec.type || "" }),
      kind: kindOf(rec) === "pdf" ? "pdf" : "image",
    }));
    const bytes = await merge.mergeToPdf(items, "fit");
    return new Blob([bytes], { type: "application/pdf" });
  }

  /*
   * 인쇄에 대해 (중요)
   * ------------------
   * 원래 blob URL을 iframe에 올리고 `iframe.contentWindow.print()`를 부르는 방식이었는데,
   * index.html을 file://로 여는 이 환경에서는 이게 동작하지 않는다. 이유가 두 가지 겹친다.
   *
   *  1) file:// 문서는 브라우저가 origin을 "null"(불투명 origin)로 취급한다. 여기서 만든
   *     blob URL은 `blob:null/...`이 되고, 그 iframe은 부모(file://) 기준으로 교차 출처다.
   *     그래서 `iframe.contentWindow.print()`에 손대는 순간 SecurityError가 난다
   *     → 잡아서 "인쇄 창을 열지 못했습니다" 메시지만 뜨고 실제 인쇄 대화상자는 안 뜬다.
   *  2) 설령 출처가 같아도, iframe 안의 PDF는 크롬 내장 PDF 뷰어(플러그인 문서)가 그린다.
   *     이건 스크립트로 print()를 부를 수 있는 일반 HTML 문서가 아니라서 역시 신뢰할 수 없다.
   *
   * 그래서 인쇄 경로를 둘로 나눈다.
   *  - 이미지만 고른 경우: PDF를 거치지 않고, 부모와 같은 출처인 iframe(srcdoc)에 이미지를
   *    data URL로 넣은 HTML을 그려서 인쇄한다. 이건 교차 출처 문제가 없어 확실히 동작한다.
   *  - PDF가 하나라도 섞인 경우: 브라우저 안에서 PDF를 직접 인쇄할 방법이 없으므로 새 탭으로
   *    열어 사용자가 Ctrl+P를 누르게 안내하고, 새 탭도 막히면 파일로 내려준다.
   */

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("파일을 읽지 못했습니다."));
      reader.readAsDataURL(blob);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // 이미지들을 A4 한 장에 하나씩 넣은 인쇄용 HTML을 만든다
  function buildImagePrintHtml(entries) {
    const pages = entries.map(e => `
      <div class="page"><img src="${e.dataUrl}" alt="${escapeHtml(e.name)}"></div>`).join("");
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>필요서류 인쇄</title>
<style>
  @page { size: A4; margin: 10mm; }
  html, body { margin: 0; padding: 0; }
  .page {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 277mm;      /* A4 세로 297mm - 위아래 여백 10mm씩 */
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body>${pages}</body></html>`;
  }

  // 같은 출처(srcdoc) iframe에 HTML을 그려서 인쇄한다 — file://에서도 동작하는 경로
  function printHtml(html) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:fixed; right:0; bottom:0; width:0; height:0; border:0;";
      iframe.onload = () => {
        try {
          const win = iframe.contentWindow;
          // 이미지가 다 그려지기 전에 인쇄하면 빈 장이 나올 수 있어 한 박자 기다린다
          setTimeout(() => {
            try {
              win.focus();
              win.print();
              resolve();
            } catch (err) {
              reject(new Error("인쇄 창을 열지 못했습니다. '다운로드'로 받아서 인쇄해주세요."));
            } finally {
              setTimeout(() => iframe.remove(), 60000);
            }
          }, 250);
        } catch (err) {
          iframe.remove();
          reject(new Error("인쇄 창을 열지 못했습니다. '다운로드'로 받아서 인쇄해주세요."));
        }
      };
      iframe.onerror = () => { iframe.remove(); reject(new Error("인쇄용 화면을 만들지 못했습니다.")); };
      document.body.appendChild(iframe);
      iframe.srcdoc = html;
    });
  }

  // http(s)로 열렸으면 blob URL이 페이지와 같은 출처가 되어 iframe 안의 PDF도 인쇄할 수 있다.
  // file://에서는 origin이 "null"이라 이 방법이 통하지 않는다.
  function canPrintPdfInPage() {
    return location.protocol === "http:" || location.protocol === "https:";
  }

  // 같은 출처일 때만 쓰는 경로 — blob URL을 iframe에 올려 바로 인쇄한다
  function printPdfInIframe(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:fixed; right:0; bottom:0; width:0; height:0; border:0;";
      let settled = false;
      const fail = msg => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        iframe.remove();
        reject(new Error(msg));
      };
      iframe.onload = () => {
        // PDF 뷰어가 준비되기 전에 부르면 아무 일도 안 일어나서 한 박자 기다린다
        setTimeout(() => {
          if (settled) return;
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            settled = true;
            resolve();
            setTimeout(() => { URL.revokeObjectURL(url); iframe.remove(); }, 60000);
          } catch (err) {
            fail("iframe 인쇄 실패");
          }
        }, 400);
      };
      iframe.onerror = () => fail("인쇄용 파일을 불러오지 못했습니다.");
      iframe.src = url;
      document.body.appendChild(iframe);
    });
  }

  // PDF는 새 탭으로 열어 사용자가 직접 인쇄하게 한다(file://에서의 대체 경로).
  // 반환값으로 어떻게 처리했는지 알려줘서 화면 안내 문구를 맞출 수 있게 한다.
  function openPdfForPrint(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return "opened";
    }
    // 새 탭이 막히면 파일로 내려준다
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return "downloaded";
  }

  // 고른 서류를 인쇄한다. 이미지만이면 바로 인쇄, PDF가 섞이면 새 탭/다운로드로 넘긴다.
  async function printDocs(records) {
    if (!records.length) throw new Error("인쇄할 서류를 골라주세요.");

    if (records.every(rec => kindOf(rec) === "image")) {
      const entries = [];
      for (const rec of records) {
        entries.push({ name: rec.name, dataUrl: await blobToDataUrl(rec.blob) });
      }
      await printHtml(buildImagePrintHtml(entries));
      return { mode: "printed" };
    }

    const blob = await buildPdf(records);
    const name = records.length === 1
      ? `${records[0].name.replace(/\.[^.]+$/, "")}.pdf`
      : "필요서류.pdf";

    // http로 열렸으면 페이지 안에서 바로 인쇄를 시도하고, 안 되면 새 탭으로 넘긴다
    if (canPrintPdfInPage()) {
      try {
        await printPdfInIframe(blob);
        return { mode: "printed" };
      } catch (err) {
        console.warn("페이지 안 PDF 인쇄에 실패해 새 탭으로 엽니다:", err && err.message);
      }
    }
    return { mode: openPdfForPrint(blob, name) };
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 인쇄 경로가 셋(바로 인쇄 / 새 탭 / 다운로드)이라 결과를 그대로 알려준다.
  // PDF는 브라우저 제약상 바로 인쇄가 안 되므로, 왜 새 탭이 떴는지 사용자가 알 수 있게 한다.
  function printResultMessage(result) {
    if (result.mode === "printed") return "인쇄 창을 열었습니다.";
    if (result.mode === "opened") return "새 탭에서 PDF를 열었습니다. 그 탭에서 Ctrl+P로 인쇄해주세요 (PDF는 브라우저가 바로 인쇄하지 못합니다).";
    return "새 탭이 차단돼 파일로 내려받았습니다. 받은 파일을 열어 인쇄해주세요.";
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
    return (bytes / 1024 / 1024).toFixed(1) + "MB";
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ---------- 화면 ----------

  function init(root) {
    const els = {
      zone: root.querySelector("#rd-dropzone"),
      input: root.querySelector("#rd-file"),
      list: root.querySelector("#rd-list"),
      empty: root.querySelector("#rd-empty"),
      summary: root.querySelector("#rd-summary"),
      selectAll: root.querySelector("#rd-select-all"),
      printBtn: root.querySelector("#rd-print-btn"),
      saveBtn: root.querySelector("#rd-save-btn"),
      status: root.querySelector("#rd-status"),
      store: root.querySelector("#rd-store"),
    };
    if (!els.zone) return;

    let docs = [];
    const selected = new Set();
    let busy = false;

    function setStatus(msg, kind) {
      els.status.textContent = msg;
      els.status.style.color = kind === "error" ? "#dc2626" : kind === "ok" ? "#16a34a" : "";
    }

    function setBusy(on) {
      busy = on;
      els.printBtn.disabled = on;
      els.saveBtn.disabled = on;
    }

    function selectedDocs() {
      return docs.filter(d => selected.has(d.id));
    }

    function renderSummary() {
      const n = selected.size;
      els.summary.textContent = docs.length
        ? `등록 ${docs.length}건 · 선택 ${n}건`
        : "";
      els.printBtn.textContent = n > 1 ? `선택 ${n}건 합쳐서 인쇄` : "선택 항목 인쇄";
      els.saveBtn.textContent = n > 1 ? `선택 ${n}건 합쳐서 PDF 저장` : "선택 항목 PDF로 저장";
      els.printBtn.disabled = busy || n === 0;
      els.saveBtn.disabled = busy || n === 0;
      els.selectAll.checked = docs.length > 0 && n === docs.length;
    }

    function render() {
      els.list.innerHTML = "";
      els.empty.style.display = docs.length ? "none" : "";

      for (const doc of docs) {
        const row = document.createElement("div");
        row.className = "rd-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(doc.id);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(doc.id); else selected.delete(doc.id);
          renderSummary();
        });

        const icon = document.createElement("span");
        icon.textContent = kindOf(doc) === "pdf" ? "📕" : "🖼️";

        const name = document.createElement("span");
        name.className = "rd-name";
        name.textContent = doc.name;
        name.title = doc.name;

        const meta = document.createElement("span");
        meta.className = "rd-meta";
        meta.textContent = `${formatSize(doc.size)} · ${formatDate(doc.addedAt)}`;

        const mk = (text, title, handler, extraClass) => {
          const b = document.createElement("button");
          b.className = "rd-mini-btn" + (extraClass ? " " + extraClass : "");
          b.textContent = text;
          b.title = title;
          b.addEventListener("click", handler);
          return b;
        };

        const printBtn = mk("인쇄", "이 서류만 인쇄", async () => {
          if (busy) return;
          setBusy(true);
          try {
            setStatus(`"${doc.name}" 인쇄 준비 중...`);
            setStatus(printResultMessage(await printDocs([doc])), "ok");
          } catch (err) {
            console.error(err);
            setStatus(err.message || "인쇄에 실패했습니다.", "error");
          } finally {
            setBusy(false);
            renderSummary();
          }
        });

        const dlBtn = mk("다운로드", "원본 파일 그대로 내려받기", () => {
          downloadBlob(doc.blob, doc.name);
          setStatus(`"${doc.name}"을(를) 내려받았습니다.`, "ok");
        });

        const renameBtn = mk("이름변경", "표시 이름 바꾸기", async () => {
          const next = prompt("새 이름을 입력하세요", doc.name);
          if (next === null) return;
          const trimmed = next.trim();
          if (!trimmed) { setStatus("이름은 비워둘 수 없습니다.", "error"); return; }
          await storage.rename(doc.id, trimmed);
          await reload();
          setStatus("이름을 바꿨습니다.", "ok");
        });

        const delBtn = mk("삭제", "목록에서 지우기", async () => {
          if (!confirm(`"${doc.name}"을(를) 삭제할까요?`)) return;
          await storage.remove(doc.id);
          selected.delete(doc.id);
          await reload();
          setStatus("삭제했습니다.", "ok");
        }, "rd-del-btn");

        row.append(cb, icon, name, meta, printBtn, dlBtn, renameBtn, delBtn);
        els.list.appendChild(row);
      }
      renderSummary();
    }

    async function reload() {
      docs = await storage.list();
      // 지워진 항목이 선택 상태로 남지 않게 정리
      const ids = new Set(docs.map(d => d.id));
      [...selected].forEach(id => { if (!ids.has(id)) selected.delete(id); });
      render();
      const where = backend === "idb"
        ? "보관 위치: 이 브라우저 (IndexedDB)"
        : "보관 위치: 이 브라우저 (localStorage · 용량이 좁으니 큰 파일은 피해주세요)";
      // file://로 열면 PDF 인쇄·저장 공간에 제약이 있어서, 서버로 여는 방법을 같이 안내한다
      els.store.textContent = location.protocol === "file:"
        ? `${where} · 지금은 파일로 직접 열려 있어 PDF는 새 탭에서 인쇄해야 합니다 — "tools/helper-server/start-server-now.bat"으로 열면 바로 인쇄됩니다.`
        : where;
    }

    async function addFiles(fileList) {
      if (busy) return;
      const skipped = [];
      let added = 0;
      for (const file of Array.from(fileList)) {
        const rec = {
          name: file.name,
          type: file.type || "",
          size: file.size,
          addedAt: Date.now(),
          blob: file,
        };
        if (kindOf(rec) === "unknown") { skipped.push(file.name); continue; }
        try {
          await storage.add(rec);
          added++;
        } catch (err) {
          console.error(err);
          setStatus(err.message || `"${file.name}" 저장에 실패했습니다.`, "error");
          break;
        }
      }
      await reload();
      if (added) {
        setStatus(`${added}건을 등록했습니다.` + (skipped.length ? ` 건너뜀: ${skipped.join(", ")}` : ""),
          skipped.length ? "error" : "ok");
      } else if (skipped.length) {
        setStatus(`PDF·이미지 파일만 등록할 수 있습니다. 건너뜀: ${skipped.join(", ")}`, "error");
      }
    }

    els.zone.addEventListener("click", () => { if (!busy) els.input.click(); });
    els.input.addEventListener("change", () => {
      if (els.input.files.length) addFiles(els.input.files);
      els.input.value = "";
    });
    els.zone.addEventListener("dragover", e => { e.preventDefault(); els.zone.classList.add("dragover"); });
    els.zone.addEventListener("dragleave", () => els.zone.classList.remove("dragover"));
    els.zone.addEventListener("drop", e => {
      e.preventDefault();
      els.zone.classList.remove("dragover");
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    els.selectAll.addEventListener("change", () => {
      selected.clear();
      if (els.selectAll.checked) docs.forEach(d => selected.add(d.id));
      render();
    });

    els.printBtn.addEventListener("click", async () => {
      const picked = selectedDocs();
      if (!picked.length || busy) return;
      setBusy(true);
      try {
        setStatus(`${picked.length}건 인쇄 준비 중...`);
        setStatus(printResultMessage(await printDocs(picked)), "ok");
      } catch (err) {
        console.error(err);
        setStatus(err.message || "인쇄에 실패했습니다.", "error");
      } finally {
        setBusy(false);
        renderSummary();
      }
    });

    els.saveBtn.addEventListener("click", async () => {
      const picked = selectedDocs();
      if (!picked.length || busy) return;
      setBusy(true);
      try {
        setStatus(`${picked.length}건을 PDF로 만드는 중...`);
        const blob = await buildPdf(picked);
        downloadBlob(blob, picked.length === 1 ? `${picked[0].name.replace(/\.[^.]+$/, "")}.pdf` : "필요서류.pdf");
        setStatus(`${picked.length}건을 PDF로 저장했습니다.`, "ok");
      } catch (err) {
        console.error(err);
        setStatus(err.message || "저장에 실패했습니다.", "error");
      } finally {
        setBusy(false);
        renderSummary();
      }
    });

    reload().catch(err => {
      console.error(err);
      setStatus("저장된 서류를 불러오지 못했습니다: " + (err.message || err), "error");
    });
  }

  window.HilineRequiredDocsTool = {
    init,
    _internal: {
      kindOf, buildPdf, formatSize, formatDate, storage, pickBackend, base64ToBlob,
      printDocs, buildImagePrintHtml, printResultMessage, escapeHtml,
    },
  };
})();
