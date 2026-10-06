// board.js — clickable SVG dartboard (manual entry, unknown-packet assignment, calibration).
import { BOARD_ORDER } from './segments.js';

// Real proportions in mm; the double ring's outer edge is 170.
const R = { db: 6.35, sb: 15.9, tIn: 99, tOut: 107, dIn: 162, dOut: 170 };

const pt = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [+(r * Math.sin(a)).toFixed(2), +(-r * Math.cos(a)).toFixed(2)];
};

function sector(r1, r2, a1, a2) {
  const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2), [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
  return `M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z`;
}

export function boardSVG({ highlight = null } = {}) {
  let paths = '';
  BOARD_ORDER.forEach((n, i) => {
    const a1 = i * 18 - 9, a2 = i * 18 + 9;
    const even = i % 2 === 0;
    const rings = [
      ['S_IN', R.sb, R.tIn, even ? 'b-s1' : 'b-s2'],
      ['T', R.tIn, R.tOut, even ? 'b-r1' : 'b-r2'],
      ['S_OUT', R.tOut, R.dIn, even ? 'b-s1' : 'b-s2'],
      ['D', R.dIn, R.dOut, even ? 'b-r1' : 'b-r2'],
    ];
    for (const [zone, r1, r2, cls] of rings) {
      const hl = highlight && highlight.zone === zone && highlight.value === n ? ' target' : '';
      paths += `<path class="seg ${cls}${hl}" data-zone="${zone}" data-value="${n}" d="${sector(r1, r2, a1, a2)}"/>`;
    }
    const [tx, ty] = pt(186, i * 18);
    paths += `<text class="b-num" x="${tx}" y="${ty}">${n}</text>`;
  });
  const hlSB = highlight?.zone === 'SB' ? ' target' : '';
  const hlDB = highlight?.zone === 'DB' ? ' target' : '';
  paths += `<circle class="seg b-r2${hlSB}" data-zone="SB" data-value="25" r="${R.sb}"/>`;
  paths += `<circle class="seg b-r1${hlDB}" data-zone="DB" data-value="25" r="${R.db}"/>`;
  return `<svg class="board" viewBox="-205 -205 410 410" role="img" aria-label="Dartboard">
    <circle class="b-miss seg" data-zone="MISS" data-value="0" r="203"/>${paths}</svg>`;
}
