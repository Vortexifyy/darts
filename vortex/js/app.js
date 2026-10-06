// app.js — screens, navigation and wiring between BLE, game engines and storage.
import { store, ensureDefaultProfiles, recordProfileStats, newId, PLAYER_COLORS, emptyStats } from './store.js';
import { HitMapper, makeSeg, MISS, longLabel, shortLabel, CAL_SEQUENCE } from './segments.js';
import { GranboardBLE } from './ble.js';
import { MENU, CRICKET_TARGETS, createGame, summarize } from './games.js';
import { boardSVG } from './board.js';
import { fx, sound } from './fx.js';

// ---------- state ----------
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');
fx.mount(document.getElementById('fx'));

const S = {
  screen: 'home',
  openMenu: null,       // expanded category on home
  mode: null,           // selected MENU item
  selected: [],         // profile ids in throw order
  opts: {},
  game: null,
  lastSummary: null,
  ble: { state: 'disconnected', name: null, battery: null, message: '' },
  log: [],              // recent raw packets
  cal: null,            // { i } calibration progress
  pendingKey: null,     // unrecognized packet waiting for assignment
  historyOpen: null,
};

let settings = store.settings();
const applySettings = () => { sound.enabled = settings.sound; fx.enabled = settings.animations; };
applySettings();
ensureDefaultProfiles();

const mapper = new HitMapper(() => store.mapping(), (t) => store.saveMapping(t));
const ble = new GranboardBLE();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt2 = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2);
const profileById = (id) => store.profiles().find(p => p.id === id);

// ---------- navigation ----------
function go(screen, patch = {}) {
  Object.assign(S, patch, { screen });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const view = { home, setup, game: gameScreen, results, players, history, board, calibrate, settings: settingsScreen }[S.screen] || home;
  app.innerHTML = view();
  app.dataset.screen = S.screen;
  if (S.screen === 'game') scheduleAutoAdvance();
}

