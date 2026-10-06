// games.js — pure game logic. No DOM here, so it can be unit-tested in Node.
import { points, shortLabel } from './segments.js';

// Home-screen menu. Each item becomes a "setup" card; add modes by adding entries.
export const MENU = [
  {
    id: 'x01', title: '01 games', blurb: 'Count down to exactly zero',
    items: [
      { id: '301', label: '301', type: 'x01', start: 301 },
      { id: '501', label: '501', type: 'x01', start: 501 },
      { id: '701', label: '701', type: 'x01', start: 701 },
      { id: '901', label: '901', type: 'x01', start: 901 },
      { id: 'f501', label: 'Freeze 501', type: 'x01', start: 501, freeze: true, note: 'Teams of two. You can\'t go out while your partner\'s score is higher than both opponents combined.' },
      { id: 'f701', label: 'Freeze 701', type: 'x01', start: 701, freeze: true, note: 'Teams of two. You can\'t go out while your partner\'s score is higher than both opponents combined.' },
    ],
  },
  {
    id: 'cricket', title: 'Cricket', blurb: 'Close 15 through 20 and the bull',
    items: [
      { id: 'cr', label: 'Standard cricket', type: 'cricket', variant: 'standard' },
      { id: 'crns', label: 'No-score cricket', type: 'cricket', variant: 'noscore', note: 'First to close every number wins. No points.' },
      { id: 'crct', label: 'Cut-throat cricket', type: 'cricket', variant: 'cutthroat', note: 'Extra marks score points on your opponents. Lowest score wins.' },
    ],
  },
];

export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];

class BaseGame {
  constructor(cfg, players) {
    this.cfg = cfg;
    this.players = players.map((p, i) => ({ id: p.id, name: p.name, color: p.color, idx: i, darts: 0, ...this.initPlayer() }));
    this.cur = 0;
    this.round = 1;
    this.turn = [];          // darts thrown this turn: { seg, label, ...result }
    this.turnEnded = false;
    this.over = false;
    this.winners = [];       // player indexes
    this.lastAward = null;
    this.startedAt = Date.now();
    this._undo = [];
    this.onTurnStart();
  }

  get player() { return this.players[this.cur]; }
  get teams() { return !!this.cfg.freeze; }
  teamOf(i) { return i % 2; } // players 0 & 2 vs 1 & 3

  _snap() {
    const { _undo, ...rest } = this;
    this._undo.push(JSON.stringify(rest));
    if (this._undo.length > 200) this._undo.shift();
  }
  canUndo() { return this._undo.length > 0; }
  undo() {
    if (!this._undo.length) return false;
    Object.assign(this, JSON.parse(this._undo.pop()));
    return true;
  }

  canThrow() { return !this.over && !this.turnEnded && this.turn.length < 3; }

  throwDart(seg) {
    if (!this.canThrow()) return null;
    this._snap();
    this.lastAward = null;
    this.player.darts++;
    const r = this.applyDart(seg);
    this.turn.push({ seg, label: shortLabel(seg), ...r });
    if (!this.over && (this.turn.length >= 3 || r.bust)) this.turnEnded = true;
    if (this.turn.length >= 3 && !r.bust) this.lastAward = this.turnAward();
    return { ...r, award: this.lastAward };
  }

  nextPlayer() {
    if (this.over) return;
    this._snap();
    this.player.darts += 3 - this.turn.length; // unthrown darts count, like a real machine
    this.turn = [];
    this.turnEnded = false;
    this.lastAward = null;
    this.cur = (this.cur + 1) % this.players.length;
    if (this.cur === 0) {
      this.round++;
      if (this.cfg.rounds && this.round > this.cfg.rounds) { this.round = this.cfg.rounds; this.finishByLimit(); return; }
    }
    this.onTurnStart();
  }

  _win(idx) {
    this.over = true;
    this.turnEnded = true;
    this.winners = this.teams ? this.players.filter(p => this.teamOf(p.idx) === this.teamOf(idx)).map(p => p.idx) : [idx];
  }

  onTurnStart() {}
}

export class X01Game extends BaseGame {
  initPlayer() {
    return { score: this.cfg.start, opened: this.cfg.inMode !== 'double', turnStart: this.cfg.start };
  }
  onTurnStart() { this.player.turnStart = this.player.score; }

  applyDart(seg) {
    const p = this.player;
    const isDouble = seg.mult === 2;
    const fat = !!this.cfg.fatBull;
    if (!p.opened) {
      if (!isDouble) return { pts: 0, noIn: true };
      p.opened = true;
    }
    const pts = points(seg, fat);
    const rem = p.score - pts;
    const out = this.cfg.outMode || 'double';
    let bust = false, reason = '';
    if (rem < 0) { bust = true; reason = 'Over'; }
    else if (rem === 1 && out !== 'open') { bust = true; reason = 'Left on 1'; }
    else if (rem === 0 && out === 'double' && !isDouble) { bust = true; reason = 'Double out'; }
    else if (rem === 0 && out === 'master' && seg.mult < 2) { bust = true; reason = 'Master out'; }
    else if (rem === 0 && this.cfg.freeze) {
      const mate = this.players.find(q => q.idx !== p.idx && this.teamOf(q.idx) === this.teamOf(p.idx));
      const opp = this.players.filter(q => this.teamOf(q.idx) !== this.teamOf(p.idx)).reduce((a, q) => a + q.score, 0);
      if (mate && mate.score > opp) { bust = true; reason = 'Frozen'; }
    }
    if (bust) {
      p.score = p.turnStart;
      return { pts: 0, bust: true, reason };
    }
    p.score = rem;
    if (rem === 0) this._win(p.idx);
    return { pts };
  }

