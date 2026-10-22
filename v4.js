// MTM Pejo v4 — Photon autocomplete, POI berdekatan (Overpass), Rumah/Kerja, riwayat carian
// 100% free: photon.komoot.io (no key), overpass-api.de (no key), localStorage

// ==================== A. PHOTON AUTOCOMPLETE ====================
const phCSS = document.createElement('style');
phCSS.textContent = `
  #suggBox { position:absolute; top:58px; left:12px; right:70px; background:#161b22; border:1px solid #30363d;
    border-radius:10px; max-height:260px; overflow-y:auto; z-index:1100; display:none; box-shadow:0 8px 24px rgba(0,0,0,.5); }
  .suggItem { padding:10px 14px; cursor:pointer; border-bottom:1px solid #21262d; color:#e6edf3; font-size:14px; }
  .suggItem:hover, .suggItem.sel { background:#21262d; }
  .suggItem .sd { color:#8b949e; font-size:11px; margin-top:2px; }
  #nearBtn { position:absolute; bottom:150px; right:14px; z-index:1000; width:46px; height:46px; border-radius:50%;
    background:#21262d; color:#e6edf3; border:1px solid #30363d; font-size:20px; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,.4); }
  #nearMenu { position:absolute; bottom:205px; right:14px; z-index:1050; background:#161b22; border:1px solid #30363d;
    border-radius:12px; padding:6px; display:none; grid-template-columns:1fr 1fr; gap:4px; width:230px; box-shadow:0 8px 24px rgba(0,0,0,.5); }
  .nearItem { padding:10px 12px; border-radius:8px; cursor:pointer; color:#e6edf3; font-size:13px; background:#21262d; text-align:left; border:none; }
  .nearItem:hover { background:#30363d; }
  #hkBar { position:absolute; top:58px; left:12px; z-index:1000; display:flex; gap:8px; }
  .hkBtn { background:#21262d; border:1px solid #30363d; color:#e6edf3; padding:7px 14px; border-radius:20px; font-size:13px; cursor:pointer; }
  .hkBtn.edit { padding:7px 8px; }
  #histList { position:absolute; top:104px; left:12px; z-index:1090; background:#161b22; border:1px solid #30363d;
    border-radius:10px; padding:6px; width:260px; display:none; box-shadow:0 8px 24px rgba(0,0,0,.5); }
  .histItem { padding:8px 10px; color:#e6edf3; font-size:13px; cursor:pointer; border-radius:6px; display:flex; justify-content:space-between; }
  .histItem:hover { background:#21262d; }
  .histItem .x { color:#8b949e; padding:0 6px; }
`;
document.head.appendChild(phCSS);

// --- A1. Suggestion box
const suggBox = document.createElement('div');
suggBox.id = 'suggBox';
document.body.appendChild(suggBox);

const searchEl = document.getElementById('search');
let phTimer = null, phSel = -1, phResults = [];

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function photonQuery(q) {
  // Photon: percuma, tanpa key — bias ke Malaysia
  const url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=8&lat=3.14&lon=101.69';
  const r = await fetch(url);
  if (!r.ok) throw new Error('photon ' + r.status);
  return (await r.json()).features || [];
}

async function nominatimFallback(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q) + '&limit=6&countrycodes=my';
  const r = await fetch(url, {headers: {'Accept-Language': 'ms'}});
  if (!r.ok) return [];
  return (await r.json()).map(n => ({
    geometry: {coordinates: [parseFloat(n.lon), parseFloat(n.lat)]},
    properties: {name: (n.display_name || '').split(',')[0], city: (n.display_name || '').split(',').slice(1,3).join(','), country: 'Malaysia'}
  }));
}

function renderSugg(list) {
  phResults = list;
  if (!list.length) { suggBox.style.display = 'none'; return; }
  suggBox.innerHTML = list.map((f, i) => {
    const p = f.properties || {};
    const main = p.name || p.street || p.city || 'Tanpa nama';
    const sub = [p.city, p.state, p.country].filter(Boolean).join(', ');
    return `<div class="suggItem" data-i="${i}"><div>${main}</div><div class="sd">${sub}</div></div>`;
  }).join('');
  suggBox.style.display = 'block';
  phSel = -1;
  suggBox.querySelectorAll('.suggItem').forEach(el => {
    el.onclick = () => pickSugg(parseInt(el.dataset.i));
  });
}

function pickSugg(i) {
  const f = phResults[i];
  if (!f) return;
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties || {};
  const name = p.name || p.city || 'Lokasi';
  suggBox.style.display = 'none';
  searchEl.value = name;
  addHistory(name, lat, lon);
  if (typeof window.setDest === 'function') window.setDest([lat, lon], name);
  else if (typeof status === 'function') status('Dipilih: ' + name);
}