// ---------- shared bits ----------
function bleLabel() {
  const st = S.ble.state;
  return st === 'connected' ? (S.ble.name || 'Board connected') : st === 'connecting' ? 'Connecting…' : st === 'reconnecting' ? 'Reconnecting…' : 'No board';
}
function blePill() {
  return `<button class="ble-pill is-${S.ble.state}" data-action="nav" data-to="board" aria-label="Board connection: ${bleLabel()}">
    <span class="dot"></span>${esc(bleLabel())}${S.ble.battery != null ? ` <small>${S.ble.battery}%</small>` : ''}</button>`;
}
function topbar(title, back = 'home') {
  return `<header class="topbar">
    <button class="back" data-action="nav" data-to="${back}" aria-label="Back">
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h1>${esc(title)}</h1>${blePill()}</header>`;
}
function segControl(name, options, value) {
  return `<div class="segc" role="radiogroup">${options.map(([v, l]) =>
    `<button role="radio" aria-checked="${v === value}" class="${v === value ? 'on' : ''}" data-action="opt" data-name="${name}" data-value="${v}">${esc(l)}</button>`).join('')}</div>`;
}
const vortexMark = (size = 64) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 6a26 26 0 1 1-24.7 34" fill="none" stroke="var(--hot)" stroke-width="5" stroke-linecap="round"/>
  <path d="M32 16a16 16 0 1 1-15.2 21" fill="none" stroke="var(--mint)" stroke-width="5" stroke-linecap="round"/>
  <path d="M32 26a6 6 0 1 1-5.7 8" fill="none" stroke="var(--text)" stroke-width="5" stroke-linecap="round"/></svg>`;

// ---------- HOME ----------
function home() {
  const menu = MENU.map(cat => {
    const open = S.openMenu === cat.id;
    return `<li class="menu-cat ${open ? 'open' : ''}">
      <button class="menu-btn" data-action="toggleMenu" data-id="${cat.id}" aria-expanded="${open}">
        <span class="menu-title">${esc(cat.title)}</span><span class="menu-blurb">${esc(cat.blurb)}</span>
        <svg class="chev" viewBox="0 0 24 24" width="20" height="20"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
      </button>
      ${open ? `<ul class="submenu">${cat.items.map(it => `<li><button class="sub-btn" data-action="pickMode" data-id="${it.id}"><span>${esc(it.label)}</span></button></li>`).join('')}</ul>` : ''}
    </li>`;
  }).join('');
  const util = [['players', 'Players', 'Profiles and lifetime stats'], ['history', 'Match history', 'Every finished game'], ['board', 'Board connection', 'Pair and calibrate your Granboard'], ['settings', 'Settings', 'Sound, animation, rules']]
    .map(([to, t, b]) => `<li><button class="menu-btn quiet" data-action="nav" data-to="${to}"><span class="menu-title">${t}</span><span class="menu-blurb">${b}</span></button></li>`).join('');
  return `<div class="home">
    <section class="brand">${vortexMark(96)}<div class="wordmark">Vortex</div><p class="tag">Home darts scoring for your Granboard</p>${blePill()}</section>
    <nav class="menu" aria-label="Game modes"><ul>${menu}</ul><ul class="menu-util">${util}</ul></nav>
  </div>`;
}

// ---------- SETUP ----------
function findMode(id) { for (const c of MENU) for (const it of c.items) if (it.id === id) return it; return null; }

function defaultOpts(mode) {
  return mode.type === 'x01'
    ? { inMode: 'open', outMode: 'double', fatBull: settings.fatBull, rounds: settings.defaultRounds }
    : { rounds: settings.cricketRounds };
}

function setup() {
  const m = S.mode, o = S.opts;
  const profiles = store.profiles();
  const need = m.freeze ? 'Pick exactly 4 players. 1 & 3 play 2 & 4.' : 'Pick 1–4 players. Tap order is throw order.';
  const chips = profiles.map(p => {
    const pos = S.selected.indexOf(p.id);
    return `<button class="pchip ${pos >= 0 ? 'on' : ''}" style="--pc:${p.color}" data-action="togglePlayer" data-id="${p.id}" aria-pressed="${pos >= 0}">
      ${pos >= 0 ? `<b class="order">${pos + 1}</b>` : ''}${esc(p.name)}</button>`;
  }).join('');
  const valid = m.freeze ? S.selected.length === 4 : S.selected.length >= 1 && S.selected.length <= 4;
  const rounds = [[10, '10'], [15, '15'], [20, '20'], [25, '25'], [0, 'No limit']];
  const x01 = m.type === 'x01' ? `
      <div class="field"><label>Start</label>${segControl('inMode', [['open', 'Open in'], ['double', 'Double in']], o.inMode)}</div>
      <div class="field"><label>Finish</label>${segControl('outMode', [['open', 'Open out'], ['double', 'Double out'], ['master', 'Master out']], o.outMode)}</div>
      <div class="field"><label>Bull</label>${segControl('fatBull', [[false, 'Split 25 / 50'], [true, 'Fat bull 50']], o.fatBull)}</div>` : '';
  return `${topbar(m.label, 'home')}
  <main class="page setup">
    ${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}
    <section class="panel"><h2>Players</h2><p class="hint">${need}</p>
      <div class="chips">${chips}<button class="pchip add" data-action="quickAdd">+ New player</button></div></section>
    <section class="panel"><h2>Rules</h2>${x01}
      <div class="field"><label>Round limit</label>${segControl('rounds', rounds, o.rounds)}</div></section>
    <button class="cta" data-action="startGame" ${valid ? '' : 'disabled'}>Start game</button>
  </main>`;
}

// ---------- GAME ----------
function markGlyph(n) {
  if (!n) return '';
  const slash = '<path d="M7 25L25 7"/>';
  const x = slash + '<path d="M7 7l18 18"/>';
  return `<svg class="mk mk${Math.min(n, 3)}" viewBox="0 0 32 32">${n >= 2 ? x : slash}${n >= 3 ? '<circle cx="16" cy="16" r="13"/>' : ''}</svg>`;
}

function playerTile(p, g) {
  const active = g.cur === p.idx && !g.over;
  const isX = g.cfg.type === 'x01';
  const st = g.stats(p);
  const won = g.winners.includes(p.idx);
  const team = g.cfg.freeze ? `<span class="team">Team ${p.idx % 2 + 1}</span>` : '';
  return `<div class="tile ${active ? 'active' : ''} ${won ? 'won' : ''}" style="--pc:${p.color}">
    <div class="tile-in">
      <div class="tile-name">${esc(p.name)}${team}</div>
      <div class="tile-score">${isX ? p.score : p.points}</div>
      <div class="tile-stat">${isX ? fmt2(st.ppd) + ' PPD' : fmt2(st.mpr) + ' MPR'}${isX && !p.opened ? ' · needs double in' : ''}</div>
    </div></div>`;
}

function cricketGrid(g) {
  const n = g.players.length;
  const left = g.players.slice(0, Math.ceil(n / 2)), right = g.players.slice(Math.ceil(n / 2));
  const rows = CRICKET_TARGETS.map(t => {
    const closedAll = g.players.every(p => p.marks[t] >= 3);
    const cell = p => `<td class="mcell ${g.cur === p.idx && !g.over ? 'cur' : ''}" style="--pc:${p.color}">${markGlyph(p.marks[t])}</td>`;
    return `<tr class="${closedAll ? 'dead' : ''}">${left.map(cell).join('')}<th>${t === 25 ? 'Bull' : t}</th>${right.map(cell).join('')}</tr>`;
  }).join('');
  return `<table class="cgrid" aria-label="Cricket marks">${rows}</table>`;
}

function gameScreen() {
  const g = S.game;
  const isX = g.cfg.type === 'x01';
  const p = g.player;
  const slots = [0, 1, 2].map(i => {
    const d = g.turn[i];
    const cls = d ? (d.bust ? 'bust' : d.seg.zone === 'MISS' || d.noIn ? 'miss' : 'hit') : i === g.turn.length && g.canThrow() ? 'next' : '';
    return `<div class="slot ${cls}"><span>${d ? esc(d.label) : ''}</span>${d && isX ? `<small>${d.bust ? 'bust' : d.noIn ? 'no in' : d.pts}</small>` : d ? `<small>${d.marks ? d.marks + ' mk' : '—'}</small>` : ''}</div>`;
  }).join('');
  const busted = g.turn.some(d => d.bust);
  const center = isX
    ? `<div class="bigscore ${busted ? 'is-bust' : ''}" style="--pc:${p.color}" aria-live="polite">${p.score}</div>
       <div class="who">${esc(p.name)}${busted ? ` · <span class="bust-txt">Bust — ${esc(g.turn.at(-1).reason)}</span>` : ''}</div>`
    : cricketGrid(g);
  const tiles = g.players.map(q => playerTile(q, g)).join('');
  const nextLabel = g.over ? 'See results' : g.turnEnded ? 'Next player' : 'End turn';
  return `<div class="game ${isX ? 'g-x01' : 'g-cricket'} n${g.players.length}">
    <header class="gbar">
      <button class="back" data-action="quitGame" aria-label="Leave game">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
      <div class="gmeta"><b>${esc(g.cfg.label)}</b><span>Round ${g.round}${g.cfg.rounds ? ' / ' + g.cfg.rounds : ''}</span></div>
      ${blePill()}
    </header>
    <div class="tiles">${tiles}</div>
    <div class="stage">${center}</div>
    <footer class="dock">
      <div class="slots">${slots}</div>
      <div class="turn-total"><small>${isX ? 'This turn' : 'Marks'}</small><b>${g.turnTotal()}</b></div>
      <div class="dock-actions">
        <button class="ghost" data-action="undo" ${g.canUndo() && !g.over ? '' : 'disabled'}>Undo</button>
        <button class="ghost" data-action="manual">Tap board</button>
        <button class="go ${g.turnEnded ? 'pulse' : ''}" data-action="next">${nextLabel}</button>
      </div>
    </footer>
  </div>`;
}

let advanceTimer = null;
function scheduleAutoAdvance() {
  clearTimeout(advanceTimer);
  const g = S.game;
  if (!settings.autoAdvance || !g || g.over || !g.turnEnded) return;
  advanceTimer = setTimeout(() => { if (S.screen === 'game' && S.game === g && g.turnEnded && !g.over) { g.nextPlayer(); render(); } }, settings.autoAdvanceDelay * 1000);
}

function throwSeg(seg) {
  const g = S.game;
  if (!g || !g.canThrow()) return;
  const before = g.player;
  const r = g.throwDart(seg);
  if (!r) return;
  sound.hit(seg);
  const extra = g.cfg.type === 'x01' ? (r.noIn ? 'Needs a double to start' : '') : (r.marks ? `${r.marks} mark${r.marks > 1 ? 's' : ''}` : '');
  fx.hit(seg, extra);
  if (r.bust) { setTimeout(() => { sound.bust(); fx.banner('Bust', 'bust'); }, 250); }
  if (r.award) { setTimeout(() => { sound.award(); fx.banner(r.award, 'award'); }, 350); }
  render();
  if (g.over) finishGame(before);
  if (g.turnEnded && document.querySelector('.modal.manual')) closeModal();
}

function finishGame() {
  const g = S.game;
  const summary = summarize(g, newId());
  store.addMatch(summary);
  recordProfileStats(summary);
  S.lastSummary = summary;
  setTimeout(() => {
    sound.win();
    fx.banner(g.winners.map(i => esc(g.players[i].name)).join(' & ') + ' wins', 'win');
  }, 400);
  releaseWake();
}

// ---------- RESULTS ----------
function statsTable(sum) {
  const isX = sum.type === 'x01';
  const head = isX ? '<th>Left</th><th>Darts</th><th>PPD</th><th>Avg / 3</th>' : '<th>Points</th><th>Marks</th><th>Darts</th><th>MPR</th>';
  const rows = sum.players.map(p => `<tr class="${p.winner ? 'w' : ''}"><td><i style="background:${p.color}"></i>${esc(p.name)}${p.winner ? ' <b>Winner</b>' : ''}</td>${isX
    ? `<td>${p.left}</td><td>${p.darts}</td><td>${fmt2(p.ppd)}</td><td>${fmt2(p.ppd * 3)}</td>`
    : `<td>${p.points}</td><td>${p.marks}</td><td>${p.darts}</td><td>${fmt2(p.mpr)}</td>`}</tr>`).join('');
  return `<div class="table-wrap"><table class="stats"><thead><tr><th>Player</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function results() {
  const s = S.lastSummary;
  const w = s.players.filter(p => p.winner);
  return `${topbar('Match result', 'home')}
  <main class="page results">
    <section class="winner" style="--pc:${w[0]?.color || 'var(--hot)'}">
      ${vortexMark(56)}<h2>${w.map(p => esc(p.name)).join(' & ')}</h2><p>${esc(s.label)} · ${s.rounds} round${s.rounds > 1 ? 's' : ''}</p></section>
    ${statsTable(s)}
    <div class="row-actions"><button class="cta" data-action="rematch">Rematch</button><button class="ghost" data-action="nav" data-to="home">Main menu</button></div>
  </main>`;
}

