"use strict";

const note = document.querySelector("#note");
const noteCount = document.querySelector("#note-count");
const counterValue = document.querySelector("#counter-value");
let count = 0;
const updateNoteCount = () => { noteCount.textContent = `${Array.from(note.value).length} 个字符`; };
updateNoteCount();
note.addEventListener("input", updateNoteCount);
document.querySelector("#counter-add").addEventListener("click", () => {
  count += 1;
  counterValue.replaceChildren(document.createTextNode(String(count).padStart(2, "0")), Object.assign(document.createElement("span"), {textContent: "次"}));
});
document.querySelector("#counter-reset").addEventListener("click", () => {
  count = 0;
  counterValue.replaceChildren(document.createTextNode("00"), Object.assign(document.createElement("span"), {textContent: "次"}));
});

const clockValue = document.querySelector("#clock-value");
const elapsedValue = document.querySelector("#elapsed-value");
const railFill = document.querySelector("#time-rail-fill");
const startTime = performance.now();
const canvas = document.querySelector("#live-canvas");
const ctx = canvas.getContext("2d");
const frameValue = document.querySelector("#canvas-frame");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastFrame = 0;
let frame = 0;

function paint(now) {
  const elapsed = (now - startTime) / 1000;
  clockValue.textContent = new Date().toLocaleTimeString("zh-CN", {hour12: false});
  elapsedValue.textContent = elapsed.toFixed(1);
  railFill.style.width = `${(elapsed % 20) * 5}%`;
  const t = reducedMotion.matches ? 0 : elapsed;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#1e2c27";
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#40574055";
  ctx.beginPath();
  for (let x = 0; x < w; x += 35) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0; y < h; y += 35) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  for (let line = 0; line < 3; line++) {
    ctx.strokeStyle = ["#dfe86b", "#86b391", "#7da3a2"][line];
    ctx.globalAlpha = 1 - line * 0.24;
    ctx.lineWidth = line === 0 ? 2.5 : 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const envelope = Math.sin(x / w * Math.PI);
      const y = h / 2 + Math.sin(x / 45 + t * 2 + line * 1.8) * 46 * envelope + Math.sin(x / 18 - t * 1.1) * 8 + (line - 1) * 24;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const pulseX = (t * 64) % w;
  const pulseY = h / 2 + Math.sin(pulseX / 45 + t * 2) * 46 * Math.sin(pulseX / w * Math.PI) + Math.sin(pulseX / 18 - t * 1.1) * 8 - 24;
  const glow = ctx.createRadialGradient(pulseX, pulseY, 1, pulseX, pulseY, 22);
  glow.addColorStop(0, "#e7f15a88"); glow.addColorStop(1, "#e7f15a00");
  ctx.fillStyle = glow; ctx.fillRect(pulseX - 22, pulseY - 22, 44, 44);
  ctx.fillStyle = "#f0f899"; ctx.beginPath(); ctx.arc(pulseX, pulseY, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a9f82"; ctx.font = "10px monospace"; ctx.fillText("SIGNAL / RUNNING", 12, 18);
  frame += 1;
  frameValue.textContent = `FRAME ${String(frame).padStart(4, "0")}`;
}

function tick(now) {
  if (now - lastFrame >= 66) { paint(now); lastFrame = now; }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
