/* ─── Config ─────────────────────────────────────────────────────────────── */

const TILE_URL    = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR   = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
const TRACK_COLOR = '#FF6B00';
const TRACK_WIDTH = 5;
const DB_NAME     = 'mototracker';
const DB_VERSION  = 1;
const STORE_NAME  = 'rides';

/* ─── State ──────────────────────────────────────────────────────────────── */

let db           = null;
let activeRide   = null;  // { id, startTime, coordinates, map, polyline, watchId, timerInterval, wakeLock }
let detailRideId = null;
let detailMap    = null;

/* ─── IndexedDB ──────────────────────────────────────────────────────────── */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const store = e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('startTime', 'startTime');
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbPut(ride) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(ride);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

function dbGet(id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).index('startTime').getAll();
    req.onsuccess = e => resolve(e.target.result.reverse());
    req.onerror   = e => reject(e.target.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/* ─── Screen routing ─────────────────────────────────────────────────────── */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ─── Toast ──────────────────────────────────────────────────────────────── */

let toastTimer = null;
function showToast(msg, duration = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => { el.hidden = true; }, 300);
  }, duration);
}

/* ─── Utility: formatting ────────────────────────────────────────────────── */

function fmtElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function mpsToMph(mps) { return mps * 2.23694; }
function metersToMiles(m) { return m * 0.000621371; }

/* ─── Utility: geo ───────────────────────────────────────────────────────── */

function haversine(a, b) {
  const R  = 6371000;
  const φ1 = a.lat * Math.PI / 180;
  const φ2 = b.lat * Math.PI / 180;
  const Δφ = (b.lat - a.lat) * Math.PI / 180;
  const Δλ = (b.lng - a.lng) * Math.PI / 180;
  const x  = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function totalDistance(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i-1], coords[i]);
  return d;
}

function computeStats(ride) {
  const coords   = ride.coordinates;
  const duration = ride.endTime - ride.startTime;
  const distM    = totalDistance(coords);
  const speeds   = coords.map(c => c.speed ?? 0).filter(s => s >= 0);
  const topMph   = speeds.length ? mpsToMph(Math.max(...speeds)) : 0;
  const avgMph   = duration > 0 ? metersToMiles(distM) / (duration / 3600000) : 0;
  return { distance: metersToMiles(distM), duration, topSpeed: topMph, avgSpeed: avgMph };
}

/* ─── Leaflet helpers ────────────────────────────────────────────────────── */

function makeTileLayer() {
  return L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 });
}

function makeMap(containerId, center, zoom) {
  const map = L.map(containerId, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  makeTileLayer().addTo(map);
  // Invalidate size after the screen becomes visible so tiles render correctly
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}

/* ─── Home screen ────────────────────────────────────────────────────────── */

async function renderHome() {
  showScreen('screen-home');
  const rides = await dbGetAll();
  const list  = document.getElementById('ride-list');
  const empty = document.getElementById('ride-list-empty');
  list.innerHTML = '';

  if (rides.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  rides.forEach(ride => {
    const li = document.createElement('li');
    li.className = 'ride-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `Ride on ${fmtDate(ride.startTime)}`);
    const stats = ride.stats ?? computeStats(ride);
    li.innerHTML = `
      <span class="ride-date">${fmtDate(ride.startTime)}</span>
      <span class="ride-meta">${stats.distance.toFixed(1)} mi · ${fmtElapsed(stats.duration)}</span>
    `;
    li.addEventListener('click', () => openDetail(ride.id));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDetail(ride.id); });
    list.appendChild(li);
  });
}

/* ─── Active ride ────────────────────────────────────────────────────────── */