// ---------- PLAYERS ----------
function players() {
  const list = store.profiles().map(p => {
    const s = { ...emptyStats(), ...p.stats };
    const ppd = s.x01Darts ? s.x01Points / s.x01Darts : 0;
    const mpr = s.cricketDarts ? s.cricketMarks / (s.cricketDarts / 3) : 0;
    return `<li class="pcard" style="--pc:${p.color}">
      <div class="pc-head"><span class="swatch"></span><h3>${esc(p.name)}</h3><button class="ghost sm" data-action="editPlayer" data-id="${p.id}">Edit</button></div>
      <dl class="pc-stats">
        <div><dt>Games</dt><dd>${s.games}</dd></div><div><dt>Wins</dt><dd>${s.wins}${s.games ? ` <small>${Math.round(s.wins / s.games * 100)}%</small>` : ''}</dd></div>
        <div><dt>01 PPD</dt><dd>${fmt2(ppd)}</dd></div><div><dt>Cricket MPR</dt><dd>${fmt2(mpr)}</dd></div>
        <div><dt>Best PPD</dt><dd>${fmt2(s.best.ppd)}</dd></div><div><dt>Best MPR</dt><dd>${fmt2(s.best.mpr)}</dd></div>
      </dl></li>`;
  }).join('');
  return `${topbar('Players')}<main class="page"><ul class="pgrid">${list}</ul>
    <button class="cta" data-action="editPlayer" data-id="">Add player</button></main>`;
}

