/*
 * PDF 파일 변환 (여러 PDF/이미지 → PDF 1개)
 * 여러 개의 PDF와 이미지 파일을 원하는 순서로 늘어놓고 한 개의 PDF로 합친다.
 * 처리는 전부 브라우저 안에서 이뤄지고(pdf-lib), 파일은 서버로 전송되지 않는다.
 *
 * 이미지는 pdf-lib가 JPEG/PNG만 직접 임베드할 수 있어서, 그 외 형식(webp/gif/bmp 등)은
 * 캔버스에 그려 PNG로 바꾼 뒤 넣는다(브라우저가 열 수 있는 형식이면 다 된다).
 */
(function () {
  const A4 = { width: 595.28, height: 841.89 };

  const IMAGE_EXT = /\.(jpe?g|png|gif|bmp|webp|avif)$/i;
  const PDF_EXT = /\.pdf$/i;

  function fileKind(file) {
    if (PDF_EXT.test(file.name) || file.type === "application/pdf") return "pdf";
    if (IMAGE_EXT.test(file.name) || /^image\//.test(file.type || "")) return "image";
    return "unknown";
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + "B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + "KB";
    return (bytes / 1024 / 1024).toFixed(1) + "MB";
  }

  // 브라우저가 열 수 있는 이미지면 뭐든 캔버스를 거쳐 PNG 바이트로 바꾼다
  function imageToPngBytes(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext("2d").drawImage(img, 0, 0);
          canvas.toBlob(blob => {
            URL.revokeObjectURL(url);
            if (!blob) { reject(new Error("이미지를 변환하지 못했습니다.")); return; }
            blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
          }, "image/png");
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("이미지를 열지 못했습니다 (지원하지 않는 형식일 수 있습니다)."));
      };
      img.src = url;
    });
  }

  async function embedImageInto(out, file, arrayBuffer) {
    const name = file.name || "";
    const type = file.type || "";
    if (/jpe?g/i.test(type) || /\.jpe?g$/i.test(name)) return out.embedJpg(arrayBuffer);
    if (/png/i.test(type) || /\.png$/i.test(name)) return out.embedPng(arrayBuffer);
    return out.embedPng(await imageToPngBytes(file));
  }

  // 이미지 한 장을 페이지로 만든다.
  //  - "fit": A4 세로에 비율 유지해서 가운데 맞춤 (스캔 문서를 섞을 때 크기가 들쭉날쭉하지 않게)
  //  - "natural": 이미지 크기 그대로를 페이지 크기로 (원본 비율/해상도를 그대로 두고 싶을 때)
  function addImagePage(out, image, pageMode) {
    if (pageMode === "natural") {
      const page = out.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      return;
    }
    const page = out.addPage([A4.width, A4.height]);
    const scale = Math.min(A4.width / image.width, A4.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: (A4.width - w) / 2, y: (A4.height - h) / 2, width: w, height: h });
  }

  // items: [{ file, kind }] 순서대로 합친다.
  // onProgress(현재, 전체, 파일명)으로 진행 상황을 알려준다(파일이 많으면 오래 걸려서).
  async function mergeToPdf(items, pageMode, onProgress) {
    if (!items.length) throw new Error("합칠 파일이 없습니다.");
    const out = await PDFLib.PDFDocument.create();

    for (let i = 0; i < items.length; i++) {
      const { file, kind } = items[i];
      if (onProgress) {
        onProgress(i + 1, items.length, file.name);
        // 진행 표시가 화면에 반영되도록 이벤트 루프를 한 번 넘겨준다
        await new Promise(r => setTimeout(r, 0));
      }
      const buffer = await file.arrayBuffer();
      try {
        if (kind === "pdf") {
          const src = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
          const copied = await out.copyPages(src, src.getPageIndices());
          copied.forEach(p => out.addPage(p));
        } else {
          const image = await embedImageInto(out, file, buffer);
          addImagePage(out, image, pageMode);
        }
      } catch (err) {
        // 어느 파일에서 막혔는지 알려주지 않으면 원인을 찾기 어렵다
        throw new Error(`"${file.name}" 처리 중 실패: ${err.message || err}`);
      }
    }

    if (!out.getPageCount()) throw new Error("만들어진 페이지가 없습니다.");
    return out.save();
  }

  // ---------- 화면 ----------

  function init(root) {
    const els = {
      zone: root.querySelector("#pm-dropzone"),
      input: root.querySelector("#pm-file"),
      panel: root.querySelector("#pm-panel"),
      list: root.querySelector("#pm-list"),
      summary: root.querySelector("#pm-summary"),
      clearBtn: root.querySelector("#pm-clear-btn"),
      sortBtn: root.querySelector("#pm-sort-btn"),
      mergeBtn: root.querySelector("#pm-merge-btn"),
      status: root.querySelector("#pm-status"),
    };
    if (!els.zone) return;

    let items = [];   // { file, kind, pageCount }
    let busy = false;

    function setStatus(msg, kind) {
      els.status.textContent = msg;
      els.status.style.color = kind === "error" ? "#dc2626" : kind === "ok" ? "#16a34a" : "";
    }

    function setBusy(on) {
      busy = on;
      els.mergeBtn.disabled = on;
      els.clearBtn.disabled = on;
      els.sortBtn.disabled = on;
    }

    function render() {
      els.panel.style.display = items.length ? "" : "none";
      els.list.innerHTML = "";

      items.forEach((item, idx) => {
        const row = document.createElement("div");
        row.className = "pm-item";

        const order = document.createElement("span");
        order.className = "pm-order";
        order.textContent = String(idx + 1);

        const icon = document.createElement("span");
        icon.textContent = item.kind === "pdf" ? "📕" : "🖼️";

        const name = document.createElement("span");
        name.className = "pm-name";
        name.textContent = item.file.name;
        name.title = item.file.name;

        const meta = document.createElement("span");
        meta.className = "pm-meta";
        meta.textContent = item.kind === "pdf"
          ? `PDF · ${item.pageCount}쪽 · ${formatSize(item.file.size)}`
          : `이미지 · ${formatSize(item.file.size)}`;

        const up = document.createElement("button");
        up.className = "pm-mini-btn";
        up.textContent = "▲";
        up.title = "위로";
        up.disabled = idx === 0;
        up.addEventListener("click", () => move(idx, -1));

        const down = document.createElement("button");
        down.className = "pm-mini-btn";
        down.textContent = "▼";
        down.title = "아래로";
        down.disabled = idx === items.length - 1;
        down.addEventListener("click", () => move(idx, 1));

        const del = document.createElement("button");
        del.className = "pm-mini-btn pm-del-btn";
        del.textContent = "삭제";
        del.addEventListener("click", () => { items.splice(idx, 1); render(); });

        row.append(order, icon, name, meta, up, down, del);
        els.list.appendChild(row);
      });

      const pdfCount = items.filter(i => i.kind === "pdf").length;
      const imgCount = items.length - pdfCount;
      const pageTotal = items.reduce((a, i) => a + (i.kind === "pdf" ? i.pageCount : 1), 0);
      els.summary.textContent = items.length
        ? `파일 ${items.length}개 (PDF ${pdfCount} · 이미지 ${imgCount}) · 합치면 약 ${pageTotal}쪽`
        : "";
      els.mergeBtn.textContent = items.length
        ? `${items.length}개 파일을 PDF 1개로 저장`
        : "PDF 1개로 저장";
    }

    function move(idx, delta) {
      const to = idx + delta;
      if (to < 0 || to >= items.length) return;
      [items[idx], items[to]] = [items[to], items[idx]];
      render();
    }

    // 파일은 덮어쓰지 않고 뒤에 이어 붙인다(여러 번 나눠 담을 수 있게)
    async function addFiles(fileList) {
      if (busy) return;
      const skipped = [];
      let added = 0;
      for (const file of Array.from(fileList)) {
        const kind = fileKind(file);
        if (kind === "unknown") { skipped.push(file.name); continue; }

        const item = { file, kind, pageCount: 1 };
        if (kind === "pdf") {
          try {
            const doc = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
            item.pageCount = doc.getPageCount();
          } catch (err) {
            skipped.push(`${file.name} (열 수 없음)`);
            continue;
          }
        }
        items.push(item);
        added++;
      }
      render();
      if (skipped.length) {
        setStatus(`${added}개를 추가했습니다. 건너뜀: ${skipped.join(", ")}`, "error");
      } else {
        setStatus(`${added}개를 추가했습니다. 순서를 맞춘 뒤 저장하세요.`, "ok");
      }
    }

    els.zone.addEventListener("click", () => { if (!busy) els.input.click(); });
    els.input.addEventListener("change", () => {
      if (els.input.files.length) addFiles(els.input.files);
      els.input.value = ""; // 같은 파일을 다시 골라도 change가 뜨도록
    });
    els.zone.addEventListener("dragover", e => { e.preventDefault(); els.zone.classList.add("dragover"); });
    els.zone.addEventListener("dragleave", () => els.zone.classList.remove("dragover"));
    els.zone.addEventListener("drop", e => {
      e.preventDefault();
      els.zone.classList.remove("dragover");
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });

    els.clearBtn.addEventListener("click", () => {
      if (busy) return;
      items = [];
      render();
      setStatus("목록을 비웠습니다.");
    });

    els.sortBtn.addEventListener("click", () => {
      if (busy) return;
      // 숫자가 섞인 파일명이 1,10,2 순으로 가지 않도록 자연 정렬
      const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
      items.sort((a, b) => collator.compare(a.file.name, b.file.name));
      render();
      setStatus("파일명 순으로 정렬했습니다.");
    });

    els.mergeBtn.addEventListener("click", async () => {
      if (busy) return;
      if (!items.length) { setStatus("합칠 파일을 먼저 올려주세요.", "error"); return; }
      const pageMode = (root.querySelector("input[name=pm-page-mode]:checked") || {}).value || "fit";

      setBusy(true);
      try {
        const bytes = await mergeToPdf(items, pageMode,
          (done, total, name) => setStatus(`합치는 중... ${done}/${total} (${name})`));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "합친문서.pdf";
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`파일 ${items.length}개를 PDF 1개로 저장했습니다.`, "ok");
      } catch (err) {
        console.error(err);
        setStatus("저장에 실패했습니다: " + (err.message || err), "error");
      } finally {
        setBusy(false);
      }
    });

    render();
  }

  window.HilinePdfMergeTool = {
    init,
    _internal: { mergeToPdf, fileKind, formatSize, addImagePage, A4 },
  };
})();
