// Penampil anatomi 3D (Sumatif Anatomi). Dimuat lewat import() saat kartu model pertama kali dibuka.
// 3D dibangun dari gambar slide itu sendiri: foto/ilustrasi slide menjadi alas, dan setiap struktur berlabel
// dipotong dari gambar yang sama (field "potong" di data/anatomi3d/model-*.json) lalu diberi tebal dan lapisan.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {CSS2DRenderer, CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';

const SYS = {arteri:['Arteri','#d84a43'], vena:['Vena','#4f80e6'], jantung:['Jantung','#bda999'], otot:['Otot','#a8948a'],
  saraf:['Saraf','#e8c64f'], tulang:['Tulang','#efe6d2'], lainnya:['Lainnya','#8f8b85']};
const ORDER = Object.keys(SYS);
const SIDE = {dx:'kanan', sn:'kiri'};
const AR = 1100 / 778; // rasio gambar slide; satuan dunia: tinggi slide = 1
const T = 0.012;       // tebal satu lapis potongan
const DEPTH = {posterior: 0, tengah: 1, anterior: 2};
const TILT = {'Depan (sesuai slide)': [0, 0], 'Miring kiri': [-38, 0], 'Miring kanan': [38, 0], 'Dari atas': [0, 32], 'Dari bawah': [0, -32]};
const cache = {};
const load = k => cache[k] ||= fetch(`data/anatomi3d/model-${k.toLowerCase()}.json`).then(r => { if (!r.ok) throw r; return r.json(); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem('anat3d_' + k) || '{}'); } catch(e){ return {}; } },
  set(k, v){ try { localStorage.setItem('anat3d_' + k, JSON.stringify(v)); } catch(e){} }
};
const hasGL = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch(e){ return false; } };
const slideBtn = n => `<button type="button" class="a3-btn" data-zoom="an1|${n}">Lihat slide ${n}</button>`;
const fmtT = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// koordinat tekstur: lembar p/an1/<k>.jpg memuat 4 slide bertumpuk (slide n di baris (n-1)%4)
const texUV = (n, u, v) => [u, 1 - (((n - 1) % 4) + v) / 4];
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
const centroid = poly => { let A = 0, x = 0, y = 0; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], k = p.x * q.y - q.x * p.y; A += k; x += (p.x + q.x) * k; y += (p.y + q.y) * k; }); return new THREE.Vector2(x / (3 * A), y / (3 * A)); };

function index(M){
  const S = M.struktur, by = new Map(S.map(s => [s.id, s]));
  const dup = new Set(S.map(s => s.nama.toLowerCase()).filter((n, i, a) => a.indexOf(n) !== i));
  S.forEach(s => {
    s.kids = S.filter(c => c.induk === s.id); s.trib = S.filter(c => c.muara === s.id);
    const side = SIDE[s.id.split('-').pop()];
    s.label = s.nama + (dup.has(s.nama.toLowerCase()) && side ? ` (${side})` : '');
    s.acc = [s.nama, ...(s.alias || [])];
  });
  return by;
}