function playerModal(id) {
  const p = id ? profileById(id) : { name: '', color: PLAYER_COLORS[store.profiles().length % PLAYER_COLORS.length] };
  openModal(`<h2>${id ? 'Edit player' : 'New player'}</h2>
    <label class="lbl">Name<input id="pname" maxlength="18" value="${esc(p.name)}" autocomplete="off"></label>
    <div class="lbl">Colour<div class="colors">${PLAYER_COLORS.map(c => `<button class="cpick ${c === p.color ? 'on' : ''}" style="background:${c}" data-action="pickColor" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
    <div class="row-actions">${id ? '<button class="danger" data-action="deletePlayer">Delete</button>' : ''}<button class="ghost" data-action="closeModal">Cancel</button><button class="cta sm" data-action="savePlayer">Save</button></div>`,
    'player', { id, color: p.color });
  setTimeout(() => document.getElementById('pname')?.focus(), 30);
}

// ---------- HISTORY ----------
function history() {
  const h = store.history();
  if (!h.length) return `${topbar('Match history')}<main class="page"><div class="empty">${vortexMark(56)}<p>Finished games show up here. Start one from the main menu.</p><button class="cta" data-action="nav" data-to="home">Choose a game</button></div></main>`;
  const rows = h.map(m => {
    const d = new Date(m.endedAt);
    const open = S.historyOpen === m.id;
    const names = m.players.map(p => `<span class="${p.winner ? 'w' : ''}" style="--pc:${p.color}">${esc(p.name)}</span>`).join('<em>v</em>');
    return `<li class="hrow ${open ? 'open' : ''}">
      <button class="hbtn" data-action="toggleHistory" data-id="${m.id}" aria-expanded="${open}">
        <span class="hdate">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}<small>${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small></span>
        <span class="hmode">${esc(m.label)}</span><span class="hplayers">${names}</span></button>
      ${open ? `<div class="hdetail">${statsTable(m)}<button class="ghost sm" data-action="deleteMatch" data-id="${m.id}">Delete this match</button></div>` : ''}</li>`;
  }).join('');
  return `${topbar('Match history')}<main class="page"><ul class="hlist">${rows}</ul>
    <button class="ghost" data-action="clearHistory">Clear history</button></main>`;
}

// ---------- BOARD (BLE) ----------
function board() {
  const sup = GranboardBLE.supported;
  const st = S.ble.state;
  const log = S.log.slice(0, 10).map(l => `<li><code>${esc(l.ascii ?? '—')}</code><code class="hex">${esc(l.hex)}</code><span>${l.res ? esc(l.res) : '<i>unmapped</i>'}</span></li>`).join('');
  return `${topbar('Board connection')}
  <main class="page boardpage">
    <section class="panel conn is-${st}">
      <div class="conn-head"><span class="bigdot"></span><div><h2>${esc(bleLabel())}</h2><p class="hint">${esc(S.ble.message || (st === 'connected' ? 'Throw a dart to test. Hits appear in the packet log below.' : 'Turn the board on, make sure no phone is already connected to it, then scan.'))}</p></div></div>
      ${!sup ? `<p class="warn">Bluetooth isn't available in this browser. Open Vortex in Chrome (Android) or Chrome / Edge (Windows), from an https:// address or http://localhost.</p>` : ''}
      <div class="row-actions">
        ${st === 'connected' ? '<button class="ghost" data-action="bleDisconnect">Disconnect</button>' : `<button class="cta sm" data-action="bleScan" ${sup ? '' : 'disabled'}>Scan for Granboard</button><button class="ghost sm" data-action="bleScanAll" ${sup ? '' : 'disabled'}>Show all devices</button>`}
      </div>
    </section>
    <section class="panel">
      <h2>Segment map</h2>
      <p class="hint">${mapper.size} of ${CAL_SEQUENCE.length} targets learned. Calibration walks you through every segment once so Vortex knows exactly what your board sends. Anything unmapped during a game asks you once, then is remembered.</p>
      <div class="meter"><span style="width:${Math.min(100, mapper.size / CAL_SEQUENCE.length * 100)}%"></span></div>
      <div class="row-actions">
        <button class="cta sm" data-action="calStart" ${st === 'connected' ? '' : 'disabled'}>Calibrate board</button>
        <button class="ghost sm" data-action="mapExport">Export map</button>
        <button class="ghost sm" data-action="mapImport">Import map</button>
        <button class="ghost sm" data-action="mapClear">Clear map</button>
      </div>
    </section>
    <section class="panel"><h2>Packet log</h2>
      ${log ? `<ul class="plog">${log}</ul>` : '<p class="hint">No packets yet. Connect and throw a dart, or press the board\'s button.</p>'}</section>
  </main>`;
}

// ---------- CALIBRATE ----------
function calibrate() {
  const i = S.cal.i;
  if (i >= CAL_SEQUENCE.length) {
    return `${topbar('Calibration', 'board')}<main class="page"><div class="empty">${vortexMark(56)}<h2>Board calibrated</h2><p>${mapper.size} targets learned. You're ready to play.</p><button class="cta" data-action="nav" data-to="home">Main menu</button></div></main>`;
  }
  const t = CAL_SEQUENCE[i];
  const what = t.zone === 'BUTTON' ? 'Press the board\'s button' : 'Hit ' + longLabel(makeSeg(t.zone, t.value));
  return `${topbar('Calibration', 'board')}
  <main class="page cal">
    <div class="cal-info"><div class="cal-step">${i + 1} / ${CAL_SEQUENCE.length}</div><h2 aria-live="polite">${esc(what)}</h2>
      <p class="hint">Push the segment in with a dart tip or your finger. Vortex records whatever the board sends for it.</p>
      <div class="meter"><span style="width:${i / CAL_SEQUENCE.length * 100}%"></span></div>
      <div class="row-actions"><button class="ghost sm" data-action="calBack" ${i ? '' : 'disabled'}>Previous</button><button class="ghost sm" data-action="calSkip">Skip</button><button class="ghost sm" data-action="nav" data-to="board">Stop</button></div></div>
    <div class="cal-board">${boardSVG({ highlight: t.zone === 'BUTTON' ? null : t })}</div>
  </main>`;
}

