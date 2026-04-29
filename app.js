/* LOADER */
const loaderOverlay = document.getElementById("loaderOverlay");
const loaderMessage = document.getElementById("loaderMessage");

function showLoader(msg = "Processing") {
  loaderMessage.textContent = msg;
  loaderOverlay.classList.add("active");
}

function hideLoader() {
  loaderOverlay.classList.remove("active");
}

const tabButtons = document.querySelectorAll(".tab-btn");
const toolSections = document.querySelectorAll(".tool-section");

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((item) => item.classList.remove("active"));
    toolSections.forEach((section) => section.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(button.dataset.tab).classList.add("active");
  });
});

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.dataset.loaded = "false";
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function cmToPx(cm, dpi) {
  return Math.round((Number(cm) / 2.54) * Number(dpi));
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas, type = "image/png", quality = 0.92) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

/* Inject pHYs chunk into PNG to set correct DPI so downloaded file shows correct mm size */
async function pngWithDpi(blob, dpi) {
  const ppm = Math.round(dpi / 0.0254); // pixels per meter
  const buf = await blob.arrayBuffer();
  const src = new Uint8Array(buf);

  // PNG: 8-byte signature, then chunks. pHYs must appear before first IDAT.
  // Each chunk: 4-byte length, 4-byte type, data, 4-byte CRC
  const pHYsData = new Uint8Array(9);
  const view = new DataView(pHYsData.buffer);
  view.setUint32(0, ppm); // X pixels per unit
  view.setUint32(4, ppm); // Y pixels per unit
  pHYsData[8] = 1;        // unit = meter

  // Build pHYs chunk: length(4) + "pHYs"(4) + data(9) + CRC(4) = 21 bytes
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, 9); // data length
  chunk[4] = 0x70; chunk[5] = 0x48; chunk[6] = 0x59; chunk[7] = 0x73; // "pHYs"
  chunk.set(pHYsData, 8);

  // CRC over type + data
  const crcInput = chunk.slice(4, 4 + 4 + 9);
  chunkView.setUint32(17, crc32(crcInput));

  // Find insertion point: right after IHDR chunk (signature=8, IHDR chunk = 8+13+4+4 = 25+4=29... just find end of IHDR)
  // IHDR is always first chunk at offset 8. Its length is at offset 8..11, always 13.
  const ihdrLen = (src[8] << 24 | src[9] << 16 | src[10] << 8 | src[11]) >>> 0;
  const insertAt = 8 + 4 + 4 + ihdrLen + 4; // after signature + IHDR length + type + data + crc

  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.slice(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(src.slice(insertAt), insertAt + chunk.length);

  return new Blob([out], { type: "image/png" });
}

/* CRC32 for PNG chunks */
const _crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = _crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* Inject JFIF DPI into JPEG blob */
async function jpgWithDpi(blob, dpi) {
  const buf = await blob.arrayBuffer();
  const src = new Uint8Array(buf);

  // Build JFIF APP0 marker: FF E0 + length(2) + "JFIF\0" + version + units + Xdpi + Ydpi + thumb
  const jfif = new Uint8Array(20);
  const jv = new DataView(jfif.buffer);
  jfif[0] = 0xFF; jfif[1] = 0xE0;       // APP0 marker
  jv.setUint16(2, 18);                    // length (18 bytes after marker)
  // "JFIF\0"
  jfif[4] = 0x4A; jfif[5] = 0x46; jfif[6] = 0x49; jfif[7] = 0x46; jfif[8] = 0x00;
  jfif[9] = 1; jfif[10] = 1;              // version 1.1
  jfif[11] = 1;                            // units = DPI
  jv.setUint16(12, dpi);                   // X density
  jv.setUint16(14, dpi);                   // Y density
  jfif[16] = 0; jfif[17] = 0;             // no thumbnail
  jfif[18] = 0; jfif[19] = 0;

  // Insert after SOI (FF D8) at offset 0-1, skip existing APP0/APP1 if present
  let insertAt = 2;
  // Skip existing APP0 if present
  if (src[2] === 0xFF && src[3] === 0xE0) {
    const existingLen = (src[4] << 8 | src[5]);
    insertAt = 2 + 2 + existingLen; // skip marker + length + data
  }

  const out = new Uint8Array(2 + jfif.length + (src.length - insertAt));
  out.set(src.slice(0, 2), 0);            // SOI
  out.set(jfif, 2);                        // our JFIF APP0
  out.set(src.slice(insertAt), 2 + jfif.length); // rest of file

  return new Blob([out], { type: "image/jpeg" });
}

/* IMAGE COMPRESSOR */
const imageInput = document.getElementById("imageInput");
const imageType = document.getElementById("imageType");
const qualityRange = document.getElementById("qualityRange");
const qualityValue = document.getElementById("qualityValue");
const maxWidth = document.getElementById("maxWidth");
const maxHeight = document.getElementById("maxHeight");
const compressBtn = document.getElementById("compressBtn");
const downloadCompressedBtn = document.getElementById("downloadCompressedBtn");
const clearImageBtn = document.getElementById("clearImageBtn");
const originalSize = document.getElementById("originalSize");
const compressedSize = document.getElementById("compressedSize");
const savedPercent = document.getElementById("savedPercent");
const outputPixels = document.getElementById("outputPixels");
const imagePreview = document.getElementById("imagePreview");
const imagePlaceholder = document.getElementById("imagePlaceholder");

let originalImageFile = null;
let compressedBlob = null;
let compressedFileName = "compressed-image.jpg";

qualityRange.addEventListener("input", () => {
  qualityValue.textContent = `${qualityRange.value}%`;
});

imageInput.addEventListener("change", () => {
  originalImageFile = imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;
  compressedBlob = null;

  if (!originalImageFile) return;

  originalSize.textContent = formatBytes(originalImageFile.size);
  compressedSize.textContent = "-";
  savedPercent.textContent = "-";
  outputPixels.textContent = "-";

  const url = URL.createObjectURL(originalImageFile);
  imagePreview.src = url;
  imagePreview.onload = () => URL.revokeObjectURL(url);
  imagePreview.style.display = "block";
  imagePlaceholder.style.display = "none";
});

function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const url = typeof fileOrUrl === "string" ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    const img = new Image();

    img.onload = () => {
      if (typeof fileOrUrl !== "string") URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      if (typeof fileOrUrl !== "string") URL.revokeObjectURL(url);
      reject(new Error("Could not load image."));
    };

    img.src = url;
  });
}

compressBtn.addEventListener("click", async () => {
  if (!originalImageFile) {
    alert("Please upload an image first.");
    return;
  }

  showLoader("Compressing image");
  try {
    const img = await loadImage(originalImageFile);
    const maxW = Math.max(100, Number(maxWidth.value) || img.naturalWidth);
    const maxH = Math.max(100, Number(maxHeight.value) || img.naturalHeight);

    let width = img.naturalWidth;
    let height = img.naturalHeight;

    const ratio = Math.min(maxW / width, maxH / height, 1);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const type = imageType.value;
    const quality = Number(qualityRange.value) / 100;

    compressedBlob = await new Promise((resolve) => {
      canvas.toBlob(resolve, type, type === "image/png" ? undefined : quality);
    });

    if (!compressedBlob) {
      alert("Could not compress this image.");
      return;
    }

    const ext = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
    compressedFileName = `compressed-image.${ext}`;

    const compressedUrl = URL.createObjectURL(compressedBlob);
    imagePreview.src = compressedUrl;
    imagePreview.onload = () => URL.revokeObjectURL(compressedUrl);

    compressedSize.textContent = formatBytes(compressedBlob.size);
    outputPixels.textContent = `${width}×${height}`;

    const saved = originalImageFile.size > 0
      ? ((1 - compressedBlob.size / originalImageFile.size) * 100)
      : 0;

    savedPercent.textContent = `${Math.max(0, saved).toFixed(1)}%`;
  } catch (error) {
    console.error(error);
    alert("Image compression failed.");
  } finally {
    hideLoader();
  }
});