export async function open(det){
  const body = det.querySelector('.acc-body');
  if (body.dataset.ready) { body._wake?.(); return; }
  const key = det.dataset.model, M = await load(key);
  body.dataset.ready = '1';
  const by = index(M), S = M.struktur, sys = ORDER.filter(k => S.some(s => s.sistem === k));
  const slides = Object.keys(M.foto || {}).map(Number).sort((a, b) => a - b);
  body.innerHTML = `
    <div class="bar a3-bar">
      <div class="a3-tabs" role="tablist" aria-label="Mode model ${key}">
        <button type="button" role="tab" aria-selected="true" data-mode="jelajah">Jelajah</button>
        <button type="button" role="tab" aria-selected="false" data-mode="bongkar">Bongkar</button>
        <button type="button" role="tab" aria-selected="false" data-mode="pasang">Pasang</button>
      </div>
      <button class="close-acc" type="button">Tutup<span class="sr-only"> Model ${key}</span> <span aria-hidden="true">▲</span></button>
    </div>
    <div class="a3">
      <div class="a3-stage"><canvas tabindex="0" aria-label="Model ${key} 3D dari gambar slide: ${esc(M.judul)}. Panah menggeser, Shift+panah memiringkan, + dan − zoom."></canvas>
        <div class="a3-lbl"></div>
        <p class="a3-hint" aria-hidden="true">Seret untuk memiringkan · cubit/gulir untuk zoom · dua jari atau klik kanan untuk menggeser · ketuk struktur untuk keterangan</p>
      </div>
      <div class="a3-side">
        <div class="a3-row"><label class="a3-sel">Slide <select data-k="slide">${slides.map(n => `<option value="${n}">${n}</option>`).join('')}</select></label><span class="a3-sl" data-k="slidebtn"></span></div>
        <div class="a3-row a3-views" role="group" aria-label="Sudut pandang">${Object.keys(TILT).map(v => `<button type="button" class="a3-btn" data-view="${v}">${v}</button>`).join('')}</div>
        <div class="a3-pane" data-pane="jelajah"></div>
        <div class="a3-pane" data-pane="bongkar" hidden>
          <label class="a3-range"><span>Bongkar <output>0%</output></span><input type="range" min="0" max="100" value="0" data-k="exp"></label>
          <div class="a3-row"><label class="a3-sel">Sistem <select data-k="expsys"><option value="">Semua sistem</option>${sys.map(k => `<option value="${k}">${SYS[k][0]}</option>`).join('')}</select></label>
            <button type="button" class="a3-btn" data-act="expsys">Bongkar sistem</button><button type="button" class="a3-btn" data-act="rebuild">Pasang kembali</button></div>
        </div>
        <div class="a3-pane" data-pane="pasang" hidden>
          <div class="a3-row"><label class="a3-sel">Jenis <select data-k="qv"><option value="seret">Seret ke posisi</option><option value="sebut">Sebut nama</option></select></label>
            <label class="a3-sel">Struktur <select data-k="qs"><option value="">Acak (semua sistem)</option>${sys.map(k => `<option value="${k}">${SYS[k][0]}</option>`).join('')}</select></label>
            <label class="a3-sel">Jumlah <select data-k="qn"><option>5</option><option>10</option><option value="0">Semua</option></select></label></div>
          <div class="a3-row"><button type="button" class="a3-btn a3-go" data-act="qstart">Mulai</button><span class="a3-time" aria-hidden="true"></span></div>
          <div class="a3-quiz" aria-live="polite"></div>
          <ul class="a3-pend" aria-label="Struktur yang belum dipasang"></ul>
        </div>
        <div class="a3-info" aria-live="polite"><p>Ketuk potongan pada gambar atau pilih dari daftar untuk melihat asal, cabang, muara, keterangan, dan slide sumbernya.</p></div>
        <div class="a3-tg">
          <fieldset class="a3-leg"><legend>Sistem (legenda, centang untuk menampilkan)</legend>${sys.map(k => `<label><input type="checkbox" checked data-sys="${k}"><i style="background:${SYS[k][1]}"></i>${SYS[k][0]}</label>`).join('')}</fieldset>
          <div class="a3-row"><button type="button" class="a3-btn" data-act="labels" aria-pressed="false">Label</button><button type="button" class="a3-btn" data-act="iso" aria-pressed="false" disabled>Isolasi</button><button type="button" class="a3-btn" data-act="flow" disabled>Telusuri aliran</button></div>
        </div>
        <div class="a3-treebox"><input class="find" type="search" placeholder="Cari struktur (mis. coronaria)" aria-label="Cari struktur model ${key}"><div class="a3-tree"></div></div>
      </div>
    </div>
    <p class="sub a3-note">Model 3D dari gambar slide ${M.slide_dari}–${M.slide_sampai} buku saku: gambar slide menjadi alas, dan setiap struktur yang dilabeli dipotong dari gambar itu lalu diberi tebal sesuai lapisannya. Garis potong mengikuti tepi yang terlihat di gambar sehingga bersifat perkiraan.</p>
    <button class="close-acc bottom" type="button">Tutup Model ${key} <span aria-hidden="true">▲</span></button>`;
  body.querySelectorAll('.close-acc').forEach(b => b.addEventListener('click', () => {
    det.open = false; const sm = det.querySelector('summary'); sm.focus({preventScroll: true}); sm.scrollIntoView({block: 'start'});
  }));
  const $ = q => body.querySelector(q);
  // pohon struktur: per sistem, lalu per percabangan (arteri lewat induk, vena lewat muara)
  const parentOf = s => s.sistem === 'vena' ? s.muara : s.induk;
  $('.a3-tree').innerHTML = sys.map(k => {
    const items = S.filter(s => s.sistem === k), ids = new Set(items.map(s => s.id));
    const kids = s => items.filter(c => parentOf(c) === s.id);
    const rec = s => `<li><button type="button" data-id="${s.id}" data-q="${esc(s.acc.join(' ').toLowerCase())}"><i style="background:${SYS[k][1]}"></i>${esc(s.label)}</button>${kids(s).length ? `<ul>${kids(s).map(rec).join('')}</ul>` : ''}</li>`;
    return `<details class="a3-grp" open><summary>${SYS[k][0]} (${items.length})</summary><ul>${items.filter(s => !ids.has(parentOf(s))).map(rec).join('')}</ul></details>`;
  }).join('');
  $('.find').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    body.querySelectorAll('.a3-tree li').forEach(li => li.hidden = !!q && ![...li.querySelectorAll('[data-q]')].some(b => b.dataset.q.includes(q)));
  });
  const infoHTML = (s, note = '') => {
    const ln = id => by.has(id) ? `<button type="button" class="a3-link" data-id="${id}">${esc(by.get(id).label)}</button>` : '';
    const row = (t, v) => v ? `<p class="a3-rel"><span>${t}</span> ${v}</p>` : '';
    return `<h4>${esc(s.label)}</h4><p class="a3-k">${SYS[s.sistem][0]} · ${esc(s.kedalaman.nilai)} (${esc(s.kedalaman.sumber)})</p>
      ${row('Asal', ln(s.induk))}${row('Cabang', s.kids.map(c => ln(c.id)).join(' '))}${row('Muara', ln(s.muara))}${row('Menerima', s.trib.map(c => ln(c.id)).join(' '))}
      <p>${esc(s.keterangan)}</p>${note}${s.alias ? `<p class="a3-alias">Tertulis juga: ${s.alias.map(esc).join(', ')}</p>` : ''}
      <div class="a3-sl">${s.slide.map(slideBtn).join('')}</div>`;
  };
  if (!hasGL()) return fallback(body, M, by, infoHTML, 'Perangkat atau peramban ini tidak mendukung WebGL, jadi model 3D tidak bisa ditampilkan.');
  if (!slides.length) return fallback(body, M, by, infoHTML, 'Potongan 3D untuk model ini sedang disiapkan.');
  viewer(det, body, key, M, by, infoHTML, slides);
}