// ---------- SETTINGS ----------
function toggle(key, label, hint) {
  return `<label class="toggle"><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" data-action="setToggle" data-key="${key}" ${settings[key] ? 'checked' : ''}><i></i></label>`;
}
function settingsScreen() {
  return `${topbar('Settings')}
  <main class="page">
    <section class="panel"><h2>Play</h2>
      ${toggle('sound', 'Sound effects')}
      ${toggle('animations', 'Hit animations', 'Turn off for a calmer screen')}
      ${toggle('autoAdvance', 'Auto next player', `After 3 darts, move on after ${settings.autoAdvanceDelay} seconds`)}
      ${settings.autoAdvance ? `<div class="field"><label>Delay</label>${segControl('s_delay', [[2, '2 s'], [3, '3 s'], [5, '5 s'], [8, '8 s']], settings.autoAdvanceDelay)}</div>` : ''}
    </section>
    <section class="panel"><h2>Default rules</h2>
      ${toggle('fatBull', 'Fat bull in 01', 'Outer bull scores 50')}
      <div class="field"><label>01 round limit</label>${segControl('s_rounds', [[10, '10'], [15, '15'], [20, '20'], [25, '25'], [0, 'None']], settings.defaultRounds)}</div>
      <div class="field"><label>Cricket round limit</label>${segControl('s_crounds', [[15, '15'], [20, '20'], [25, '25'], [0, 'None']], settings.cricketRounds)}</div>
    </section>
    <section class="panel"><h2>Data</h2><p class="hint">Everything is stored on this device only.</p>
      <div class="row-actions"><button class="ghost sm" data-action="clearHistory">Clear match history</button><button class="danger sm" data-action="resetAll">Reset everything</button></div></section>
  </main>`;
}

