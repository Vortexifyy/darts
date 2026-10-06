// ble.js — Granboard Bluetooth Low Energy link (Web Bluetooth).
// Works in Chrome / Edge on Windows 10+ and Chrome on Android, served over https:// or http://localhost.
//
// Events dispatched (EventTarget):
//   'status'  detail: { state: 'disconnected'|'connecting'|'connected'|'reconnecting'|'error', name?, message? }
//   'packet'  detail: { key, hex, ascii, bytes, at }
//   'battery' detail: { level }

// GATT layout shared by Granboard models (community-documented; verify on your 3s via Settings → Packet log).
export const GB_SERVICE = '442f1570-8a00-9a28-cbe1-e1d4212d53eb';
export const GB_NOTIFY  = '442f1571-8a00-9a28-cbe1-e1d4212d53eb'; // board → app: hit packets
export const GB_WRITE   = '442f1572-8a00-9a28-cbe1-e1d4212d53eb'; // app → board: LED commands (unused here)

const DEDUPE_MS = 80; // the board can fire the same notification twice in quick succession

export function decodePacket(dataView) {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const printable = bytes.length > 0 && [...bytes].every(b => b >= 0x20 && b < 0x7f);
  const ascii = printable ? String.fromCharCode(...bytes) : null;
  // The key is what the mapper stores. Granboards send short ASCII strings, so prefer that;
  // fall back to hex for any binary payload so nothing is ever lost.
  const key = ascii !== null ? ascii.trim() : 'hex:' + hex;
  return { key, hex, ascii, bytes: [...bytes], at: Date.now() };
}

export class GranboardBLE extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.notifyChar = null;
    this.state = 'disconnected';
    this._wantConnected = false;
    this._last = { key: null, at: 0 };
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
  }

  static get supported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }

  _status(state, extra = {}) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('status', { detail: { state, name: this.device?.name, ...extra } }));
  }

  /** Scan + pick. Must be called from a user gesture (button tap). */
  async scanAndConnect({ showAll = false } = {}) {
    if (!GranboardBLE.supported) throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge, served over https or localhost.');
    const options = showAll
      ? { acceptAllDevices: true, optionalServices: [GB_SERVICE, 'battery_service'] }
      : { filters: [{ namePrefix: 'GRAN' }, { namePrefix: 'Gran' }, { services: [GB_SERVICE] }], optionalServices: [GB_SERVICE, 'battery_service'] };
    this._status('connecting');
    try {
      this.device = await navigator.bluetooth.requestDevice(options);
    } catch (e) {
      this._status('disconnected', { message: e.name === 'NotFoundError' ? 'No board selected.' : e.message });
      throw e;
    }
    this.device.removeEventListener('gattserverdisconnected', this._onDisconnect);
    this.device.addEventListener('gattserverdisconnected', this._onDisconnect);
    this._wantConnected = true;
    await this._connectGatt();
  }

  /** Reconnect to a board this origin has already been granted (no chooser). Chrome-only API. */
  async reconnectKnown() {
    if (!navigator.bluetooth?.getDevices) return false;
    const devices = await navigator.bluetooth.getDevices();
    const gb = devices.find(d => /gran/i.test(d.name || ''));
    if (!gb) return false;
    this.device = gb;
    this.device.addEventListener('gattserverdisconnected', this._onDisconnect);
    this._wantConnected = true;
    try { await this._connectGatt(); return true; } catch { return false; }
  }

  async _connectGatt() {
    this._status('connecting');
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(GB_SERVICE);
    this.notifyChar = await service.getCharacteristic(GB_NOTIFY);
    this.notifyChar.removeEventListener('characteristicvaluechanged', this._onNotify);
    this.notifyChar.addEventListener('characteristicvaluechanged', this._onNotify);
    await this.notifyChar.startNotifications();
    this._status('connected');
    this._readBattery().catch(() => {});
  }

  async _readBattery() {
    const svc = await this.server.getPrimaryService('battery_service');
    const ch = await svc.getCharacteristic('battery_level');
    const v = await ch.readValue();
    this.dispatchEvent(new CustomEvent('battery', { detail: { level: v.getUint8(0) } }));
  }

  _onNotify(event) {
    const pkt = decodePacket(event.target.value);
    if (pkt.key === this._last.key && pkt.at - this._last.at < DEDUPE_MS) return;
    this._last = pkt;
    this.dispatchEvent(new CustomEvent('packet', { detail: pkt }));
  }

  async _onDisconnect() {
    this.notifyChar = null;
    if (!this._wantConnected) { this._status('disconnected'); return; }
    // Board went to sleep or out of range: retry with backoff.
    for (let attempt = 1; attempt <= 5 && this._wantConnected; attempt++) {
      this._status('reconnecting', { message: `Attempt ${attempt} of 5` });
      await new Promise(r => setTimeout(r, 800 * attempt));
      try { await this._connectGatt(); return; } catch { /* keep trying */ }
    }
    this._wantConnected = false;
    this._status('disconnected', { message: 'Lost the board. Wake it by pressing its button, then connect again.' });
  }

  disconnect() {
    this._wantConnected = false;
    try { this.notifyChar?.stopNotifications(); } catch {}
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this._status('disconnected');
  }
}
