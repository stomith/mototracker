/* ─── Config ─────────────────────────────────────────────────────────────── */

const WORKER_URL  = 'https://mototracker-worker.stomith.workers.dev';
const TILE_URL    = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR   = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
const TRACK_COLOR = '#FF6B00';
const TRACK_WIDTH = 5;
const DB_NAME     = 'mototracker';
const DB_VERSION  = 1;
const STORE_NAME  = 'rides';

/* ─── State ──────────────────────────────────────────────────────────────── */

let db          = null;
let map         = null;   // single persistent Leaflet map
let activeRide  = null;   // { id, startTime, coordinates, polyline, watchId, timerInterval, wakeLock, paused, pausedMs, pauseStart }
let searchPin   = null;
let detailMap   = null;
let detailRideId = null;

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

/* ─── Formatting ─────────────────────────────────────────────────────────── */

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

function mpsToMph(mps)      { return mps * 2.23694; }
function metersToMiles(m)   { return m * 0.000621371; }

/* ─── Geo ────────────────────────────────────────────────────────────────── */

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
  const duration = ride._elapsedMs ?? (ride.endTime - ride.startTime);
  const distM    = totalDistance(coords);
  const speeds   = coords.map(c => c.speed ?? 0).filter(s => s >= 0);
  const topMph   = speeds.length ? mpsToMph(Math.max(...speeds)) : 0;
  const avgMph   = duration > 0 ? metersToMiles(distM) / (duration / 3600000) : 0;
  return { distance: metersToMiles(distM), duration, topSpeed: topMph, avgSpeed: avgMph };
}

/* ─── Map init ───────────────────────────────────────────────────────────── */

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([37.7749, -122.4194], 12);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);

  // Try to center on user's location immediately
  navigator.geolocation.getCurrentPosition(
    pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
    () => { /* stay on default */ },
    { enableHighAccuracy: false, timeout: 5000 }
  );
}

/* ─── UI state ───────────────────────────────────────────────────────────── */

function showHomeUI() {
  document.getElementById('overlay-home').hidden   = false;
  document.getElementById('overlay-active').hidden = true;
  document.getElementById('map-buttons').classList.remove('ride-active');
}

function showActiveUI() {
  document.getElementById('overlay-home').hidden   = true;
  document.getElementById('overlay-active').hidden = false;
  document.getElementById('map-buttons').classList.add('ride-active');
}

/* ─── Drawers ────────────────────────────────────────────────────────────── */

function openDrawer(id) {
  closeAllDrawers();
  document.getElementById(id).classList.add('open');
  document.getElementById(id).setAttribute('aria-hidden', 'false');
  const backdrop = document.getElementById('drawer-backdrop');
  backdrop.hidden = false;
  backdrop.onclick = closeAllDrawers;
}

function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => {
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
  });
  document.getElementById('drawer-backdrop').hidden = true;
}

/* ─── Past rides drawer ──────────────────────────────────────────────────── */

async function openPastRides() {
  const rides = await dbGetAll();
  const list  = document.getElementById('ride-list');
  const empty = document.getElementById('ride-list-empty');
  list.innerHTML = '';

  if (rides.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    rides.forEach(ride => {
      const li    = document.createElement('li');
      li.className = 'ride-item';
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      const stats = ride.stats ?? computeStats(ride);
      li.innerHTML = `
        <span class="ride-date">${fmtDate(ride.startTime)}</span>
        <span class="ride-meta">${stats.distance.toFixed(1)} mi · ${fmtElapsed(stats.duration)}</span>
      `;
      li.addEventListener('click', () => { closeAllDrawers(); openDetail(ride.id); });
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { closeAllDrawers(); openDetail(ride.id); } });
      list.appendChild(li);
    });
  }

  openDrawer('drawer-past-rides');
}

/* ─── Active ride ────────────────────────────────────────────────────────── */

function activeElapsed() {
  return (Date.now() - activeRide.startTime) - activeRide.pausedMs;
}

