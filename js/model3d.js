/* WV Bridge Explorer, Step 5: simple 3D bridge model, parts colored by condition.
   Drawn from the bridge's length, width, number of spans, longest span and type in the federal file.
   It is a simplified model: real bridges differ in detail. */
import * as THREE from '../vendor/three.module.min.js';

var COLORS = { Good: 0x2E8540, Fair: 0xE8590C, Poor: 0xB91C1C, none: 0x94a3b8 };
var NEUTRAL = 0xcbd5e1, RAIL = 0x64748b, GROUND = 0xa8b89a, WATER = 0x7fb3d5, SCOUR = 0x38bdf8;
var MAX_SPANS = 24;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* spec: {kind, lengthFt, widthFt, spans, maxSpanFt, water, scour,
          parts: {deck:{cls,text}, beams:{cls,text}, supports:{cls,text}, culvert:{cls,text}}} */
export function mountModel(container, spec, onPick) {
  var W = container.clientWidth || 300, H = container.clientHeight || 210;
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);
  container.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.6));
  var sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.6, 1, 0.8); scene.add(sun);

  var mats = {};
  function mat(part, cls) {
    var key = part + ':' + cls;
    if (!mats[key]) {
      var color = part === 'rail' ? RAIL : part === 'ground' ? GROUND : part === 'water' ? WATER : part === 'road' ? NEUTRAL :
        part === 'scour' ? SCOUR : (COLORS[cls] || COLORS.none);
      mats[key] = new THREE.MeshStandardMaterial({ color: color, roughness: 0.75, metalness: 0.05, flatShading: true,
        transparent: part === 'scour' || part === 'water', opacity: part === 'scour' ? 0.8 : part === 'water' ? 0.85 : 1 });
    }
    return mats[key];
  }
  var group = new THREE.Group(); scene.add(group);
  function partCls(p) { return spec.parts[p] ? spec.parts[p].cls : 'none'; }
  function add(mesh, part) { mesh.userData.part = part; group.add(mesh); return mesh; }
  function box(part, cx, cy, cz, sx, sy, sz) {
    return add(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(part, partCls(part))).translateX(cx).translateY(cy).translateZ(cz), part);
  }
  var up = new THREE.Vector3(0, 1, 0);
  function bar(part, a, b, t) {  // a thin member from point a to point b
    var len = a.distanceTo(b); if (len < 0.01) return;
    var m = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), mat(part, partCls(part)));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    add(m, part);
  }
  function v(x, y, z) { return new THREE.Vector3(x, y, z); }

  /* ----- dimensions (feet). The x axis runs along the road. ----- */
  var L = Math.max(20, spec.lengthFt || 40);
  var realW = spec.widthFt || 0;
  // Long, narrow bridges are drawn a little wider so the parts stay visible.
  var Wd = Math.max(realW || 30, L / 14);
  var n = clamp(spec.spans || 1, 1, MAX_SPANS);
  var maxSpan = spec.maxSpanFt || L / n;
  var spanLens = [];
  if (n === 1) spanLens = [L];
  else if (maxSpan * n > L * 0.95 || maxSpan >= L) { for (var i = 0; i < n; i++) spanLens.push(L / n); }
  else {
    var rest = (L - maxSpan) / (n - 1), mid = Math.floor(n / 2);
    for (var j = 0; j < n; j++) spanLens.push(j === mid ? maxSpan : rest);
  }
  var xs = [-L / 2]; spanLens.forEach(function (s) { xs.push(xs[xs.length - 1] + s); });  // span ends
  var kind = spec.kind;
  var beamDepth = clamp(maxSpan / 20, 2.5, 14);
  var clearH = clamp(maxSpan * 0.3 + 10, 16, 90);
  if (kind === 'culvert') clearH = 0;
  var deckT = 1.2, deckY = clearH + beamDepth + deckT / 2;

  /* ----- ground and water ----- */
  var gw = Wd * 2.2 + 30, gl = L * 1.12 + 30;
  box('ground', 0, -0.6, 0, gl, 1.2, gw);
  if (spec.water && kind !== 'culvert') {
    var ww = Math.max(spanLens[Math.floor(n / 2)] * 0.7, 12);
    box('water', 0, 0.15, 0, ww, 0.4, gw * 0.98);
  }

  if (kind === 'culvert') { buildCulvert(); }
  else {
    buildSupports();
    buildSuperstructure();
    // deck and railings
    box('deck', 0, deckY, 0, L, deckT, Wd);
    box('rail', 0, deckY + 2, Wd / 2 - 0.4, L, 2.6, 0.6);
    box('rail', 0, deckY + 2, -Wd / 2 + 0.4, L, 2.6, 0.6);
  }

  function buildSupports() {
    var topY = clearH;
    // abutments at both ends
    [xs[0] - 4, xs[n] + 4].forEach(function (x) { box('supports', x, topY / 2 + beamDepth / 2, 0, 8, topY + beamDepth, Wd + 4); });
    // piers between spans: columns and a cap
    var cols = clamp(Math.round(Wd / 22) + 1, 1, 6);
    for (var k = 1; k < n; k++) {
      var x = xs[k];
      box('supports', x, topY - 1.5, 0, 4, 3, Wd * 0.95);
      for (var c = 0; c < cols; c++) {
        var z = cols === 1 ? 0 : -Wd * 0.4 + (Wd * 0.8) * c / (cols - 1);
        var col = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, topY - 3, 12), mat('supports', partCls('supports')));
        col.position.set(x, (topY - 3) / 2, z); add(col, 'supports');
      }
      box('supports', x, 0.8, 0, 8, 1.6, Wd * 0.95);  // footing
      if (spec.scour) scourRing(x, Wd);
    }
    if (spec.scour) { scourRing(xs[0] - 4, Wd + 4); scourRing(xs[n] + 4, Wd + 4); }
  }
  function scourRing(x, w) {  // a bright ring around the base of a support: where flood erosion can undermine it
    var rx = 9, rz = w / 2 + 5, seg = 24, prev = null;
    for (var s = 0; s <= seg; s++) {
      var a = s / seg * Math.PI * 2, p = v(x + rx * Math.cos(a), 1.4, rz * Math.sin(a));
      if (prev) bar('scour', prev, p, 1.6);
      prev = p;
    }
  }

  function girders(count, wEach) {
    for (var g = 0; g < count; g++) {
      var z = count === 1 ? 0 : -Wd / 2 + Wd * (g + 0.5) / count;
      box('beams', 0, clearH + beamDepth / 2, z, L, beamDepth, wEach);
    }
  }
  function truss(xa, xb, y0, h, z) {  // a Pratt-style truss panel line between xa and xb
    var panels = clamp(Math.round((xb - xa) / 25), 3, 14), t = clamp(h / 18, 0.8, 2.2);
    for (var p = 0; p < panels; p++) {
      var x1 = xa + (xb - xa) * p / panels, x2 = xa + (xb - xa) * (p + 1) / panels;
      bar('beams', v(x1, y0 + h, z), v(x2, y0 + h, z), t);
      bar('beams', v(x1, y0, z), v(x2, y0, z), t);
      bar('beams', v(x1, y0, z), v(x1, y0 + h, z), t);
      bar('beams', p < panels / 2 ? v(x1, y0 + h, z) : v(x2, y0 + h, z), p < panels / 2 ? v(x2, y0, z) : v(x1, y0, z), t * 0.8);
    }
    bar('beams', v(xb, y0, z), v(xb, y0 + h, z), t);
  }
  function arch(xa, xb, yBase, rise, z, deckLevel, above) {
    var seg = 16, t = clamp(rise / 12, 1, 3.5), prev = null;
    for (var s = 0; s <= seg; s++) {
      var u = s / seg, x = xa + (xb - xa) * u, y = yBase + rise * 4 * u * (1 - u), p = v(x, y, z);
      if (prev) bar('beams', prev, p, t);
      if (s % 2 === 0 && s > 0 && s < seg) bar('beams', p, v(x, deckLevel, z), t * 0.5);  // spandrel column or hanger
      prev = p;
    }
  }

  function buildSuperstructure() {
    var top = clearH + beamDepth;
    if (kind === 'slab') {
      box('beams', 0, clearH + beamDepth / 2, 0, L, beamDepth, Wd);
    } else if (kind === 'box') {
      var nb = clamp(Math.round(Wd / 4), 3, 14); girders(nb, Wd / nb * 0.92);
    } else if (kind === 'truss-through') {
      girders(clamp(Math.round(Wd / 10), 2, 6), 1.2);
      spanLens.forEach(function (s, k) {
        var h = clamp(s * 0.16, 14, 45);
        truss(xs[k], xs[k + 1], top, h, Wd / 2 - 0.5);
        truss(xs[k], xs[k + 1], top, h, -Wd / 2 + 0.5);
        for (var q = 0; q <= 3; q++) { var x = xs[k] + s * q / 3; bar('beams', v(x, top + h, Wd / 2 - 0.5), v(x, top + h, -Wd / 2 + 0.5), 1); }
      });
    } else if (kind === 'truss-deck') {
      spanLens.forEach(function (s, k) {
        var h = Math.min(clamp(s * 0.14, 8, 40), clearH - 4);
        truss(xs[k], xs[k + 1], top - h, h, Wd / 2 - 1);
        truss(xs[k], xs[k + 1], top - h, h, -Wd / 2 + 1);
      });
    } else if (kind === 'arch-deck') {
      girders(clamp(Math.round(Wd / 10), 2, 6), 1.2);
      spanLens.forEach(function (s, k) {
        var base = 2, rise = Math.max(clearH - base - 1, 6);
        [Wd * 0.3, -Wd * 0.3].forEach(function (z) { arch(xs[k], xs[k + 1], base, rise, z, clearH, false); });
      });
    } else if (kind === 'arch-through') {
      girders(clamp(Math.round(Wd / 10), 2, 6), 1.2);
      spanLens.forEach(function (s, k) {
        var rise = clamp(s * 0.2, 15, 90);
        [Wd / 2 - 0.5, -Wd / 2 + 0.5].forEach(function (z) { arch(xs[k], xs[k + 1], top, rise, z, top, true); });
      });
    } else if (kind === 'suspension' || kind === 'cable') {
      girders(2, 2);
      var mid = Math.floor(n / 2), xa = n > 1 ? xs[mid] : xs[0] + L * 0.15, xb = n > 1 ? xs[mid + 1] : xs[n] - L * 0.15;
      var tower = kind === 'cable' ? clamp((xb - xa) * 0.3, 40, 320) : clamp((xb - xa) * 0.18, 30, 160);
      var towers = kind === 'cable' && n === 2 ? [xs[1]] : [xa, xb];
      towers.forEach(function (x) {
        [Wd / 2 + 1, -Wd / 2 - 1].forEach(function (z) {
          var t = new THREE.Mesh(new THREE.BoxGeometry(4, top + tower, 4), mat('supports', partCls('supports')));
          t.position.set(x, (top + tower) / 2, z); add(t, 'supports');
        });
        box('supports', x, top + tower - 2, 0, 4, 3, Wd + 6);
      });
      [Wd / 2 + 1, -Wd / 2 - 1].forEach(function (z) {
        if (kind === 'suspension') {
          var seg = 20, prev = null;
          for (var s = 0; s <= seg; s++) {
            var u = s / seg, x = xa + (xb - xa) * u, y = top + tower - 3 - (tower - 6) * 4 * u * (1 - u), p = v(x, y, z);
            if (prev) bar('beams', prev, p, 1.2);
            if (s > 0 && s < seg) bar('beams', p, v(x, top, z), 0.35);
            prev = p;
          }
          bar('beams', v(xs[0], top, z), v(xa, top + tower - 3, z), 1.2);
          bar('beams', v(xs[n], top, z), v(xb, top + tower - 3, z), 1.2);
        } else {
          towers.forEach(function (x) {
            for (var c = 1; c <= 8; c++) {
              bar('beams', v(x, top + tower - c * 3, z), v(x - (xb - xa) * 0.45 * c / 8, top, z), 0.8);
              bar('beams', v(x, top + tower - c * 3, z), v(x + (xb - xa) * 0.45 * c / 8, top, z), 0.8);
            }
          });
        }
      });
    } else {  // beam or girder (default), tee beam, channel beam, frame, other
      girders(clamp(Math.round(Wd / 8), 3, 12), 1.4);
    }
  }

  function buildCulvert() {
    // Road on an embankment; the culvert barrel runs under it, across the road.
    var cells = clamp(spec.spans || 1, 1, 8), open = Math.max(L / cells, 4), hgt = clamp(open * 0.8, 4, 14);
    var emb = hgt + 6, roadW = realW || 30, depth = roadW + emb * 2.4;
    var span = open * cells + (cells - 1) * 1;
    // embankment (fill) on both sides of the barrel, and the road on top
    box('ground', 0, emb / 2, 0, span + 60, emb, depth);
    box('road', 0, emb + 0.4, 0, span + 60, 0.8, roadW);
    box('rail', 0, emb + 1.8, roadW / 2 - 0.3, span + 60, 2, 0.5);
    box('rail', 0, emb + 1.8, -roadW / 2 + 0.3, span + 60, 2, 0.5);
    for (var c = 0; c < cells; c++) {
      var x = -span / 2 + open / 2 + c * (open + 1);
      if (open <= 12 && cells === 1) {  // pipe
        var pipe = new THREE.Mesh(new THREE.CylinderGeometry(open / 2, open / 2, depth + 2, 24, 1, true), mat('culvert', partCls('culvert')));
        pipe.material.side = THREE.DoubleSide; pipe.rotation.x = Math.PI / 2; pipe.position.set(x, open / 2, 0); add(pipe, 'culvert');
      } else {  // box cell: top, walls and floor
        box('culvert', x, hgt + 0.6, 0, open + 1.2, 1.2, depth + 2);
        box('culvert', x - open / 2, hgt / 2, 0, 1.2, hgt, depth + 2);
        box('culvert', x + open / 2, hgt / 2, 0, 1.2, hgt, depth + 2);
        box('culvert', x, 0.3, 0, open, 0.6, depth + 2);
      }
    }
    if (spec.water) box('water', 0, 0.7, 0, span, 0.4, depth + 30);
    if (spec.scour) scourRing(0, span + 8);
  }

  /* ----- camera, spin and pick ----- */
  // Frame the bridge itself (not the ground) so it fills the view.
  var bb = new THREE.Box3();
  group.children.forEach(function (o) { if (o.userData.part !== 'ground' && o.userData.part !== 'water') bb.expandByObject(o); });
  // Bridges with many spans open on their middle spans; zoom out to see the rest.
  var partial = n > 6 && kind !== 'culvert';
  if (partial) { var m0 = Math.max(0, Math.floor(n / 2) - 1), m1 = Math.min(n, m0 + 3); bb.min.x = xs[m0]; bb.max.x = xs[m1]; }
  var center = bb.getCenter(new THREE.Vector3());
  var corners = [];
  [bb.min.x, bb.max.x].forEach(function (x) { [bb.min.y, bb.max.y].forEach(function (y) { [bb.min.z, bb.max.z].forEach(function (z) { corners.push(new THREE.Vector3(x, y, z)); }); }); });
  var radius = bb.getSize(new THREE.Vector3()).length() / 2;
  var camera = new THREE.PerspectiveCamera(35, W / H, radius / 100, radius * 40);
  var theta0 = -0.62, phi0 = 1.12, theta = theta0, phi = phi0, dist = radius * 3;
  function fit() {  // smallest distance that keeps every corner of the bridge inside the frame
    var lo = radius * 0.3, hi = radius * 8, p = new THREE.Vector3();
    for (var it = 0; it < 22; it++) {
      dist = (lo + hi) / 2; place(); camera.updateMatrixWorld();
      var ok = corners.every(function (c) { p.copy(c).project(camera); return Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.84 && p.z < 1; });
      if (ok) hi = dist; else lo = dist;
    }
    dist = hi;
  }
  var minD, maxD;
  function place() {
    camera.position.set(center.x + dist * Math.sin(phi) * Math.sin(theta), center.y + dist * Math.cos(phi), center.z + dist * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(center);
  }
  fit(); minD = dist * 0.15; maxD = dist * (partial ? L / (bb.max.x - bb.min.x) * 1.4 : 2.5);
  var queued = false;
  function render() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; place(); renderer.render(scene, camera); }); }
  render();

  var el = renderer.domElement, dragging = false, moved = 0, lx = 0, ly = 0, pinch = null;
  el.style.touchAction = 'none'; el.style.cursor = 'grab';
  var pointers = {};
  el.addEventListener('pointerdown', function (e) { pointers[e.pointerId] = [e.clientX, e.clientY]; dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', function (e) {
    if (!dragging) { hover(e); return; }
    pointers[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(pointers);
    if (ids.length === 2) {  // pinch to zoom
      var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { dist = clamp(dist * pinch / d, minD, maxD); render(); }
      pinch = d; return;
    }
    var dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    theta -= dx * 0.01; phi = clamp(phi - dy * 0.01, 0.25, 1.5); render();
  });
  function end(e) {
    delete pointers[e.pointerId]; pinch = null;
    if (Object.keys(pointers).length) return;
    dragging = false; el.style.cursor = 'grab';
    if (moved < 5) pick(e, true);
  }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', function (e) { e.preventDefault(); dist = clamp(dist * (e.deltaY > 0 ? 1.12 : 0.89), minD, maxD); render(); }, { passive: false });

  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), lit = null;
  var PICKABLE = { deck: 1, beams: 1, supports: 1, culvert: 1, scour: 1 };
  function hit(e) {
    var r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(group.children, false);
    for (var i = 0; i < hits.length; i++) if (PICKABLE[hits[i].object.userData.part]) return hits[i].object.userData.part;
    return null;
  }
  function highlight(part) {
    if (part === lit) return;
    lit = part;
    Object.keys(mats).forEach(function (k) { mats[k].emissive && mats[k].emissive.setHex(k.split(':')[0] === part ? 0x333333 : 0x000000); });
    render();
  }
  function hover(e) { if (e.pointerType === 'mouse') { var p = hit(e); highlight(p); el.style.cursor = p ? 'pointer' : 'grab'; if (p) onPick(p); } }
  function pick(e) { var p = hit(e); highlight(p); onPick(p); }

  var ro = new ResizeObserver(function () {
    var w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); fit(); render();
  });
  ro.observe(container);

  return {
    partial: partial,
    reset: function () { theta = theta0; phi = phi0; fit(); render(); },
    dispose: function () {
      ro.disconnect();
      group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
      renderer.dispose(); renderer.forceContextLoss();
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