downloadCompressedBtn.addEventListener("click", () => {
  if (!compressedBlob) {
    alert("Please compress an image first.");
    return;
  }
  downloadBlob(compressedBlob, compressedFileName);
});

clearImageBtn.addEventListener("click", () => {
  imageInput.value = "";
  originalImageFile = null;
  compressedBlob = null;
  originalSize.textContent = "-";
  compressedSize.textContent = "-";
  savedPercent.textContent = "-";
  outputPixels.textContent = "-";
  imagePreview.removeAttribute("src");
  imagePreview.style.display = "none";
  imagePlaceholder.style.display = "block";
});

/* QR CODE */
const qrText = document.getElementById("qrText");
const qrSize = document.getElementById("qrSize");
const qrCorrection = document.getElementById("qrCorrection");
const qrDark = document.getElementById("qrDark");
const qrLight = document.getElementById("qrLight");
const generateQrBtn = document.getElementById("generateQrBtn");
const downloadQrBtn = document.getElementById("downloadQrBtn");
const clearQrBtn = document.getElementById("clearQrBtn");
const qrPreview = document.getElementById("qrPreview");

/* Border & Design elements */
const qrBorderStyle = document.getElementById("qrBorderStyle");
const qrBorderColor = document.getElementById("qrBorderColor");
const qrBorderColor2 = document.getElementById("qrBorderColor2");
const qrBorderWidth = document.getElementById("qrBorderWidth");
const qrPadding = document.getElementById("qrPadding");
const qrCornerRadius = document.getElementById("qrCornerRadius");
const qrBorderWidthVal = document.getElementById("qrBorderWidthVal");
const qrPaddingVal = document.getElementById("qrPaddingVal");
const qrCornerRadiusVal = document.getElementById("qrCornerRadiusVal");
const qrFrameInput = document.getElementById("qrFrameInput");
const qrFramePreview = document.getElementById("qrFramePreview");
const qrFrameResizeWrap = document.getElementById("qrFrameResizeWrap");
const qrFrameResizeHandle = document.getElementById("qrFrameResizeHandle");
const qrFrameSizeInfo = document.getElementById("qrFrameSizeInfo");
const clearQrFrameBtn = document.getElementById("clearQrFrameBtn");

let qrCustomFrameImg = null; // stores loaded Image object
let qrFrameScale = 1; // user-set scale via drag resize
let qrFrameOrigW = 0;
let qrFrameOrigH = 0;

/* Range label updates */
qrBorderWidth.addEventListener("input", () => { qrBorderWidthVal.textContent = qrBorderWidth.value + "px"; });
qrPadding.addEventListener("input", () => { qrPaddingVal.textContent = qrPadding.value + "px"; });
qrCornerRadius.addEventListener("input", () => { qrCornerRadiusVal.textContent = qrCornerRadius.value + "px"; });

function updateFrameSizeInfo() {
  if (!qrCustomFrameImg) { qrFrameSizeInfo.textContent = ""; return; }
  const w = Math.round(qrFrameOrigW * qrFrameScale);
  const h = Math.round(qrFrameOrigH * qrFrameScale);
  qrFrameSizeInfo.textContent = `Frame output size: ${w} × ${h} px (drag corner to resize)`;
}

/* Custom frame upload */
qrFrameInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      qrCustomFrameImg = img;
      qrFrameOrigW = img.naturalWidth;
      qrFrameOrigH = img.naturalHeight;
      qrFrameScale = 1;
      qrFramePreview.innerHTML = "";
      const preview = document.createElement("img");
      preview.src = ev.target.result;
      preview.alt = "Custom QR frame preview";
      qrFramePreview.appendChild(preview);
      qrFrameResizeWrap.classList.add("has-frame");
      updateFrameSizeInfo();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

clearQrFrameBtn.addEventListener("click", () => {
  qrCustomFrameImg = null;
  qrFrameScale = 1;
  qrFrameOrigW = 0;
  qrFrameOrigH = 0;
  qrFrameInput.value = "";
  qrFramePreview.innerHTML = "<span>No custom frame uploaded</span>";
  qrFrameResizeWrap.classList.remove("has-frame");
  qrFrameSizeInfo.textContent = "";
});

