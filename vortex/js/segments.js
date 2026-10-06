// segments.js — the dartboard segment model and the Granboard packet → segment mapper.

// Clockwise from the top.
export const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// zone: S_IN (inner single), S_OUT (outer single), D, T, SB (outer bull), DB (bullseye), MISS
export const seg = (value, mult, zone) => ({ value, mult, zone });
export const MISS = seg(0, 0, 'MISS');

export function makeSeg(zone, value) {
  switch (zone) {
    case 'S_IN': case 'S_OUT': return seg(value, 1, zone);
    case 'D': return seg(value, 2, 'D');
    case 'T': return seg(value, 3, 'T');
    case 'SB': return seg(25, 1, 'SB');
    case 'DB': return seg(25, 2, 'DB');
    default: return MISS;
  }
}

export function shortLabel(s) {
  if (!s || s.zone === 'MISS') return 'Miss';
  if (s.zone === 'SB') return 'Bull';
  if (s.zone === 'DB') return 'D-Bull';
  if (s.zone === 'T') return 'T' + s.value;
  if (s.zone === 'D') return 'D' + s.value;
  return String(s.value);
}

export function longLabel(s) {
  if (!s || s.zone === 'MISS') return 'Miss';
  if (s.zone === 'SB') return 'Bull';
  if (s.zone === 'DB') return 'Double bull';
  if (s.zone === 'T') return 'Triple ' + s.value;
  if (s.zone === 'D') return 'Double ' + s.value;
  if (s.zone === 'S_IN') return s.value + ' (inner single)';
  if (s.zone === 'S_OUT') return s.value + ' (outer single)';
  return String(s.value);
}

export function points(s, fatBull = false) {
  if (!s || s.zone === 'MISS') return 0;
  if (s.value === 25) return fatBull ? 50 : 25 * s.mult;
  return s.value * s.mult;
}

// Order used by the calibration wizard: every physical segment once, then the button.
export const CAL_SEQUENCE = (() => {
  const out = [];
  for (const n of BOARD_ORDER) {
    out.push({ zone: 'S_IN', value: n }, { zone: 'T', value: n }, { zone: 'S_OUT', value: n }, { zone: 'D', value: n });
  }
  out.push({ zone: 'SB', value: 25 }, { zone: 'DB', value: 25 }, { zone: 'BUTTON', value: 0 });
  return out;
})();

/**
 * HitMapper turns a raw packet key (from ble.js) into a segment.
 * The table is learned on-device (calibration wizard or "tap where it landed"),
 * or imported as JSON: { "<packet key>": { "zone": "T", "value": 20 } | { "zone": "BUTTON" } }.
 */
export class HitMapper {
  constructor(load, persist) {
    this._persist = persist;
    this.table = load() || {};
  }
  get size() { return Object.keys(this.table).length; }

  resolve(key) {
    const t = this.table[key];
    if (!t) return null;
    if (t.zone === 'BUTTON') return { button: true };
    return { seg: makeSeg(t.zone, t.value) };
  }

  learn(key, zone, value) {
    // One packet key per physical target: drop any older key pointing at the same target.
    for (const [k, v] of Object.entries(this.table)) {
      if (v.zone === zone && (zone === 'BUTTON' || v.value === value)) delete this.table[k];
    }
    this.table[key] = zone === 'BUTTON' ? { zone } : { zone, value };
    this._persist(this.table);
  }

  forget(key) { delete this.table[key]; this._persist(this.table); }
  clear() { this.table = {}; this._persist(this.table); }
  exportJSON() { return JSON.stringify(this.table, null, 2); }

  importJSON(text) {
    const obj = JSON.parse(text);
    const valid = ['S_IN', 'S_OUT', 'D', 'T', 'SB', 'DB', 'BUTTON'];
    let n = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (v && valid.includes(v.zone)) { this.table[k] = v.zone === 'BUTTON' ? { zone: 'BUTTON' } : { zone: v.zone, value: Number(v.value) }; n++; }
    }
    this._persist(this.table);
    return n;
  }
}
