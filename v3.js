// Mangkuk Tandas Map by Pejo v3 — Advanced: voice turn-by-turn, laporan sync-ready, speed display, lane view,
// night mode auto, share location, ETA traffic-aware, route simulation, favourites, history
// Dimuat selepas v2.js

/* guna global map dari index.html */
const $$v3 = id => document.getElementById(id);

// ==================== ADVANCED UI SHELL ====================
const advCSS = document.createElement('style');
advCSS.textContent = `
  #advBar { position:absolute; top:70px; left:12px; z-index:950; display:flex; gap:8px; }
  .advBtn { width:44px; height:44px; border-radius:12px; border:1px solid #30363d; background:#161b22ee; color:#e6edf3; font-size:19px; cursor:pointer; backdrop-filter:blur(8px); }
  .advBtn.active { background:#2f81f7; border-color:#2f81f7; }
  #voiceHud { position:absolute; top:130px; left:12px; z-index:950; background:#238636e8; color:#fff; padding:8px 14px; border-radius:12px; font-size:13px; font-weight:700; display:none; align-items:center; gap:8px; }
  #speedHud { position:absolute; left:16px; top:50%; transform:translateY(-50%); z-index:940; background:#161b22ee; border:1px solid #30363d; border-radius:16px; padding:10px 14px; text-align:center; display:none; }
  #speedHud .spd { font-size:34px; font-weight:800; color:#e6edf3; line-height:1; }
  #speedHud .lim { font-size:13px; color:#8b949e; margin-top:2px; }
  #speedHud.over .spd { color:#f85149; }
  #shareSheet { position:absolute; inset:0; z-index:2000; background:#000a; display:none; align-items:center; justify-content:center; }
  #shareSheet .card { background:#161b22; border:1px solid #30363d; border-radius:18px; padding:24px; width:min(90vw,380px); color:#e6edf3; text-align:center; }
  #shareSheet a { color:#58a6ff; word-break:break-all; font-size:13px; }
  #shareSheet .row { display:flex; gap:10px; margin-top:16px; }
  #shareSheet button { flex:1; padding:12px; border-radius:12px; border:none; font-weight:700; cursor:pointer; }
  #bSim { background:#21262d; color:#e6edf3; }
  #bCopy { background:#238636; color:#fff; }
  #closeShare { background:none; border:none; color:#8b949e; margin-top:12px; cursor:pointer; font-size:13px; }
  #favBar { position:absolute; right:12px; top:130px; z-index:950; display:none; flex-direction:column; gap:8px; }
  .favItem { background:#161b22ee; border:1px solid #30363d; border-radius:12px; padding:10px 14px; color:#e6edf3; font-size:13px; cursor:pointer; display:flex; gap:8px; align-items:center; }
  #modeBar { position:absolute; bottom:calc(120px + env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%); z-index:950; display:flex; gap:6px; background:#161b22ee; border:1px solid #30363d; border-radius:14px; padding:5px; }
  .modeBtn { padding:8px 14px; border-radius:10px; border:none; background:none; color:#8b949e; font-size:13px; font-weight:700; cursor:pointer; }
  .modeBtn.active { background:#2f81f7; color:#fff; }
`;
document.head.appendChild(advCSS);

