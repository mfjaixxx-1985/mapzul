// MTM Pejo v6 — NAVIGASI AKTIF ala Waze: GPS live follow, auto-reroute bila lalu jalan lain
// Free: browser Geolocation (GPS fon) + OSRM reroute. Tiada API key.

const navCSS = document.createElement('style');
navCSS.textContent = `
  #navPanel { position:fixed; top:0; left:0; right:0; z-index:2000; background:#0d1117f2;
    padding:14px 16px; display:none; box-shadow:0 4px 20px rgba(0,0,0,.6); backdrop-filter:blur(8px); }
  #navInstr { color:#fff; font-size:22px; font-weight:700; line-height:1.25; }
  #navSub { color:#8b949e; font-size:13px; margin-top:4px; }
  #navDist { position:fixed; bottom:90px; left:50%; transform:translateX(-50%); z-index:2000;
    background:#0d1117f2; color:#fff; padding:10px 18px; border-radius:24px; font-size:15px;
    font-weight:600; display:none; box-shadow:0 4px 16px rgba(0,0,0,.5); backdrop-filter:blur(6px); }
  #navPanel .stopNav { position:absolute; right:12px; top:12px; background:#da3633; color:#fff;
    border:none; padding:6px 12px; border-radius:8px; font-weight:700; cursor:pointer; }
  .navFollowBtn { position:fixed !important; }
`;
document.head.appendChild(navCSS);

// Panel arahan atas
const navPanel = document.createElement('div');
navPanel.id = 'navPanel';
navPanel.innerHTML = `<div id="navInstr">—</div><div id="navSub"></div><button class="stopNav" id="stopNav">✕ Tamat</button>`;
document.body.appendChild(navPanel);

const navDist = document.createElement('div');
navDist.id = 'navDist';
document.body.appendChild(navDist);

// ==================== STATE ====================
window.__nav = {
  on: false,            // navigasi aktif?
  route: null,          // coordinates [[lat,lng],...]
  steps: [],            // langkah OSRM
  stepIdx: 0,
  lastFix: null,
  offRouteSince: null,
  rerouteCount: 0,
  watchId: null,
  voice: true,
  dest: null,           // [lat,lng]
  destName: ''
};

