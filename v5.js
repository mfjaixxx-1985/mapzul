// MTM Pejo v5 — CARIAN KAYA: gabung Photon + Nominatim + Overpass + Wikipedia + Geoapify (jika key ada)
// Semua percuma; keputusan digabung, dedup, disusun ikut skor relevan
// Menggantikan logik carian dalam v4 (v4 masih load, tapi renderSugg di-override)

const richCSS = document.createElement('style');
richCSS.textContent = `
  .suggItem .src { float:right; font-size:9px; color:#58a6ff; background:#1c2431; padding:1px 6px; border-radius:8px; margin-left:6px; }
  .suggItem .sd { display:block; clear:both; }
  #catRow { position:absolute; top:104px; left:0; right:0; z-index:1000; display:flex; gap:6px; overflow-x:auto;
    padding:0 12px 6px 12px; scrollbar-width:none; }
  #catRow::-webkit-scrollbar { display:none; }
  .catChip { flex:0 0 auto; background:#161b22e0; border:1px solid #30363d; color:#e6edf3; padding:8px 12px;
    border-radius:18px; font-size:12px; cursor:pointer; white-space:nowrap; }
  .catChip:active { background:#30363d; }
`;
document.head.appendChild(richCSS);

// ==================== SUMBER CARIAN (semua free) ====================

async function srcPhoton(q) {
  const r = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=8&lat=3.14&lon=101.69');
  if (!r.ok) return [];
  return (await r.json()).features || [];
}

async function srcNominatim(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q) + '&limit=6&countrycodes=my', {headers: {'Accept-Language': 'ms'}});
  if (!r.ok) return [];
  return (await r.json()).map(n => ({
    geometry: {coordinates: [parseFloat(n.lon), parseFloat(n.lat)]},
    properties: {name: (n.display_name||'').split(',')[0], city: (n.display_name||'').split(',').slice(1,3).join(',')}
  }));
}