  turnAward() {
    const total = this.turn.reduce((a, d) => a + (d.pts || 0), 0);
    const segs = this.turn.map(d => d.seg);
    if (segs.every(s => s.value === 25)) return 'Hat trick';
    if (total === 180) return 'Ton 80';
    if (segs.every(s => s.zone === segs[0].zone && s.value === segs[0].value && s.mult === 3)) return 'Three in a bed';
    if (total >= 151) return 'High ton';
    if (total >= 100) return 'Low ton';
    return null;
  }

  finishByLimit() {
    if (this.teams) {
      const t0 = this.players.filter(p => p.idx % 2 === 0).reduce((a, p) => a + p.score, 0);
      const t1 = this.players.filter(p => p.idx % 2 === 1).reduce((a, p) => a + p.score, 0);
      this.over = true; this.turnEnded = true;
      this.winners = this.players.filter(p => p.idx % 2 === (t0 <= t1 ? 0 : 1)).map(p => p.idx);
      return;
    }
    const best = Math.min(...this.players.map(p => p.score));
    this.over = true; this.turnEnded = true;
    this.winners = this.players.filter(p => p.score === best).map(p => p.idx);
  }

  stats(p) {
    const scored = this.cfg.start - p.score;
    return { scored, darts: p.darts, ppd: p.darts ? scored / p.darts : 0 };
  }
  turnTotal() { return this.turn.reduce((a, d) => a + (d.pts || 0), 0); }
}

export class CricketGame extends BaseGame {
  initPlayer() {
    const marks = {};
    for (const t of CRICKET_TARGETS) marks[t] = 0;
    return { marks, points: 0, marksHit: 0 };
  }

  closedBy(p) { return CRICKET_TARGETS.every(t => p.marks[t] >= 3); }

  applyDart(seg) {
    const p = this.player;
    const v = seg.value;
    if (!CRICKET_TARGETS.includes(v)) return { marks: 0, pts: 0 };
    const variant = this.cfg.variant;
    const others = this.players.filter(q => q.idx !== p.idx);
    let marks = 0, pts = 0;
    for (let i = 0; i < seg.mult; i++) {
      if (p.marks[v] < 3) { p.marks[v]++; marks++; continue; }
      if (variant === 'noscore') continue;
      const open = others.filter(q => q.marks[v] < 3);
      if (!open.length) continue;
      marks++;
      if (variant === 'cutthroat') open.forEach(q => { q.points += v; });
      else p.points += v;
      pts += v;
    }
    p.marksHit += marks;
    this._checkWin(p);
    return { marks, pts };
  }

  _checkWin(p) {
    if (!this.closedBy(p)) return;
    const others = this.players.filter(q => q.idx !== p.idx);
    const v = this.cfg.variant;
    if (v === 'noscore') return this._win(p.idx);
    if (v === 'cutthroat' && others.every(q => p.points <= q.points)) return this._win(p.idx);
    if (v === 'standard' && others.every(q => p.points >= q.points)) return this._win(p.idx);
  }

  turnAward() {
    const m = this.turn.reduce((a, d) => a + (d.marks || 0), 0);
    if (this.turn.every(d => d.seg.value === 25)) return 'Hat trick';
    if (m >= 5) return `${m} marks`;
    return null;
  }

  finishByLimit() {
    this.over = true; this.turnEnded = true;
    const v = this.cfg.variant;
    const key = p => v === 'noscore' ? p.marksHit : v === 'cutthroat' ? -p.points : p.points;
    const best = Math.max(...this.players.map(key));
    this.winners = this.players.filter(p => key(p) === best).map(p => p.idx);
  }

  stats(p) { return { marks: p.marksHit, darts: p.darts, mpr: p.darts ? p.marksHit / (p.darts / 3) : 0, points: p.points }; }
  turnTotal() { return this.turn.reduce((a, d) => a + (d.marks || 0), 0); }
}

export function createGame(cfg, players) {
  return cfg.type === 'x01' ? new X01Game(cfg, players) : new CricketGame(cfg, players);
}

// Plain-object summary written to match history and profile stats.
export function summarize(game, id) {
  return {
    id,
    type: game.cfg.type,
    label: game.cfg.label,
    cfg: game.cfg,
    startedAt: game.startedAt,
    endedAt: Date.now(),
    rounds: game.round,
    players: game.players.map(p => ({
      id: p.id, name: p.name, color: p.color,
      winner: game.winners.includes(p.idx),
      ...(game.cfg.type === 'x01' ? { left: p.score } : { points: p.points }),
      ...game.stats(p),
    })),
  };
}