// ---------- modal ----------
let modalCtx = {};
function openModal(html, kind = '', ctx = {}) {
  modalCtx = ctx;
  modalRoot.innerHTML = `<div class="scrim" data-action="closeModal"></div><div class="modal ${kind}" role="dialog" aria-modal="true">${html}</div>`;
  modalRoot.hidden = false;
}
function closeModal() { modalRoot.hidden = true; modalRoot.innerHTML = ''; modalCtx = {}; S.pendingKey = null; }

function manualModal() {
  openModal(`<div class="mhead"><h2>Tap where the dart landed</h2><button class="ghost sm" data-action="closeModal">Done</button></div>
    <div data-board="throw">${boardSVG()}</div><button class="ghost wide" data-action="throwMiss">Miss</button>`, 'manual');
}
function assignModal(key) {
  S.pendingKey = key;
  openModal(`<h2>New signal from the board</h2><p class="hint">Vortex hasn't seen <code>${esc(key)}</code> before. Tap the segment you hit and it will be remembered.</p>
    <div data-board="assign">${boardSVG()}</div>
    <div class="row-actions"><button class="ghost sm" data-action="assignButton">That was the button</button><button class="ghost sm" data-action="closeModal">Ignore</button></div>`, 'assign', { key });
  S.pendingKey = key;
}

