// store.js — all persistence lives here (localStorage, per device).
// Swap this module for IndexedDB or a native store later without touching the UI.

const K = {
  profiles: 'vx.profiles',
  history: 'vx.history',
  settings: 'vx.settings',
  map: 'vx.blemap',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export const PLAYER_COLORS = ['#4fc3ff', '#ff7a59', '#a8e05f', '#c38bff', '#ffd166', '#5ce1e6', '#ff9ecf', '#e0e0e0'];

export const DEFAULT_SETTINGS = {
  sound: true,
  animations: true,
  fatBull: false,          // true: outer bull scores 50 like the bullseye
  autoAdvance: false,      // move to next player automatically after 3 darts
  autoAdvanceDelay: 3,     // seconds
  defaultRounds: 20,
  cricketRounds: 20,
};

export const newId = () => Math.random().toString(36).slice(2, 10);

export const store = {
  profiles: () => load(K.profiles, []),
  saveProfiles: (p) => save(K.profiles, p),

  history: () => load(K.history, []),
  addMatch(m) {
    const h = this.history();
    h.unshift(m);
    save(K.history, h.slice(0, 300));
  },
  deleteMatch(id) { save(K.history, this.history().filter(m => m.id !== id)); },
  clearHistory: () => save(K.history, []),

  settings: () => ({ ...DEFAULT_SETTINGS, ...load(K.settings, {}) }),
  saveSettings: (s) => save(K.settings, s),

  mapping: () => load(K.map, {}),
  saveMapping: (m) => save(K.map, m),

  resetAll() { Object.values(K).forEach(k => localStorage.removeItem(k)); },
};

export function emptyStats() {
  return { games: 0, wins: 0, x01Darts: 0, x01Points: 0, cricketDarts: 0, cricketMarks: 0, best: { ppd: 0, mpr: 0 } };
}

export function ensureDefaultProfiles() {
  let p = store.profiles();
  if (!p.length) {
    p = [
      { id: newId(), name: 'Player 1', color: PLAYER_COLORS[0], stats: emptyStats(), created: Date.now() },
      { id: newId(), name: 'Player 2', color: PLAYER_COLORS[1], stats: emptyStats(), created: Date.now() },
    ];
    store.saveProfiles(p);
  }
  return p;
}

// Fold a finished match summary into each profile's lifetime stats.
export function recordProfileStats(summary) {
  const profiles = store.profiles();
  for (const row of summary.players) {
    const p = profiles.find(x => x.id === row.id);
    if (!p) continue;
    p.stats = { ...emptyStats(), ...p.stats };
    p.stats.games++;
    if (row.winner) p.stats.wins++;
    if (summary.type === 'x01') {
      p.stats.x01Darts += row.darts;
      p.stats.x01Points += row.scored;
      p.stats.best.ppd = Math.max(p.stats.best.ppd, row.ppd || 0);
    } else {
      p.stats.cricketDarts += row.darts;
      p.stats.cricketMarks += row.marks;
      p.stats.best.mpr = Math.max(p.stats.best.mpr, row.mpr || 0);
    }
  }
  store.saveProfiles(profiles);
}