// ==================== BANTU GEO ====================
function distM(a, b) {  // haversine meter
  const R = 6371000, dLat = (b[0]-a[0])*Math.PI/180, dLon = (b[1]-a[1])*Math.PI/180;
  const la1 = a[0]*Math.PI/180, la2 = b[0]*Math.PI/180;
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function nearestOnRoute(pos) {
  // cari segmen route terdekat + jarak
  const r = window.__nav.route;
  let best = {d: Infinity, idx: 0, proj: null};
  for (let i = 0; i < r.length-1; i++) {
    const d = distToSegment(pos, r[i], r[i+1]);
    if (d < best.d) { best = {d, idx: i}; }
  }
  return best;
}

function distToSegment(p, a, b) {
  // jarak point ke segmen (meter, approximate planar)
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
  const dot = A*C + B*D, len2 = C*C + D*D;
  let t = len2 ? dot/len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t*C, py = y1 + t*D;
  return distM(p, [px, py]);
}

// ==================== MULA NAVIGASI ====================
window.startNav = function(dest, name) {
  const n = window.__nav;
  n.dest = dest; n.destName = name || 'Destinasi'; n.rerouteCount = 0;
  const myPos = (typeof mePos !== 'undefined' && mePos) ? mePos : window.__mockPos;
  if (!myPos) { status('📍 Tunggu GPS dulu — keluar tingkap atau izinkan lokasi'); return; }
  status('🧭 Mengira laluan...');
  fetchOSRM([myPos, dest], route => {
    n.route = route.coords;
    n.steps = route.steps;
    n.stepIdx = 0;
    n.on = true;
    drawRoute(route.coords);
    navPanel.style.display = 'block';
    navDist.style.display = 'block';
    speakNav('Navigasi bermula ke ' + n.destName);
    beginWatch();
    status('🧭 Navigasi aktif — ikut laluan biru');
  });
};

function fetchOSRM(points, cb) {
  const pts = points.map(p => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(';');
  const url = 'https://router.project-osrm.org/route/v1/driving/' + pts + '?overview=full&geometries=geojson&steps=true';
  fetch(url).then(r => r.json()).then(j => {
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) { status('❌ Laluan tidak dijumpai'); return; }
    const rt = j.routes[0];
    const coords = rt.geometry.coordinates.map(c => [c[1], c[0]]);
    const steps = [];
    rt.legs.forEach(leg => leg.steps.forEach(s => {
      steps.push({loc: [s.maneuver.location[1], s.maneuver.location[0]],
        type: s.maneuver.type, modifier: s.maneuver.modifier || '',
        name: s.name || '', dist: s.distance});
    }));
    cb({coords, steps, dist: rt.distance, dur: rt.duration});
  }).catch(() => status('❌ Gagal hubungi OSRM'));
}

function drawRoute(coords) {
  if (window.__navLine) map.removeLayer(window.__navLine);
  window.__navLine = L.polyline(coords, {color: '#1f6feb', weight: 7, opacity: 0.9}).addTo(map);
  if (window.__navLineCase) map.removeLayer(window.__navLineCase);
  window.__navLineCase = L.polyline(coords, {color: '#0d1117', weight: 11, opacity: 0.5}).addTo(map);
}

// ==================== GPS WATCH ====================
function beginWatch() {
  const n = window.__nav;
  if (n.watchId) navigator.geolocation.clearWatch(n.watchId);
  n.watchId = navigator.geolocation.watchPosition(onFix, err => {
    status('⚠ GPS gagal: ' + err.message);
  }, {enableHighAccuracy: true, maximumAge: 2000, timeout: 15000});
}

function onFix(p) {
  const n = window.__nav;
  const pos = [p.coords.latitude, p.coords.longitude];
  n.lastFix = pos;
  if (!n.on) return;

  // marker kenderaan (panah mengikut arah)
  const heading = p.coords.heading !== null && !isNaN(p.coords.heading) ? p.coords.heading : lastHeading(pos);
  if (window.__carMarker) map.removeLayer(window.__carMarker);
  window.__carMarker = L.marker(pos, {
    icon: L.divIcon({className: '', html: '<div style="transform:rotate(' + (heading||0) + 'deg);font-size:30px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">🔺</div>', iconSize: [30,30], iconAnchor: [15,15]})
  }).addTo(map);

  // kamera ikut kenderaan (rotate tak perlu — cukup pan & zoom)
  map.setView(pos, Math.max(map.getZoom(), 17), {animate: true, duration: 0.5});

  // jarak ke route — deteksi lalu jalan lain
  const near = nearestOnRoute(pos);
  const OFF_M = 35;   // >35m dari laluan = lalu tempat lain
  if (near.d > OFF_M) {
    if (!n.offRouteSince) n.offRouteSince = Date.now();
    // reroute selepas 6 saat konsisten off-route (elak GPS jitter)
    if (Date.now() - n.offRouteSince > 6000) {
      n.offRouteSince = null;
      reroute(pos);
    } else {
      status('⚠ Lalu jalan lain — mengira semula...');
    }
  } else {
    n.offRouteSince = null;
  }

  // kemas kini langkah arahan
  updateStep(pos, p.coords.speed);

  // ETA & jarak tinggal
  const remainM = remainingDist(pos, near.idx);
  const mins = Math.round(remainM / 500 * 60) / 10;  // ~30km/j purata bandar
  navDist.textContent = Math.round(remainM/1000*10)/10 + ' km • ' + Math.max(1, Math.round(mins)) + ' min • ' + n.destName;
}

function lastHeading(pos) {
  const n = window.__nav;
  if (n.prevFix) {
    const dLat = pos[0]-n.prevFix[0], dLon = pos[1]-n.prevFix[1];
    if (dLat || dLon) { n.prevHeading = Math.atan2(dLon, dLat)*180/Math.PI; }
  }
  n.prevFix = pos;
  return n.prevHeading || 0;
}

function reroute(pos) {
  const n = window.__nav;
  n.rerouteCount++;
  status('🔄 Reroute #' + n.rerouteCount + ' — laluan baru dikira');
  speakNav('Mengira laluan baru');
  fetchOSRM([pos, n.dest], route => {
    n.route = route.coords; n.steps = route.steps; n.stepIdx = 0;
    drawRoute(route.coords);
    status('✅ Laluan baru sedia');
    speakNav('Laluan baru sedia');
  });
}

function updateStep(pos, speed) {
  const n = window.__nav;
  // maju stepIdx bila dah lepas maneuver
  while (n.stepIdx < n.steps.length-1 && distM(pos, n.steps[n.stepIdx].loc) < 25) {
    n.stepIdx++;
    const s = n.steps[n.stepIdx];
    if (s && n.voice) speakNav(instrText(s));
  }
  const s = n.steps[n.stepIdx];
  if (!s) return;
  const d = distM(pos, s.loc);
  document.getElementById('navInstr').textContent = instrText(s);
  document.getElementById('navSub').textContent = (d > 30 ? 'dalam ' + Math.round(d) + ' m — ' : '') + (speed ? (speed*3.6).toFixed(0) + ' km/j' : 'ikut GPS');
}

function instrText(s) {
  const m = {left:'Beliok kiri', right:'Beliok kanan', 'slight left':'Sedikit kiri', 'slight right':'Sedikit kanan',
    'sharp left':'Tajam kiri', 'sharp right':'Tajam kanan', straight:'Terus', uturn:'Pusing balik'};
  if (s.type === 'depart') return 'Mula perjalanan' + (s.name ? ' ke ' + s.name : '');
  if (s.type === 'arrive') return '🏁 Sampai — ' + window.__nav.destName;
  if (s.type === 'roundabout' || s.type === 'rotary') return 'Masuk bulatan, keluar ikut tanda';
  return (m[s.modifier] || 'Terus') + (s.name ? ' ke ' + s.name : '');
}

function remainingDist(pos, idx) {
  const r = window.__nav.route;
  let d = distM(pos, r[idx]);
  for (let i = idx; i < r.length-1; i++) d += distM(r[i], r[i+1]);
  return d;
}

// ==================== SUARA ====================
let __lastSpeak = '';
function speakNav(text) {
  if (!window.__nav.voice || text === __lastSpeak) return;
  __lastSpeak = text;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ms-MY'; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch(e) {}
}

// ==================== STOP & HOOK ====================
document.getElementById('stopNav').onclick = () => {
  const n = window.__nav;
  n.on = false;
  if (n.watchId) navigator.geolocation.clearWatch(n.watchId);
  n.watchId = null;
  navPanel.style.display = 'none';
  navDist.style.display = 'none';
  if (window.__carMarker) { map.removeLayer(window.__carMarker); window.__carMarker = null; }
  status('Navigasi ditamatkan');
};

// Hook: "Mula Navigasi" butang v1 & setDest → auto startNav jika route wujud
const oldSetDest = window.setDest;
window.setDest = function(pt, name) {
  if (oldSetDest) oldSetDest(pt, name);
  // selepas route dikira oleh versi lama (≈2s), tawarkan navigasi aktif
  setTimeout(() => {
    if (window.__nav && !window.__nav.on && typeof routeLine !== 'undefined' && routeLine) {
      window.startNav(pt, name);
    }
  }, 3000);
};
status('v6: navigasi live + auto-reroute sedia');