// ---------- packets from the board ----------
function onPacket(pkt) {
  const res = mapper.resolve(pkt.key);
  S.log.unshift({ ...pkt, res: res ? (res.button ? 'Button' : longLabel(res.seg)) : null });
  S.log = S.log.slice(0, 30);

  if (S.screen === 'calibrate' && S.cal.i < CAL_SEQUENCE.length) {
    const t = CAL_SEQUENCE[S.cal.i];
    mapper.learn(pkt.key, t.zone, t.value);
    sound.click();
    S.cal.i++;
    render();
    return;
  }
  if (S.screen === 'game' && S.game) {
    if (!res) { if (!S.pendingKey) assignModal(pkt.key); return; }
    if (res.button) { doNext(); return; }
    throwSeg(res.seg);
    return;
  }
  if (S.screen === 'board') render();
}

ble.addEventListener('packet', e => onPacket(e.detail));
ble.addEventListener('status', e => {
  S.ble.state = e.detail.state;
  S.ble.name = e.detail.name || S.ble.name;
  S.ble.message = e.detail.message || '';
  if (e.detail.state === 'disconnected') S.ble.battery = null;
  // Light refresh: just the pills, unless we're on the board screen.
  if (S.screen === 'board' || S.screen === 'home') render();
  else document.querySelectorAll('.ble-pill').forEach(el => { el.outerHTML = blePill(); });
});
ble.addEventListener('battery', e => { S.ble.battery = e.detail.level; document.querySelectorAll('.ble-pill').forEach(el => { el.outerHTML = blePill(); }); });

// ---------- wake lock ----------
let wake = null;
async function holdWake() { try { wake = await navigator.wakeLock?.request('screen'); } catch {} }
function releaseWake() { try { wake?.release(); } catch {} wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.screen === 'game' && !S.game?.over) holdWake(); });

// ---------- actions ----------
function startGame() {
  const m = S.mode;
  const roster = S.selected.map(profileById).filter(Boolean);
  const cfg = { ...m, ...S.opts, label: m.label };
  S.game = createGame(cfg, roster);
  holdWake();
  go('game');
}

function doNext() {
  const g = S.game;
  if (!g) return;
  if (g.over) { go('results'); return; }
  g.nextPlayer();
  sound.click();
  render();
  if (g.over) finishGame();
}