async function startRide() {
  if (activeRide) return;

  let wakeLock = null;
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* non-fatal */ }

  const polyline = L.polyline([], { color: TRACK_COLOR, weight: TRACK_WIDTH }).addTo(map);

  activeRide = {
    id:        Date.now(),
    startTime: Date.now(),
    coordinates: [],
    polyline,
    watchId:      null,
    timerInterval: null,
    wakeLock,
    paused:     false,
    pausedMs:   0,
    pauseStart: null,
  };

  activeRide.timerInterval = setInterval(() => {
    if (!activeRide.paused)
      document.getElementById('hud-elapsed').textContent = fmtElapsed(activeElapsed());
  }, 1000);

  activeRide.watchId = navigator.geolocation.watchPosition(
    onGpsUpdate,
    err => showToast(`GPS error: ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );

  showActiveUI();
}

function onGpsUpdate(pos) {
  if (!activeRide) return;

  const { latitude: lat, longitude: lng, speed, accuracy } = pos.coords;
  if (accuracy > 50 && activeRide.coordinates.length === 0) return;

  const point = { lat, lng, timestamp: pos.timestamp, speed: speed ?? 0 };
  activeRide.coordinates.push(point);

  document.getElementById('hud-speed').textContent    = Math.round(mpsToMph(speed ?? 0));
  document.getElementById('hud-distance').textContent = metersToMiles(totalDistance(activeRide.coordinates)).toFixed(1);

  map.setView([lat, lng]);
  activeRide.polyline.addLatLng([lat, lng]);

  dbPut({
    id: activeRide.id, startTime: activeRide.startTime,
    endTime: null, coordinates: activeRide.coordinates, stats: null,
  });
}

function pauseRide() {
  if (!activeRide || activeRide.paused) return;
  activeRide.paused     = true;
  activeRide.pauseStart = Date.now();
  navigator.geolocation.clearWatch(activeRide.watchId);
  activeRide.watchId = null;
  document.getElementById('hud-speed').textContent = '0';
  document.getElementById('btn-pause-ride').textContent = 'Resume';
  document.getElementById('btn-pause-ride').setAttribute('aria-label', 'Resume current ride');
}

function resumeRide() {
  if (!activeRide || !activeRide.paused) return;
  activeRide.pausedMs  += Date.now() - activeRide.pauseStart;
  activeRide.pauseStart = null;
  activeRide.paused     = false;
  activeRide.watchId    = navigator.geolocation.watchPosition(
    onGpsUpdate,
    err => showToast(`GPS error: ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
  document.getElementById('btn-pause-ride').textContent = 'Pause';
  document.getElementById('btn-pause-ride').setAttribute('aria-label', 'Pause current ride');
}

async function endRide() {
  if (!activeRide) return;

  navigator.geolocation.clearWatch(activeRide.watchId);
  clearInterval(activeRide.timerInterval);
  try { await activeRide.wakeLock?.release(); } catch { /* non-fatal */ }

  const endTime     = Date.now();
  const rideElapsed = activeElapsed();
  const ride = {
    id: activeRide.id, startTime: activeRide.startTime,
    endTime, coordinates: activeRide.coordinates, stats: null,
  };
  ride.stats = computeStats({ ...ride, _elapsedMs: rideElapsed });
  await dbPut(ride);

  const savedId = activeRide.id;

  // Reset HUD
  document.getElementById('hud-speed').textContent    = '0';
  document.getElementById('hud-elapsed').textContent  = '00:00';
  document.getElementById('hud-distance').textContent = '0.0';
  document.getElementById('btn-pause-ride').textContent = 'Pause';
  document.getElementById('btn-pause-ride').setAttribute('aria-label', 'Pause current ride');

  // Clean up search pin and ride polyline from main map
  if (searchPin) { searchPin.remove(); searchPin = null; }
  activeRide.polyline.remove();
  activeRide = null;

  closeSearchDrawer();
  showHomeUI();
  openDetail(savedId);
}

/* ─── Ride detail ────────────────────────────────────────────────────────── */

async function openDetail(id) {
  const ride = await dbGet(id);
  if (!ride) { showToast('Ride not found.'); return; }

  detailRideId = id;
  document.getElementById('screen-detail').hidden = false;

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

  detailMap = L.map('map-detail', { zoomControl: false, attributionControl: true }).setView(center, 13);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(detailMap);
  setTimeout(() => detailMap.invalidateSize(), 50);

  if (hasTrack) {
    const latlngs = coords.map(c => [c.lat, c.lng]);
    L.polyline(latlngs, { color: TRACK_COLOR, weight: TRACK_WIDTH }).addTo(detailMap);
    detailMap.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });
    L.circleMarker(latlngs[0],                    { radius: 8, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }).addTo(detailMap);
    L.circleMarker(latlngs[latlngs.length - 1],   { radius: 8, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).addTo(detailMap);
  }
}