async function startRide() {
  if (activeRide) return;

  showScreen('screen-active');

  let wakeLock = null;
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* non-fatal */ }

  const map      = makeMap('map-active', [0, 0], 15);
  const polyline = L.polyline([], { color: TRACK_COLOR, weight: TRACK_WIDTH }).addTo(map);

  activeRide = {
    id: Date.now(),
    startTime: Date.now(),
    coordinates: [],
    map,
    polyline,
    watchId: null,
    timerInterval: null,
    wakeLock,
  };

  activeRide.timerInterval = setInterval(() => {
    document.getElementById('hud-elapsed').textContent = fmtElapsed(Date.now() - activeRide.startTime);
  }, 1000);

  activeRide.watchId = navigator.geolocation.watchPosition(
    onGpsUpdate,
    err => showToast(`GPS error: ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function onGpsUpdate(pos) {
  if (!activeRide) return;

  const { latitude: lat, longitude: lng, speed, accuracy } = pos.coords;

  if (accuracy > 50 && activeRide.coordinates.length === 0) return;

  const point = { lat, lng, timestamp: pos.timestamp, speed: speed ?? 0 };
  activeRide.coordinates.push(point);

  // HUD
  document.getElementById('hud-speed').textContent    = Math.round(mpsToMph(speed ?? 0));
  document.getElementById('hud-distance').textContent = metersToMiles(totalDistance(activeRide.coordinates)).toFixed(1);

  // Map
  activeRide.map.setView([lat, lng]);
  activeRide.polyline.addLatLng([lat, lng]);

  // Incremental persist
  dbPut({
    id: activeRide.id, startTime: activeRide.startTime,
    endTime: null, coordinates: activeRide.coordinates, stats: null,
  });
}

async function endRide() {
  if (!activeRide) return;

  navigator.geolocation.clearWatch(activeRide.watchId);
  clearInterval(activeRide.timerInterval);
  try { await activeRide.wakeLock?.release(); } catch { /* non-fatal */ }
  activeRide.map.remove();

  const endTime = Date.now();
  const ride = {
    id: activeRide.id, startTime: activeRide.startTime,
    endTime, coordinates: activeRide.coordinates, stats: null,
  };
  ride.stats = computeStats(ride);
  await dbPut(ride);

  const savedId = activeRide.id;
  activeRide = null;

  document.getElementById('hud-speed').textContent    = '0';
  document.getElementById('hud-elapsed').textContent  = '00:00';
  document.getElementById('hud-distance').textContent = '0.0';

  openDetail(savedId);
}

/* ─── Ride detail ────────────────────────────────────────────────────────── */

async function openDetail(id) {
  const ride = await dbGet(id);
  if (!ride) { showToast('Ride not found.'); renderHome(); return; }

  detailRideId = id;
  showScreen('screen-detail');

  document.getElementById('detail-title').textContent = fmtDate(ride.startTime);

  const stats = ride.stats ?? computeStats(ride);
  document.getElementById('stat-distance').textContent  = `${stats.distance.toFixed(2)} mi`;
  document.getElementById('stat-duration').textContent  = fmtElapsed(stats.duration);
  document.getElementById('stat-top-speed').textContent = `${Math.round(stats.topSpeed)} mph`;
  document.getElementById('stat-avg-speed').textContent = `${Math.round(stats.avgSpeed)} mph`;

  if (detailMap) { detailMap.remove(); detailMap = null; }

  const coords   = ride.coordinates;
  const hasTrack = coords.length >= 2;
  const center   = hasTrack
    ? [coords[Math.floor(coords.length / 2)].lat, coords[Math.floor(coords.length / 2)].lng]
    : [0, 0];

  detailMap = makeMap('map-detail', center, 13);

  if (hasTrack) {
    const latlngs = coords.map(c => [c.lat, c.lng]);
    L.polyline(latlngs, { color: TRACK_COLOR, weight: TRACK_WIDTH }).addTo(detailMap);

    // Fit to track
    detailMap.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });

    // Start / end markers
    L.circleMarker(latlngs[0], { radius: 8, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }).addTo(detailMap);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 8, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).addTo(detailMap);
  }
}

async function deleteRide() {
  if (detailRideId == null) return;
  await dbDelete(detailRideId);
  detailRideId = null;
  if (detailMap) { detailMap.remove(); detailMap = null; }
  renderHome();
}

/* ─── Event listeners ────────────────────────────────────────────────────── */

document.getElementById('btn-start-ride').addEventListener('click', startRide);
document.getElementById('btn-end-ride').addEventListener('click',   endRide);
document.getElementById('btn-recenter').addEventListener('click', () => {
  if (!activeRide || activeRide.coordinates.length === 0) return;
  const last = activeRide.coordinates[activeRide.coordinates.length - 1];
  activeRide.map.setView([last.lat, last.lng]);
});
document.getElementById('btn-back').addEventListener('click', () => {
  if (detailMap) { detailMap.remove(); detailMap = null; }
  renderHome();
});
document.getElementById('btn-delete-ride').addEventListener('click', async () => {
  if (confirm('Delete this ride? This cannot be undone.')) await deleteRide();
});

document.addEventListener('visibilitychange', async () => {
  if (!activeRide) return;
  if (document.visibilityState === 'visible' && activeRide.wakeLock?.released) {
    try { activeRide.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* non-fatal */ }
  }
});

/* ─── Boot ───────────────────────────────────────────────────────────────── */

(async () => {
  db = await openDB();
  await renderHome();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* non-fatal */ });
  }
})();