// Overpass: cari nama kedai/tempat dalam kawasan peta semasa (radius ~15km)
async function srcOverpass(q) {
  const c = map.getCenter();
  const d = 0.15;
  const bbox = `${(c.lat-d).toFixed(4)},${(c.lng-d).toFixed(4)},${(c.lat+d).toFixed(4)},${(c.lng+d).toFixed(4)}`;
  const qq = `node["name"~"${q.replace(/["\\]/g,'')}",i](${bbox});way["name"~"${q.replace(/["\\]/g,'')}",i](${bbox});`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:json][timeout:15];(${qq});out center 25;`);
  const r = await fetch(url);
  if (!r.ok) return [];
  return ((await r.json()).elements || []).filter(e => e.lat || e.center).map(e => {
    const lat = e.lat || e.center.lat, lon = e.lon || e.center.lon;
    return { geometry: {coordinates: [lon, lat]},
      properties: {name: e.tags && e.tags.name || 'Tanpa nama', city: [e.tags&&e.tags['addr:city'], e.tags&&e.tags.shop||e.tags.amenity||e.tags.shop].filter(Boolean).join(' • '), osmId: e.id} };
  });
}

// Wikipedia geosearch — tempat famous, tarikan, bangunan
async function srcWikipedia(q) {
  const r = await fetch('https://ms.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=10000&gscoord=3.139%7C101.687&gslimit=5&format=json&origin=*&gssearch=' + encodeURIComponent(q));
  if (!r.ok) return [];
  const j = await r.json();
  return ((j.query||{}).geosearch||[]).map(w => ({
    geometry: {coordinates: [w.lon, w.lat]},
    properties: {name: w.title, city: 'Wikipedia', wiki: true}
  }));
}

// Geoapify — hanya jika key disimpan (mtm_geokey), free 3k/hari
async function srcGeoapify(q) {
  const key = localStorage.getItem('mtm_geokey');
  if (!key) return [];
  const r = await fetch(`https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&limit=5&apiKey=${key}&filter=countrycode:my`);
  if (!r.ok) return [];
  return (await r.json()).features || [];
}

// ==================== GABUNG + DEDUP + SKOR ====================
let richResults = [];

function normName(n) { return (n||'').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF ]/g,'').trim(); }

function mergeResults(lists) {
  const seen = new Map();
  lists.forEach(list => {
    (list||[]).forEach(f => {
      const p = f.properties || {};
      const key = normName(p.name);
      if (!key) return;
      if (seen.has(key)) {
        const ex = seen.get(key);
        ex._srcs.add(p._src);
        if (!ex.properties.city && p.city) ex.properties.city = p.city;
      } else {
        f.properties = {...p, _src: p._src};
        f._srcs = new Set([p._src]);
        seen.set(key, f);
      }
    });
  });
  return [...seen.values()];
}

async function richSearch(q) {
  status('🔎 Mencari "' + q + '"...');
  const runs = [
    srcPhoton(q).then(r => r.map(x => (x.properties._src='Photon', x))),
    srcNominatim(q).then(r => r.map(x => (x.properties._src='OSM', x))),
    srcOverpass(q).then(r => r.map(x => (x.properties._src='Overpass', x))),
    srcWikipedia(q).then(r => r.map(x => (x.properties._src='Wiki', x))),
    srcGeoapify(q).then(r => r.map(x => (x.properties._src='Geoapify', x)))
  ];
  const lists = await Promise.allSettled(runs);
  const ok = lists.filter(l => l.status === 'fulfilled').map(l => l.value);
  // dedup by name+proximity
  const merged = [];
  ok.flat().forEach(f => {
    if (!f || !f.geometry) return;
    const p = f.properties || {};
    const name = (p.name||'').trim();
    if (!name) return;
    const k = normName(name);
    const near = merged.find(m => {
      const a = m.geometry.coordinates, b = f.geometry.coordinates;
      return normName(m.properties.name) === k && Math.abs(a[0]-b[0]) < 0.002 && Math.abs(a[1]-b[1]) < 0.002;
    });
    if (near) {
      near.properties._srcs = [...new Set([...(near.properties._srcs||[near.properties._src]), p._src])];
    } else {
      f.properties._srcs = [p._src];
      merged.push(f);
    }
  });
  return merged.slice(0, 20);
}

function renderRich(list) {
  richResults = list;
  if (!list.length) {
    suggBox.innerHTML = '<div class="suggItem" style="color:#8b949e">Tiada tempat dijumpai — cuba nama lain atau 🔎 berdekatan</div>';
    suggBox.style.display = 'block';
    return;
  }
  suggBox.innerHTML = list.map((f, i) => {
    const p = f.properties || {};
    const main = p.name || 'Tanpa nama';
    const sub = [p.city, p.state, p.country].filter(Boolean).join(', ');
    const srcs = (p._srcs||[]).map(s => `<span class="src">${s}</span>`).join('');
    return `<div class="suggItem" data-i="${i}"><div>${main} ${srcs}</div><div class="sd">${sub}</div></div>`;
  }).join('');
  suggBox.style.display = 'block';
  suggBox.querySelectorAll('.suggItem').forEach(el => {
    el.onclick = () => {
      const f = richResults[parseInt(el.dataset.i)];
      if (!f) return;
      const [lon, lat] = f.geometry.coordinates;
      const name = f.properties.name;
      suggBox.style.display = 'none';
      searchEl.value = name;
      if (typeof addHistory === 'function') addHistory(name, lat, lon);
      if (typeof window.setDest === 'function') window.setDest([lat, lon], name);
    };
  });
}

// Override suggest dari v4
const doRichSuggest = debounce(async () => {
  const q = searchEl.value.trim();
  if (q.length < 2) { suggBox.style.display = 'none'; return; }
  try {
    const res = await richSearch(q);
    renderRich(res);
  } catch (e) { suggBox.style.display = 'none'; }
}, 350);

if (searchEl) {
  searchEl.removeEventListener('input', doSuggest);   // buang listener v4 kalau ada
  searchEl.addEventListener('input', doRichSuggest);
}