const actions = {
  nav: el => go(el.dataset.to),
  toggleMenu: el => { S.openMenu = S.openMenu === el.dataset.id ? null : el.dataset.id; render(); },
  pickMode: el => {
    const m = findMode(el.dataset.id);
    const all = store.profiles();
    const sel = S.selected.filter(id => all.some(p => p.id === id));
    go('setup', { mode: m, opts: defaultOpts(m), selected: sel.length ? sel.slice(0, 4) : all.slice(0, m.freeze ? 4 : 2).map(p => p.id) });
  },
  togglePlayer: el => {
    const id = el.dataset.id, i = S.selected.indexOf(id);
    if (i >= 0) S.selected.splice(i, 1); else if (S.selected.length < 4) S.selected.push(id);
    render();
  },
  quickAdd: () => playerModal(''),
  opt: el => {
    const name = el.dataset.name;
    let v = el.dataset.value;
    v = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v;
    if (name.startsWith('s_')) {
      const key = { s_delay: 'autoAdvanceDelay', s_rounds: 'defaultRounds', s_crounds: 'cricketRounds' }[name];
      settings[key] = v; store.saveSettings(settings);
    } else S.opts[name] = v;
    render();
  },
  startGame,
  undo: () => { if (S.game && !S.game.over && S.game.undo()) render(); },
  next: doNext,
  manual: () => manualModal(),
  throwMiss: () => throwSeg(MISS),
  quitGame: () => {
    if (S.game && !S.game.over && !confirm('Leave this game? It won\'t be saved to history.')) return;
    releaseWake(); S.game = null; go('home');
  },
  rematch: () => {
    const g = S.game;
    S.game = createGame(g.cfg, g.players.map(p => profileById(p.id) || p));
    holdWake(); go('game');
  },
  editPlayer: el => playerModal(el.dataset.id),
  pickColor: el => { modalCtx.color = el.dataset.c; modalRoot.querySelectorAll('.cpick').forEach(b => b.classList.toggle('on', b === el)); },
  savePlayer: () => {
    const name = document.getElementById('pname').value.trim();
    if (!name) { document.getElementById('pname').focus(); return; }
    const list = store.profiles();
    if (modalCtx.id) Object.assign(list.find(p => p.id === modalCtx.id), { name, color: modalCtx.color });
    else {
      const p = { id: newId(), name, color: modalCtx.color, stats: emptyStats(), created: Date.now() };
      list.push(p);
      if (S.screen === 'setup' && S.selected.length < 4) S.selected.push(p.id);
    }
    store.saveProfiles(list); closeModal(); render();
  },
  deletePlayer: () => {
    if (!confirm('Delete this player and their lifetime stats? Match history is kept.')) return;
    store.saveProfiles(store.profiles().filter(p => p.id !== modalCtx.id));
    S.selected = S.selected.filter(id => id !== modalCtx.id);
    closeModal(); render();
  },
  toggleHistory: el => { S.historyOpen = S.historyOpen === el.dataset.id ? null : el.dataset.id; render(); },
  deleteMatch: el => { store.deleteMatch(el.dataset.id); render(); },
  clearHistory: () => { if (confirm('Delete all match history? Player stats are kept.')) { store.clearHistory(); render(); } },
  resetAll: () => { if (confirm('Erase all players, history, settings and the board map?')) { store.resetAll(); location.reload(); } },
  setToggle: el => { settings[el.dataset.key] = el.checked; store.saveSettings(settings); applySettings(); render(); },
  closeModal,

  bleScan: () => ble.scanAndConnect().catch(() => {}),
  bleScanAll: () => ble.scanAndConnect({ showAll: true }).catch(() => {}),
  bleDisconnect: () => ble.disconnect(),

  calStart: () => go('calibrate', { cal: { i: 0 } }),
  calSkip: () => { S.cal.i++; render(); },
  calBack: () => { S.cal.i = Math.max(0, S.cal.i - 1); render(); },
  mapExport: () => openModal(`<h2>Segment map</h2><p class="hint">Copy this to back up your board's map or move it to another device.</p>
    <textarea readonly class="code">${esc(mapper.exportJSON())}</textarea><div class="row-actions"><button class="cta sm" data-action="closeModal">Done</button></div>`),
  mapImport: () => openModal(`<h2>Import segment map</h2><p class="hint">Paste JSON like <code>{"&lt;packet&gt;": {"zone":"T","value":20}}</code>. Zones: S_IN, S_OUT, D, T, SB, DB, BUTTON.</p>
    <textarea id="mapjson" class="code"></textarea><div class="row-actions"><button class="ghost sm" data-action="closeModal">Cancel</button><button class="cta sm" data-action="mapImportGo">Import</button></div>`),
  mapImportGo: () => {
    try { const n = mapper.importJSON(document.getElementById('mapjson').value); closeModal(); alert(`Imported ${n} entries.`); render(); }
    catch (e) { alert('That isn\'t valid JSON: ' + e.message); }
  },
  mapClear: () => { if (confirm('Forget every learned segment?')) { mapper.clear(); render(); } },
  assignButton: () => { const k = modalCtx.key; mapper.learn(k, 'BUTTON', 0); closeModal(); doNext(); },
};

document.addEventListener('click', e => {
  // Board segment taps
  const segEl = e.target.closest('.board .seg');
  if (segEl) {
    const host = segEl.closest('[data-board]');
    if (!host) return;
    const zone = segEl.dataset.zone, value = Number(segEl.dataset.value);
    const s = makeSeg(zone, value);
    if (host.dataset.board === 'throw') throwSeg(s);
    else if (host.dataset.board === 'assign') {
      const k = modalCtx.key;
      if (zone !== 'MISS') mapper.learn(k, zone, value);
      closeModal();
      throwSeg(s);
    }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[data-action]');
  if (el) actions[el.dataset.action]?.(el);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalRoot.hidden) { closeModal(); return; }
  if (S.screen !== 'game' || !modalRoot.hidden || e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doNext(); }
  if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); actions.undo(); }
});

// Try silent reconnect to a previously paired board (Chrome with getDevices support).
ble.reconnectKnown().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});

// Dev hook: simulate a board packet from the console, e.g. __vortex.packet("2.3@")
window.__vortex = {
  packet: (ascii) => onPacket({ key: ascii.trim(), ascii, hex: [...ascii].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '), at: Date.now() }),
  mapper, ble,
};

render();
