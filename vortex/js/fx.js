// fx.js — animated hit indicators and synthesized sounds (no audio assets needed).
import { longLabel } from './segments.js';

let ctx = null;
function audio() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'triangle', gain = 0.18, slideTo = null) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

export const sound = {
  enabled: true,
  hit(seg) {
    if (!this.enabled) return;
    if (seg.zone === 'MISS') return tone(140, 0, 0.18, 'sine', 0.1, 90);
    if (seg.value === 25) { tone(300, 0, 0.5, 'sawtooth', 0.08, 1200); tone(900, 0.12, 0.35, 'triangle', 0.12); return; }
    const base = 420 + seg.value * 14;
    for (let i = 0; i < seg.mult; i++) tone(base * (1 + i * 0.25), i * 0.075, 0.14);
  },
  bust() { if (this.enabled) { tone(220, 0, 0.25, 'square', 0.08, 110); tone(160, 0.2, 0.35, 'square', 0.08, 80); } },
  award() { if (this.enabled) [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.14)); },
  win() { if (this.enabled) [392, 523, 659, 784, 659, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.15)); },
  click() { if (this.enabled) tone(900, 0, 0.04, 'sine', 0.05); },
};

let layer = null;
export const fx = {
  enabled: true,
  mount(el) { layer = el; },

  _add(html, cls, ms) {
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'fx ' + cls + (this.enabled ? '' : ' fx-static');
    el.innerHTML = html;
    layer.appendChild(el);
    setTimeout(() => el.remove(), this.enabled ? ms : Math.min(ms, 900));
  },

  hit(seg, extra = '') {
    const kind = seg.zone === 'MISS' ? 'miss' : seg.value === 25 ? 'bull' : seg.zone === 'T' ? 'triple' : seg.zone === 'D' ? 'double' : 'single';
    const rings = kind === 'single' || kind === 'miss' ? 1 : kind === 'double' ? 2 : 3;
    let ringHtml = '';
    for (let i = 0; i < rings; i++) ringHtml += `<span class="ring" style="animation-delay:${i * 90}ms"></span>`;
    this._add(`${ringHtml}<span class="fx-label">${longLabel(seg).replace(/ \(.*\)/, '')}</span>${extra ? `<span class="fx-sub">${extra}</span>` : ''}`, 'fx-hit fx-' + kind, 1300);
  },
  banner(text, tone = 'award') { this._add(`<span>${text}</span>`, 'fx-banner fx-' + tone, 2200); },
};