const doSuggest = debounce(async () => {
  const q = searchEl.value.trim();
  if (q.length < 2) { suggBox.style.display = 'none'; showHistory(); return; }
  try {
    let res = [];
    try { res = await photonQuery(q); } catch (e) { res = await nominatimFallback(q); }
    if (!res.length) res = await nominatimFallback(q);
    renderSugg(res);
  } catch (e) { suggBox.style.display = 'none'; }
}, 300);

if (searchEl) {
  searchEl.addEventListener('input', doSuggest);
  searchEl.addEventListener('focus', () => { if (!searchEl.value.trim()) showHistory(); });
  searchEl.addEventListener('keydown', e => {
    if (suggBox.style.display !== 'block') return;
    const items = suggBox.querySelectorAll('.suggItem');
    if (e.key === 'ArrowDown') { phSel = Math.min(phSel+1, items.length-1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { phSel = Math.max(phSel-1, 0); e.preventDefault(); }
    else if (e.key === 'Enter') { if (phSel >= 0) { pickSugg(phSel); e.preventDefault(); } return; }
    else return;
    items.forEach((el, i) => el.classList.toggle('sel', i === phSel));
  });
}
document.addEventListener('click', e => {
  if (!suggBox.contains(e.target) && e.target !== searchEl) { suggBox.style.display = 'none'; }
});

// ==================== C. RUMAH / KERJA + RIWAYAT ====================
const hkStore = {
  get: k => { try { return JSON.parse(localStorage.getItem('mtm_' + k)); } catch(e) { return null; } },
  set: (k, v) => localStorage.setItem('mtm_' + k, JSON.stringify(v))
};

const hkBar = document.createElement('div');
hkBar.id = 'hkBar';
hkBar.innerHTML = `
  <button class="hkBtn" id="btnHome">🏠 <span id="homeLbl">Rumah</span></button>
  <button class="hkBtn" id="btnWork">💼 <span id="workLbl">Kerja</span></button>
  <button class="hkBtn edit" id="btnHist">🕘</button>`;
document.body.appendChild(hkBar);

const histList = document.createElement('div');
histList.id = 'histList';
document.body.appendChild(histList);

function setHomeWork(kind) {
  const center = map.getCenter();
  // guna lokasi pengguna semasa (mePos) jika ada, lain tengah peta
  const pos = (typeof mePos !== 'undefined' && mePos) ? mePos : [center.lat, center.lng];
  hkStore.set(kind, {lat: pos[0], lng: pos[1], t: Date.now()});
  status(kind === 'home' ? '🏠 Rumah ditetapkan di lokasi semasa' : '💼 Tempat kerja ditetapkan di lokasi semasa');
  renderHK();
}

function renderHK() {
  const h = hkStore.get('home'), w = hkStore.get('work');
  document.getElementById('homeLbl').textContent = h ? (h.name || 'Rumah') : 'Rumah';
  document.getElementById('workLbl').textContent = w ? (w.name || 'Kerja') : 'Kerja';
}

document.getElementById('btnHome').onclick = () => {
  const h = hkStore.get('home');
  if (!h) return setHomeWork('home');
  routeTo(h.lat, h.lng, 'Rumah');
};
document.getElementById('btnHome').oncontextmenu = e => { e.preventDefault(); setHomeWork('home'); };
document.getElementById('btnWork').onclick = () => {
  const w = hkStore.get('work');
  if (!w) return setHomeWork('work');
  routeTo(w.lat, w.lng, 'Kerja');
};
document.getElementById('btnWork').oncontextmenu = e => { e.preventDefault(); setHomeWork('work'); };

function routeTo(lat, lng, name) {
  addHistory(name, lat, lng);
  if (typeof window.setDest === 'function') window.setDest([lat, lng], name);
  else status('Pergi: ' + name);
}

// riwayat carian
function addHistory(name, lat, lng) {
  let h = hkStore.get('hist') || [];
  h = h.filter(x => x.name !== name);
  h.unshift({name, lat, lng, t: Date.now()});
  h = h.slice(0, 10);
  hkStore.set('hist', h);
}

function showHistory() {
  const h = hkStore.get('hist') || [];
  if (!h.length) { histList.style.display = 'none'; return; }
  histList.innerHTML = '<div style="color:#8b949e;font-size:11px;padding:4px 10px">RIWAYAT</div>' +
    h.map((x, i) => `<div class="histItem" data-i="${i}"><span>📍 ${x.name}</span><span class="x" data-x="${i}">✕</span></div>`).join('');
  histList.style.display = 'block';
  histList.querySelectorAll('.histItem').forEach(el => {
    el.onclick = e => {
      const i = parseInt(el.dataset.i);
      if (e.target.classList.contains('x')) {
        const h2 = hkStore.get('hist') || [];
        h2.splice(i, 1);
        hkStore.set('hist', h2);
        showHistory();
        return;
      }
      const x = (hkStore.get('hist') || [])[i];
      if (x) { histList.style.display = 'none'; routeTo(x.lat, x.lng, x.name); }
    };
  });
}

document.getElementById('btnHist').onclick = e => {
  e.stopPropagation();
  const open = histList.style.display === 'block';
  histList.style.display = open ? 'none' : 'block';
  if (!open) showHistory();
};
document.addEventListener('click', e => {
  if (!histList.contains(e.target) && e.target.id !== 'btnHist') histList.style.display = 'none';
});
renderHK();

// ==================== B. BERDEKATAN (Overpass POI) ====================
const POIS = [
  {icon:'⛽', label:'Stesen Minyak', q:'node["amenity"="fuel"]({{bbox}});'},
  {icon:'🕌', label:'Masjid / Surau', q:'node["amenity"="place_of_worship"]["religion"="muslim"]({{bbox}});'},
  {icon:'🍽️', label:'Kedai Makan', q:'node["amenity"~"restaurant|fast_food|cafe"]({{bbox}});'},
  {icon:'🏧', label:'ATM / Bank', q:'node["amenity"~"atm|bank"]({{bbox}});'},
  {icon:'🚻', label:'Toilet', q:'node["amenity"="toilets"]({{bbox}});'},
  {icon:'🏥', label:'Hospital / Klinik', q:'node["amenity"~"hospital|clinic|doctors"]({{bbox}});'},
  {icon:'🏪', label:'Kedai Runcit', q:'node["shop"~"convenience|supermarket"]({{bbox}});'},
  {icon:'🅿️', label:'Parkir', q:'node["amenity"="parking"]({{bbox}});'}
];

const nearBtn = document.createElement('button');
nearBtn.id = 'nearBtn';
nearBtn.textContent = '🔎';
nearBtn.title = 'Cari berdekatan';
document.body.appendChild(nearBtn);

const nearMenu = document.createElement('div');
nearMenu.id = 'nearMenu';
nearMenu.innerHTML = POIS.map((p,i) => `<button class="nearItem" data-i="${i}">${p.icon} ${p.label}</button>`).join('');
document.body.appendChild(nearMenu);

nearBtn.onclick = e => {
  e.stopPropagation();
  nearMenu.style.display = nearMenu.style.display === 'grid' ? 'none' : 'grid';
};
document.addEventListener('click', e => {
  if (!nearMenu.contains(e.target) && e.target !== nearBtn) nearMenu.style.display = 'none';
});

nearMenu.querySelectorAll('.nearItem').forEach(el => {
  el.onclick = async () => {
    const p = POIS[parseInt(el.dataset.i)];
    nearMenu.style.display = 'none';
    status('🔎 Mencari ' + p.label + ' berdekatan...');
    const c = map.getCenter();
    const d = 0.02; // ~2km
    const bbox = `${(c.lat-d).toFixed(5)},${(c.lng-d).toFixed(5)},${(c.lat+d).toFixed(5)},${(c.lng+d).toFixed(5)}`;
    const q = p.q.replace('{{bbox}}', bbox);
    const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent('[out:json][timeout:20];(' + q + ');out body 40;');
    try {
      const r = await fetch(url);
      const j = await r.json();
      const els = (j.elements || []).filter(e => e.lat);
      if (window.__poiLayer) map.removeLayer(window.__poiLayer);
      window.__poiLayer = L.layerGroup().addTo(map);
      if (!els.length) { status('Tiada ' + p.label + ' di kawasan peta sekarang'); return; }
      els.forEach(e2 => {
        const nm = e2.tags && (e2.tags.name || e2.tags.brand) || p.label;
        L.marker([e2.lat, e2.lon], {title: nm}).addTo(window.__poiLayer)
          .bindPopup(`<b>${p.icon} ${nm}</b><br><a href="#" onclick="window.setDest && setDest([${e2.lat},${e2.lon}],'${nm.replace(/'/g,'')}'); return false;">Pergi ke sini</a>`);
      });
      status(`✅ ${els.length} ${p.label} dijumpai — tap marker untuk pergi`);
    } catch (err) {
      status('❌ Gagal cari POI — cuba lagi');
    }
  };
});

status('v4 aktif: taip untuk cadangan, 🔎 untuk berdekatan, 🏠💼 Rumah/Kerja');
