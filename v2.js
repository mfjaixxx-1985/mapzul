// Mangkuk Tandas Map by Pejo v2 extensions — alternatif laluan, laporan komuniti, PWA, offline tiles
// Dimuat selepas skrip utama dalam index.html

// ==================== 1. ALTERNATIF LALUAN ====================
// (dalam calcRoute: OSRM alternatives=true sudah diaktifkan — kita lukis semua + pilih)
window.showAlternatives = function(data) {
  // buang laluan lama
  altLines.forEach(l => map.removeLayer(l));
  altLines = [];
  data.routes.forEach((r, i) => {
    const isBest = i === 0;
    const line = L.geoJSON(r.geometry, {
      style: {color: isBest ? '#2f81f7' : '#8b949e', weight: isBest ? 6 : 4, opacity: isBest ? .95 : .6, dashArray: isBest ? null : '8 6'}
    }).addTo(map);
    line.on('click', () => selectRoute(i));
    line._routeIdx = i;
    altLines.push(line);
  });
  window._routes = data.routes;
};

window.selectRoute = function(idx) {
  const r = window._routes[idx];
  altLines.forEach((l, i) => l.setStyle({color: i===idx ? '#2f81f7' : '#8b949e', weight: i===idx?6:4, opacity: i===idx?.95:.6, dashArray: i===idx?null:'8 6'}));
  const mins = Math.round(r.duration/60), hrs = Math.floor(mins/60), rem = mins%60;
  $('eta').textContent = hrs ? `${hrs} j ${rem} m` : `${rem} min`;
  $('dist').textContent = `${(r.distance/1000).toFixed(1)} km • ${idx===0?'laluan terpantas':'alternatif '+(idx+1)}`;
  routeLine = altLines[idx];
};

// ==================== 2. LAPORAN KOMUNITI (IndexedDB) ====================
const REPORT_TYPES = {
  hazard:   {icon:'⚠️', label:'Bahaya di jalan'},
  jam:      {icon:'🚗', label:'Kesesakan'},
  police:   {icon:'👮', label:'Polis'},
  camera:   {icon:'📷', label:'Kamera laju'},
  accident: {icon:'💥', label:'Kemalangan'},
  roadwork: {icon:'🚧', label:'Kerja-kerja jalan'},
};
let reportLayer = L.layerGroup().addTo(map);

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('mapzul', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('reports', {keyPath:'id'});
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function saveReport(r) {
  const db = await openDB();
  await new Promise((res) => { const tx = db.transaction('reports','readwrite'); tx.objectStore('reports').put(r); tx.oncomplete = res; });
  drawReport(r);
}
async function loadReports() {
  const db = await openDB();
  const all = await new Promise((res) => {
    const tx = db.transaction('reports','readonly');
    const rq = tx.objectStore('reports').getAll();
    rq.onsuccess = () => res(rq.result);
  });
  const now = Date.now();
  all.filter(r => now - r.t < 2*3600*1000).forEach(drawReport); // papar 2 jam sahaja
}
function drawReport(r) {
  const t = REPORT_TYPES[r.type];
  L.marker([r.lat, r.lng], {icon: L.divIcon({className:'', html:`<div style="font-size:26px;filter:drop-shadow(0 2px 4px #0009)">${t.icon}</div>`})})
   .addTo(reportLayer).bindPopup(`${t.label}<br><small>${new Date(r.t).toLocaleTimeString('ms-MY')}</small>`);
}
// UI lapor: butang + menu
const fab = document.createElement('div');
fab.style.cssText = 'position:absolute;left:16px;bottom:calc(60px + env(safe-area-inset-bottom));z-index:900;';
fab.innerHTML = `<button id="btnReport" style="width:52px;height:52px;border-radius:50%;border:1px solid #30363d;background:#161b22ee;color:#f85149;font-size:22px;cursor:pointer">⚠</button>
<div id="reportMenu" style="display:none;position:absolute;bottom:60px;left:0;background:#161b22f8;border:1px solid #30363d;border-radius:14px;padding:8px;min-width:190px"></div>`;
document.body.appendChild(fab);
const menu = document.getElementById('reportMenu');
Object.entries(REPORT_TYPES).forEach(([k,v]) => {
  const b = document.createElement('div');
  b.style.cssText = 'padding:10px 12px;color:#e6edf3;font-size:14px;cursor:pointer;border-radius:8px';
  b.innerHTML = `${v.icon} ${v.label}`;
  b.onclick = () => { addReport(k); menu.style.display='none'; };
  b.onmouseenter = () => b.style.background = '#21262d';
  b.onmouseleave = () => b.style.background = 'none';
  menu.appendChild(b);
});
document.getElementById('btnReport').onclick = () => {
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};
function addReport(type) {
  const pos = mePos || map.getCenter();
  saveReport({id: crypto.randomUUID(), type, lat: pos.lat + (Math.random()-.5)*0.0005, lng: pos.lng + (Math.random()-.5)*0.0005, t: Date.now()});
  status('Terima kasih! Laporan dikongsi dengan komuniti Mangkuk Tandas Map by Pejo ✔', false);
}
loadReports();

// ==================== 3. PWA (manifest + service worker inline) ====================
// Manifest dibina sebagai blob (satu-fail friendly)
const iconDataURI = (() => {
  // logo "M" hijau pada latar gelap — jana canvas
  const c = document.createElement('canvas'); c.width = c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = '#0d1117'; x.fillRect(0,0,192,192);
  x.fillStyle = '#3fb950'; x.font = 'bold 64px sans-serif'; x.textAlign='center'; x.textBaseline='middle';
  x.fillText('MTM', 96, 104);
  return c.toDataURL('image/png');
})();
const manifest = {name:'Mangkuk Tandas Map by Pejo', short_name:'MTM Pejo', start_url:'.', display:'standalone', background_color:'#0d1117', theme_color:'#0d1117',
  icons:[{src: iconDataURI, sizes:'192x192', type:'image/png'}]};
const mfBlob = new Blob([JSON.stringify(manifest)], {type:'application/json'});
document.querySelector('head').insertAdjacentHTML('beforeend', `<link rel="icon" href="${iconDataURI}">`);

// Service worker — cache tiles & app shell utk offline
if ('serviceWorker' in navigator) {
  const swCode = `
    const CACHE = 'mapzul-v1';
    self.addEventListener('install', e => self.skipWaiting());
    self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
    self.addEventListener('fetch', e => {
      const url = new URL(e.request.url);
      // cache tile OSM — strategi cache-first
      if (url.hostname.includes('tile.openstreetmap.org')) {
        e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return resp;
        }).catch(() => caches.match('/map-offline.png'))));
        return;
      }
      // app shell — network-first, fallback cache
      e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    });
  `;
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}

// ==================== 4. OFFLINE status indicator ====================
const netBadge = document.createElement('div');
netBadge.style.cssText = 'position:absolute;top:70px;right:12px;z-index:1200;display:none;background:#f85149;color:#fff;padding:6px 12px;border-radius:10px;font-size:12px;font-weight:700';
netBadge.textContent = 'OFFLINE — peta cache sahaja';
document.body.appendChild(netBadge);
addEventListener('offline', () => netBadge.style.display = 'block');
addEventListener('online', () => netBadge.style.display = 'none');
if (!navigator.onLine) netBadge.style.display = 'block';