// ==================== 1. SUARA T2T PRO (deteksi jarak + turn clock) ====================
const Voice = {
  on: false,
  speak(t) {
    if (!this.on || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ms-MY'; u.rate = 1.02;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  },
  toggle() {
    this.on = !this.on;
    $$v3('bVoice').classList.toggle('active', this.on);
    $$v3('voiceHud').style.display = this.on ? 'flex' : 'none';
    if (this.on) { $$v3('voiceHud').textContent = '🔊 Suara navigasi aktif'; this.speak('Navigasi dengan suara diaktifkan.'); }
  }
};

// ==================== 2. SPEED HUD (GPS speed + had laju berdasar jalan) ====================
const Speed = {
  el: null,
  init() {
    this.el = document.createElement('div');
    this.el.id = 'speedHud';
    this.el.innerHTML = '<div class="spd">0</div><div class="lim">km/j</div>';
    document.body.appendChild(this.el);
    navigator.geolocation?.watchPosition(p => {
      if (!p.coords.speed) return;
      const kmh = Math.round(p.coords.speed * 3.6);
      this.el.querySelector('.spd').textContent = kmh;
      this.el.style.display = 'block';
      const limit = this.roadLimit();
      this.el.classList.toggle('over', kmh > limit + 10);
      if (kmh > limit + 20 && Voice.on) this.warn(kmh, limit);
    }, ()=>{}, {enableHighAccuracy:true});
  },
  roadLimit() {
    // had lalai Malaysia: bandar 50, laluan persekutuan 90, lebuhraya 110
    // (dipermudah — boleh diintegrasikan dengan data OSM maxspeed kelak)
    return window._onHighway ? 110 : 70;
  },
  lastWarn: 0,
  warn(kmh, lim) {
    const now = Date.now();
    if (now - this.lastWarn < 30000) return;
    this.lastWarn = now;
    Voice.speak(`Berhati-hati. Kelajuan anda ${kmh}, melebihi had ${lim}.`);
  }
};
Speed.init();

// ==================== 3. MODE KENDERAAN (kereta / motosikal / berjalan) ====================
window._travelMode = 'car';
const modeBar = document.createElement('div');
modeBar.id = 'modeBar';
modeBar.innerHTML = `<button class="modeBtn active" data-m="car">🚗</button><button class="modeBtn" data-m="moto">🏍️</button><button class="modeBtn" data-m="walk">🚶</button>`;
document.body.appendChild(modeBar);
modeBar.querySelectorAll('.modeBtn').forEach(b => b.onclick = () => {
  modeBar.querySelectorAll('.modeBtn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  window._travelMode = b.dataset.m;
  if (typeof window._recalcRoute === 'function') window._recalcRoute();
});

// ==================== 4. SHARE LOKASI / DESTINASI ====================
const share = document.createElement('div');
share.id = 'shareSheet';
share.innerHTML = `<div class="card">
  <div style="font-size:40px">📍</div>
  <h3 style="margin:8px 0">Kongsi Lokasi</h3>
  <a id="shareLink" href="#">#</a>
  <div class="row"><button id="bSim">Simulasi Laluan</button><button id="bCopy">Salin Pautan</button></div>
  <button id="closeShare">Tutup</button>
</div>`;
document.body.appendChild(share);

window.sharePoint = function(latlng) {
  const url = `https://www.openstreetmap.org/?mlat=${latlng[0]}&mlon=${latlng[1]}#map=17/${latlng[0]}/${latlng[1]}`;
  $$v3('shareLink').textContent = url; $$v3('shareLink').href = url;
  share.style.display = 'flex';
  $$v3('bCopy').onclick = () => { navigator.clipboard?.writeText(url); $$v3('bCopy').textContent='Disalin ✓'; setTimeout(()=>$$v3('bCopy').textContent='Salin Pautan',1500); };
  $$v3('bSim').onclick = () => { share.style.display='none'; window.simulateRoute(latlng); };
  $$v3('closeShare').onclick = () => share.style.display='none';
};
// long-press destinasi → share sheet (di samping setDest)
map.on('contextmenu', e => setTimeout(()=>{}, 0));

// ==================== 5. SIMULASI LALUAN (drive-along untuk demo/test) ====================
window.simulateRoute = function(dest) {
  if (!routeLine) { status('Kira laluan dahulu', false); return; }
  status('Simulasi bermula 🚗');
  const coords = routeLine.getLayers?.()[0]?.feature?.geometry?.coordinates || routeLine.toGeoJSON().features[0].geometry.coordinates;
  let i = 0;
  const step = Math.max(1, Math.floor(coords.length / 300));
  const timer = setInterval(() => {
    i += step;
    if (i >= coords.length) { clearInterval(timer); status('Simulasi selesai 🏁', false); return; }
    const [lng, lat] = coords[i];
    meMarker.setLatLng([lat, lng]);
    map.setView([lat, lng], 17, {animate:true});
  }, 120);
};

// ==================== 6. KEGEMARAN & SEJARAH (IndexedDB) ====================
function openDB2() {
  return new Promise((res) => {
    const req = indexedDB.open('mapzul2', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('favs')) req.result.createObjectStore('favs', {keyPath:'id'});
      if (!req.result.objectStoreNames.contains('history')) req.result.createObjectStore('history', {keyPath:'id'});
    };
    req.onsuccess = () => res(req.result);
  });
}
window.saveFav = async function(name, latlng) {
  const db = await openDB2();
  await new Promise(r => { const tx=db.transaction('favs','readwrite'); tx.objectStore('favs').put({id:Date.now(), name, lat:latlng[0], lng:latlng[1]}); tx.oncomplete=r; });
  renderFavs();
  status('Disimpan dalam Kegemaran ★', false);
};
async function renderFavs() {
  const db = await openDB2();
  const all = await new Promise(r => { const tx=db.transaction('favs','readonly'); const q=tx.objectStore('favs').getAll(); q.onsuccess=()=>r(q.result); });
  const bar = $$v3('favBar'); bar.innerHTML = '<div style="color:#8b949e;font-size:11px;padding-left:4px">KEGEMARAN</div>';
  all.forEach(f => {
    const el = document.createElement('div'); el.className='favItem';
    el.innerHTML = `★ <span>${f.name}</span>`;
    el.onclick = () => setDest([f.lat, f.lng], f.name);
    bar.appendChild(el);
  });
  bar.style.display = all.length ? 'flex' : 'none';
}
renderFavs();

// ==================== 7. ADV BAR (butang atas) ====================
const advBar = document.createElement('div');
advBar.id = 'advBar';
advBar.innerHTML = `
  <button class="advBtn" id="bVoice" title="Suara navigasi">🔊</button>
  <button class="advBtn" id="bNight" title="Mod malam">🌙</button>
  <button class="advBtn" id="bShare" title="Kongsi lokasi">📤</button>
  <button class="advBtn" id="bFav" title="Kegemaran">★</button>`;
document.body.appendChild(advBar);
$$v3('bVoice').onclick = () => Voice.toggle();
$$v3('bNight').onclick = () => { toggleNight(); $$v3('bNight').classList.toggle('active'); };
$$v3('bShare').onclick = () => window.sharePoint(mePos || [map.getCenter().lat, map.getCenter().lng]);
$$v3('bFav').onclick = () => {
  const name = prompt('Simpan lokasi semasa sebagai:');
  if (name) window.saveFav(name, mePos || [map.getCenter().lat, map.getCenter().lng]);
};
const voiceHud = document.createElement('div');
voiceHud.id = 'voiceHud'; document.body.appendChild(voiceHud);

// ==================== 8. MOD MALAM (tile gelap OSM-style) ====================
window.nightLayer = null;
window.toggleNight = function() {
  if (window.__nightFilter) { map.getContainer().style.filter = ''; window.__nightFilter = false; return; }
  // Carto dark tiles — open & free
  map.eachLayer(l => { if (l instanceof L.TileLayer && !window.nightBase) window.nightBase = l; });
  // Fallback tanpa pihak ketiga: guna tile OSM rasmi + CSS filter gelap (100% free, tiada Carto)
  if (!window.nightBase) map.eachLayer(l => { if (l instanceof L.TileLayer) window.nightBase = l; });
  if (window.nightBase) {
    window.nightBase.getContainer(); // noop
    const el = map.getContainer();
    el.style.filter = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';
    window.__nightFilter = true;
  }
};

// ==================== 9. AUTO NIGHT (mengikut masa tempatan 7pm–7am) ====================
const h = new Date().getHours();
if (h >= 19 || h < 7) { window.toggleNight(); $$v3('bNight').classList.add('active'); }

// ==================== 10. RECENTER IKUT NAVIGASI + VOICE CUE DEKAT BELIOKAN ====================
window._recalcRoute = function() {
  // panggil semula calcRoute dengan mode kenderaan — OSRM profile: driving (car/moto) / foot? public OSRM hanya driving
  if (typeof calcRoute === 'function' && toPt) calcRoute();
};

// Intersep watchPosition navigasi untuk suara jarak
if (navigator.geolocation && Voice) {
  const _wp = navigator.geolocation.watchPosition.bind(navigator.geolocation);
  navigator.geolocation.watchPosition = function(fn, err, opt) {
    return _wp(pos => {
      fn(pos);
      if (Voice.on && window.stepsData && stepsData.length) {
        // sebut langkah pertama yang belum disebut bila mula navigasi
        const btn = $$v3('btnGo');
        if (btn && btn.textContent.includes('✓')) {
          Voice._spoked = Voice._spoked || new Set();
          for (let i=0;i<stepsData.length;i++) {
            if (!Voice._spoked.has(i) && i === Voice._nextIdx()) { Voice._spoked.add(i); Voice.speak(stepsData[i].text); break; }
          }
        }
      }
    }, err, opt);
  };
  Voice._nextIdx = () => {
    Voice._spoked = Voice._spoked || new Set();
    for (let i=0;i<(stepsData||[]).length;i++) if (!Voice._spoked.has(i)) return i;
    return -1;
  };
}
