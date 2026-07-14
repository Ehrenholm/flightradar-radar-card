/**
 * flightradar-radar-card v0.10.1
 *
 * A round "radar scope" Lovelace card for the AlexandrErohin/home-assistant-flightradar24
 * integration. Renders the entity's `flights` attribute as sweep-lit blips on a dark map.
 *
 * Usage (after adding this file as a dashboard resource, type: module):
 *
 *   type: custom:flightradar-radar-card
 *   entity: sensor.flightradar24_current_in_area
 *   radius_km: 40            # optional; set to match the radius configured in the FR24
 *                            # integration (it is not exposed on the sensor, so it can't
 *                            # be read automatically)
 *   latitude: 59.3293        # optional, defaults to hass.config.latitude
 *   longitude: 18.0686       # optional, defaults to hass.config.longitude
 *   site_label: HOME         # optional, text in the top-left readout
 *   contacts_position: right # optional: right | left | bottom | none
 *   map_brightness: 0.55     # optional: 0–1.5, higher = more visible basemap
 *   sweep_period: 4          # optional, seconds per sweep revolution
 *   trail_length: 7          # optional, number of past positions in the trail
 *   max_diameter: 0          # optional, px cap on the scope size (0 = fill the column)
 *   fit_height: true         # optional, also cap the scope so it fits the screen height
 *   height_offset: 150       # optional, px reserved for HA header/readout when fitting
 *                            # height (lower it to ~40 in kiosk mode)
 *   show_details: true       # optional, extra rows per contact (airline, model, reg, route)
 *   theme: green             # optional: green | amber | blue
 *   smooth_motion: true      # optional, dead-reckon blips between integration updates
 *   trail_style: line        # optional: line | dots (phosphor-style afterglow dots)
 *   show_ring_labels: true   # optional, km labels on the range rings
 *   startup_animation: true  # optional, scope warm-up fade on load
 *   show_photo: true         # optional, aircraft photo in the panel for selected contact
 *   alert_distance_km: 0     # optional, pulse blips closer than this (0 = off)
 *   linger_time: 45          # optional, seconds a dropped contact coasts on the scope
 *                            # (dimmed, dead-reckoned) before it is removed
 *   sound_alerts: none       # optional: none | new_contact | proximity | all —
 *                            # synthesized pings; shows a tap-to-arm speaker toggle
 *                            # on the scope (hidden when none)
 *   speed_unit: kts          # optional: kts | kmh
 *   altitude_unit: ft        # optional: ft | m
 *   debug: false             # optional, show viewport/size diagnostics in the readout
 *
 * Emergency squawks (7700/7600/7500) always paint red, pulse, and sort first.
 * Helicopters are drawn as circle blips (detected from aircraft code/model).
 * Click a blip or a contact row to select it: shows an ATC-style data tag.
 */

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap';

const CARD_VERSION = '0.10.1';

const DEFAULT_SWEEP_PERIOD_S = 4;
const DEFAULT_MAP_BRIGHTNESS = 0.55;
const DEFAULT_RADIUS_KM = 40;
const KM_PER_DEG_LAT = 111.32;
const DEFAULT_TRAIL_LENGTH = 7;
const DEFAULT_HEIGHT_OFFSET = 150;
const CONTACTS_POSITIONS = ['right', 'left', 'bottom', 'none'];
const TRAIL_STYLES = ['line', 'dots'];
const SOUND_MODES = ['none', 'new_contact', 'proximity', 'all'];
const SPEED_UNITS = ['kts', 'kmh'];
const ALTITUDE_UNITS = ['ft', 'm'];
const SOUND_STORAGE_KEY = 'flightradar-radar-card-sound-armed';

const SPEAKER_ON_SVG = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/>'
  + '<path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
const SPEAKER_OFF_SVG = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/>'
  + '<line x1="16" y1="9" x2="22" y2="15" stroke="currentColor" stroke-width="2"/>'
  + '<line x1="22" y1="9" x2="16" y2="15" stroke="currentColor" stroke-width="2"/></svg>';
const EMERGENCY_SQUAWKS = ['7700', '7600', '7500'];

const THEMES = {
  green: { accentRgb: '77,255,158', selectedRgb: '255,181,69', text: '#bdf5d6', muted: '#5c8f76', soft: '#7fe9ab', mapHue: '65deg' },
  amber: { accentRgb: '255,181,69', selectedRgb: '77,255,158', text: '#f5e6c8', muted: '#8f7c5c', soft: '#e9cb7f', mapHue: '350deg' },
  blue: { accentRgb: '77,181,255', selectedRgb: '255,181,69', text: '#c8ddf5', muted: '#5c7a8f', soft: '#7fc0e9', mapHue: '185deg' },
};

const HELI_CODE_RE = /^(EC\d|H1\d\d|B06|B407|B412|B429|B505|R22|R44|R66|S61|S64|S76|S92|UH1|A109|A119|A129|A139|A149|A169|A189|AS3\d|AS5\d|MI\d|KA\d)/;
const HELI_MODEL_RE = /helicopter|eurocopter|sikorsky|robinson r|bell \d|agusta|kamov|airbus h\d|leonardo aw/i;
function isHelicopter(f) {
  return HELI_CODE_RE.test(String(f.aircraft_code || '').toUpperCase())
    || HELI_MODEL_RE.test(String(f.aircraft_model || ''));
}

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.onload = () => resolve(window.L);
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('flightradar-radar-card: failed to load Leaflet from CDN'));
      };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