function fallback(body, M, by, infoHTML, why){
  const st = body.querySelector('.a3-stage');
  st.innerHTML = `<p class="a3-fb">${why} Gunakan gambar slide asli di bawah ini (ketuk untuk memperbesar) dan daftar struktur di samping.</p>
    <div class="a3-thumbs">${Array.from({length: M.slide_sampai - M.slide_dari + 1}, (_, j) => M.slide_dari + j).filter(n => n !== 17).map(n =>
      `<button type="button" class="zoom" data-zoom="an1|${n}" aria-label="Perbesar slide ${n}">${window.LM ? window.LM.slide(n) : 'Slide ' + n}</button>`).join('')}</div>`;
  st.querySelectorAll('.sl').forEach(el => el.style.backgroundImage = `url(${el.dataset.bg})`);
  body.querySelectorAll('.a3-tabs,.a3-pane,.a3-tg,.a3-views,.a3-side > .a3-row:first-child').forEach(e => e.hidden = true);
  body.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) body.querySelector('.a3-info').innerHTML = infoHTML(by.get(b.dataset.id)); });
}

function viewer(det, body, key, M, by, infoHTML, slides){
  const S = M.struktur, $ = q => body.querySelector(q), $$ = q => body.querySelectorAll(q);
  const stage = $('.a3-stage'), canvas = stage.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({canvas, antialias: devicePixelRatio < 2, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const labels = new CSS2DRenderer({element: $('.a3-lbl')});
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const controls = new OrbitControls(camera, canvas); controls.listenToKeyEvents(canvas);
  // gambar hanya boleh dimiringkan ±45°, tidak dibalik
  Object.assign(controls, {minAzimuthAngle: -0.8, maxAzimuthAngle: 0.8, minPolarAngle: Math.PI / 2 - 0.8, maxPolarAngle: Math.PI / 2 + 0.8, screenSpacePanning: true});
  const texs = {}, tex = n => { const k = (n - 1) >> 2; if (!texs[k]) { const t = texs[k] = new THREE.TextureLoader().load(`p/an1/${k}.jpg`, () => kick()); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); } return texs[k]; };
  const lineMat = new THREE.LineBasicMaterial({color: 0xffd75e}), sockMat = new THREE.MeshBasicMaterial({color: 0x0b0b0c});
  const coverMat = new THREE.MeshBasicMaterial({color: 0x2a2a2e, depthTest: false}); // juga menutup tulisan di dalam gambar (mis. "Pulmo")
  const dashMat = new THREE.LineDashedMaterial({color: 0xd8d6cc, dashSize: 0.008, gapSize: 0.006, transparent: true, opacity: 0.8});
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 10), new THREE.MeshBasicMaterial({color: 0xfff2a8})); dot.visible = false; scene.add(dot);
  const dashGeo = new THREE.BufferGeometry(), dash = new THREE.LineSegments(dashGeo, dashMat); scene.add(dash);

  // ---------- satu slide = satu adegan: alas gambar + potongan struktur ----------
  let n = 0, W = 1, H = 1, world = null, base = null, covers = [], P = [], PC = new Map(), meshes = [];
  const build = k => {
    if (world) { scene.remove(world); world.traverse(o => { o.geometry?.dispose(); if (o.material && !Array.isArray(o.material) && o.material.map) o.material.dispose(); }); P.forEach(p => { p.front.dispose(); p.side.dispose(); }); }
    n = k; const F = M.foto[n], [x0, y0, x1, y1] = F.area, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, map = tex(n);
    W = (x1 - x0) * AR; H = y1 - y0;
    const toW = ([u, v]) => new THREE.Vector2((u - cx) * AR, -(v - cy));
    const setUV = g => { const p = g.attributes.position, a = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { const t = texUV(n, p.getX(i) / AR + cx, cy - p.getY(i)); a[2 * i] = t[0]; a[2 * i + 1] = t[1]; } g.setAttribute('uv', new THREE.BufferAttribute(a, 2)); };
    world = new THREE.Group(); scene.add(world);
    base = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({map})); setUV(base.geometry); world.add(base);
    covers = (F.tutup || []).map(r => { // penutup kotak label saat kuis
      const m = new THREE.Mesh(new THREE.PlaneGeometry((r[2] - r[0]) * AR, r[3] - r[1]), coverMat);
      m.position.set(((r[0] + r[2]) / 2 - cx) * AR, -((r[1] + r[3]) / 2 - cy), 0.0006); m.renderOrder = 5; m.visible = false; world.add(m); return m;
    });
    const items = S.filter(s => s.potong?.[n]).map(s => ({s, polys: s.potong[n].map(p => p.map(toW))}));
    const all = items.flatMap(it => it.polys.map(p => ({it, p})));
    meshes = []; PC = new Map();
    // satu poligon = satu potongan; struktur yang dilabeli di dua gambar pada slide yang sama punya dua potongan
    P = all.map(({it, p: poly}, i) => {
      const s = it.s, c = centroid(poly), front = new THREE.MeshBasicMaterial({map}), side = new THREE.MeshBasicMaterial({map, color: 0x77716b});
      // lapis = banyak potongan struktur lain yang memuat potongan ini; lapis lebih tinggi duduk di atasnya
      const lvl = all.filter(o => o.it !== it && inPoly(c, o.p)).length, z = lvl * T + i * 0.00005, grp = new THREE.Group();
      const pc = {s, grp, front, side, c, poly, lvl, top: z + T, cur: new THREE.Vector3(), tgt: new THREE.Vector3(), sc: 1, scT: 1, bb: new THREE.Box2()};
      const shape = new THREE.Shape(poly), g = new THREE.ExtrudeGeometry(shape, {depth: T, bevelEnabled: false});
      setUV(g); g.translate(-c.x, -c.y, 0);
      const m = new THREE.Mesh(g, [front, side]); m.position.z = z; m.userData.pc = pc; grp.add(m); meshes.push(m);
      pc.line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(poly.map(q => new THREE.Vector3(q.x - c.x, q.y - c.y, z + T + 0.001))), lineMat);
      pc.line.visible = false; grp.add(pc.line);
      const sk = new THREE.Mesh(new THREE.ShapeGeometry(shape), sockMat); sk.position.z = z + 0.0008; world.add(sk); // lubang bekas potongan
      poly.forEach(q => pc.bb.expandByPoint(new THREE.Vector2(q.x - c.x, q.y - c.y)));
      const el = document.createElement('div'); el.className = 'a3-tag'; el.textContent = s.label;
      pc.tag = new CSS2DObject(el); pc.tag.position.set(0, 0, pc.top + 0.002); pc.tag.center.set(0.5, 1.3); pc.tag.visible = false; grp.add(pc.tag);
      // arah bongkar: menjauh dari pusat gambar dan naik ke arah pembaca; lapis dalam dan struktur anterior naik lebih tinggi
      const xy = c.length() > 1e-3 ? c.clone().normalize() : new THREE.Vector2(0, 1), dep = DEPTH[s.kedalaman?.nilai] ?? 1;
      pc.dir = new THREE.Vector3(xy.x * H * 0.16, xy.y * H * 0.16, H * (0.08 + 0.09 * lvl + 0.03 * dep));
      grp.position.set(c.x, c.y, 0); world.add(grp);
      if (!PC.has(s.id)) PC.set(s.id, []); PC.get(s.id).push(pc); return pc;
    });
    P.forEach(p => { const k = PC.get(p.s.id); p.name = p.s.label + (k.length > 1 ? ` (${k.indexOf(p) + 1})` : ''); });
    $('[data-k="slide"]').value = n; $('[data-k="slidebtn"]').innerHTML = slideBtn(n);
    if (sel && !PC.has(sel.id)) sel = null;
    iso = null; tgl('iso', false); frame(lastView); paint();
  };

  // ---------- render sesuai permintaan; berhenti saat panel ditutup atau tab tersembunyi ----------
  let raf = 0, flow = null, drag = null;
  const step = () => {
    let moving = false; const pos = [];
    P.forEach(p => {
      if (p !== drag?.p) {
        if (p.cur.distanceToSquared(p.tgt) > 1e-9) { p.cur.lerp(p.tgt, 0.18); moving = true; } else p.cur.copy(p.tgt);
        if (Math.abs(p.sc - p.scT) > 1e-3) { p.sc += (p.scT - p.sc) * 0.18; moving = true; } else p.sc = p.scT;
      }
      p.grp.position.set(p.c.x + p.cur.x, p.c.y + p.cur.y, p.cur.z); p.grp.scale.setScalar(p.sc);
      if (p.grp.visible && p.cur.lengthSq() > 1e-5 && !(Q?.v === 'seret')) pos.push(p.c.x, p.c.y, p.top, p.c.x + p.cur.x, p.c.y + p.cur.y, p.cur.z + p.top);
    });
    dashGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dash.computeLineDistances();
    if (flow) {
      const t = Math.min(1, (performance.now() - flow.t0) / flow.ms), d = t * flow.len;
      let i = 1; while (i < flow.cum.length - 1 && flow.cum[i] < d) i++;
      const k = (d - flow.cum[i - 1]) / Math.max(1e-6, flow.cum[i] - flow.cum[i - 1]);
      dot.position.lerpVectors(flow.pts[i - 1], flow.pts[i], Math.min(1, k)); dot.visible = true;
      if (t >= 1) { flow = null; setTimeout(() => { dot.visible = false; kick(); }, 700); } else moving = true;
    }
    return moving;
  };
  const loop = () => {
    raf = 0; if (!det.open || document.hidden) return;
    const moving = step(); renderer.render(scene, camera); labels.render(scene, camera);
    if (moving) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); frame(lastView);
  };
  body._wake = () => { resize(); kick(); };
  new ResizeObserver(resize).observe(stage);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  controls.addEventListener('change', kick);

  // ---------- kamera: tegak lurus = sama persis dengan gambar slide; miring sampai ±45° ----------
  let lastView = 'Depan (sesuai slide)';
  const box = () => { // bidang yang harus terlihat; saat kuis seret ditambah tempat potongan yang dilepas
    if (Q?.v === 'seret' && !Q.done) return Q.wide ? [-W / 2 - Q.cw - 0.04, -H / 2, W / 2 + Q.cw + 0.04, H / 2] : [-W / 2, -H / 2 - 0.03 - Q.rows * Q.ch, W / 2, H / 2];
    return [-W / 2, -H / 2, W / 2, H / 2];
  };
  const frame = name => {
    lastView = name; const [az, el] = TILT[name].map(THREE.MathUtils.degToRad), b = box();
    const h = Math.max(b[3] - b[1], (b[2] - b[0]) / camera.aspect) * 1.06, d = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    controls.target.set((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0);
    camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d));
    camera.near = d / 20; camera.far = d * 4; camera.updateProjectionMatrix(); controls.minDistance = d * 0.25; controls.maxDistance = d * 2.5;
    controls.update(); kick();
  };

  // ---------- tampilan: sistem, sorotan, isolasi, label ----------
  const sysOn = Object.fromEntries(ORDER.map(k => [k, true]));
  let sel = null, iso = null, showLabels = false, Q = null, expF = 0, expSys = '';
  const isoSet = s => {
    const set = new Set([s.id]);
    for (let p = s; p.induk && by.has(p.induk);) { p = by.get(p.induk); set.add(p.id); }
    for (let p = s; p.muara && by.has(p.muara);) { p = by.get(p.muara); set.add(p.id); }
    const down = x => { x.kids.concat(x.trib).forEach(c => { if (!set.has(c.id)) { set.add(c.id); down(c); } }); }; down(s); return set;
  };
  const DIM = 0x3c3c3c, DIMS = 0x2a2826;
  const place = () => { // posisi tujuan setiap potongan (bongkar, sorotan, kuis)
    P.forEach(p => {
      if (Q?.v === 'seret' && Q.set.has(p) && !p.ok) return; // diatur oleh kuis
      p.tgt.copy(p.dir).multiplyScalar(!Q && (!expSys || p.s.sistem === expSys) ? expF : 0);
      if (p.s === sel || p.s === Q?.cur) p.tgt.z += T * 3;
      p.scT = 1;
    });
  };
  const paint = () => {
    const focus = Q ? (Q.v === 'sebut' && Q.cur ? new Set([Q.cur.id]) : null) : iso || (sel ? new Set([sel.id]) : null);
    base.material.color.setHex(focus ? DIM : 0xffffff);
    P.forEach(p => {
      const s = p.s, lit = !focus || focus.has(s.id);
      p.grp.visible = sysOn[s.sistem] && (!iso || iso.has(s.id));
      p.front.color.setHex(Q && p.ok ? 0xa8f0b4 : lit ? 0xffffff : DIM); p.side.color.setHex(lit ? 0x77716b : DIMS);
      p.line.visible = s === sel || s === Q?.cur || p === Q?.active;
      p.tag.visible = !Q && (showLabels || s === sel); p.tag.element.classList.toggle('on', s === sel);
    });
    covers.forEach(c => c.visible = !!Q);
    place(); kick();
  };
  const infoEl = $('.a3-info');
  const choose = s => {
    if (s && !PC.has(s.id)) { const m = slides.find(k => s.potong?.[k]); if (m) { sel = s; build(m); } }
    sel = s; if (iso && s) iso = isoSet(s);
    const note = s && !PC.has(s.id) ? '<p class="a3-alias">Struktur ini belum dipotong pada gambar slide 3D yang tersedia.</p>' : '';
    infoEl.innerHTML = s ? infoHTML(s, note) : '<p>Ketuk potongan pada gambar atau pilih dari daftar.</p>';
    $$('.a3-tree button').forEach(b => b.setAttribute('aria-current', !!s && b.dataset.id === s.id));
    $('[data-act="iso"]').disabled = !s; $('[data-act="flow"]').disabled = !s || flowChain(s).length < 2;
    paint();
  };
  body.addEventListener('click', e => {
    const b = e.target.closest('button[data-id]'); if (b && !Q) { choose(by.get(b.dataset.id)); return; }
    const v = e.target.closest('[data-view]'); if (v) frame(v.dataset.view);
  });
  $('[data-k="slide"]').addEventListener('change', e => { if (Q) stopQuiz(); build(+e.target.value); });
  $$('[data-sys]').forEach(c => c.addEventListener('change', () => { sysOn[c.dataset.sys] = c.checked; paint(); }));
  const tgl = (a, on) => $(`[data-act="${a}"]`).setAttribute('aria-pressed', on);
  $('[data-act="labels"]').addEventListener('click', () => { showLabels = !showLabels; tgl('labels', showLabels); paint(); });
  $('[data-act="iso"]').addEventListener('click', () => { iso = iso ? null : sel && isoSet(sel); tgl('iso', !!iso); paint(); });

  // ---------- telusuri aliran: arteri dari pangkal ke cabang terpilih, vena dari cabang ke muaranya (lewat potongan di slide ini) ----------
  const flowChain = s => {
    if (!['arteri', 'vena'].includes(s.sistem)) return [];
    const ch = []; if (s.sistem === 'arteri') { for (let p = s; p; p = by.get(p.induk)) ch.unshift(p); } else { for (let p = s; p; p = by.get(p.muara)) ch.push(p); }
    return ch.filter(c => PC.has(c.id));
  };
  $('[data-act="flow"]').addEventListener('click', () => {
    const ch = sel && flowChain(sel); if (!ch || ch.length < 2) return;
    const pts = ch.map(c => { const p = PC.get(c.id)[0]; return new THREE.Vector3(p.c.x + p.cur.x, p.c.y + p.cur.y, p.cur.z + p.top + 0.006); });
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const len = cum[cum.length - 1]; flow = {pts, cum, len, ms: Math.min(7000, Math.max(1800, len / H * 4000)), t0: performance.now()};
    infoEl.querySelector('.a3-flow')?.remove();
    infoEl.insertAdjacentHTML('beforeend', `<p class="a3-flow">Aliran ${sel.sistem}: ${ch.map(c => esc(c.label)).join(' → ')}</p>`);
    kick();
  });

  // ---------- bongkar ----------
  const expIn = $('[data-k="exp"]'), expOut = $('.a3-range output');
  const setExp = v => { expIn.value = v; expF = v / 100; expOut.textContent = v + '%'; place(); kick(); };
  expIn.addEventListener('input', () => setExp(+expIn.value));
  $('[data-act="expsys"]').addEventListener('click', () => { expSys = $('[data-k="expsys"]').value; setExp(expF ? expIn.value : 60); });
  $('[data-act="rebuild"]').addEventListener('click', () => { expSys = ''; $('[data-k="expsys"]').value = ''; setExp(0); });

  // ---------- mode ----------
  const setMode = m => {
    if (Q) stopQuiz();
    $$('[role="tab"]').forEach(t => { t.setAttribute('aria-selected', t.dataset.mode === m); t.tabIndex = t.dataset.mode === m ? 0 : -1; });
    $$('.a3-pane').forEach(p => p.hidden = p.dataset.pane !== m);
    infoEl.hidden = $('.a3-treebox').hidden = $('.a3-tg').hidden = m === 'pasang';
    if (m !== 'bongkar' && expF) { expSys = ''; setExp(0); }
    if (m === 'pasang') { iso = null; tgl('iso', false); choose(null); }
    paint();
  };
  $$('[role="tab"]').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
  $('.a3-tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const ts = [...$$('[role="tab"]')], i = ts.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const nx = ts[(i + (e.key === 'ArrowRight' ? 1 : ts.length - 1)) % ts.length]; nx.focus(); setMode(nx.dataset.mode);
  });

  // ---------- pasang (kuis) ----------
  const qEl = $('.a3-quiz'), pendEl = $('.a3-pend'), timeEl = $('.a3-time');
  let timer = 0;
  const project = v => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * stage.clientWidth, (1 - p.y) / 2 * stage.clientHeight]; };
  const slot = p => { // tempat potongan yang dilepas: kolom kiri/kanan (layar lebar) atau baris di bawah gambar (layar sempit)
    const i = Q.items.indexOf(p), N = Q.items.length;
    if (Q.wide) { const half = Math.ceil(N / 2), ch = H / half, side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      return {x: side * (W / 2 + 0.02 + Q.cw / 2), y: H / 2 - ch * (row + 0.5), w: Q.cw, h: ch}; }
    const cw = W / Q.cols; return {x: -W / 2 + cw * (i % Q.cols + 0.5), y: -H / 2 - 0.03 - Q.ch * (Math.floor(i / Q.cols) + 0.5), w: cw, h: Q.ch};
  };
  const toSlot = p => {
    const o = slot(p), sz = p.bb.getSize(new THREE.Vector2());
    p.scT = Math.min(1, o.w * 0.86 / sz.x, o.h * 0.86 / sz.y); p.tgt.set(o.x - p.c.x, o.y - p.c.y, 0.02);
  };
  const hint = p => {
    const s = p.s, rel = by.get(s.induk) || by.get(s.muara);
    if (rel) return `Petunjuk: ${esc(s.label)} ${s.sistem === 'vena' || !by.get(s.induk) ? 'bermuara ke' : 'bercabang dari'} ${esc(rel.label)}.`;
    const out = P.find(o => o.s !== s && o.lvl < p.lvl && inPoly(p.c, o.poly));
    if (out) return `Petunjuk: ${esc(s.label)} berada di dalam ${esc(out.s.label)}.`;
    const nb = P.filter(o => o.s !== s && (!Q.set.has(o) || o.ok)).sort((a, b) => a.c.distanceTo(p.c) - b.c.distanceTo(p.c))[0];
    return nb ? `Petunjuk: ${esc(s.label)} terletak dekat ${esc(nb.s.label)}.` : '';
  };
  const pendList = () => {
    pendEl.innerHTML = Q.v === 'seret' && !Q.done ? Q.items.filter(p => !p.ok).map(p => `<li><button type="button" data-q="${P.indexOf(p)}" aria-pressed="${p === Q.active}">${esc(p.name)}</button></li>`).join('') : '';
  };
  const startQuiz = () => {
    setMode('pasang'); const v = $('[data-k="qv"]').value, fs = $('[data-k="qs"]').value, k = +$('[data-k="qn"]').value;
    let pool = shuffle((v === 'seret' ? P : [...new Set(P.map(p => p.s))].map(s => ({s}))).filter(p => !fs || p.s.sistem === fs));
    if (v === 'sebut') pool = pool.map(p => p.s);
    if (k) pool = pool.slice(0, k);
    if (!pool.length) { qEl.innerHTML = `<p>Tidak ada struktur untuk pilihan ini pada slide ${n}.</p>`; return; }
    const wide = camera.aspect >= 1.1, cols = 3, rows = Math.ceil(pool.length / cols);
    Q = {v, items: pool, set: new Set(pool), wrong: new Set(), t0: performance.now(), i: 0, cur: null, active: null, wide, cols, rows, cw: W * 0.24, ch: W / cols * 0.75};
    clearInterval(timer); timeEl.textContent = 'Waktu 0:00'; timer = setInterval(() => { timeEl.textContent = 'Waktu ' + fmtT(performance.now() - Q.t0); }, 1000);
    if (v === 'seret') {
      Q.items.forEach(toSlot); frame('Depan (sesuai slide)');
      qEl.innerHTML = `<p>Kotak label ditutup dan ${pool.length} potongan dilepas dari gambar slide ${n}. Seret setiap potongan kembali ke lubangnya. Tanpa mouse: pilih nama di daftar, geser dengan tombol panah saat gambar terfokus, lalu tekan Enter.</p>`;
      pendList(); paint();
    } else { frame('Depan (sesuai slide)'); askName(); }
  };
  const askName = () => {
    Q.cur = Q.items[Q.i]; const s = Q.cur;
    qEl.innerHTML = `<p class="a3-k">Soal ${Q.i + 1} dari ${Q.items.length}</p><p>Potongan yang terangkat dan bergaris kuning bernama apa? Singkatan (a./v./n.), huruf besar/kecil, dan salah ketik kecil tetap dianggap benar.</p>
      <form class="a3-isi"><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Nama struktur yang disorot"><button type="submit">Periksa</button></form><div class="a3-res"></div>`;
    const f = qEl.querySelector('form'), inp = f.querySelector('input');
    f.addEventListener('submit', ev => {
      ev.preventDefault(); const val = inp.value.trim(); if (!val || inp.readOnly) return;
      const ok = !!(window.LM && window.LM.isRight({type: 'isian', acc: s.acc}, 'T:' + val));
      if (!ok) Q.wrong.add(Q.cur); inp.readOnly = true; inp.className = ok ? 'right' : 'wrong';
      qEl.querySelector('.a3-res').innerHTML = `<p class="verdict ${ok ? 'ok' : 'no'}">${ok ? '✓ Benar.' : `✗ Belum tepat, jawabanmu "${esc(val)}".`} Jawaban: <b>${esc(s.nama)}</b>.</p>
        <div class="a3-sl"><button type="button" class="a3-btn a3-next">${Q.i + 1 < Q.items.length ? 'Berikutnya' : 'Lihat hasil'}</button>${s.slide.map(slideBtn).join('')}</div>`;
      const nx = qEl.querySelector('.a3-next'); nx.addEventListener('click', () => { Q.i++; Q.i < Q.items.length ? askName() : finish(); }); nx.focus();
    });
    inp.focus({preventScroll: true}); paint();
  };
  const check = p => {
    const a = project(new THREE.Vector3(p.c.x + p.cur.x, p.c.y + p.cur.y, p.top)), h = project(new THREE.Vector3(p.c.x, p.c.y, p.top));
    const tol = Math.max(24, Math.min(stage.clientWidth, stage.clientHeight) * 0.06);
    if (Math.hypot(a[0] - h[0], a[1] - h[1]) <= tol) { p.ok = true; p.tgt.set(0, 0, 0); p.scT = 1; if (Q.active === p) Q.active = null; qEl.innerHTML = `<p class="verdict ok">✓ ${esc(p.name)} terpasang.</p>`; }
    else { Q.wrong.add(p); toSlot(p); qEl.innerHTML = `<p class="verdict no">✗ Belum tepat, ${esc(p.name)} kembali ke tepi.</p><p>${hint(p)}</p>`; }
    pendList(); paint(); if (Q.items.every(x => x.ok)) finish();
  };
  const finish = () => {
    clearInterval(timer); const ms = performance.now() - Q.t0, N = Q.items.length, ok = N - Q.wrong.size;
    const all = store.get(key), prev = all[Q.v]?.terbaik, cur = {benar: ok, total: N, waktu: Math.round(ms / 1000), tgl: new Date().toISOString().slice(0, 10), slide: n};
    const better = !prev || ok / N > prev.benar / prev.total || (ok / N === prev.benar / prev.total && cur.waktu < prev.waktu);
    all[Q.v] = {terakhir: cur, terbaik: better ? cur : prev, main: (all[Q.v]?.main || 0) + 1}; store.set(key, all);
    const wr = [...new Set([...Q.wrong].map(p => p.s || p))], best = all[Q.v].terbaik;
    Q.cur = null; Q.done = true; timeEl.textContent = ''; pendEl.innerHTML = '';
    qEl.innerHTML = `<p class="a3-k">Hasil ${Q.v === 'seret' ? 'seret ke posisi' : 'sebut nama'} · slide ${n}</p>
      <p><b>${ok} dari ${N}</b> benar pada percobaan pertama, waktu ${fmtT(ms)}. Terbaik: ${best.benar}/${best.total} dalam ${fmtT(best.waktu * 1000)}. Skor tersimpan di perangkat ini.</p>
      ${wr.length ? `<p>Struktur yang masih salah:</p><ul class="a3-wrong">${wr.map(s => `<li><span>${esc(s.label)}</span> ${s.slide.map(slideBtn).join('')}</li>`).join('')}</ul>` : '<p>Semua benar pada percobaan pertama.</p>'}
      <div class="a3-sl"><button type="button" class="a3-btn a3-again">Ulangi</button></div>`;
    qEl.querySelector('.a3-again').addEventListener('click', startQuiz); frame(lastView); paint();
  };
  const stopQuiz = () => { clearInterval(timer); timeEl.textContent = ''; P.forEach(p => { p.ok = false; }); Q = null; drag = null; controls.enabled = true; qEl.innerHTML = ''; pendEl.innerHTML = ''; frame(lastView); paint(); };
  $('[data-act="qstart"]').addEventListener('click', startQuiz);
  pendEl.addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (!b || !Q) return; Q.active = P[+b.dataset.q]; pendList(); paint(); canvas.focus(); });

  // ---------- pointer: pilih (jelajah/bongkar) dan seret (pasang) ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const aim = e => { const r = canvas.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera); };
  const hitAt = (e, list) => {
    aim(e);
    return ray.intersectObjects(list).find(h => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; }) || null;
  };
  let down = null;
  canvas.addEventListener('pointerdown', e => {
    down = [e.clientX, e.clientY];
    if (!Q || Q.v !== 'seret' || Q.done) return;
    const h = hitAt(e, meshes.filter(m => Q.set.has(m.userData.pc) && !m.userData.pc.ok)); if (!h) return;
    const p = h.object.userData.pc;
    drag = {p, plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -h.point.z), p0: h.point.clone(), o0: p.cur.clone()};
    p.scT = 1; p.sc = 1; Q.active = p; controls.enabled = false; canvas.setPointerCapture(e.pointerId); pendList(); paint();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; aim(e);
    const q = ray.ray.intersectPlane(drag.plane, new THREE.Vector3()); if (!q) return;
    drag.p.cur.set(drag.o0.x + q.x - drag.p0.x, drag.o0.y + q.y - drag.p0.y, 0.04); drag.p.tgt.copy(drag.p.cur); kick();
  });
  canvas.addEventListener('pointerup', e => {
    if (drag) { const p = drag.p; drag = null; controls.enabled = true; check(p); return; }
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6 || Q) return; down = null;
    const h = hitAt(e, meshes); choose(h ? h.object.userData.pc.s : null);
  });
  canvas.addEventListener('pointercancel', () => { if (drag) { toSlot(drag.p); drag = null; controls.enabled = true; kick(); } });
  canvas.addEventListener('keydown', e => {
    const a = Q?.active;
    if (a && Q.v === 'seret' && !a.ok) {
      const st = H * 0.02, mv = {ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st]}[e.key];
      if (mv) { a.scT = 1; a.tgt.x += mv[0]; a.tgt.y += mv[1]; e.preventDefault(); e.stopImmediatePropagation(); kick(); return; }
      if (e.key === 'Enter') { e.preventDefault(); check(a); return; }
    }
    if (e.key !== '+' && e.key !== '=' && e.key !== '-') return;
    const off = camera.position.clone().sub(controls.target).multiplyScalar(e.key === '-' ? 1.15 : 0.87);
    camera.position.copy(controls.target).add(off); controls.update(); e.preventDefault();
  }, true);

  resize(); build(slides[0]);
  body._dbg = {build, get P(){ return P; }, project, camera, controls, frame}; // dipakai uji lokal
}