/* ---- Mouse / Touch drag-to-resize frame ---- */
(function initFrameResize() {
  let dragging = false;
  let startX = 0, startY = 0, startW = 0;

  function onPointerDown(e) {
    if (!qrCustomFrameImg) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    startW = qrFramePreview.offsetWidth;
    qrFrameResizeWrap.classList.add("resizing");
    document.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("touchmove", onPointerMove, { passive: false });
    document.addEventListener("touchend", onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const cx = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const dx = cx - startX;
    const newW = Math.max(80, startW + dx);
    // Compute scale from preview width relative to container
    const containerW = qrFrameResizeWrap.parentElement.offsetWidth;
    const clampedW = Math.min(newW, containerW);
    qrFramePreview.style.width = clampedW + "px";
    // Maintain aspect ratio for height
    const aspect = qrFrameOrigH / qrFrameOrigW;
    qrFramePreview.style.height = Math.round(clampedW * aspect) + "px";
    // Update scale
    qrFrameScale = clampedW / (qrFrameOrigW > containerW ? containerW : qrFrameOrigW);
    // If original image is larger than container, base scale on original
    qrFrameScale = clampedW / containerW * (qrFrameOrigW / containerW);
    // Simple: compute actual output pixel size from drag
    const outputW = Math.round((clampedW / containerW) * qrFrameOrigW);
    qrFrameScale = outputW / qrFrameOrigW;
    updateFrameSizeInfo();
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    qrFrameResizeWrap.classList.remove("resizing");
    document.removeEventListener("mousemove", onPointerMove);
    document.removeEventListener("mouseup", onPointerUp);
    document.removeEventListener("touchmove", onPointerMove);
    document.removeEventListener("touchend", onPointerUp);
  }

  qrFrameResizeHandle.addEventListener("mousedown", onPointerDown);
  qrFrameResizeHandle.addEventListener("touchstart", onPointerDown, { passive: false });
})();

/* ---- QR Border Drawing Helpers ---- */
function drawRoundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawFancyCorners(ctx, x, y, w, h, bw, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = bw;
  const len = Math.min(28, w * 0.15, h * 0.15);
  const off = bw / 2;
  // top-left
  ctx.beginPath(); ctx.moveTo(x + off, y + off + len); ctx.lineTo(x + off, y + off); ctx.lineTo(x + off + len, y + off); ctx.stroke();
  // top-right
  ctx.beginPath(); ctx.moveTo(x + w - off - len, y + off); ctx.lineTo(x + w - off, y + off); ctx.lineTo(x + w - off, y + off + len); ctx.stroke();
  // bottom-right
  ctx.beginPath(); ctx.moveTo(x + w - off, y + h - off - len); ctx.lineTo(x + w - off, y + h - off); ctx.lineTo(x + w - off - len, y + h - off); ctx.stroke();
  // bottom-left
  ctx.beginPath(); ctx.moveTo(x + off + len, y + h - off); ctx.lineTo(x + off, y + h - off); ctx.lineTo(x + off, y + h - off - len); ctx.stroke();
}

function composeQrWithBorder(qrCanvas) {
  const style = qrBorderStyle.value;
  const bw = Number(qrBorderWidth.value) || 8;
  const pad = Number(qrPadding.value) || 16;
  const radius = Number(qrCornerRadius.value) || 0;
  const color1 = qrBorderColor.value;
  const color2 = qrBorderColor2.value;
  const bgColor = qrLight.value;
  const qrW = qrCanvas.width;
  const qrH = qrCanvas.height;

  /* If custom frame is uploaded, use that instead */
  if (qrCustomFrameImg) {
    return composeQrWithFrame(qrCanvas);
  }

  if (style === "none") {
    // Return raw QR canvas as-is
    const out = document.createElement("canvas");
    out.width = qrW + pad * 2;
    out.height = qrH + pad * 2;
    const c = out.getContext("2d");
    c.fillStyle = bgColor;
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(qrCanvas, pad, pad);
    return out;
  }

  const totalW = qrW + pad * 2 + bw * 2;
  const totalH = qrH + pad * 2 + bw * 2;
  const out = document.createElement("canvas");
  out.width = totalW;
  out.height = totalH;
  const c = out.getContext("2d");

  // Fill background
  c.fillStyle = bgColor;
  if (radius > 0) {
    drawRoundedRect(c, 0, 0, totalW, totalH, radius);
    c.fill();
  } else {
    c.fillRect(0, 0, totalW, totalH);
  }

  // Draw border based on style
  const bx = bw / 2, by = bw / 2, bwi = totalW - bw, bhi = totalH - bw;

  if (style === "solid" || style === "rounded") {
    c.strokeStyle = color1;
    c.lineWidth = bw;
    if (style === "rounded" || radius > 0) {
      drawRoundedRect(c, bx, by, bwi, bhi, radius);
      c.stroke();
    } else {
      c.strokeRect(bx, by, bwi, bhi);
    }
  } else if (style === "double") {
    c.strokeStyle = color1;
    c.lineWidth = Math.max(2, bw * 0.3);
    const gap = bw * 0.4;
    // outer
    drawRoundedRect(c, c.lineWidth / 2, c.lineWidth / 2, totalW - c.lineWidth, totalH - c.lineWidth, radius);
    c.stroke();
    // inner
    const inOff = c.lineWidth + gap;
    drawRoundedRect(c, inOff, inOff, totalW - inOff * 2, totalH - inOff * 2, Math.max(0, radius - inOff));
    c.stroke();
  } else if (style === "dashed") {
    c.strokeStyle = color1;
    c.lineWidth = bw;
    c.setLineDash([bw * 2, bw]);
    drawRoundedRect(c, bx, by, bwi, bhi, radius);
    c.stroke();
    c.setLineDash([]);
  } else if (style === "dotted") {
    c.strokeStyle = color1;
    c.lineWidth = bw;
    c.setLineDash([bw * 0.5, bw * 0.8]);
    c.lineCap = "round";
    drawRoundedRect(c, bx, by, bwi, bhi, radius);
    c.stroke();
    c.setLineDash([]);
    c.lineCap = "butt";
  } else if (style === "shadow") {
    // card with shadow effect
    c.shadowColor = "rgba(0,0,0,0.25)";
    c.shadowBlur = bw * 2;
    c.shadowOffsetX = bw * 0.4;
    c.shadowOffsetY = bw * 0.6;
    c.fillStyle = bgColor;
    drawRoundedRect(c, bw, bw, totalW - bw * 2, totalH - bw * 2, radius);
    c.fill();
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
    // thin border
    c.strokeStyle = color1;
    c.lineWidth = 1.5;
    drawRoundedRect(c, bw, bw, totalW - bw * 2, totalH - bw * 2, radius);
    c.stroke();
  } else if (style === "gradient") {
    const grad = c.createLinearGradient(0, 0, totalW, totalH);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    c.strokeStyle = grad;
    c.lineWidth = bw;
    drawRoundedRect(c, bx, by, bwi, bhi, radius);
    c.stroke();
  } else if (style === "fancy") {
    drawFancyCorners(c, 0, 0, totalW, totalH, bw, color1);
  }

  // Draw QR in center
  c.drawImage(qrCanvas, bw + pad, bw + pad);
  return out;
}

function composeQrWithFrame(qrCanvas) {
  // Called only at download time — uses editor position/size
  const frameImg = qrCustomFrameImg;
  const frameW = frameImg.naturalWidth;
  const frameH = frameImg.naturalHeight;

  let scale = qrFrameScale || 1;
  const outW = Math.round(frameW * scale);
  const outH = Math.round(frameH * scale);

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const c = out.getContext("2d");

  // Draw frame
  c.drawImage(frameImg, 0, 0, outW, outH);

  // Get QR position/size from editor state
  const stage = document.getElementById("qrEditorStage");
  const qrEl = document.getElementById("qrEditorQr");
  const stageW = stage.offsetWidth;
  const stageH = stage.offsetHeight;

  // Ratios: editor pixel -> output pixel
  const rx = outW / stageW;
  const ry = outH / stageH;

  const qrX = parseFloat(qrEl.style.left) || 0;
  const qrY = parseFloat(qrEl.style.top) || 0;
  const qrW = qrEl.offsetWidth;
  const qrH = qrEl.offsetHeight;

  c.drawImage(qrCanvas, Math.round(qrX * rx), Math.round(qrY * ry), Math.round(qrW * rx), Math.round(qrH * ry));

  return out;
}

/* ---- Interactive QR Editor (drag + resize QR on frame) ---- */
const qrEditorWrap = document.getElementById("qrEditorWrap");
const qrEditorStage = document.getElementById("qrEditorStage");
const qrEditorFrame = document.getElementById("qrEditorFrame");
const qrEditorQr = document.getElementById("qrEditorQr");
const qrEditorQrCanvas = document.getElementById("qrEditorQrCanvas");
const qrEditorQrHandle = document.getElementById("qrEditorQrHandle");
const qrEditorInfo = document.getElementById("qrEditorInfo");
const qrEditorHint = document.getElementById("qrEditorHint");

let qrRawCanvas = null; // raw generated QR canvas (kept for re-compose)

function showQrEditor(rawCanvas) {
  qrRawCanvas = rawCanvas;
  const frameImg = qrCustomFrameImg;
  const scale = qrFrameScale || 1;
  const outW = Math.round(frameImg.naturalWidth * scale);
  const outH = Math.round(frameImg.naturalHeight * scale);

  // Set frame image in editor
  qrEditorFrame.src = frameImg.src;
  qrEditorWrap.style.display = "block";
  qrEditorHint.style.display = "inline";
  qrPreview.style.display = "none";

  // Copy raw QR onto editor canvas
  qrEditorQrCanvas.width = rawCanvas.width;
  qrEditorQrCanvas.height = rawCanvas.height;
  qrEditorQrCanvas.getContext("2d").drawImage(rawCanvas, 0, 0);

  // Wait for frame image to layout
  requestAnimationFrame(() => {
    const stageW = qrEditorStage.offsetWidth;
    const stageH = qrEditorStage.offsetHeight;

    // Default QR size: 40% of stage, centered
    const defaultQrSize = Math.round(Math.min(stageW, stageH) * 0.4);
    qrEditorQr.style.width = defaultQrSize + "px";
    qrEditorQr.style.height = defaultQrSize + "px";
    qrEditorQr.style.left = Math.round((stageW - defaultQrSize) / 2) + "px";
    qrEditorQr.style.top = Math.round((stageH - defaultQrSize) / 2) + "px";
    updateQrEditorInfo();
  });
}

function hideQrEditor() {
  qrEditorWrap.style.display = "none";
  qrEditorHint.style.display = "none";
  qrPreview.style.display = "";
}

function updateQrEditorInfo() {
  const stage = qrEditorStage;
  const qrEl = qrEditorQr;
  const sw = stage.offsetWidth;
  const sh = stage.offsetHeight;
  const scale = qrFrameScale || 1;
  const outW = Math.round(qrCustomFrameImg.naturalWidth * scale);
  const outH = Math.round(qrCustomFrameImg.naturalHeight * scale);
  const rx = outW / sw;
  const ry = outH / sh;
  const qx = Math.round((parseFloat(qrEl.style.left) || 0) * rx);
  const qy = Math.round((parseFloat(qrEl.style.top) || 0) * ry);
  const qw = Math.round(qrEl.offsetWidth * rx);
  const qh = Math.round(qrEl.offsetHeight * ry);
  qrEditorInfo.textContent = `QR: ${qw}×${qh} px at (${qx}, ${qy}) — Frame: ${outW}×${outH} px`;
}

/* Drag to move QR */
(function initQrEditorDrag() {
  let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

  function getPos(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onDown(e) {
    if (e.target === qrEditorQrHandle) return; // let resize handle
    e.preventDefault();
    dragging = true;
    const p = getPos(e);
    startX = p.x; startY = p.y;
    origLeft = parseFloat(qrEditorQr.style.left) || 0;
    origTop = parseFloat(qrEditorQr.style.top) || 0;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const p = getPos(e);
    const dx = p.x - startX;
    const dy = p.y - startY;
    const sw = qrEditorStage.offsetWidth;
    const sh = qrEditorStage.offsetHeight;
    const qw = qrEditorQr.offsetWidth;
    const qh = qrEditorQr.offsetHeight;
    let nx = origLeft + dx;
    let ny = origTop + dy;
    // Clamp inside stage
    nx = Math.max(0, Math.min(nx, sw - qw));
    ny = Math.max(0, Math.min(ny, sh - qh));
    qrEditorQr.style.left = nx + "px";
    qrEditorQr.style.top = ny + "px";
    updateQrEditorInfo();
  }

  function onUp() {
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
  }

  qrEditorQr.addEventListener("mousedown", onDown);
  qrEditorQr.addEventListener("touchstart", onDown, { passive: false });
})();

/* Drag handle to resize QR */
(function initQrEditorResize() {
  let resizing = false, startX = 0, startW = 0, startH = 0;

  function getPos(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function onDown(e) {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    const p = getPos(e);
    startX = p.x;
    startW = qrEditorQr.offsetWidth;
    startH = qrEditorQr.offsetHeight;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }

  function onMove(e) {
    if (!resizing) return;
    e.preventDefault();
    const p = getPos(e);
    const dx = p.x - startX;
    const sw = qrEditorStage.offsetWidth;
    const sh = qrEditorStage.offsetHeight;
    let nw = Math.max(30, startW + dx);
    // Keep square
    let nh = nw;
    // Clamp to stage
    const left = parseFloat(qrEditorQr.style.left) || 0;
    const top = parseFloat(qrEditorQr.style.top) || 0;
    nw = Math.min(nw, sw - left);
    nh = Math.min(nh, sh - top);
    const size = Math.min(nw, nh);
    qrEditorQr.style.width = size + "px";
    qrEditorQr.style.height = size + "px";
    updateQrEditorInfo();
  }

  function onUp() {
    resizing = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
  }

  qrEditorQrHandle.addEventListener("mousedown", onDown);
  qrEditorQrHandle.addEventListener("touchstart", onDown, { passive: false });
})();

/* ---- Generate QR ---- */
generateQrBtn.addEventListener("click", async () => {
  const text = qrText.value.trim();

  if (!text) {
    alert("Please enter QR text or URL.");
    return;
  }

  showLoader("Generating QR Code");
  try {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js");

    // Generate raw QR in a hidden container
    const tempDiv = document.createElement("div");
    tempDiv.style.cssText = "position:absolute;left:-9999px;top:-9999px";
    document.body.appendChild(tempDiv);

    new QRCode(tempDiv, {
      text,
      width: Number(qrSize.value) || 260,
      height: Number(qrSize.value) || 260,
      colorDark: qrDark.value,
      colorLight: qrLight.value,
      correctLevel: QRCode.CorrectLevel[qrCorrection.value] || QRCode.CorrectLevel.M,
    });

    // Wait a tick for QRCode to render canvas
    await new Promise((r) => setTimeout(r, 80));

    const rawCanvas = tempDiv.querySelector("canvas");
    if (!rawCanvas) {
      tempDiv.remove();
      alert("QR generation failed.");
      return;
    }

    if (qrCustomFrameImg) {
      // Show interactive editor for positioning QR on frame
      showQrEditor(rawCanvas);
      tempDiv.remove();
    } else {
      // No custom frame: compose with border and show static preview
      const finalCanvas = composeQrWithBorder(rawCanvas);
      tempDiv.remove();
      hideQrEditor();
      qrPreview.innerHTML = "";
      finalCanvas.id = "qrFinalCanvas";
      finalCanvas.style.maxWidth = "100%";
      finalCanvas.style.height = "auto";
      qrPreview.appendChild(finalCanvas);
    }
  } finally {
    hideLoader();
  }
});

/* ---- Download QR ---- */
downloadQrBtn.addEventListener("click", () => {
  // If editor is active (custom frame), compose from editor state
  if (qrCustomFrameImg && qrRawCanvas && qrEditorWrap.style.display !== "none") {
    const finalCanvas = composeQrWithFrame(qrRawCanvas);
    const url = finalCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = "qr-code.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }

  const canvas = qrPreview.querySelector("canvas");
  if (!canvas) {
    alert("Please generate a QR code first.");
    return;
  }

  const url = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = "qr-code.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
});

clearQrBtn.addEventListener("click", () => {
  qrText.value = "";
  qrPreview.innerHTML = "<span>Generated QR code will appear here</span>";
  qrPreview.style.display = "";
  hideQrEditor();
  qrRawCanvas = null;
  qrCustomFrameImg = null;
  qrFrameScale = 1;
  qrFrameOrigW = 0;
  qrFrameOrigH = 0;
  qrFrameInput.value = "";
  qrFramePreview.innerHTML = "<span>No custom frame uploaded</span>";
  qrFramePreview.style.width = "";
  qrFramePreview.style.height = "";
  qrFrameResizeWrap.classList.remove("has-frame");
  qrFrameSizeInfo.textContent = "";
});

/* BARCODE */
const barcodeValue = document.getElementById("barcodeValue");
const barcodeType = document.getElementById("barcodeType");
const barcodeWidth = document.getElementById("barcodeWidth");
const barcodeHeight = document.getElementById("barcodeHeight");
const barcodeText = document.getElementById("barcodeText");
const generateBarcodeBtn = document.getElementById("generateBarcodeBtn");
const downloadBarcodeSvgBtn = document.getElementById("downloadBarcodeSvgBtn");
const downloadBarcodePngBtn = document.getElementById("downloadBarcodePngBtn");
const clearBarcodeBtn = document.getElementById("clearBarcodeBtn");
const barcodeSvg = document.getElementById("barcodeSvg");
const barcodePlaceholder = document.getElementById("barcodePlaceholder");

async function loadJsBarcode() {
  if (window.JsBarcode) return;

  try {
    await loadScriptOnce("https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js");
  } catch (err) {
    await loadScriptOnce("https://unpkg.com/jsbarcode@3.11.6/dist/JsBarcode.all.min.js");
  }

  if (!window.JsBarcode) {
    throw new Error("JsBarcode library could not be loaded.");
  }
}

function normalizeBarcodeValue(type, value) {
  let v = String(value || "").trim();

  if (type === "EAN13") {
    v = v.replace(/\D/g, "");
    if (v.length !== 12 && v.length !== 13) {
      throw new Error("EAN13 requires 12 or 13 digits.");
    }
  }

  if (type === "UPC") {
    v = v.replace(/\D/g, "");
    if (v.length !== 11 && v.length !== 12) {
      throw new Error("UPC requires 11 or 12 digits.");
    }
  }

  if (type === "ITF14") {
    v = v.replace(/\D/g, "");
    if (v.length !== 14) {
      throw new Error("ITF14 requires exactly 14 digits.");
    }
  }

  if (type === "CODE39") {
    v = v.toUpperCase();
  }

  if (!v) {
    throw new Error("Please enter a barcode value.");
  }

  return v;
}

generateBarcodeBtn.addEventListener("click", async () => {
  try {
    const type = barcodeType.value;
    const value = normalizeBarcodeValue(type, barcodeValue.value);

    barcodePlaceholder.textContent = "Generating barcode...";
    barcodePlaceholder.style.display = "block";
    barcodeSvg.style.display = "none";
    barcodeSvg.innerHTML = "";

    await loadJsBarcode();

    window.JsBarcode(barcodeSvg, value, {
      format: type,
      width: Number(barcodeWidth.value) || 2,
      height: Number(barcodeHeight.value) || 90,
      displayValue: barcodeText.value === "true",
      margin: 14,
      fontSize: 18,
      lineColor: "#111827",
      background: "#ffffff"
    });

    barcodeSvg.style.display = "block";
    barcodePlaceholder.style.display = "none";
  } catch (error) {
    console.error(error);
    barcodeSvg.style.display = "none";
    barcodePlaceholder.style.display = "block";
    barcodePlaceholder.textContent = "Generated barcode will appear here";
    alert(error.message || "Barcode generation failed.");
  }
});

downloadBarcodeSvgBtn.addEventListener("click", () => {
  if (!barcodeSvg.innerHTML.trim()) {
    alert("Please generate a barcode first.");
    return;
  }

  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(barcodeSvg);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, "barcode.svg");
});

downloadBarcodePngBtn.addEventListener("click", () => {
  if (!barcodeSvg.innerHTML.trim()) {
    alert("Please generate a barcode first.");
    return;
  }

  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(barcodeSvg);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();

  img.onload = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(img.width || 800, 800);
    canvas.height = Math.max(img.height || 260, 260);

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const x = Math.floor((canvas.width - img.width) / 2);
    const y = Math.floor((canvas.height - img.height) / 2);

    ctx.drawImage(img, Math.max(0, x), Math.max(0, y));

    URL.revokeObjectURL(url);

    const blob = await canvasToBlob(canvas, "image/png", 0.95);
    downloadBlob(blob, "barcode.png");
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("Could not convert barcode to PNG.");
  };

  img.src = url;
});

clearBarcodeBtn.addEventListener("click", () => {
  barcodeValue.value = "";
  barcodeSvg.innerHTML = "";
  barcodeSvg.style.display = "none";
  barcodePlaceholder.style.display = "block";
  barcodePlaceholder.textContent = "Generated barcode will appear here";
});

/* PASSPORT PHOTO MAKER */
const passportInput = document.getElementById("passportInput");
const passportPreset = document.getElementById("passportPreset");
const passportDpi = document.getElementById("passportDpi");
const passportWidthCm = document.getElementById("passportWidthCm");
const passportHeightCm = document.getElementById("passportHeightCm");
const passportBackground = document.getElementById("passportBackground");
const passportBgColor = document.getElementById("passportBgColor");
const passportSheetType = document.getElementById("passportSheetType");
const passportCopies = document.getElementById("passportCopies");
const passportFileType = document.getElementById("passportFileType");
const passportSheetOrientation = document.getElementById("passportSheetOrientation");
const removeBgPassportBtn = document.getElementById("removeBgPassportBtn");
const generatePassportBtn = document.getElementById("generatePassportBtn");
const previewPassportBtn = document.getElementById("previewPassportBtn");
const downloadPassportPngBtn = document.getElementById("downloadPassportPngBtn");
const downloadPassportJpgBtn = document.getElementById("downloadPassportJpgBtn");
const downloadPassportSheetBtn = document.getElementById("downloadPassportSheetBtn");
const passportResetBtn = document.getElementById("passportResetBtn");

const passportPresetLabel = document.getElementById("passportPresetLabel");
const passportTargetSize = document.getElementById("passportTargetSize");
const passportOutputPx = document.getElementById("passportOutputPx");
const passportStatus = document.getElementById("passportStatus");
const passportCropImage = document.getElementById("passportCropImage");
const passportCropPlaceholder = document.getElementById("passportCropPlaceholder");
const passportCanvas = document.getElementById("passportCanvas");
const passportSheetCanvas = document.getElementById("passportSheetCanvas");
const passportCanvasPlaceholder = document.getElementById("passportCanvasPlaceholder");
const passportSheetPlaceholder = document.getElementById("passportSheetPlaceholder");
const passportSheetFit = document.getElementById("passportSheetFit");
const passportMaxCopies = document.getElementById("passportMaxCopies");
const passportSheetInfo = document.getElementById("passportSheetInfo");

const passportPresets = [
  { id: "custom", label: "Custom Size", widthCm: 3.5, heightCm: 4.5 },
  { id: "india_passport", label: "India Passport", widthCm: 3.5, heightCm: 4.5 },
  // South Asia
  { id: "india_visa", label: "India Visa", widthCm: 3.5, heightCm: 4.5 },
  { id: "india_aadhaar", label: "India Aadhaar Card", widthCm: 3.5, heightCm: 4.5 },
  { id: "india_pan", label: "India PAN Card", widthCm: 3.5, heightCm: 4.5 },
  { id: "india_oci", label: "India OCI Card", widthCm: 3.5, heightCm: 4.5 },
  { id: "pakistan_passport", label: "Pakistan Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "pakistan_nicop", label: "Pakistan NICOP", widthCm: 3.5, heightCm: 4.5 },
  { id: "bangladesh_passport", label: "Bangladesh Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "nepal_passport", label: "Nepal Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "srilanka_passport", label: "Sri Lanka Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "afghanistan_passport", label: "Afghanistan Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "maldives_passport", label: "Maldives Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "bhutan_passport", label: "Bhutan Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "myanmar_passport", label: "Myanmar Passport", widthCm: 3.5, heightCm: 4.5 },

  // North America
  { id: "usa_passport", label: "USA Passport", widthCm: 5.08, heightCm: 5.08 },
  { id: "usa_visa", label: "USA Visa (B1/B2/H1B/F1)", widthCm: 5.08, heightCm: 5.08 },
  { id: "usa_greencard", label: "USA Green Card", widthCm: 5.08, heightCm: 5.08 },
  { id: "usa_dv_lottery", label: "USA DV Lottery", widthCm: 5.08, heightCm: 5.08 },
  { id: "canada_passport", label: "Canada Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "canada_visa", label: "Canada Visa / PR Card", widthCm: 3.5, heightCm: 4.5 },
  { id: "mexico_passport", label: "Mexico Passport", widthCm: 3.5, heightCm: 4.5 },

  // Europe
  { id: "uk_passport", label: "UK Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "uk_visa", label: "UK Visa", widthCm: 3.5, heightCm: 4.5 },
  { id: "schengen_visa", label: "Schengen Visa", widthCm: 3.5, heightCm: 4.5 },
  { id: "germany_passport", label: "Germany Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "france_passport", label: "France Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "italy_passport", label: "Italy Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "spain_passport", label: "Spain Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "netherlands_passport", label: "Netherlands Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "belgium_passport", label: "Belgium Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "switzerland_passport", label: "Switzerland Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "austria_passport", label: "Austria Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "sweden_passport", label: "Sweden Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "norway_passport", label: "Norway Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "denmark_passport", label: "Denmark Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "finland_passport", label: "Finland Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "portugal_passport", label: "Portugal Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "greece_passport", label: "Greece Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "ireland_passport", label: "Ireland Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "poland_passport", label: "Poland Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "czech_passport", label: "Czech Republic Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "hungary_passport", label: "Hungary Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "romania_passport", label: "Romania Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "croatia_passport", label: "Croatia Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "russia_passport", label: "Russia Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "ukraine_passport", label: "Ukraine Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "turkey_passport", label: "Turkey Passport", widthCm: 5.0, heightCm: 6.0 },

  // Middle East
  { id: "uae_visa", label: "UAE / Dubai Visa", widthCm: 4.0, heightCm: 6.0 },
  { id: "uae_passport", label: "UAE Passport", widthCm: 4.0, heightCm: 6.0 },
  { id: "saudi_passport", label: "Saudi Arabia Passport", widthCm: 4.0, heightCm: 6.0 },
  { id: "saudi_visa", label: "Saudi Arabia Visa / Umrah", widthCm: 4.0, heightCm: 6.0 },
  { id: "qatar_passport", label: "Qatar Passport", widthCm: 3.8, heightCm: 4.8 },
  { id: "kuwait_passport", label: "Kuwait Passport", widthCm: 4.0, heightCm: 6.0 },
  { id: "oman_passport", label: "Oman Passport", widthCm: 4.0, heightCm: 6.0 },
  { id: "bahrain_passport", label: "Bahrain Passport", widthCm: 4.0, heightCm: 6.0 },
  { id: "iraq_passport", label: "Iraq Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "iran_passport", label: "Iran Passport", widthCm: 3.0, heightCm: 4.0 },
  { id: "israel_passport", label: "Israel Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "jordan_passport", label: "Jordan Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "lebanon_passport", label: "Lebanon Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "egypt_passport", label: "Egypt Passport", widthCm: 4.0, heightCm: 6.0 },

  // East Asia
  { id: "china_passport", label: "China Passport", widthCm: 3.3, heightCm: 4.8 },
  { id: "china_visa", label: "China Visa", widthCm: 3.3, heightCm: 4.8 },
  { id: "japan_passport", label: "Japan Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "japan_visa", label: "Japan Visa", widthCm: 3.5, heightCm: 4.5 },
  { id: "southkorea_passport", label: "South Korea Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "southkorea_visa", label: "South Korea Visa", widthCm: 3.5, heightCm: 4.5 },
  { id: "taiwan_passport", label: "Taiwan Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "hongkong_passport", label: "Hong Kong Passport", widthCm: 4.0, heightCm: 5.0 },
  { id: "mongolia_passport", label: "Mongolia Passport", widthCm: 3.5, heightCm: 4.5 },

  // Southeast Asia
  { id: "singapore_passport", label: "Singapore Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "malaysia_passport", label: "Malaysia Passport", widthCm: 3.5, heightCm: 5.0 },
  { id: "thailand_passport", label: "Thailand Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "indonesia_passport", label: "Indonesia Passport", widthCm: 3.0, heightCm: 4.0 },
  { id: "philippines_passport", label: "Philippines Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "vietnam_passport", label: "Vietnam Passport", widthCm: 4.0, heightCm: 6.0 },
  { id: "cambodia_passport", label: "Cambodia Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "laos_passport", label: "Laos Passport", widthCm: 3.0, heightCm: 4.0 },

  // Oceania
  { id: "australia_passport", label: "Australia Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "australia_visa", label: "Australia Visa", widthCm: 3.5, heightCm: 4.5 },
  { id: "newzealand_passport", label: "New Zealand Passport", widthCm: 3.5, heightCm: 4.5 },

  // Africa
  { id: "southafrica_passport", label: "South Africa Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "nigeria_passport", label: "Nigeria Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "kenya_passport", label: "Kenya Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "ethiopia_passport", label: "Ethiopia Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "ghana_passport", label: "Ghana Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "tanzania_passport", label: "Tanzania Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "uganda_passport", label: "Uganda Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "morocco_passport", label: "Morocco Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "algeria_passport", label: "Algeria Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "tunisia_passport", label: "Tunisia Passport", widthCm: 3.5, heightCm: 4.5 },

  // South America
  { id: "brazil_passport", label: "Brazil Passport", widthCm: 5.0, heightCm: 7.0 },
  { id: "argentina_passport", label: "Argentina Passport", widthCm: 4.0, heightCm: 4.0 },
  { id: "colombia_passport", label: "Colombia Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "peru_passport", label: "Peru Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "chile_passport", label: "Chile Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "venezuela_passport", label: "Venezuela Passport", widthCm: 3.5, heightCm: 4.5 },
  { id: "ecuador_passport", label: "Ecuador Passport", widthCm: 3.5, heightCm: 4.5 }
];

const passportPresetSearch = document.getElementById("passportPresetSearch");

function renderPresetOptions(filter) {
  const query = (filter || "").toLowerCase().trim();
  const prev = passportPreset.value;
  passportPreset.innerHTML = "";

  passportPresets.forEach((preset) => {
    if (query && !preset.label.toLowerCase().includes(query) && !preset.id.toLowerCase().includes(query)) return;
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.label}  (${(preset.widthCm * 10).toFixed(0)}×${(preset.heightCm * 10).toFixed(0)} mm)`;
    passportPreset.appendChild(option);
  });

  // restore previous selection if still visible
  if (passportPreset.querySelector(`option[value="${prev}"]`)) {
    passportPreset.value = prev;
  } else if (passportPreset.options.length) {
    passportPreset.value = passportPreset.options[0].value;
  }
}

passportPresetSearch.addEventListener("input", () => {
  renderPresetOptions(passportPresetSearch.value);
  applyPresetToInputs();
});

renderPresetOptions("");
passportPreset.value = "india_passport";
passportPreset.size = 6;

let cropper = null;
let passportFile = null;
let passportProcessedSourceUrl = "";
let passportOutputBlob = null;
let passportSheetBlob = null;

const passportSheetSize = document.getElementById("passportSheetSize");

function updatePassportMeta() {
  const preset = passportPresets.find((item) => item.id === passportPreset.value) || passportPresets[0];
  const widthCm = Number(passportWidthCm.value) || 3.5;
  const heightCm = Number(passportHeightCm.value) || 4.5;
  const dpi = Number(passportDpi.value) || 300;
  const pxW = cmToPx(widthCm, dpi);
  const pxH = cmToPx(heightCm, dpi);
  const widthMm = (widthCm * 10).toFixed(1);
  const heightMm = (heightCm * 10).toFixed(1);

  passportPresetLabel.textContent = preset.label;
  passportTargetSize.textContent = `${widthMm} × ${heightMm} mm`;
  passportOutputPx.textContent = `${pxW} × ${pxH} px`;

  const sheetType = passportSheetType.value;
  const orient = passportSheetOrientation.value === "landscape" ? "Landscape" : "Portrait";
  if (sheetType === "none") {
    passportSheetSize.textContent = "-";
  } else {
    const dims = getSheetDimensions(sheetType);
    if (dims) {
      passportSheetSize.textContent = `${dims.widthMm} × ${dims.heightMm} mm (${orient})`;
    }
  }
}

function applyPresetToInputs() {
  const preset = passportPresets.find((item) => item.id === passportPreset.value);
  if (!preset || preset.id === "custom") {
    updatePassportMeta();
    return;
  }
  passportWidthCm.value = preset.widthCm;
  passportHeightCm.value = preset.heightCm;
  updatePassportMeta();
}

passportPreset.addEventListener("change", applyPresetToInputs);
passportDpi.addEventListener("change", updatePassportMeta);
passportWidthCm.addEventListener("input", () => { passportPreset.value = "custom"; updatePassportMeta(); });
passportHeightCm.addEventListener("input", () => { passportPreset.value = "custom"; updatePassportMeta(); });
passportSheetType.addEventListener("change", updatePassportMeta);
passportBackground.addEventListener("change", () => {
  passportBgColor.style.display = passportBackground.value === "custom" ? "block" : "none";
});

applyPresetToInputs();

function destroyCropper() {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
}

function setupCropperWithImage(url) {
  destroyCropper();
  passportCropImage.src = url;
  passportCropImage.style.display = "block";
  passportCropPlaceholder.style.display = "none";

  passportCropImage.onload = () => {
    const ratio = (Number(passportWidthCm.value) || 3.5) / (Number(passportHeightCm.value) || 4.5);
    cropper = new Cropper(passportCropImage, {
      aspectRatio: ratio,
      viewMode: 1,
      autoCropArea: 0.8,
      dragMode: "move",
      responsive: true,
      background: false,
      guides: true,
      center: true,
      zoomable: true,
      movable: true,
      cropBoxResizable: true,
      cropBoxMovable: true
    });
    passportStatus.textContent = "Ready to crop";
  };
}

passportInput.addEventListener("change", async () => {
  const file = passportInput.files && passportInput.files[0] ? passportInput.files[0] : null;
  if (!file) return;

  passportFile = file;
  passportStatus.textContent = "Loading photo...";
  passportOutputBlob = null;
  passportSheetBlob = null;

  if (passportProcessedSourceUrl) URL.revokeObjectURL(passportProcessedSourceUrl);
  passportProcessedSourceUrl = URL.createObjectURL(file);

  setupCropperWithImage(passportProcessedSourceUrl);
});

function getPassportOutputSize() {
  const dpi = Number(passportDpi.value) || 300;
  const widthCm = Number(passportWidthCm.value) || 3.5;
  const heightCm = Number(passportHeightCm.value) || 4.5;

  return {
    dpi,
    widthCm,
    heightCm,
    widthPx: cmToPx(widthCm, dpi),
    heightPx: cmToPx(heightCm, dpi)
  };
}

async function removePassportBackground() {
  if (!passportFile && !passportProcessedSourceUrl) {
    alert("Please upload a photo first.");
    return;
  }

  showLoader("Removing background");
  try {
    passportStatus.textContent = "Loading background remover...";
    loaderMessage.textContent = "Loading AI model";
    const mod = await import("https://esm.sh/@imgly/background-removal");
    const removeBackground = mod.removeBackground;

    passportStatus.textContent = "Removing background...";
    loaderMessage.textContent = "Removing background";
    const source = passportFile || passportProcessedSourceUrl;
    const resultBlob = await removeBackground(source);

    if (passportProcessedSourceUrl) URL.revokeObjectURL(passportProcessedSourceUrl);
    passportProcessedSourceUrl = URL.createObjectURL(resultBlob);

    setupCropperWithImage(passportProcessedSourceUrl);
    passportStatus.textContent = "Background removed";
  } catch (error) {
    console.error(error);
    passportStatus.textContent = "Background removal failed";
    alert("Background removal failed. Please use a clearer subject photo and try again.");
  } finally {
    hideLoader();
  }
}

removeBgPassportBtn.addEventListener("click", removePassportBackground);

async function renderPassportCanvas() {
  if (!cropper) {
    alert("Please upload and crop a photo first.");
    return null;
  }

  const { widthPx, heightPx } = getPassportOutputSize();
  const mode = passportBackground.value;
  let fillColor = "#ffffff";

  if (mode === "transparent") fillColor = "rgba(0,0,0,0)";
  if (mode === "original") fillColor = "#ffffff";
  if (mode === "custom") fillColor = passportBgColor.value;

  const canvas = cropper.getCroppedCanvas({
    width: widthPx,
    height: heightPx,
    fillColor
  });

  if (!canvas) {
    alert("Could not generate passport photo.");
    return null;
  }

  passportCanvas.width = canvas.width;
  passportCanvas.height = canvas.height;
  const ctx = passportCanvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (mode === "white" || mode === "custom") {
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(canvas, 0, 0);
  passportCanvas.style.display = "block";
  passportCanvasPlaceholder.style.display = "none";

  const type = passportFileType.value || "image/png";
  passportOutputBlob = await canvasToBlob(passportCanvas, type, 0.95);
  passportStatus.textContent = "Passport photo generated";
  return passportCanvas;
}

function mmToPx(mm, dpi) {
  return Math.round((Number(mm) / 25.4) * Number(dpi));
}

function getSheetDimensions(type) {
  const dpi = Number(passportDpi.value) || 300;

  const sheets = {
    "4x6": {
      widthMm: 152.4,
      heightMm: 101.6,
      label: "4 × 6 inch",
    },
    "5x7": {
      widthMm: 177.8,
      heightMm: 127.0,
      label: "5 × 7 inch",
    },
    "6x8": {
      widthMm: 203.2,
      heightMm: 152.4,
      label: "6 × 8 inch",
    },
    "A5": {
      widthMm: 148,
      heightMm: 210,
      label: "A5",
    },
    "A4": {
      widthMm: 210,
      heightMm: 297,
      label: "A4",
    },
    "letter": {
      widthMm: 215.9,
      heightMm: 279.4,
      label: "US Letter",
    },
  };

  const sheet = sheets[type];
  if (!sheet) return null;

  const orientation = passportSheetOrientation.value;
  let wMm = sheet.widthMm;
  let hMm = sheet.heightMm;

  // Ensure dimensions match orientation
  if (orientation === "landscape" && hMm > wMm) {
    [wMm, hMm] = [hMm, wMm];
  } else if (orientation === "portrait" && wMm > hMm) {
    [wMm, hMm] = [wMm, hMm]; // already wider, swap
    [wMm, hMm] = [hMm, wMm];
  }

  return {
    ...sheet,
    widthMm: wMm,
    heightMm: hMm,
    widthPx: mmToPx(wMm, dpi),
    heightPx: mmToPx(hMm, dpi),
    sizeText: `${wMm} × ${hMm} mm`,
  };
}

function calculateSheetLayout(sheetW, sheetH, photoW, photoH, copies) {
  const margin = 40;
  const gap = 20;

  const usableW = sheetW - margin * 2;
  const usableH = sheetH - margin * 2;

  if (photoW > usableW || photoH > usableH) {
    return {
      fits: false,
      capacity: 0,
      cols: 0,
      rows: 0,
      margin,
      gap,
      message: "Selected passport photo size is too large for the selected sheet."
    };
  }

  const cols = Math.floor((usableW + gap) / (photoW + gap));
  const rows = Math.floor((usableH + gap) / (photoH + gap));
  const capacity = cols * rows;

  if (capacity < 1) {
    return {
      fits: false,
      capacity: 0,
      cols: 0,
      rows: 0,
      margin,
      gap,
      message: "Selected passport photo size does not fit on this sheet."
    };
  }

  if (copies > capacity) {
    return {
      fits: false,
      capacity,
      cols,
      rows,
      margin,
      gap,
      message: `Selected sheet can fit only ${capacity} photo(s). Please reduce copies or choose a larger sheet.`
    };
  }

  return {
    fits: true,
    capacity,
    cols,
    rows,
    margin,
    gap,
    message: `This sheet can fit up to ${capacity} photo(s).`
  };
}

async function renderPassportSheet(singleCanvas) {
  const sheetType = passportSheetType.value;

  if (sheetType === "none") {
    passportSheetCanvas.style.display = "none";
    passportSheetPlaceholder.style.display = "block";
    passportSheetBlob = null;
    passportSheetFit.textContent = "-";
    passportMaxCopies.textContent = "-";
    passportSheetSize.textContent = "-";
    passportSheetInfo.textContent = "No sheet selected.";
    passportSheetInfo.className = "guide-note";
    return null;
  }

  const dims = getSheetDimensions(sheetType);
  if (!dims) return null;

  const copies = Math.max(1, Math.min(50, Number(passportCopies.value) || 1));
  const photoW = singleCanvas.width;
  const photoH = singleCanvas.height;

  const layout = calculateSheetLayout(dims.widthPx, dims.heightPx, photoW, photoH, copies);

  passportMaxCopies.textContent = layout.capacity > 0 ? String(layout.capacity) : "0";

  if (!layout.fits) {
    passportSheetCanvas.width = 0;
    passportSheetCanvas.height = 0;
    passportSheetCanvas.style.display = "none";
    passportSheetPlaceholder.style.display = "block";
    passportSheetBlob = null;

    passportSheetFit.textContent = "No";
    passportSheetInfo.textContent = layout.message;
    passportSheetInfo.className = "guide-note error";
    passportStatus.textContent = "Sheet error";

    alert(layout.message);
    return null;
  }

  passportSheetFit.textContent = "Yes";
  passportSheetSize.textContent = `${dims.widthMm} × ${dims.heightMm} mm`;
  passportSheetInfo.textContent = `${dims.label} (${dims.widthMm} × ${dims.heightMm} mm). Preview generated. ${layout.message}`;
  passportSheetInfo.className = "guide-note success";

  const sheet = passportSheetCanvas;
  sheet.width = dims.widthPx;
  sheet.height = dims.heightPx;

  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  const totalGridW = layout.cols * photoW + (layout.cols - 1) * layout.gap;
  const totalGridH = layout.rows * photoH + (layout.rows - 1) * layout.gap;

  const startX = Math.floor((sheet.width - totalGridW) / 2);
  const startY = Math.floor((sheet.height - totalGridH) / 2);

  let placed = 0;

  for (let r = 0; r < layout.rows && placed < copies; r++) {
    for (let c = 0; c < layout.cols && placed < copies; c++) {
      const x = startX + c * (photoW + layout.gap);
      const y = startY + r * (photoH + layout.gap);

      ctx.drawImage(singleCanvas, x, y, photoW, photoH);
      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(x, y, photoW, photoH);
      placed++;
    }
  }

  passportSheetCanvas.style.display = "block";
  passportSheetPlaceholder.style.display = "none";
  passportSheetBlob = await canvasToBlob(passportSheetCanvas, "image/png", 0.95);
  passportStatus.textContent = "Sheet preview generated";

  return passportSheetCanvas;
}

function drawTiledPhotos(ctx, sourceCanvas, sheetW, sheetH, copies, photoW, photoH, margin, gap, cols, rows) {
  const totalGridW = cols * photoW + (cols - 1) * gap;
  const totalGridH = rows * photoH + (rows - 1) * gap;
  const startX = Math.max(margin, Math.floor((sheetW - totalGridW) / 2));
  const startY = Math.max(margin, Math.floor((sheetH - totalGridH) / 2));

  let placed = 0;
  for (let r = 0; r < rows && placed < copies; r++) {
    for (let c = 0; c < cols && placed < copies; c++) {
      const x = startX + c * (photoW + gap);
      const y = startY + r * (photoH + gap);
      ctx.drawImage(sourceCanvas, x, y, photoW, photoH);
      ctx.strokeStyle = "#d1d5db";
      ctx.strokeRect(x, y, photoW, photoH);
      placed++;
    }
  }
}

generatePassportBtn.addEventListener("click", async () => {
  showLoader("Generating passport photo");
  try {
    const canvas = await renderPassportCanvas();
    if (!canvas) return;
    await renderPassportSheet(canvas);
  } finally {
    hideLoader();
  }
});

/* Preview button — shows single photo + sheet preview without downloading */
previewPassportBtn.addEventListener("click", async () => {
  showLoader("Generating preview");
  try {
    const canvas = await renderPassportCanvas();
    if (!canvas) return;
    await renderPassportSheet(canvas);
    passportStatus.textContent = "Preview ready";
  } finally {
    hideLoader();
  }
});

/* Orientation change — re-render sheet if already generated */
passportSheetOrientation.addEventListener("change", async () => {
  updatePassportMeta();
  if (passportCanvas.width && passportSheetType.value !== "none") {
    showLoader("Updating sheet orientation");
    try {
      await renderPassportSheet(passportCanvas);
    } finally {
      hideLoader();
    }
  }
});

downloadPassportPngBtn.addEventListener("click", async () => {
  if (!passportCanvas.width) {
    const canvas = await renderPassportCanvas();
    if (!canvas) return;
  }
  const dpi = Number(passportDpi.value) || 300;
  const blob = await canvasToBlob(passportCanvas, "image/png", 0.95);
  const finalBlob = await pngWithDpi(blob, dpi);
  downloadBlob(finalBlob, "passport-photo.png");
});

downloadPassportJpgBtn.addEventListener("click", async () => {
  if (!passportCanvas.width) {
    const canvas = await renderPassportCanvas();
    if (!canvas) return;
  }

  // Draw on white background for JPG
  const temp = document.createElement("canvas");
  temp.width = passportCanvas.width;
  temp.height = passportCanvas.height;
  const ctx = temp.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(passportCanvas, 0, 0);

  const dpi = Number(passportDpi.value) || 300;
  const blob = await canvasToBlob(temp, "image/jpeg", 0.95);
  const finalBlob = await jpgWithDpi(blob, dpi);
  downloadBlob(finalBlob, "passport-photo.jpg");
});

downloadPassportSheetBtn.addEventListener("click", async () => {
  if (passportSheetType.value === "none") {
    alert("Please select a print sheet layout first.");
    return;
  }

  if (!passportSheetCanvas.width) {
    const canvas = await renderPassportCanvas();
    if (!canvas) return;
    await renderPassportSheet(canvas);
  }

  const dpi = Number(passportDpi.value) || 300;
  const blob = await canvasToBlob(passportSheetCanvas, "image/png", 0.95);
  const finalBlob = await pngWithDpi(blob, dpi);
  downloadBlob(finalBlob, "passport-photo-sheet.png");
});

passportResetBtn.addEventListener("click", () => {
  passportInput.value = "";
  passportFile = null;
  passportOutputBlob = null;
  passportSheetBlob = null;
  passportStatus.textContent = "Idle";
  destroyCropper();

  if (passportProcessedSourceUrl) {
    URL.revokeObjectURL(passportProcessedSourceUrl);
    passportProcessedSourceUrl = "";
  }

  passportCropImage.removeAttribute("src");
  passportCropImage.style.display = "none";
  passportCropPlaceholder.style.display = "block";

  passportCanvas.width = 0;
  passportCanvas.height = 0;
  passportCanvas.style.display = "none";
  passportCanvasPlaceholder.style.display = "block";

  passportSheetCanvas.width = 0;
  passportSheetCanvas.height = 0;
  passportSheetCanvas.style.display = "none";
  passportSheetPlaceholder.style.display = "block";

  passportSheetFit.textContent = "-";
  passportMaxCopies.textContent = "-";
  passportSheetSize.textContent = "-";
  passportSheetInfo.textContent = "No sheet generated.";
  passportSheetInfo.className = "guide-note";

  passportPresetSearch.value = "";
  renderPresetOptions("");
  passportPreset.value = "india_passport";
  applyPresetToInputs();
  passportDpi.value = "300";
  passportBackground.value = "white";
  passportBgColor.value = "#ffffff";
  passportBgColor.style.display = "none";
  passportSheetType.value = "none";
  passportSheetOrientation.value = "portrait";
  passportCopies.value = "8";
  passportFileType.value = "image/png";
  updatePassportMeta();
});

updatePassportMeta();