function closeDetail() {
  document.getElementById('screen-detail').hidden = true;
  if (detailMap) { detailMap.remove(); detailMap = null; }
  detailRideId = null;
}

async function deleteRide() {
  if (detailRideId == null) return;
  await dbDelete(detailRideId);
  closeDetail();
}

/* ─── Search ─────────────────────────────────────────────────────────────── */

function openSearchDrawer() {
  openDrawer('search-drawer');
  setTimeout(() => document.getElementById('search-input').focus(), 300);
}

function closeSearchDrawer() {
  closeAllDrawers();
  document.getElementById('search-input').blur();
}

async function runSearch() {
  const query   = document.getElementById('search-input').value.trim();
  const results = document.getElementById('search-results');
  const empty   = document.getElementById('search-empty');

  if (!query) return;

  results.innerHTML    = '';
  empty.textContent    = 'Searching…';
  empty.hidden         = false;

  const last = activeRide?.coordinates[activeRide.coordinates.length - 1];
  const ll   = last ? `${last.lat},${last.lng}` : '';

  let data;
  try {
    const url = new URL(`${WORKER_URL}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '8');
    if (ll) url.searchParams.set('ll', ll);
    const res = await fetch(url.toString());
    data = await res.json();
  } catch {
    empty.textContent = 'Search failed. Check connection.';
    return;
  }

  const places = data.results ?? [];
  if (places.length === 0) { empty.textContent = 'No results found.'; return; }
  empty.hidden = true;

  places.forEach(place => {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    const address = place.location?.formatted_address ?? '';
    const dist    = place.distance ? `${(place.distance * 0.000621371).toFixed(1)} mi away` : '';
    li.innerHTML = `
      <span class="search-result-name">${place.name}</span>
      <span class="search-result-meta">${[address, dist].filter(Boolean).join(' · ')}</span>
    `;
    const select = () => selectSearchResult(place);
    li.addEventListener('click', select);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') select(); });
    results.appendChild(li);
  });
}

function selectSearchResult(place) {
  const { latitude: lat, longitude: lng } = place;
  if (!lat || !lng) return;

  if (searchPin) { searchPin.remove(); searchPin = null; }

  searchPin = L.marker([lat, lng], {
    icon: L.divIcon({
      className:  '',
      html:       `<div class="search-pin"></div>`,
      iconSize:   [20, 20],
      iconAnchor: [10, 10],
    })
  }).addTo(map);

  searchPin.bindPopup(`<strong>${place.name}</strong><br>${place.location?.formatted_address ?? ''}`).openPopup();
  map.setView([lat, lng], 15);
  closeAllDrawers();
}

/* ─── Event listeners ────────────────────────────────────────────────────── */

document.getElementById('btn-start-ride').addEventListener('click', startRide);
document.getElementById('btn-end-ride').addEventListener('click',   endRide);
document.getElementById('btn-pause-ride').addEventListener('click', () => {
  if (activeRide?.paused) resumeRide(); else pauseRide();
});

document.getElementById('btn-open-past-rides').addEventListener('click', openPastRides);
document.getElementById('btn-close-past-rides').addEventListener('click', closeAllDrawers);

document.getElementById('btn-open-search').addEventListener('click', openSearchDrawer);
document.getElementById('btn-search-open').addEventListener('click', openSearchDrawer);
document.getElementById('btn-search-close').addEventListener('click', closeAllDrawers);
document.getElementById('btn-search-submit').addEventListener('click', runSearch);
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') runSearch();
});

document.getElementById('btn-recenter').addEventListener('click', () => {
  if (activeRide?.coordinates.length) {
    const last = activeRide.coordinates[activeRide.coordinates.length - 1];
    map.setView([last.lat, last.lng]);
  } else {
    navigator.geolocation.getCurrentPosition(
      pos => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => showToast('Location unavailable'),
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }
});

document.getElementById('btn-back').addEventListener('click', closeDetail);
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
  initMap();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* non-fatal */ });
  }
})();