// @font-face rules don't reliably apply from inside a shadow root, so the font
// stylesheet goes in the document head (once, shared across card instances).
function ensureFontLoaded() {
  if (document.head.querySelector(`link[href="${FONT_CSS}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_CSS;
  document.head.appendChild(link);
}

const CARD_CSS = `
  :host{
    --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    --accent-rgb: ${THEMES.green.accentRgb};
    --selected-rgb: ${THEMES.green.selectedRgb};
    --green: rgb(var(--accent-rgb));
    --text: ${THEMES.green.text};
    --muted: ${THEMES.green.muted};
    --soft: ${THEMES.green.soft};
    --map-hue: ${THEMES.green.mapHue};
    --emergency: #ff5a5a;
    --void: #04070a;
    --sweep-period: ${DEFAULT_SWEEP_PERIOD_S * 1000}ms;
    display: block;
  }
  *{ box-sizing:border-box; }
  ha-card{
    background: radial-gradient(ellipse at center, #0a0f0d 0%, #04070a 65%);
    color:var(--text);
    font-family: var(--mono);
    padding: 24px 16px;
    overflow: hidden;
  }
  .console{
    display:flex; gap:24px; align-items:flex-start; justify-content:center;
    flex-wrap:wrap;
    container-type:inline-size;
  }
  .console.contacts-left .panel{ order:-1; }
  /* too narrow for the panel beside the radar: let it fall below instead of above */
  @container (max-width: 659px){
    .console.contacts-left .panel{ order:0; }
  }
  .console.contacts-bottom{ flex-direction:column; align-items:center; }
  .console.contacts-bottom .radar-col{ width:100%; }
  .console.contacts-none .panel{ display:none; }
  .radar-col{ display:flex; flex-direction:column; align-items:center; gap:10px; flex:1 1 320px; min-width:0; }
  .readout{
    display:flex; justify-content:space-between; gap:18px;
    width:min(var(--radar-max, 100%), 100%, var(--radar-fit, 9999px)); font-size:11px; letter-spacing:.08em;
    color:var(--soft); text-transform:uppercase;
  }
  .readout span b{ color: var(--green); font-weight:600; }

  .radar-frame{
    position:relative;
    width:min(var(--radar-max, 100%), 100%, var(--radar-fit, 9999px)); aspect-ratio:1/1;
    border-radius:50%;
    background:#000;
    box-shadow:
      0 0 0 2px #0d1512,
      0 0 0 12px #101d18,
      0 0 0 14px #060a08,
      inset 0 0 50px rgba(0,0,0,.7),
      0 24px 60px rgba(0,0,0,.65);
    overflow:hidden;
  }
  #map{
    position:absolute; inset:0; width:100%; height:100%;
    filter: grayscale(.35) brightness(var(--map-brightness, ${DEFAULT_MAP_BRIGHTNESS})) sepia(.3) hue-rotate(var(--map-hue, 65deg)) saturate(2.6) contrast(1.1);
    background:#000;
  }
  .leaflet-control-attribution{
    background: rgba(0,0,0,.5) !important;
    color:var(--muted) !important;
    font-size:8px !important;
  }
  .leaflet-control-attribution a{ color:var(--soft) !important; }

  .radar-tint{
    position:absolute; inset:0; border-radius:50%; pointer-events:none;
    background: radial-gradient(circle, rgba(var(--accent-rgb),.06), rgba(0,0,0,.4) 100%);
    mix-blend-mode: overlay;
  }
  .sweep{
    position:absolute; inset:0; border-radius:50%; pointer-events:none;
    /* glow tail sits BEHIND the leading edge (322-360deg) so blips light up
       exactly when the bright line passes them and fade afterwards.
       Rotation is driven from JS (the sweep-frame loop) so the visible beam
       and the blip "ping" share one clock — a CSS animation would start at an
       arbitrary phase relative to the JS timer. */
    background: conic-gradient(from 0deg, rgba(var(--accent-rgb),0) 0deg, rgba(var(--accent-rgb),0) 322deg, rgba(var(--accent-rgb),.6) 360deg);
    mix-blend-mode: screen;
    will-change: transform;
  }
  .sound-toggle{
    width:24px; height:24px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    align-self:center; flex:0 0 auto;
    border:1px solid rgba(var(--accent-rgb),.35);
    background:rgba(0,0,0,.55); color:var(--muted); cursor:pointer;
    padding:0;
  }
  .sound-toggle svg{ width:13px; height:13px; fill:currentColor; }
  .sound-toggle:hover{ box-shadow:0 0 0 1px rgba(var(--accent-rgb),.5); }
  .sound-toggle.armed{ color:var(--green); border-color:rgba(var(--accent-rgb),.7); }
  .sound-toggle[hidden]{ display:none; }
  .bezel{ position:absolute; inset:0; pointer-events:none; }
  .bz-ring{ fill:none; stroke:rgba(var(--accent-rgb),.22); }
  .bz-tick{ stroke:rgba(var(--accent-rgb),.4); }
  .bz-txt{ fill:var(--soft); opacity:.55; }
  .bz-lbl{ fill:var(--muted); }
  .scanlines{
    position:absolute; inset:0; border-radius:50%; pointer-events:none;
    background: repeating-linear-gradient(to bottom, rgba(0,0,0,.16) 0px, rgba(0,0,0,.16) 1px, transparent 2px, transparent 3px);
    mix-blend-mode:multiply; opacity:.55;
  }
  .vignette{
    position:absolute; inset:0; border-radius:50%; pointer-events:none;
    background: radial-gradient(circle, transparent 52%, rgba(0,0,0,.6) 100%);
  }

  .blip-shape{
    width:0; height:0;
    border-left:5px solid transparent;
    border-right:5px solid transparent;
    border-bottom:12px solid var(--blip-color, var(--green));
    transform-origin: 50% 60%;
    transition: border-bottom-color .2s linear;
  }
  .blip-label{
    position:absolute; top:12px; left:8px; white-space:nowrap;
    font-size:9px; letter-spacing:.03em; color:var(--blip-color, var(--green));
    text-shadow: 0 0 4px rgba(0,0,0,.9);
  }
  .blip-shape.heli{
    width:9px; height:9px;
    border:2px solid var(--blip-color, var(--green));
    border-radius:50%;
    background:rgba(0,0,0,.35);
    transform-origin:50% 50%;
  }
  .blip-tag{
    display:none; position:absolute; left:16px; top:-16px;
    padding:2px 6px; white-space:nowrap;
    font-size:8.5px; line-height:1.4; color:var(--blip-color, var(--green));
    background:rgba(0,0,0,.72);
    border:1px solid rgba(var(--selected-rgb),.5);
  }
  .blip-tag::before{
    content:''; position:absolute; left:-8px; top:50%;
    width:8px; height:1px; background:rgba(var(--selected-rgb),.5);
  }
  .blip-icon.selected .blip-tag{ display:block; }
  .blip-icon.selected .blip-label{ display:none; }
  .blip-icon.alert::after{
    content:''; position:absolute; inset:-7px; border-radius:50%;
    border:1px solid var(--blip-color, var(--green));
    animation: blipPulse 1.3s ease-out infinite;
    pointer-events:none;
  }
  @keyframes blipPulse{
    0%{ transform:scale(.35); opacity:1; }
    100%{ transform:scale(1.4); opacity:0; }
  }
  @media (prefers-reduced-motion: no-preference){
    ha-card.boot .bezel{ animation: bootFade 1.6s ease-out both; }
    ha-card.boot #map{ animation: bootFade 2.4s ease-out both; }
    ha-card.boot .sweep{ animation: bootFade 2s ease-out both; }
    ha-card.boot .panel, ha-card.boot .readout{ animation: bootFade 1.2s ease-out both; }
  }
  @keyframes bootFade{ from{ opacity:0; } }

  .panel{
    width:300px; max-width:100%;
    background: linear-gradient(180deg, rgba(10,20,16,.92), rgba(6,12,10,.92));
    border:1px solid rgba(var(--accent-rgb),.25);
    border-radius:10px;
    padding:14px 14px 8px;
  }
  .panel h2{
    font-size:11px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--green); margin:0 0 10px; font-weight:600;
  }
  .panel h2 small{ color:var(--muted); text-transform:none; letter-spacing:0; display:block; margin-top:2px; font-size:10px;}
  .contact-list{ list-style:none; margin:0; padding:0; max-height:420px; overflow:auto; }
  .contact-row{
    all:unset;
    display:block; width:100%;
    padding:7px 6px; border-radius:6px; cursor:pointer;
    font-family:var(--mono); font-size:11px; color:var(--text);
  }
  .contact-main{
    display:grid; grid-template-columns: 1fr 46px 44px 46px; gap:4px;
  }
  .contact-sub{
    margin-top:2px; font-size:9.5px; color:var(--muted); letter-spacing:.02em;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .contact-row.selected .contact-sub{ color: rgba(var(--selected-rgb),.75); }
  .contact-row.emergency{ color: var(--emergency); }
  .contact-row.lost{ opacity:.45; }
  .contact-row.emergency .cs::after{ content:' ⚠'; }
  .contact-row.emergency .contact-sub{ color: rgba(255,90,90,.7); }
  .contact-photo{ margin-top:8px; }
  .contact-photo img{
    display:block; width:100%; max-height:180px; object-fit:cover;
    border-radius:6px;
    border:1px solid rgba(var(--accent-rgb),.25);
  }
  .contact-row:hover, .contact-row:focus-visible{
    background: rgba(var(--accent-rgb),.12);
    box-shadow: 0 0 0 1px rgba(var(--accent-rgb),.4) inset;
    outline:none;
  }
  .contact-row.selected{
    background: rgba(var(--selected-rgb),.14);
    color: rgb(var(--selected-rgb));
    box-shadow: 0 0 0 1px rgba(var(--selected-rgb),.4) inset;
  }
  .contact-row .cs{ font-weight:600; }
  .contact-head{
    display:grid; grid-template-columns: 1fr 46px 44px 46px; gap:4px;
    padding:0 6px 6px; font-size:9px; letter-spacing:.08em; color:var(--muted); text-transform:uppercase;
  }
  .warning{
    padding:12px; font-size:12px; color:var(--amber);
  }
`;

function toRad(d) { return d * Math.PI / 180; }

// ---- Visual config editor (rendered by HA's card editor dialog via ha-form) ----

const EDITOR_SCHEMA = [
  { name: 'entity', required: true, selector: { entity: { domain: 'sensor' } } },
  { name: 'radius_km', selector: { number: { min: 1, max: 500, step: 1, mode: 'box' } } },
  { name: 'contacts_position', selector: { select: { mode: 'dropdown', options: CONTACTS_POSITIONS.map((v) => ({ value: v, label: v })) } } },
  { name: 'theme', selector: { select: { mode: 'dropdown', options: Object.keys(THEMES).map((v) => ({ value: v, label: v })) } } },
  { name: 'show_details', selector: { boolean: {} } },
  { name: 'show_photo', selector: { boolean: {} } },
  { name: 'smooth_motion', selector: { boolean: {} } },
  { name: 'trail_style', selector: { select: { mode: 'dropdown', options: TRAIL_STYLES.map((v) => ({ value: v, label: v })) } } },
  { name: 'show_ring_labels', selector: { boolean: {} } },
  { name: 'startup_animation', selector: { boolean: {} } },
  { name: 'alert_distance_km', selector: { number: { min: 0, max: 200, step: 1, mode: 'box' } } },
  { name: 'linger_time', selector: { number: { min: 0, max: 300, step: 5, mode: 'box' } } },
  { name: 'sound_alerts', selector: { select: { mode: 'dropdown', options: SOUND_MODES.map((v) => ({ value: v, label: v })) } } },
  { name: 'speed_unit', selector: { select: { mode: 'dropdown', options: SPEED_UNITS.map((v) => ({ value: v, label: v })) } } },
  { name: 'altitude_unit', selector: { select: { mode: 'dropdown', options: ALTITUDE_UNITS.map((v) => ({ value: v, label: v })) } } },
  { name: 'debug', selector: { boolean: {} } },
  { name: 'map_brightness', selector: { number: { min: 0.1, max: 1.5, step: 0.05, mode: 'slider' } } },
  { name: 'sweep_period', selector: { number: { min: 1, max: 20, step: 0.5, mode: 'slider' } } },
  { name: 'trail_length', selector: { number: { min: 1, max: 500, step: 1, mode: 'box' } } },
  { name: 'max_diameter', selector: { number: { min: 0, max: 2000, step: 10, mode: 'box' } } },
  { name: 'fit_height', selector: { boolean: {} } },
  { name: 'height_offset', selector: { number: { min: 0, max: 600, step: 10, mode: 'box' } } },
  { name: 'site_label', selector: { text: {} } },
  { name: 'latitude', selector: { number: { min: -90, max: 90, step: 'any', mode: 'box' } } },
  { name: 'longitude', selector: { number: { min: -180, max: 180, step: 'any', mode: 'box' } } },
];

const EDITOR_LABELS = {
  entity: 'Entity (FR24 current-in-area sensor)',
  radius_km: 'Radius (km) — set to match your FR24 integration',
  contacts_position: 'Contacts panel position',
  theme: 'Color theme',
  show_details: 'Show aircraft details in contacts (model, route…)',
  show_photo: 'Show aircraft photo for selected contact',
  smooth_motion: 'Smooth blip motion between updates',
  trail_style: 'Trail style (line or phosphor dots)',
  show_ring_labels: 'Show km labels on range rings',
  startup_animation: 'Play startup animation',
  alert_distance_km: 'Proximity alert distance (km, 0 = off)',
  linger_time: 'Keep lost contacts for (seconds, 0 = remove instantly)',
  sound_alerts: 'Sound alerts (synthesized pings)',
  speed_unit: 'Speed unit (kts or kmh)',
  altitude_unit: 'Altitude unit (ft or m)',
  debug: 'Show size diagnostics (troubleshooting)',
  map_brightness: 'Map brightness',
  sweep_period: 'Sweep period (seconds)',
  trail_length: 'Trail length (positions)',
  max_diameter: 'Max scope diameter (px, 0 = fill the column)',
  fit_height: 'Fit scope to screen height',
  height_offset: 'Height offset (px reserved for header etc.)',
  site_label: 'Site label (top-left readout)',
  latitude: 'Latitude (defaults to HA home)',
  longitude: 'Longitude (defaults to HA home)',
};

const EDITOR_DEFAULTS = {
  radius_km: DEFAULT_RADIUS_KM,
  contacts_position: 'right',
  map_brightness: DEFAULT_MAP_BRIGHTNESS,
  sweep_period: DEFAULT_SWEEP_PERIOD_S,
  trail_length: DEFAULT_TRAIL_LENGTH,
  max_diameter: 0,
  fit_height: true,
  height_offset: DEFAULT_HEIGHT_OFFSET,
  show_details: true,
  theme: 'green',
  trail_style: 'line',
  smooth_motion: true,
  show_ring_labels: true,
  startup_animation: true,
  show_photo: true,
  alert_distance_km: 0,
  linger_time: 45,
  sound_alerts: 'none',
  speed_unit: 'kts',
  altitude_unit: 'ft',
};

class FlightradarRadarCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
      this._form.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        const value = ev.detail.value || {};
        const config = {};
        for (const [k, v] of Object.entries(value)) {
          if (v !== '' && v != null) config[k] = v;
        }
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config }, bubbles: true, composed: true,
        }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = { ...EDITOR_DEFAULTS, ...this._config };
  }
}

customElements.define('flightradar-radar-card-editor', FlightradarRadarCardEditor);

class FlightradarRadarCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._map = null;
    this._boundary = null;
    this._aircraft = new Map(); // icao24 -> { data, x, y, trail, lastSweep, marker, poly }
    this._selectedId = null;
    this._pendingFlights = null;
    this._leafletCssReady = false;
    this._connected = false;
    this._rafId = null;
    this._clockTimer = null;
    this._resizeObserver = null;
    this._lastStateObj = null;
    this._lastSweepAngle = 0;
    this._sweepMs = DEFAULT_SWEEP_PERIOD_S * 1000;
    this._anonSeq = 1;
    this._audioCtx = null;
    this._initialSyncDone = false;
    try {
      this._soundArmed = localStorage.getItem(SOUND_STORAGE_KEY) === '1';
    } catch (e) {
      this._soundArmed = false;
    }
    this._sweepEl = null;
    this._reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._colors = {
      accent: `rgb(${THEMES.green.accentRgb})`,
      selected: `rgb(${THEMES.green.selectedRgb})`,
      emergency: '#ff5a5a',
    };
  }

  // ---- Lovelace API ----

  static getConfigElement() {
    return document.createElement('flightradar-radar-card-editor');
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass?.states || {}).find(
      (id) => id.startsWith('sensor.flightradar24')
    );
    return {
      entity: entity || 'sensor.flightradar24_current_in_area',
      ...EDITOR_DEFAULTS,
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('flightradar-radar-card: "entity" is required (e.g. sensor.flightradar24_current_in_area)');
    }
    if (config.radius_km != null && !(Number(config.radius_km) > 0)) {
      throw new Error('flightradar-radar-card: "radius_km" must be a positive number');
    }
    if (config.contacts_position != null && !CONTACTS_POSITIONS.includes(config.contacts_position)) {
      throw new Error(`flightradar-radar-card: "contacts_position" must be one of ${CONTACTS_POSITIONS.join(', ')}`);
    }
    if (config.theme != null && !THEMES[config.theme]) {
      throw new Error(`flightradar-radar-card: "theme" must be one of ${Object.keys(THEMES).join(', ')}`);
    }
    if (config.trail_style != null && !TRAIL_STYLES.includes(config.trail_style)) {
      throw new Error(`flightradar-radar-card: "trail_style" must be one of ${TRAIL_STYLES.join(', ')}`);
    }
    if (config.sound_alerts != null && !SOUND_MODES.includes(config.sound_alerts)) {
      throw new Error(`flightradar-radar-card: "sound_alerts" must be one of ${SOUND_MODES.join(', ')}`);
    }
    if (config.speed_unit != null && !SPEED_UNITS.includes(config.speed_unit)) {
      throw new Error(`flightradar-radar-card: "speed_unit" must be one of ${SPEED_UNITS.join(', ')}`);
    }
    if (config.altitude_unit != null && !ALTITUDE_UNITS.includes(config.altitude_unit)) {
      throw new Error(`flightradar-radar-card: "altitude_unit" must be one of ${ALTITUDE_UNITS.join(', ')}`);
    }
    this._config = {
      ...config,
      radius_km: config.radius_km != null ? Number(config.radius_km) : DEFAULT_RADIUS_KM,
      contacts_position: config.contacts_position || 'right',
      map_brightness: config.map_brightness != null ? Number(config.map_brightness) : DEFAULT_MAP_BRIGHTNESS,
      sweep_period: Number(config.sweep_period) > 0 ? Number(config.sweep_period) : DEFAULT_SWEEP_PERIOD_S,
      trail_length: Number(config.trail_length) > 0 ? Math.round(Number(config.trail_length)) : DEFAULT_TRAIL_LENGTH,
      max_diameter: Number(config.max_diameter) > 0 ? Number(config.max_diameter) : 0,
      fit_height: config.fit_height !== false,
      height_offset: Number(config.height_offset) >= 0 ? Number(config.height_offset) : DEFAULT_HEIGHT_OFFSET,
      show_details: config.show_details !== false,
      theme: config.theme || 'green',
      trail_style: config.trail_style || 'line',
      smooth_motion: config.smooth_motion !== false,
      show_ring_labels: config.show_ring_labels !== false,
      startup_animation: config.startup_animation !== false,
      show_photo: config.show_photo !== false,
      alert_distance_km: Number(config.alert_distance_km) > 0 ? Number(config.alert_distance_km) : 0,
      linger_time: Number(config.linger_time) >= 0 ? Number(config.linger_time) : 45,
      sound_alerts: config.sound_alerts || 'none',
      speed_unit: config.speed_unit || 'kts',
      altitude_unit: config.altitude_unit || 'ft',
      debug: config.debug === true,
    };
    this._sweepMs = this._config.sweep_period * 1000;
    this._applyConfigStyles();
    // Config edits can change center/radius: rebuild the map on next opportunity.
    if (this._map) {
      this._destroyMap();
      this._tryInitMap();
    }
  }

  _applyConfigStyles() {
    const cfg = this._config;
    const th = THEMES[cfg.theme] || THEMES.green;
    this._colors = {
      accent: `rgb(${th.accentRgb})`,
      selected: `rgb(${th.selectedRgb})`,
      emergency: '#ff5a5a',
    };
    this.style.setProperty('--accent-rgb', th.accentRgb);
    this.style.setProperty('--selected-rgb', th.selectedRgb);
    this.style.setProperty('--text', th.text);
    this.style.setProperty('--muted', th.muted);
    this.style.setProperty('--soft', th.soft);
    this.style.setProperty('--map-hue', th.mapHue);
    this.style.setProperty('--sweep-period', `${this._sweepMs}ms`);
    this.style.setProperty('--map-brightness', String(cfg.map_brightness));
    if (cfg.max_diameter) {
      this.style.setProperty('--radar-max', `${cfg.max_diameter}px`);
    } else {
      this.style.removeProperty('--radar-max');
    }
    this._updateFitHeight();
    const consoleEl = this.shadowRoot && this.shadowRoot.querySelector('.console');
    if (consoleEl) {
      consoleEl.className = `console contacts-${cfg.contacts_position}`;
    }
    // bezel content depends on radius (ring labels) — rebuild it when config changes
    if (this.shadowRoot && this.shadowRoot.getElementById('bezel')) {
      this._buildBezel();
    }
    this._updateSoundToggle();
  }

  // ---- Sound alerts (Web Audio synthesized pings, no audio files) ----

  _ensureAudio() {
    if (!this._audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this._audioCtx = new Ctx();
    }
    return this._audioCtx;
  }

  _playTone(freqStart, freqEnd, dur, delay = 0, vol = 0.2, type = 'sine') {
    const ctx = this._audioCtx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _playPing(kind) {
    if (!this._soundArmed || !this._config) return;
    const mode = this._config.sound_alerts;
    if (mode === 'none') return;
    if (kind === 'contact' && mode !== 'new_contact' && mode !== 'all') return;
    if (kind === 'proximity' && mode !== 'proximity' && mode !== 'all') return;
    // emergency plays in every non-'none' mode
    const ctx = this._ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (kind === 'contact') {
      this._playTone(1150, 580, 0.5);
    } else if (kind === 'proximity') {
      this._playTone(1400, 900, 0.18);
      this._playTone(1400, 900, 0.18, 0.24);
    } else if (kind === 'emergency') {
      this._playTone(950, 940, 0.16, 0, 0.22, 'triangle');
      this._playTone(640, 630, 0.16, 0.2, 0.22, 'triangle');
      this._playTone(950, 940, 0.16, 0.4, 0.22, 'triangle');
      this._playTone(640, 630, 0.16, 0.6, 0.22, 'triangle');
    }
  }

  _setSoundArmed(armed) {
    this._soundArmed = armed;
    try { localStorage.setItem(SOUND_STORAGE_KEY, armed ? '1' : '0'); } catch (e) { /* private mode */ }
    this._updateSoundToggle();
    if (armed) {
      const ctx = this._ensureAudio();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      // confirmation ping doubles as an "audio actually works" check
      this._playTone(900, 550, 0.3);
    }
  }

  _updateSoundToggle() {
    const btn = this.shadowRoot && this.shadowRoot.getElementById('soundToggle');
    if (!btn) return;
    const enabled = this._config && this._config.sound_alerts !== 'none';
    btn.hidden = !enabled;
    if (!enabled) return;
    btn.classList.toggle('armed', this._soundArmed);
    btn.innerHTML = this._soundArmed ? SPEAKER_ON_SVG : SPEAKER_OFF_SVG;
    btn.title = this._soundArmed ? 'Sound alerts on — click to mute' : 'Sound alerts muted — click to enable';
  }

  // Pixel-based height cap: 100dvh is unsupported in older Android WebViews
  // (HA companion app on wall tablets), so measure the viewport in JS instead.
  _updateFitHeight() {
    const cfg = this._config;
    if (!cfg || !cfg.fit_height) {
      this.style.removeProperty('--radar-fit');
      return;
    }
    const h = window.innerHeight - cfg.height_offset;
    if (h > 100) this.style.setProperty('--radar-fit', `${h}px`);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    this._tryInitMap();

    const stateObj = hass.states[this._config.entity];
    if (!stateObj) {
      this._showWarning(`Entity not found: ${this._config.entity}`);
      return;
    }
    this._clearWarning();
    if (stateObj === this._lastStateObj) return; // unchanged entity, skip re-render
    this._lastStateObj = stateObj;

    const flights = Array.isArray(stateObj.attributes.flights) ? stateObj.attributes.flights : [];
    if (this._map) {
      this._reconcileFlights(flights);
    } else {
      this._pendingFlights = flights; // applied once Leaflet + map are ready
    }
  }

  get hass() { return this._hass; }

  getCardSize() { return 8; }

  // ---- Lifecycle ----

  connectedCallback() {
    this._connected = true;
    ensureFontLoaded();
    if (!this.shadowRoot.firstChild) this._buildDom();
    if (!this._onWindowResize) {
      this._onWindowResize = () => this._updateFitHeight();
      window.addEventListener('resize', this._onWindowResize);
    }
    this._updateFitHeight();
    if (!this._onPointerDown) {
      // browsers keep audio suspended until a user gesture: if sound was armed
      // on a previous visit, any tap on the card re-enables it
      this._onPointerDown = () => {
        if (this._soundArmed && this._config && this._config.sound_alerts !== 'none') {
          const ctx = this._ensureAudio();
          if (ctx && ctx.state === 'suspended') ctx.resume();
        }
      };
      this.shadowRoot.addEventListener('pointerdown', this._onPointerDown);
    }
    loadLeaflet().then(() => this._tryInitMap()).catch((err) => this._showWarning(err.message));

    if (!this._clockTimer) {
      this._clockTimer = setInterval(() => {
        const el = this.shadowRoot.getElementById('clock');
        if (el) el.textContent = new Date().toISOString().substring(11, 19) + ' UTC';
        // some Android WebViews deliver resize events unreliably — re-measure
        // on the clock tick so the height fit always converges
        this._updateFitHeight();
        const dbg = this.shadowRoot.getElementById('debugReadout');
        if (dbg) {
          const on = this._config && this._config.debug;
          dbg.hidden = !on;
          if (on) {
            const frame = this.shadowRoot.getElementById('frame');
            dbg.textContent = `DBG v${CARD_VERSION} · win ${window.innerWidth}x${window.innerHeight}`
              + ` · fit ${this.style.getPropertyValue('--radar-fit') || 'none'}`
              + ` · scope ${frame ? frame.offsetWidth : 0}px`;
          }
        }
      }, 1000);
    }
    if (this._rafId == null) {
      this._rafId = requestAnimationFrame((t) => this._sweepFrame(t));
    }
  }

  disconnectedCallback() {
    this._connected = false;
    if (this._rafId != null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
      this._onWindowResize = null;
    }
    if (this._onPointerDown) {
      this.shadowRoot.removeEventListener('pointerdown', this._onPointerDown);
      this._onPointerDown = null;
    }
  }

  // ---- DOM skeleton ----

  _buildDom() {
    const root = this.shadowRoot;

    const style = document.createElement('style');
    style.textContent = CARD_CSS;
    root.appendChild(style);

    // Leaflet's own stylesheet must live inside the shadow root to reach the map panes.
    const leafletCss = document.createElement('link');
    leafletCss.rel = 'stylesheet';
    leafletCss.href = LEAFLET_CSS;
    leafletCss.onload = () => { this._leafletCssReady = true; this._tryInitMap(); };
    root.appendChild(leafletCss);

    const card = document.createElement('ha-card');
    card.innerHTML = `
      <div class="warning" id="warning" hidden></div>
      <div class="console">
        <div class="radar-col">
          <div class="readout">
            <span>SITE <b id="siteReadout">—</b></span>
            <span>RANGE <b id="rangeReadout">—</b></span>
            <span id="clock">--:--:--</span>
            <button class="sound-toggle" id="soundToggle" hidden></button>
          </div>
          <div class="readout" id="debugReadout" hidden></div>
          <div class="radar-frame" id="frame">
            <div id="map"></div>
            <div class="radar-tint"></div>
            <div class="sweep"></div>
            <svg class="bezel" id="bezel" viewBox="0 0 100 100"></svg>
            <div class="scanlines"></div>
            <div class="vignette"></div>
          </div>
        </div>
        <div class="panel">
          <h2>Contacts <small id="contactCount">0 tracked</small></h2>
          <div class="contact-head">
            <span>Flight</span><span>Alt</span><span>Spd</span><span>Rng</span>
          </div>
          <ul class="contact-list" id="contactList"></ul>
          <div class="contact-photo" id="contactPhoto" hidden><img alt="Aircraft photo"/></div>
        </div>
      </div>
    `;
    root.appendChild(card);

    const soundBtn = root.getElementById('soundToggle');
    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setSoundArmed(!this._soundArmed);
    });
    this._updateSoundToggle();

    if (!this._config || this._config.startup_animation) {
      card.classList.add('boot');
      setTimeout(() => card.classList.remove('boot'), 3000);
    }

    this._buildBezel();
    if (this._config) this._applyConfigStyles();
  }

  _buildBezel() {
    const bezel = this.shadowRoot.getElementById('bezel');
    const svgns = 'http://www.w3.org/2000/svg';
    const C = 50, R = 48;
    const svgEl = (tag, attrs) => {
      const el = document.createElementNS(svgns, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    };
    bezel.textContent = '';
    [0.25, 0.5, 0.75, 1].forEach((f) => {
      bezel.appendChild(svgEl('circle', {
        class: 'bz-ring', cx: C, cy: C, r: R * f, 'stroke-width': 0.3,
      }));
    });
    for (let deg = 0; deg < 360; deg += 10) {
      const major = deg % 30 === 0;
      const rad = (deg - 90) * Math.PI / 180;
      const rOuter = R;
      const rInner = R - (major ? 4 : 2);
      bezel.appendChild(svgEl('line', {
        class: 'bz-tick',
        x1: C + rOuter * Math.cos(rad), y1: C + rOuter * Math.sin(rad),
        x2: C + rInner * Math.cos(rad), y2: C + rInner * Math.sin(rad),
        'stroke-width': major ? 0.5 : 0.25,
      }));
    }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([label, deg]) => {
      const rad = (deg - 90) * Math.PI / 180;
      const t = svgEl('text', {
        class: 'bz-txt',
        x: C + (R - 9) * Math.cos(rad), y: C + (R - 9) * Math.sin(rad),
        'font-size': 4, 'font-family': 'var(--mono)',
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
      });
      t.textContent = label;
      bezel.appendChild(t);
    });
    // range labels on the inner rings, along the NNE spoke
    if (this._config && this._config.show_ring_labels) {
      const radiusKm = this._config.radius_km;
      const rad = (25 - 90) * Math.PI / 180;
      [0.25, 0.5, 0.75].forEach((f) => {
        const t = svgEl('text', {
          class: 'bz-lbl',
          x: C + (R * f + 1.8) * Math.cos(rad), y: C + (R * f + 1.8) * Math.sin(rad),
          'font-size': 2.4, 'font-family': 'var(--mono)',
          'text-anchor': 'middle', 'dominant-baseline': 'middle',
        });
        const km = radiusKm * f;
        t.textContent = `${km >= 10 ? Math.round(km) : km.toFixed(1)}km`;
        bezel.appendChild(t);
      });
    }
  }

  _showWarning(msg) {
    const el = this.shadowRoot.getElementById('warning');
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  _clearWarning() {
    const el = this.shadowRoot.getElementById('warning');
    if (el) el.hidden = true;
  }

  // ---- Map ----

  _resolveCenter() {
    const cfg = this._config || {};
    if (cfg.latitude != null && cfg.longitude != null) {
      return { lat: Number(cfg.latitude), lon: Number(cfg.longitude) };
    }
    const haCfg = this._hass?.config;
    if (haCfg && haCfg.latitude != null && haCfg.longitude != null) {
      return { lat: haCfg.latitude, lon: haCfg.longitude };
    }
    return null;
  }

  _tryInitMap() {
    if (this._map || !this._connected || !window.L || !this._leafletCssReady || !this._config) return;
    const center = this._resolveCenter();
    if (!center) return; // waiting for hass

    const L = window.L;
    this._center = center;
    const radiusKm = this._config.radius_km;

    this.shadowRoot.getElementById('rangeReadout').textContent = `${radiusKm} KM`;
    this.shadowRoot.getElementById('siteReadout').textContent =
      (this._config.site_label || this._hass?.config?.location_name || 'HOME').toUpperCase();

    const mapEl = this.shadowRoot.getElementById('map');
    this._map = L.map(mapEl, {
      zoomControl: false, attributionControl: true, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
      keyboard: false, touchZoom: false, tap: false,
      // fractional zoom so fitBounds makes the scope rim EXACTLY radius_km —
      // with integer zoom snapping the visible rim could be 1.5x the range,
      // making the bezel ring labels lie about distances
      zoomSnap: 0,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
      // card version in the attribution so the running version is visible on
      // devices without a dev console (wall tablets)
      attribution: `&copy; OpenStreetMap &copy; CARTO &middot; card v${CARD_VERSION}`,
    }).addTo(this._map);

    const homeLatLng = L.latLng(center.lat, center.lon);
    // Set the view before adding vector layers: Leaflet defers layer attachment
    // until the map has a view, so circle.getBounds() would throw here.
    this._homeBounds = homeLatLng.toBounds(radiusKm * 2000);
    this._map.fitBounds(this._homeBounds, { animate: false });

    const accent = this._colors.accent;
    this._boundary = L.circle(homeLatLng, {
      radius: radiusKm * 1000, color: accent, weight: 1, opacity: .35, fill: false, dashArray: '2 6',
    }).addTo(this._map);

    L.circleMarker(homeLatLng, {
      radius: 4, color: accent, weight: 1, fillColor: accent, fillOpacity: 1,
    }).addTo(this._map);

    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => {
        this._updateFitHeight();
        if (!this._map) return;
        this._map.invalidateSize();
        if (this._homeBounds) this._map.fitBounds(this._homeBounds, { animate: false });
      });
      this._resizeObserver.observe(this.shadowRoot.getElementById('frame'));
    }

    if (this._pendingFlights) {
      const flights = this._pendingFlights;
      this._pendingFlights = null;
      this._reconcileFlights(flights);
    }
  }

  _destroyMap() {
    for (const ac of this._aircraft.values()) {
      ac.marker.remove();
      if (ac.poly) ac.poly.remove();
      if (ac.dots) ac.dots.forEach((d) => d.remove());
    }
    this._aircraft.clear();
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._map) { this._map.remove(); this._map = null; }
    this._boundary = null;
  }

  _kmOffsets(lat, lon) {
    const x = (lon - this._center.lon) * KM_PER_DEG_LAT * Math.cos(toRad(this._center.lat));
    const y = (lat - this._center.lat) * KM_PER_DEG_LAT;
    return { x, y };
  }

  _makeIcon() {
    return window.L.divIcon({
      className: 'blip-icon',
      html: '<div class="blip-shape"></div><div class="blip-label"></div>'
        + '<div class="blip-tag"><div class="t1"></div><div class="t2"></div></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
  }

  _refreshTrailDots(ac) {
    if (ac.dots) ac.dots.forEach((d) => d.remove());
    const n = ac.trail.length;
    // skip the last point — that's the aircraft's current position
    ac.dots = ac.trail.slice(0, -1).map(([la, lo], i) =>
      window.L.circleMarker([la, lo], {
        radius: 1.6, stroke: false, fillColor: this._colors.accent,
        fillOpacity: 0.06 + 0.3 * ((i + 1) / n),
        interactive: false,
      }).addTo(this._map));
  }

  // ---- Flight reconciliation (add / update / remove by aircraft_icao_24bit) ----

  _reconcileFlights(flights) {
    const L = window.L;
    const seen = new Set();

    for (const f of flights) {
      const lat = Number(f.latitude);
      const lon = Number(f.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      // FR24 reports privacy-blocked aircraft with the literal string 'BLOCKED'
      const reg = f.aircraft_registration && f.aircraft_registration !== 'BLOCKED' ? f.aircraft_registration : '';
      // `||` not `??`: anonymized aircraft can report empty strings for these
      let id = f.aircraft_icao_24bit || f.callsign || reg || f.flight_number || '';
      if (!id || id === 'BLOCKED') {
        // no usable identity: adopt the nearest existing anonymous track so the
        // blip and its trail persist across updates instead of respawning
        let best = null;
        let bestD = 10; // km
        for (const cand of this._aircraft.values()) {
          if (!cand.anon || seen.has(cand.id)) continue;
          const dx = (cand.lon - lon) * KM_PER_DEG_LAT * Math.cos(toRad(lat));
          const dy = (cand.lat - lat) * KM_PER_DEG_LAT;
          const d = Math.hypot(dx, dy);
          if (d < bestD) { best = cand; bestD = d; }
        }
        id = best ? best.id : `anon-${this._anonSeq++}`;
      }
      seen.add(id);

      let ac = this._aircraft.get(id);
      if (!ac) {
        ac = {
          id,
          anon: id.startsWith('anon-'),
          trail: [],
          lastSweep: 0,
          trend: '',
          dispLat: lat,
          dispLon: lon,
          marker: L.marker([lat, lon], { icon: this._makeIcon(), interactive: true }).addTo(this._map),
        };
        if (this._config.trail_style === 'dots') {
          ac.dots = [];
        } else {
          ac.poly = L.polyline([[lat, lon]], { color: this._colors.accent, weight: 1.4, opacity: .3 }).addTo(this._map);
        }
        ac.marker.on('click', () => {
          this._selectedId = (this._selectedId === ac.id) ? null : ac.id;
          this._renderContacts();
        });
        this._aircraft.set(id, ac);
        // no ping for the initial batch when the card loads
        if (this._initialSyncDone) this._playPing('contact');
      }

      const prevAlt = ac.alt;
      ac.heli = isHelicopter(f);
      // blocked/anonymous aircraft: label by type like the FR24 site does,
      // instead of showing the literal 'BLOCKED' placeholder
      const cs = f.callsign && f.callsign !== 'BLOCKED' ? f.callsign : '';
      ac.callsign = cs || f.flight_number || reg || f.aircraft_code
        || (ac.heli ? 'HELI' : 'NO-ID');
      ac.alt = Number(f.altitude) || 0;
      ac.speedKts = Number(f.ground_speed) || 0;
      ac.heading = Number(f.heading ?? f.track) || 0;
      ac.model = f.aircraft_model || f.aircraft_code || '';
      ac.reg = reg;
      ac.airline = f.airline_short || '';
      ac.origin = f.airport_origin_code_iata || '';
      ac.dest = f.airport_destination_code_iata || '';
      ac.squawk = String(f.squawk || '');
      const wasEmergency = ac.emergency;
      ac.emergency = EMERGENCY_SQUAWKS.includes(ac.squawk);
      if (ac.emergency && !wasEmergency && this._initialSyncDone) this._playPing('emergency');
      ac.photo = f.aircraft_photo_small || f.aircraft_photo_medium || '';
      if (prevAlt != null) {
        const climb = ac.alt - prevAlt;
        ac.trend = Math.abs(climb) >= 100 ? (climb > 0 ? '▲' : '▼') : '';
      }
      ac.lat = lat;
      ac.lon = lon;
      // dead-reckoning base: the sweep-frame loop extrapolates from here
      ac.baseLat = lat;
      ac.baseLon = lon;
      ac.baseTime = performance.now();
      const { x, y } = this._kmOffsets(lat, lon);
      ac.x = x;
      ac.y = y;

      const last = ac.trail[ac.trail.length - 1];
      if (!last || last[0] !== lat || last[1] !== lon) {
        ac.trail.push([lat, lon]);
        while (ac.trail.length > this._config.trail_length) ac.trail.shift();
      }

      if (!this._config.smooth_motion) {
        ac.dispLat = lat;
        ac.dispLon = lon;
        ac.marker.setLatLng([lat, lon]);
      }
      if (ac.poly) ac.poly.setLatLngs(ac.trail);
      if (ac.dots) this._refreshTrailDots(ac);
      const el = ac.marker.getElement();
      if (el) {
        const shape = el.querySelector('.blip-shape');
        const label = el.querySelector('.blip-label');
        if (shape) {
          shape.classList.toggle('heli', !!ac.heli);
          shape.style.transform = ac.heli ? '' : `rotate(${ac.heading}deg)`;
        }
        if (label) label.textContent = ac.callsign;
      }
    }

    // aircraft that dropped out of the sensor list start lingering; the
    // sweep-frame loop expires them after linger_time (0 = remove now)
    const nowTs = performance.now();
    for (const [id, ac] of this._aircraft) {
      if (seen.has(id)) {
        ac.lostAt = null;
      } else if (!ac.lostAt) {
        ac.lostAt = nowTs;
      }
      if (ac.lostAt && this._config.linger_time === 0) {
        ac.marker.remove();
        if (ac.poly) ac.poly.remove();
        if (ac.dots) ac.dots.forEach((d) => d.remove());
        this._aircraft.delete(id);
        if (this._selectedId === id) this._selectedId = null;
      }
    }

    this._renderContacts();
    this._initialSyncDone = true;
  }

  // ---- Unit formatting (FR24 reports altitude in ft, ground speed in kts) ----

  _fmtAlt(ft) {
    if (this._config.altitude_unit === 'm') return `${Math.round(ft * 0.3048)}m`;
    return `${(ft / 1000).toFixed(1)}k`;
  }

  _fmtSpd(kts) {
    return String(Math.round(this._config.speed_unit === 'kmh' ? kts * 1.852 : kts));
  }

  _spdUnitLabel() {
    return this._config.speed_unit === 'kmh' ? 'km/h' : 'kt';
  }

  // ---- Contact list ----

  _renderContacts() {
    const listEl = this.shadowRoot.getElementById('contactList');
    const countEl = this.shadowRoot.getElementById('contactCount');
    if (!listEl || !countEl) return;

    const sorted = [...this._aircraft.values()].sort(
      (a, b) => (b.emergency ? 1 : 0) - (a.emergency ? 1 : 0)
        || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)
    );
    listEl.textContent = '';
    for (const ac of sorted) {
      const dist = Math.hypot(ac.x, ac.y);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'contact-row'
        + (ac.id === this._selectedId ? ' selected' : '')
        + (ac.emergency ? ' emergency' : '')
        + (ac.lostAt ? ' lost' : '');
      const main = document.createElement('div');
      main.className = 'contact-main';
      const cells = [
        ['cs', ac.callsign],
        ['', `${this._fmtAlt(ac.alt)}${ac.trend || ''}`],
        ['', this._fmtSpd(ac.speedKts)],
        ['', `${dist.toFixed(0)}km`],
      ];
      for (const [cls, text] of cells) {
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = text;
        main.appendChild(span);
      }
      btn.appendChild(main);
      if (this._config.show_details) {
        const route = (ac.origin || ac.dest) ? `${ac.origin || '???'} → ${ac.dest || '???'}` : '';
        const subLines = [
          [ac.airline, ac.model].filter(Boolean).join(' · '),
          [ac.reg, route].filter(Boolean).join(' · '),
        ].filter(Boolean);
        for (const text of subLines) {
          const sub = document.createElement('div');
          sub.className = 'contact-sub';
          sub.textContent = text;
          btn.appendChild(sub);
        }
      }
      btn.addEventListener('click', () => {
        this._selectedId = (this._selectedId === ac.id) ? null : ac.id;
        this._renderContacts();
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    }
    countEl.textContent = `${this._aircraft.size} tracked`;

    // aircraft photo for the selected contact
    const photoEl = this.shadowRoot.getElementById('contactPhoto');
    if (photoEl) {
      const sel = this._aircraft.get(this._selectedId);
      if (this._config.show_photo && sel && sel.photo) {
        const img = photoEl.firstElementChild;
        if (img.getAttribute('src') !== sel.photo) img.src = sel.photo;
        photoEl.hidden = false;
      } else {
        photoEl.hidden = true;
      }
    }
  }

  // ---- Sweep-driven brightness decay (the "phosphor" effect) ----

  _sweepFrame(now) {
    this._rafId = this._connected ? requestAnimationFrame((t) => this._sweepFrame(t)) : null;

    // one clock for beam and pings; slow everything down under reduced motion
    const sweepMs = this._sweepMs * (this._reduceMotion ? 5 : 1);
    const angle = (now % sweepMs) / sweepMs * 360;
    const lastAngle = this._lastSweepAngle;

    const sweepEl = this._sweepEl
      || (this._sweepEl = this.shadowRoot && this.shadowRoot.querySelector('.sweep'));
    if (sweepEl) sweepEl.style.transform = `rotate(${angle}deg)`;

    if (!this._map || this._aircraft.size === 0) {
      this._lastSweepAngle = angle;
      return;
    }

    const cfg = this._config;
    const smooth = cfg && cfg.smooth_motion;
    const alertKm = cfg ? cfg.alert_distance_km : 0;
    const lingerMs = cfg ? cfg.linger_time * 1000 : 0;
    const expired = [];

    for (const ac of this._aircraft.values()) {
      // lost contacts (dropped from the sensor) coast on dead reckoning while
      // they linger, then expire
      if (ac.lostAt && now - ac.lostAt > lingerMs) {
        expired.push(ac);
        continue;
      }
      // dead reckoning: glide the blip along its track between integration updates
      if (smooth && ac.baseTime != null) {
        const dt = Math.min((now - ac.baseTime) / 1000, 90); // stop extrapolating stale data
        const dKm = (ac.speedKts * 1.852 / 3600) * dt;
        const rad = toRad(ac.heading);
        const predLat = ac.baseLat + (dKm * Math.cos(rad)) / KM_PER_DEG_LAT;
        const predLon = ac.baseLon + (dKm * Math.sin(rad)) / (KM_PER_DEG_LAT * Math.cos(toRad(this._center.lat)));
        // low-pass toward the prediction so fresh updates ease in instead of jumping
        ac.dispLat += (predLat - ac.dispLat) * 0.08;
        ac.dispLon += (predLon - ac.dispLon) * 0.08;
        ac.marker.setLatLng([ac.dispLat, ac.dispLon]);
        const o = this._kmOffsets(ac.dispLat, ac.dispLon);
        ac.x = o.x;
        ac.y = o.y;
      }

      const b = (Math.atan2(ac.x, ac.y) * 180 / Math.PI + 360) % 360;
      const crossed = lastAngle < angle
        ? (b >= lastAngle && b < angle)
        : (b >= lastAngle || b < angle); // wrapped past 360
      if (crossed) ac.lastSweep = now;

      const age = now - ac.lastSweep;
      const brightness = Math.max(0.35, 1 - age / sweepMs);
      const isSelected = ac.id === this._selectedId;
      const fullBright = isSelected || ac.emergency;
      const lostDim = ac.lostAt ? 0.45 : 1;
      const el = ac.marker.getElement();
      if (el) {
        const color = ac.emergency ? this._colors.emergency
          : isSelected ? this._colors.selected
          : this._colors.accent;
        el.style.setProperty('--blip-color', color);
        el.classList.toggle('selected', isSelected);
        const inAlertRange = alertKm > 0 && Math.hypot(ac.x, ac.y) < alertKm;
        el.classList.toggle('alert', !ac.lostAt && (ac.emergency || inAlertRange));
        if (inAlertRange && !ac.wasInAlert && !ac.lostAt && this._initialSyncDone) {
          this._playPing('proximity');
        }
        ac.wasInAlert = inAlertRange;
        const shape = el.querySelector('.blip-shape');
        const label = el.querySelector('.blip-label');
        const bright = (fullBright ? 1 : brightness) * lostDim;
        if (shape) {
          shape.style.opacity = bright;
          shape.style.filter = `drop-shadow(0 0 ${2 + bright * 4}px ${color})`;
        }
        if (label) label.style.opacity = (fullBright ? 1 : Math.max(0.5, brightness)) * lostDim;
        if (isSelected) {
          const tagText = `${this._fmtAlt(ac.alt)}${ac.trend} ${this._fmtSpd(ac.speedKts)}${this._spdUnitLabel()}`;
          if (ac._tag !== tagText) {
            ac._tag = tagText;
            const t1 = el.querySelector('.blip-tag .t1');
            const t2 = el.querySelector('.blip-tag .t2');
            if (t1) t1.textContent = ac.callsign;
            if (t2) t2.textContent = tagText;
          }
        }
      }
      if (ac.poly) ac.poly.setStyle({ opacity: (isSelected ? 0.6 : 0.25) * lostDim });
    }
    this._lastSweepAngle = angle;

    if (expired.length) {
      for (const ac of expired) {
        ac.marker.remove();
        if (ac.poly) ac.poly.remove();
        if (ac.dots) ac.dots.forEach((d) => d.remove());
        this._aircraft.delete(ac.id);
        if (this._selectedId === ac.id) this._selectedId = null;
      }
      this._renderContacts();
    }
  }
}

customElements.define('flightradar-radar-card', FlightradarRadarCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'flightradar-radar-card',
  name: 'Flightradar Radar Card',
  description: 'Round radar scope showing live flights from the FlightRadar24 integration.',
  preview: false,
});

console.info(
  `%c FLIGHTRADAR-RADAR-CARD %c v${CARD_VERSION} `,
  'background:#04070a;color:#4dff9e;font-weight:700;',
  'background:#4dff9e;color:#04070a;font-weight:700;'
);
