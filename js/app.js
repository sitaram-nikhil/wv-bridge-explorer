/* WV Bridge Explorer, Step 2: statewide 3D map, search, filters and counts. */
(function () {
  'use strict';

  var WV_BOUNDS = [[-82.65, 37.2], [-77.72, 40.64]];
  var COND = ['Good', 'Fair', 'Poor'];
  var COND_COLOR = ['#2E8540', '#E8590C', '#B91C1C'];
  var LIST_MAX = 150;
  var USGS = 'https://basemap.nationalmap.gov/arcgis/rest/services/';
  var USGS_ATTR = 'Imagery and maps: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return n == null ? 'Not listed' : n.toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };

  var CAMS = null, CAM_BRIDGES = {}, META, ALL = [], BY_ID = {}, COUNTY_BOUNDS = {}, shown = [], selectedId = null, popup = null, is3D = true;

  /* ---------- Map ---------- */
  function raster(service, maxzoom) {
    return { type: 'raster', tiles: [USGS + service + '/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: maxzoom, attribution: USGS_ATTR };
  }
  var map = new maplibregl.Map({
    container: 'map',
    bounds: WV_BOUNDS,
    fitBoundsOptions: { padding: 20 },
    maxPitch: 75,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        hybrid: raster('USGSImageryTopo', 16),
        photo: raster('USGSImageryOnly', 16),
        topo: raster('USGSTopo', 16),
        dem: {
          type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14,
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          attribution: '3D hills: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>'
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#2b3a2c' } },
        { id: 'hybrid', type: 'raster', source: 'hybrid' },
        { id: 'photo', type: 'raster', source: 'photo', layout: { visibility: 'none' } },
        { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } }
      ]
    }
  });
  window.bridgeMap = map;
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

  function setBase(name) {
    ['hybrid', 'photo', 'topo'].forEach(function (b) { map.setLayoutProperty(b, 'visibility', b === name ? 'visible' : 'none'); });
    document.querySelectorAll('.basemap button').forEach(function (btn) { btn.classList.toggle('on', btn.dataset.base === name); });
  }
  function set3D(on) {
    is3D = on;
    $('b-3d').classList.toggle('on', on);
    if (on) {
      map.setTerrain({ source: 'dem', exaggeration: 1 });
      if (map.getPitch() < 20) map.easeTo({ pitch: 50, duration: 800 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }
  function homeView() {
    // Tilting pushes the south of the state toward the bottom edge, so zoom out a little more when tilted.
    var cam = map.cameraForBounds(WV_BOUNDS, { padding: 20 });
    map.flyTo({ center: cam.center, zoom: cam.zoom - (is3D ? 0.35 : 0), pitch: is3D ? 30 : 0, bearing: 0, elevation: 0, duration: 1200 });
  }

  /* ---------- Data ---------- */
  function load() {
    return Promise.all([
      fetch('data/bridges-map.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('data/counties.geojson').then(function (r) { return r.json(); }),
      fetch('data/wv-outline.geojson').then(function (r) { return r.json(); }),
      // Cameras are optional: if the file fails, the map still works without them.
      fetch('data/cameras.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]);
  }

  function prepare(data) {
    META = data.meta;
    var F = META.fields;
    ALL = data.rows.map(function (r) {
      var b = {};
      F.forEach(function (f, i) { b[f] = r[i]; });
      var hay = [b.id, b.name, b.alias || '', b.county, b.county + ' county', b.route, b.owner, b.place, b.typeName].join(' ').toLowerCase();
      b.hay = hay;
      b.compact = hay.replace(/[^a-z0-9]/g, '');
      BY_ID[b.id] = b;
      return b;
    });
  }

  function countyBounds(geo) {
    geo.features.forEach(function (f) {
      var bb = [180, 90, -180, -90];
      (function walk(c) {
        if (typeof c[0] === 'number') { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }
        else c.forEach(walk);
      })(f.geometry.coordinates);
      COUNTY_BOUNDS[f.properties.NAME] = [[bb[0], bb[1]], [bb[2], bb[3]]];
    });
  }

  function fillFilters() {
    var counties = Array.from(new Set(ALL.map(function (b) { return b.county; }))).sort();
    $('f-county').insertAdjacentHTML('beforeend', counties.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join(''));
    $('f-type').insertAdjacentHTML('beforeend', META.types.map(function (t, i) { return '<option value="' + i + '">' + esc(t) + '</option>'; }).join(''));

    var html = '<optgroup label="Road type">' + META.routeClasses.map(function (c, i) { return '<option value="c:' + i + '">' + (i < 3 ? 'All ' + c + 's' : c + 's') + '</option>'; }).join('') + '</optgroup>';
    [0, 1, 2].forEach(function (ci) {
      var routes = Array.from(new Set(ALL.filter(function (b) { return b.routeClass === ci && b.route; }).map(function (b) { return b.route; })));
      routes.sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); });
      html += '<optgroup label="' + META.routeClasses[ci] + 's">' + routes.map(function (r) { return '<option value="r:' + esc(r) + '">' + esc(r) + '</option>'; }).join('') + '</optgroup>';
    });
    $('f-route').insertAdjacentHTML('beforeend', html);
  }

  /* ---------- Filtering ---------- */
  function readFilters() {
    var y = $('f-year').value.split('-');
    return {
      q: $('q').value.trim().toLowerCase(),
      cond: $('f-cond').value, county: $('f-county').value, route: $('f-route').value,
      type: $('f-type').value, owner: $('f-owner').value, scour: $('f-scour').checked, cam: $('f-cam').checked,
      y0: y.length === 2 ? +y[0] : null, y1: y.length === 2 ? +y[1] : null
    };
  }

  function matches(b, f, tokens, compactQ) {
    if (f.cond !== '' && b.cond !== +f.cond) return false;
    if (f.county && b.county !== f.county) return false;
    if (f.route) {
      if (f.route.charAt(0) === 'c' && b.routeClass !== +f.route.slice(2)) return false;
      if (f.route.charAt(0) === 'r' && b.route !== f.route.slice(2)) return false;
    }
    if (f.type !== '' && b.type !== +f.type) return false;
    if (f.owner !== '' && b.wvdoh !== +f.owner) return false;
    if (f.scour && !b.scour) return false;
    if (f.cam && !b.cams) return false;
    if (f.y0 !== null && (b.year == null || b.year < f.y0 || b.year > f.y1)) return false;
    if (tokens.length) {
      var all = tokens.every(function (t) { return b.hay.indexOf(t) !== -1; });
      if (!all && (compactQ.length < 2 || b.compact.indexOf(compactQ) === -1)) return false;
    }
    return true;
  }

  function apply(fit) {
    var f = readFilters();
    var tokens = f.q ? f.q.split(/\s+/) : [];
    var compactQ = f.q.replace(/[^a-z0-9]/g, '');
    shown = ALL.filter(function (b) { return matches(b, f, tokens, compactQ); });

    ['f-cond', 'f-county', 'f-route', 'f-type', 'f-year', 'f-owner'].forEach(function (id) { $(id).classList.toggle('set', $(id).value !== ''); });
    $('q').classList.toggle('set', f.q !== '');

    var c = [0, 0, 0], scour = 0, withCam = 0;
    shown.forEach(function (b) { c[b.cond]++; if (b.scour) scour++; if (b.cams) withCam++; });
    $('k-all').textContent = fmt(shown.length);
    $('k-good').textContent = fmt(c[0]);
    $('k-fair').textContent = fmt(c[1]);
    $('k-poor').textContent = fmt(c[2]);
    $('k-scour').textContent = fmt(scour);
    $('k-cam').textContent = fmt(withCam);

    var src = map.getSource('bridges');
    if (src) src.setData(toGeo(shown));
    renderList(f, compactQ);
    if (currentTab === 'summary') renderSummary();
    if (currentTab === 'downloads') renderDownloads();

    if (fit) fitToShown(f);
  }

  function toGeo(list) {
    return {
      type: 'FeatureCollection',
      features: list.filter(function (b) { return b.lat != null && b.lon != null; }).map(function (b) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] }, properties: { id: b.id, cond: b.cond, scour: b.scour } };
      })
    };
  }

  function fitToShown(f) {
    if (f.county && !f.route && !f.q) { map.fitBounds(COUNTY_BOUNDS[f.county], { padding: 40, pitch: is3D ? 45 : 0, duration: 1200 }); return; }
    var pts = shown.filter(function (b) { return b.lat != null; });
    if (!pts.length || pts.length === ALL.length - 1) return;
    if (pts.length === 1) { map.flyTo({ center: [pts[0].lon, pts[0].lat], zoom: 14, duration: 1200 }); return; }
    var bb = [180, 90, -180, -90];
    pts.forEach(function (b) { bb[0] = Math.min(bb[0], b.lon); bb[1] = Math.min(bb[1], b.lat); bb[2] = Math.max(bb[2], b.lon); bb[3] = Math.max(bb[3], b.lat); });
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 50, maxZoom: 13, pitch: is3D ? 45 : 0, duration: 1200 });
  }

  /* ---------- List ---------- */
  function adtSort(b) { return b.adtOdd ? 0 : (b.adt || 0); }
  function adtText(b) { return b.adt == null ? 'Not listed' : fmt(b.adt) + (b.adtOdd ? ' (likely a typo in the federal file)' : ''); }
  function renderList(f, compactQ) {
    var list = shown.slice();
    list.sort(function (a, b) {
      if (compactQ) {
        var ea = a.id.toLowerCase() === compactQ ? 1 : 0, eb = b.id.toLowerCase() === compactQ ? 1 : 0;
        if (ea !== eb) return eb - ea;
      }
      return (b.cond - a.cond) || (adtSort(b) - adtSort(a));
    });
    var top = list.slice(0, LIST_MAX);
    var el = $('list');
    if (!top.length) {
      el.innerHTML = '<li class="empty">No bridges match. Try a different search or select Clear.</li>';
    } else {
      el.innerHTML = top.map(function (b) {
        return '<li tabindex="0" data-id="' + esc(b.id) + '"' + (b.id === selectedId ? ' class="sel"' : '') + '>' +
          '<span class="dot" style="background:' + COND_COLOR[b.cond] + '" title="' + COND[b.cond] + '"></span>' +
          '<span class="nm">' + esc(b.name) + '</span>' +
          '<span class="meta"><span>' + esc(b.county) + ' County</span><span class="t">' + (b.adt != null ? (b.adtOdd ? 'Traffic count looks wrong' : fmt(b.adt) + ' vehicles a day') : '') + '</span><span class="id">' + esc(b.id) + '</span>' +
          (b.cams ? '<span title="Live camera nearby"><i class="camicon"></i></span>' : '') +
          (b.lat == null ? '<span class="flag">No map location</span>' : '') + '</span></li>';
      }).join('');
    }
    $('more').textContent = list.length > LIST_MAX ? 'Showing the first ' + LIST_MAX + ' of ' + fmt(list.length) + '. Search or filter to narrow the list.' : '';
    $('list-sub').textContent = compactQ ? 'Best matches first, then poor bridges with the most traffic.' : 'Poor bridges with the most traffic are listed first.';
  }

  /* ---------- Selecting a bridge ---------- */
  function select(id, fly) {
    var b = BY_ID[id];
    if (!b) return;
    selectedId = id;
    if (map.getLayer('selected')) map.setFilter('selected', ['==', ['get', 'id'], id]);
    document.querySelectorAll('#list li').forEach(function (li) { li.classList.toggle('sel', li.dataset.id === id); });
    history.replaceState(null, '', '#bridge=' + encodeURIComponent(id));
    if (popup) popup.remove();
    stopCam();
    disposeModel();
    showDetail(b);
    if (b.lat == null) return;
    var open = function () {
      if (selectedId !== id) return;
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ offset: 12, maxWidth: '320px', closeOnClick: false }).setLngLat([b.lon, b.lat]).setHTML(popupHtml(b)).addTo(map);
      popup.on('close', function () { if (selectedId === id && !closingQuietly) clearSelection(); });
      // Sharper hill data can arrive after the fly-in; when the map settles, re-aim at the bridge's true ground height.
      map.once('idle', function () {
        if (selectedId !== id || !popup) return;
        if (is3D) {
          var g = map.queryTerrainElevation([b.lon, b.lat]);
          if (g != null && Math.abs(g - map.getCenterElevation()) > 2 && map.getCenter().distanceTo(new maplibregl.LngLat(b.lon, b.lat)) < 30) map.jumpTo({ elevation: Math.max(0, g) });
        }
        popup.setLngLat([b.lon, b.lat]);
      });
    };
    if (fly) {
      // Fly in looking straight down, then set the camera to the bridge's ground height and tilt.
      // This keeps the bridge in the middle of the 3D view instead of hidden behind a hill.
      var ll = [b.lon, b.lat], token = 'fly-' + id + '-' + Date.now();
      var step = function (e) {
        if (!e || e.flyId !== token) return;
        map.off('moveend', step);
        if (!is3D) { open(); return; }
        map.jumpTo({ elevation: Math.max(0, map.queryTerrainElevation(ll) || 0) });
        token = token + '-tilt';
        map.on('moveend', function tilt(e2) {
          if (e2.flyId !== token) return;
          map.off('moveend', tilt);
          open();
        });
        map.easeTo({ pitch: 55, duration: 700 }, { flyId: token });
      };
      map.stop();
      map.on('moveend', step);
      map.flyTo({ center: ll, zoom: 15.5, pitch: 0, duration: 1600, essential: true }, { flyId: token });
    } else open();
  }
  var closingQuietly = false;
  function clearSelection() {
    stopCam();
    disposeModel();
    selectedId = null;
    showList();
    if (popup) { closingQuietly = true; popup.remove(); popup = null; closingQuietly = false; }
    if (map.getLayer('selected')) map.setFilter('selected', ['==', ['get', 'id'], '']);
    document.querySelectorAll('#list li.sel').forEach(function (li) { li.classList.remove('sel'); });
    history.replaceState(null, '', location.pathname + location.search);
  }
  function popupHtml(b) {
    return '<div class="pop mini"><div class="t"><span class="pill" style="background:' + COND_COLOR[b.cond] + '">' + COND[b.cond] + '</span>' + esc(b.name) + '</div></div>';
  }

  /* ---------- Bridge panel (Step 3) ---------- */
  var DETAIL = null, detailLoading = null;
  var RATING_WORD = ['failed', 'about to fail', 'critical', 'serious', 'poor', 'fair', 'satisfactory', 'good', 'very good', 'excellent'];
  // Keys match the bridge-record format in tools/bridge_record.py (same for every FHWA file layout).
  var POSTING = {
    open: ['open', 'Open, no restrictions'],
    open_temp: ['open', 'Open, temporary bridge in place'],
    open_shored: ['open', 'Open, held up by temporary supports until repairs'],
    needs_posting: ['posted', 'Open, weight limit recommended but not yet posted'],
    posted: ['posted', 'Open, weight limit posted'],
    posted_reduce: ['posted', 'Open, weight limit posted; a lower limit is recommended'],
    posted_missing: ['posted', 'Open, weight limit posted, but a required sign is missing'],
    posted_other: ['posted', 'Open, other limits posted (such as speed or trucks at a time)'],
    not_open: ['closed', 'New bridge, not yet open'],
    closed: ['closed', 'Closed to all traffic'],
    unknown: ['open', 'Not listed']
  };
  var SCOUR = {
    closed: 'Flood erosion has damaged the supports badly enough that the bridge is, or should be, closed.',
    unstable_seen: 'Flood erosion found at the supports is affecting the strength or stability of the bridge.',
    critical: 'Engineers judged the supports could become unstable if a flood erodes the streambed around them.',
    critical_temp: 'Engineers judged the supports could become unstable from flood erosion. Temporary protection is in place.',
    scour_seen: 'Scour was found that affects the supports, but the bridge has not been rated scour critical.',
    exposed: 'Stable, but exposed foundations need protection.',
    protected: 'Stable, with erosion protection in place.',
    protected_unclear: 'Erosion protection is in place. The federal file does not yet say whether it was engineered.',
    stable: 'Stable for flood erosion.',
    dry: 'Foundations sit on dry land well above flood water.',
    not_checked: 'Not yet checked for flood erosion.',
    not_checked_temp: 'Not yet checked for flood erosion. Temporary protection is in place.',
    unknown_foundation: 'Foundation type unknown, so flood erosion risk cannot be judged.',
    no_water: 'Does not cross water.',
    tidal: 'Over tidal water.'
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function loadDetail() {
    if (DETAIL) return Promise.resolve(DETAIL);
    if (!detailLoading) {
      detailLoading = fetch('data/bridges-detail.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { DETAIL = j; return j; })
        .catch(function (e) { detailLoading = null; throw e; });
    }
    return detailLoading;
  }
  function detailFor(id) {
    var r = DETAIL.rows[id], d = {};
    if (!r) return null;
    DETAIL.fields.forEach(function (f, i) { d[f] = r[i]; });
    return d;
  }
  function wordFor(code) {
    var n = parseInt(code, 10);
    if (isNaN(n)) return null;
    return { n: n, cls: n >= 7 ? 0 : n >= 5 ? 1 : 2, word: RATING_WORD[n] };
  }
  function condRow(label, help, code) {
    var w = wordFor(code);
    if (!w) return '';
    return '<div class="row"><span class="pill" style="background:' + COND_COLOR[w.cls] + '">' + COND[w.cls] + '</span><b>' + label + '</b>' +
      '<small>' + help + '. Rated ' + w.n + ' of 9 (' + w.word + ').</small></div>';
  }
  function monthYear(ym) {  // "YYYY-MM"
    var m = /^(\d{4})-(\d{2})$/.exec(ym || '');
    if (!m) return 'Not listed';
    return (MONTHS[parseInt(m[2], 10) - 1] || '') + ' ' + m[1];
  }
  function ft(n) { return n ? fmt(n) + ' ft' : 'Not listed'; }

  function showList() {
    $('view-detail').hidden = true;
    $('view-list').hidden = false;
  }
  function showDetail(b) {
    $('view-list').hidden = true;
    $('view-detail').hidden = false;
    $('d-name').textContent = b.name;
    $('d-sub').textContent = (b.route ? b.route + ' · ' : '') + b.county + ' County';
    $('d-id').textContent = b.id;
    $('d-body').innerHTML = '<div class="sec fine">Loading bridge details…</div>';
    $('d-body').scrollTop = 0;
    loadDetail().then(function () {
      if (selectedId !== b.id) return;
      $('d-body').innerHTML = detailHtml(b, detailFor(b.id) || {});
      wireButtons(b);
      mountModelFor(b, detailFor(b.id) || {});
      if (b.cams && CAMS) wireCam(b);
    }).catch(function () {
      $('d-body').innerHTML = '<div class="sec fine">The bridge details could not be loaded. Check your connection and select the bridge again.</div>';
    });
    if (window.matchMedia('(max-width: 860px)').matches) $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function detailHtml(b, d) {
    var post = POSTING[d.posting] || ['open', 'Not listed'];
    var parts = b.name.split(' over ');
    var carries = parts.length > 1 ? parts[0] : (d.carries || 'Not listed');
    var crosses = parts.length > 1 ? parts.slice(1).join(' over ') : (d.crosses || 'Not listed');
    var h = '';
    // Open / posted / closed
    h += '<div class="sec"><div class="status ' + post[0] + '">' + esc(post[1]) + '</div></div>';

    // Condition
    var isCulvert = wordFor(d.cCulvert) !== null;
    h += '<div class="sec"><div class="lbl">Condition</div><div class="cond">';
    if (isCulvert) {
      h += condRow('Culvert', 'The whole culvert (a pipe or box that carries a stream under the road) gets one rating', d.cCulvert);
    } else {
      h += condRow('Deck', 'The driving surface', d.cDeck);
      h += condRow('Beams', 'The beams or girders that hold up the deck', d.cBeams);
      h += condRow('Supports', 'The piers and abutments the bridge sits on', d.cSupports);
    }
    h += '</div><div class="overall">Overall: <b style="color:' + COND_COLOR[b.cond] + '">' + COND[b.cond] + '</b>. A bridge is rated by its weakest part' + (isCulvert ? '' : ' (deck, beams or supports)') + '.</div>';
    if (b.scour) {
      h += '<div class="warnbox">Flood erosion risk at the supports<small>' + esc(SCOUR[d.scour] || '') + '</small></div>';
    } else if (['scour_seen', 'unknown_foundation', 'not_checked', 'not_checked_temp', 'exposed', 'protected_unclear'].indexOf(d.scour) >= 0) {
      h += '<div class="infobox">' + esc(SCOUR[d.scour]) + '</div>';
    }
    h += '</div>';

    // 3D model
    h += modelSection(b, d, isCulvert);

    // Live camera
    if (b.cams && CAMS) h += camSection(b);

    // Facts
    var built = b.year ? String(b.year) : 'Not listed';
    if (d.yearRecon) built += ' (rebuilt ' + d.yearRecon + ')';
    var adt = b.adt == null ? 'Not listed' : (b.adtOdd ? fmt(b.adt) + ' (count looks wrong)' : fmt(b.adt) + (d.adtYear ? ' (' + d.adtYear + ' count)' : ''));
    var lanes = d.lanesOn ? d.lanesOn + ' on top' + (d.lanesUnder ? ', ' + d.lanesUnder + ' underneath' : '') : 'Not listed';
    h += '<div class="sec"><div class="lbl">Bridge facts</div><div class="facts">' +
      (d.commonName ? '<div class="wide"><span>Also known as</span>' + esc(d.commonName) + '</div>' : '') +
      '<div class="wide"><span>Carries</span>' + esc(carries) + '</div>' +
      '<div class="wide"><span>Crosses</span>' + esc(crosses) + '</div>' +
      (b.place ? '<div class="wide"><span>Location</span>' + esc(b.place) + '</div>' : '') +
      '<div><span>Year built</span>' + built + '</div>' +
      '<div><span>Vehicles a day</span>' + adt + '</div>' +
      '<div><span>Length</span>' + ft(d.lengthFt) + '</div>' +
      '<div><span>Deck width</span>' + ft(d.widthFt) + '</div>' +
      '<div><span>Spans</span>' + (d.spans || 'Not listed') + '</div>' +
      '<div><span>Longest span</span>' + ft(d.maxSpanFt) + '</div>' +
      '<div class="wide"><span>Type</span>' + esc((d.material ? d.material + ', ' : '') + (b.typeName || '').toLowerCase()) + '</div>' +
      '<div><span>Traffic lanes</span>' + lanes + '</div>' +
      '<div><span>Detour if closed</span>' + (d.detourMi ? d.detourMi + ' mi' : d.detourMi === 0 ? 'None needed (bypass nearby)' : 'Not listed') + '</div>' +
      '<div><span>Owner</span>' + (b.wvdoh ? 'WVDOH' : esc(b.owner)) + '</div>' +
      '<div><span>WVDOH district</span>' + (parseInt(d.district, 10) > 0 ? parseInt(d.district, 10) : 'Not listed') + '</div>' +
      '<div><span>Last inspected</span>' + monthYear(d.inspected) + '</div>' +
      '<div><span>Inspected every</span>' + (d.inspectEvery ? d.inspectEvery + ' months' : 'Not listed') + '</div>' +
      (d.nextInspection ? '<div class="wide"><span>Next inspection due</span>' + monthYear(d.nextInspection) + '</div>' : '') +
      '<div class="wide"><span>National Highway System</span>' + (d.nhs ? 'Yes' : 'No') + '</div>' +
      '</div>' +
      (b.locFlag === 1 ? '<div class="infobox">Map location may be off: it falls a few miles outside the listed county.</div>' : '') +
      '</div>';

    // Buttons
    h += '<div class="sec"><div class="btns">' +
      '<a class="btn p" id="b-sv" target="_blank" rel="noopener" href="' + streetViewUrl(b) + '">Open in Street View</a>' +
      '<a class="btn" id="b-ge" target="_blank" rel="noopener" href="' + earthUrl(b) + '">Open in Google Earth</a>' +
      '<button class="btn" type="button" id="b-copy">Copy link</button></div>' +
      (b.lat == null ? '<div class="infobox">This bridge has no map location in the federal file, so it is not on the map and the Street View and Google Earth buttons are off.</div>' : '') +
      '<div class="fine">Street View opens the closest Google photo to the bridge. Some rural bridges have none, and photos can be a few years old.</div></div>';

    h += '<div class="sec fine">Ratings from the ' + esc(META.source) + '. Ratings run from 9 (excellent) to 0 (failed): 7 to 9 is Good, 5 to 6 is Fair, 0 to 4 is Poor.</div>';
    return h;
  }

  function streetViewUrl(b) {
    if (b.lat == null) return '#';
    return 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + b.lat.toFixed(6) + ',' + b.lon.toFixed(6);
  }
  function earthUrl(b) {
    if (b.lat == null) return '#';
    var ground = Math.round(Math.max(0, (map.getTerrain() && map.queryTerrainElevation([b.lon, b.lat])) || 250));
    return 'https://earth.google.com/web/@' + b.lat.toFixed(6) + ',' + b.lon.toFixed(6) + ',' + ground + 'a,450d,35y,0h,60t,0r';
  }
  function bridgeLink(b) {
    return location.origin + location.pathname + '#bridge=' + encodeURIComponent(b.id);
  }
  function wireButtons(b) {
    var btn = $('b-copy');
    if (b.lat == null) {
      ['b-sv', 'b-ge'].forEach(function (id) { var a = $(id); a.removeAttribute('href'); a.style.opacity = .45; a.title = 'This bridge has no map location'; });
    } else {
      // Ground height is known better once the map has flown in, so refresh the Google Earth link on click.
      $('b-ge').addEventListener('click', function () { this.href = earthUrl(b); });
    }
    btn.addEventListener('click', function () {
      var url = bridgeLink(b);
      var done = function () { btn.textContent = 'Link copied'; btn.classList.add('done'); setTimeout(function () { btn.textContent = 'Copy link'; btn.classList.remove('done'); }, 2000); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link:', url); });
      else window.prompt('Copy this link:', url);
    });
  }

  /* ---------- Summary screen (Step 6) ---------- */
  var currentTab = 'map', watchSort = { k: 'adt', dir: -1 }, watchRows = [];
  var AGE_BINS = [[0, 1899, 'Before 1900']];
  for (var dec = 1900; dec <= 2020; dec += 10) AGE_BINS.push([dec, dec + 9, dec + 's']);

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabs button').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === tab); });
    $('summary').hidden = tab !== 'summary';
    $('downloads').hidden = tab !== 'downloads';
    document.querySelector('.main').hidden = tab !== 'map';
    if (tab !== 'map') stopCam();
    if (tab === 'summary') renderSummary();
    else if (tab === 'downloads') renderDownloads();
    else map.resize();
  }
  // Drag handle: resize the map and the side panel (width saved in this browser).
  (function () {
    var sp = $('splitter'), main = document.querySelector('.main');
    if (!sp || !main) return;
    var KEY = 'wvbe.panelWidth', DEF = 330, MIN = 300, MAP_MIN = 320;
    function maxW() { return Math.max(MIN, Math.min(main.clientWidth - MAP_MIN - 14 - 28, Math.round(window.innerWidth * 0.7))); }
    var resizeQueued = false;
    function apply(w, save) {
      w = Math.round(Math.max(MIN, Math.min(maxW(), w)));
      main.style.setProperty('--pw', w + 'px');
      sp.setAttribute('aria-valuemin', MIN); sp.setAttribute('aria-valuemax', maxW()); sp.setAttribute('aria-valuenow', w);
      if (!resizeQueued) { resizeQueued = true; requestAnimationFrame(function () { resizeQueued = false; map.resize(); }); }
      if (save) { try { if (w === DEF) localStorage.removeItem(KEY); else localStorage.setItem(KEY, w); } catch (e) {} }
      return w;
    }
    function cur() { return parseInt(getComputedStyle(main).getPropertyValue('--pw'), 10) || DEF; }
    var saved = null; try { saved = parseInt(localStorage.getItem(KEY), 10); } catch (e) {}
    apply(saved || DEF, false);
    var startX = 0, startW = 0;
    sp.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); sp.setPointerCapture(e.pointerId);
      startX = e.clientX; startW = cur();
      sp.classList.add('drag'); document.body.classList.add('resizing');
    });
    sp.addEventListener('pointermove', function (e) {
      if (!sp.hasPointerCapture(e.pointerId)) return;
      apply(startW + (startX - e.clientX), false);
    });
    function end(e) {
      if (!sp.hasPointerCapture(e.pointerId)) return;
      sp.releasePointerCapture(e.pointerId);
      sp.classList.remove('drag'); document.body.classList.remove('resizing');
      apply(cur(), true);
    }
    sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
    sp.addEventListener('dblclick', function () { apply(DEF, true); });
    sp.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 80 : 20, w = cur();
      if (e.key === 'ArrowLeft') w += step; else if (e.key === 'ArrowRight') w -= step;
      else if (e.key === 'Home') w = DEF; else if (e.key === 'End') w = maxW(); else return;
      e.preventDefault(); apply(w, true);
    });
    window.addEventListener('resize', function () { if (main.clientWidth) apply(cur(), false); });
  })();

  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function stackRow(label, counts, maxTotal, opts) {
    opts = opts || {};
    var total = counts[0] + counts[1] + counts[2];
    var segs = [2, 1, 0].map(function (c) {  // poor first so the problem share reads from the left
      if (!counts[c]) return '';
      var w = total ? counts[c] / maxTotal * 100 : 0;
      return '<i style="width:' + w + '%;background:' + COND_COLOR[c] + '" title="' + COND[c] + ': ' + fmt(counts[c]) + ' (' + pct(counts[c], total) + '%)">' +
        (opts.big && w > 7 ? fmt(counts[c]) : '') + '</i>';
    }).join('');
    return '<div class="hb' + (opts.big ? ' big' : '') + (opts.click ? ' click' : '') + '"' + (opts.click ? ' data-v="' + esc(opts.click) + '" tabindex="0"' : '') + '>' +
      '<span class="l" title="' + esc(label) + '">' + esc(label) + '</span><span class="sbar">' + segs + '</span>' +
      '<span class="t" title="' + pct(counts[2], total) + '% poor">' + fmt(total) + '</span></div>';
  }
  var LEGEND = '<div class="legend2"><span><i style="background:' + COND_COLOR[2] + '"></i>Poor</span><span><i style="background:' + COND_COLOR[1] + '"></i>Fair</span><span><i style="background:' + COND_COLOR[0] + '"></i>Good</span></div>';
  function tally(list, keyFn) {
    var m = {};
    list.forEach(function (b) { var k = keyFn(b); if (k == null) return; (m[k] = m[k] || [0, 0, 0])[b.cond]++; });
    return m;
  }
  function renderSummary() {
    if (currentTab !== 'summary') return;
    var list = shown, n = list.length;
    $('sum-note').innerHTML = n === ALL.length ? 'All <b>' + fmt(n) + '</b> bridges. Use the search and filters above to narrow every chart and the watch list.' :
      'Showing <b>' + fmt(n) + '</b> of ' + fmt(ALL.length) + ' bridges that match your search and filters.';
    if (!n) {
      ['ch-cond', 'ch-part', 'ch-age', 'ch-county', 'ch-type'].forEach(function (id) { $(id).innerHTML = '<p class="cap">No bridges match. Select Clear to start over.</p>'; });
      ['cap-cond', 'cap-age', 'cap-type'].forEach(function (id) { $(id).textContent = ''; });
      renderWatch(); return;
    }
    // Condition
    var c = [0, 0, 0]; list.forEach(function (b) { c[b.cond]++; });
    $('ch-cond').innerHTML = LEGEND + stackRow('All shown', c, n, { big: true });
    $('cap-cond').textContent = pct(c[2], n) + '% of these bridges are in poor condition, ' + pct(c[1], n) + '% fair and ' + pct(c[0], n) + '% good.';
    // Age
    var ages = tally(list, function (b) { if (!b.year) return 'Not listed'; for (var i = 0; i < AGE_BINS.length; i++) if (b.year <= AGE_BINS[i][1]) return AGE_BINS[i][2]; return '2020s'; });
    var ageRows = AGE_BINS.map(function (a) { return a[2]; }).concat(['Not listed']).filter(function (k) { return ages[k]; });
    var maxAge = Math.max.apply(null, ageRows.map(function (k) { return ages[k][0] + ages[k][1] + ages[k][2]; }));
    $('ch-age').innerHTML = LEGEND + ageRows.map(function (k) { return stackRow(k, ages[k], maxAge); }).join('');
    var years = list.filter(function (b) { return b.year; }).map(function (b) { return b.year; }).sort(function (a, b) { return a - b; });
    var old = list.filter(function (b) { return b.year && b.year < 1960; }), oldPoor = old.filter(function (b) { return b.cond === 2; }).length;
    $('cap-age').textContent = years.length ? 'Half of these bridges were built before ' + years[Math.floor(years.length / 2)] + '. ' +
      (old.length ? pct(oldPoor, old.length) + '% of those built before 1960 are poor.' : '') : '';
    // County
    var cty = tally(list, function (b) { return b.county; });
    var keys = Object.keys(cty), sortBy = $('cty-sort').value;
    var tot = function (k) { return cty[k][0] + cty[k][1] + cty[k][2]; };
    keys.sort(function (a, b) {
      if (sortBy === 'name') return a < b ? -1 : 1;
      if (sortBy === 'all') return tot(b) - tot(a);
      if (sortBy === 'share') return (cty[b][2] / tot(b)) - (cty[a][2] / tot(a)) || tot(b) - tot(a);
      return cty[b][2] - cty[a][2] || tot(b) - tot(a);
    });
    var maxC = Math.max.apply(null, keys.map(tot));
    $('ch-county').innerHTML = LEGEND + keys.map(function (k) { return stackRow(k, cty[k], maxC, { click: k }); }).join('');
    $('ch-county').querySelectorAll('.hb.click').forEach(function (r) {
      var go = function () { $('f-county').value = r.dataset.v; showTab('map'); apply(true); };
      r.addEventListener('click', go);
      r.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    });
    // Type
    var ty = tally(list, function (b) { return META.types[b.type]; });
    var tk = Object.keys(ty).sort(function (a, b) { return (ty[b][0] + ty[b][1] + ty[b][2]) - (ty[a][0] + ty[a][1] + ty[a][2]); });
    var maxT = Math.max.apply(null, tk.map(function (k) { return ty[k][0] + ty[k][1] + ty[k][2]; }));
    $('ch-type').innerHTML = LEGEND + tk.map(function (k) { return stackRow(k, ty[k], maxT); }).join('');
    var worst = tk.filter(function (k) { return ty[k][0] + ty[k][1] + ty[k][2] >= 30; })
      .sort(function (a, b) { return ty[b][2] / (ty[b][0] + ty[b][1] + ty[b][2]) - ty[a][2] / (ty[a][0] + ty[a][1] + ty[a][2]); })[0];
    $('cap-type').textContent = 'Most common: ' + tk[0].toLowerCase() + ' (' + fmt(ty[tk[0]][0] + ty[tk[0]][1] + ty[tk[0]][2]) + ').' +
      (worst ? ' Highest share poor among types with 30 or more bridges: ' + worst.toLowerCase() + ' (' + pct(ty[worst][2], ty[worst][0] + ty[worst][1] + ty[worst][2]) + '%).' : '');
    // Lowest part and watch list need the detail file
    $('ch-part').innerHTML = '<p class="cap">Loading…</p>';
    loadDetail().then(function () {
      if (currentTab !== 'summary') return;
      var parts = tally(list, function (b) { return lowestPart(b).part; });
      var pk = ['Deck', 'Beams', 'Supports', 'Culvert'].filter(function (k) { return parts[k]; });
      var maxP = Math.max.apply(null, pk.map(function (k) { return parts[k][0] + parts[k][1] + parts[k][2]; }));
      $('ch-part').innerHTML = pk.map(function (k) { return stackRow(k, parts[k], maxP); }).join('');
      renderWatch();
    }).catch(function () { $('ch-part').innerHTML = '<p class="cap">The part ratings could not be loaded. Check your connection.</p>'; });
  }
  function lowestPart(b) {
    var d = detailFor(b.id) || {}, best = null;
    [['Deck', d.cDeck], ['Beams', d.cBeams], ['Supports', d.cSupports], ['Culvert', d.cCulvert]].forEach(function (p) {
      var w = wordFor(p[1]); if (w && (!best || w.n < best.n)) best = { part: p[0], n: w.n, word: w.word };
    });
    return best || { part: null, n: null, word: '' };
  }
  function renderWatch() {
    if (!DETAIL) return;
    var min = +$('w-min').value;
    var poor = shown.filter(function (b) { return b.cond === 2; });
    var odd = poor.filter(function (b) { return b.adtOdd; }).length;
    watchRows = poor.filter(function (b) { return !b.adtOdd && b.adt >= min; }).map(function (b) {
      var d = detailFor(b.id) || {}, lp = lowestPart(b), post = POSTING[d.posting] || ['open', 'Not listed'];
      return { b: b, d: d, name: b.name, county: b.county, adt: b.adt, year: b.year || 0, low: lp.n == null ? 99 : lp.n, lowText: lp.part ? lp.part + ', ' + lp.n + ' of 9' : 'Not listed',
        status: post[1], statusCls: post[0], scour: b.scour ? 1 : 0, cam: b.cams ? 1 : 0 };
    });
    var k = watchSort.k, dir = watchSort.dir;
    watchRows.sort(function (a, c) { var x = a[k], y = c[k]; return (x < y ? -1 : x > y ? 1 : 0) * dir || c.adt - a.adt; });
    document.querySelectorAll('#wt th').forEach(function (th) {
      if (th.dataset.k === k) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
    });
    $('cap-watch').textContent = fmt(watchRows.length) + ' poor bridges carry at least ' + fmt(min) + ' vehicles a day. Select a column to sort, or a row to see the bridge on the map.' +
      (odd ? ' Left out: ' + odd + ' poor bridge' + (odd > 1 ? 's' : '') + ' whose traffic count looks wrong in the federal file.' : '');
    var tb = $('wt').querySelector('tbody');
    tb.innerHTML = watchRows.length ? watchRows.map(function (r) {
      return '<tr data-id="' + esc(r.b.id) + '"><td class="nm">' + esc(r.name) + '<small>' + (r.b.route ? esc(r.b.route) + ' · ' : '') + '<span class="id">' + esc(r.b.id) + '</span></small></td>' +
        '<td>' + esc(r.county) + '</td><td class="num">' + fmt(r.adt) + '</td><td class="num">' + (r.year || '') + '</td>' +
        '<td>' + esc(r.lowText) + '</td><td><span class="tag ' + r.statusCls + '">' + esc(r.status.replace('Open, ', '').replace(/^no restrictions$/, 'Open')) + '</span></td>' +
        '<td>' + (r.scour ? 'Yes' : '') + '</td><td>' + (r.cam ? '<i class="camicon" title="Live camera"></i>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">No poor bridges with that much traffic match your filters.</td></tr>';
  }
  function watchCsv() {
    var head = ['Bridge ID', 'Bridge', 'County', 'Route', 'Vehicles a day', 'Traffic count year', 'Year built', 'Deck rating', 'Beams rating', 'Supports rating', 'Culvert rating', 'Lowest part', 'Open, posted or closed', 'Flood erosion risk', 'Live camera', 'Latitude', 'Longitude'];
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [head.map(q).join(',')].concat(watchRows.map(function (r) {
      var d = r.d, b = r.b;
      return [b.id, b.name, b.county, b.route, b.adt, d.adtYear, b.year, d.cDeck, d.cBeams, d.cSupports, d.cCulvert, r.lowText, r.status, r.scour ? 'Yes' : 'No', r.cam ? 'Yes' : 'No', b.lat, b.lon].map(q).join(',');
    }));
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'wv-bridges-watch-list-' + $('w-min').value + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ---------- Downloads (Step 7) ---------- */
  function filterText() {
    var f = readFilters(), out = [];
    var label = function (id) { var el = $(id); return el.options[el.selectedIndex].text; };
    if (f.q) out.push('search "' + $('q').value.trim() + '"');
    ['f-cond', 'f-county', 'f-route', 'f-type', 'f-year', 'f-owner'].forEach(function (id) { if ($(id).value !== '') out.push(label(id)); });
    if (f.scour) out.push('flood erosion risk only');
    if (f.cam) out.push('has live camera');
    return out.join(', ');
  }
  function renderDownloads() {
    var ft = filterText();
    $('dl-n-shown').textContent = '(' + fmt(shown.length) + (ft ? ': ' + ft : ': no filters set, so this is every bridge') + ')';
    $('dl-n-all').textContent = '(' + fmt(ALL.length) + ')';
    $('dl-note').innerHTML = 'Files are made in your browser from the same data as the map: the <b>' + esc(META.source) + '</b>, with live cameras from WV511.';
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function num(code) { var n = parseInt(code, 10); return isNaN(n) ? null : n; }
  function exportRows(list) {
    var base = location.origin + location.pathname;
    return list.map(function (b) {
      var d = detailFor(b.id) || {}, post = POSTING[d.posting], lp = lowestPart(b);
      var parts = b.name.split(' over ');
      var r = {
        id: b.id, name: b.name, alias: d.commonName || '', carries: parts.length > 1 ? parts[0] : d.carries, crosses: parts.length > 1 ? parts.slice(1).join(' over ') : d.crosses,
        place: b.place, county: b.county, district: parseInt(d.district, 10) > 0 ? parseInt(d.district, 10) : null, route: b.route,
        owner: b.wvdoh ? 'WVDOH' : b.owner, cond: COND[b.cond],
        rDeck: num(d.cDeck), rBeams: num(d.cBeams), rSupports: num(d.cSupports), rCulvert: num(d.cCulvert),
        lowest: lp.part || '', status: post ? post[1] : '', scour: b.scour ? 'Yes' : 'No', scourText: SCOUR[d.scour] || '',
        year: b.year || null, yearRecon: d.yearRecon || null, adt: b.adt, adtYear: d.adtYear || null, adtNote: b.adtOdd ? 'Count looks wrong in the federal file' : '',
        lengthFt: d.lengthFt || null, widthFt: d.widthFt || null, spans: d.spans || null, maxSpanFt: d.maxSpanFt || null,
        type: b.typeName, material: d.material, lanesOn: d.lanesOn || null, lanesUnder: d.lanesUnder || null, detourMi: d.detourMi == null ? null : d.detourMi,
        nhs: d.nhs ? 'Yes' : 'No', inspected: monthYear(d.inspected), inspectEvery: d.inspectEvery || null, nextInsp: d.nextInspection ? monthYear(d.nextInspection) : '',
        cam: b.cams ? 'Yes' : 'No', camIds: b.cams ? b.cams.map(function (m) { return m[0]; }).join(', ') : '',
        lat: b.lat, lon: b.lon, locNote: b.lat == null ? 'No map location in the federal file' : b.locFlag === 1 ? 'May be off: a few miles outside the listed county' : '',
        link: base + '#bridge=' + encodeURIComponent(b.id)
      };
      return r;
    });
  }
  var XCOLS = [
    { h: 'Bridge ID', k: 'id', w: 17 }, { h: 'Bridge', k: 'name', w: 40 }, { h: 'Also known as', k: 'alias', w: 28 }, { h: 'Carries', k: 'carries', w: 24 }, { h: 'Crosses', k: 'crosses', w: 24 },
    { h: 'Location', k: 'place', w: 28 }, { h: 'County', k: 'county', w: 12 }, { h: 'WVDOH district', k: 'district', w: 9 }, { h: 'Route', k: 'route', w: 9 },
    { h: 'Owner', k: 'owner', w: 20 }, { h: 'Condition', k: 'cond', w: 10 },
    { h: 'Deck rating (0-9)', k: 'rDeck', w: 9 }, { h: 'Beams rating (0-9)', k: 'rBeams', w: 9 }, { h: 'Supports rating (0-9)', k: 'rSupports', w: 10 },
    { h: 'Culvert rating (0-9)', k: 'rCulvert', w: 9 }, { h: 'Lowest part', k: 'lowest', w: 11 }, { h: 'Open, posted or closed', k: 'status', w: 30 },
    { h: 'Flood erosion risk', k: 'scour', w: 9 }, { h: 'Flood erosion note', k: 'scourText', w: 40 },
    { h: 'Year built', k: 'year', w: 8 }, { h: 'Year rebuilt', k: 'yearRecon', w: 8 }, { h: 'Vehicles a day', k: 'adt', w: 11, num: 'int' },
    { h: 'Traffic count year', k: 'adtYear', w: 9 }, { h: 'Traffic count note', k: 'adtNote', w: 22 },
    { h: 'Length (ft)', k: 'lengthFt', w: 9, num: 'int' }, { h: 'Deck width (ft)', k: 'widthFt', w: 9, num: 'dec' }, { h: 'Spans', k: 'spans', w: 7 },
    { h: 'Longest span (ft)', k: 'maxSpanFt', w: 9, num: 'int' }, { h: 'Type', k: 'type', w: 20 }, { h: 'Material', k: 'material', w: 22 },
    { h: 'Lanes on bridge', k: 'lanesOn', w: 8 }, { h: 'Lanes underneath', k: 'lanesUnder', w: 9 }, { h: 'Detour if closed (mi)', k: 'detourMi', w: 9 },
    { h: 'National Highway System', k: 'nhs', w: 10 }, { h: 'Last inspected', k: 'inspected', w: 14 }, { h: 'Inspected every (months)', k: 'inspectEvery', w: 10 }, { h: 'Next inspection due', k: 'nextInsp', w: 14 },
    { h: 'Live camera', k: 'cam', w: 8 }, { h: 'Camera IDs', k: 'camIds', w: 16 }, { h: 'Latitude', k: 'lat', w: 11 }, { h: 'Longitude', k: 'lon', w: 11 },
    { h: 'Map location note', k: 'locNote', w: 30 }, { h: 'Open in Bridge Explorer', k: 'link', w: 50 }
  ];
  function aboutLines(scope) {
    return [
      ['WV Bridge Explorer: bridge list', ''],
      ['Source', META.source + ' (FHWA National Bridge Inventory). Live cameras: WV511, run by WVDOH.'],
      ['Data file built', META.built],
      ['Downloaded', today()],
      ['Which bridges', scope],
      ['Condition', 'FHWA Good, Fair or Poor. A bridge is rated by its weakest part: the deck, the beams (superstructure), the supports (substructure), or the culvert for culverts. A part rated 7 to 9 is Good, 5 to 6 is Fair, 0 to 4 is Poor.'],
      ['Ratings (0 to 9)', '9 excellent, 8 very good, 7 good, 6 satisfactory, 5 fair, 4 poor, 3 serious, 2 critical, 1 about to fail, 0 failed. Blank means that part is not rated separately for that bridge.'],
      ['Flood erosion risk', 'Yes when the federal file lists the bridge as scour critical: its supports could be undermined when a flood erodes the streambed (codes 0 to 3).'],
      ['Vehicles a day', 'Average daily traffic from the federal file, with the year it was counted. One bridge has a count that looks wrong (600,500 a day); it is marked in the Traffic count note column.'],
      ['Live camera', 'Yes when a WV511 traffic camera is within 0.15 mile of the bridge, or within 0.5 mile on or over the same road. Cameras point at traffic and may not show the bridge itself.'],
      ['Dates', 'Inspection dates and traffic counts are as of the federal file, so many bridges have been inspected again since.']
    ];
  }
  function kmlHtml(r) {
    var row = function (k, v) { return v == null || v === '' ? '' : '<tr><td style="color:#64748b;padding:2px 8px 2px 0">' + k + '</td><td><b>' + esc(v) + '</b></td></tr>'; };
    var rate = function (v) { return v == null ? null : v + ' of 9'; };
    return '<div style="font-family:Arial,sans-serif;font-size:12px;max-width:320px">' +
      '<div style="font-size:13px;margin-bottom:4px"><b>' + esc(r.cond) + '</b> condition · ' + esc(r.county) + ' County · ' + esc(r.id) + '</div><table>' +
      row('Status', r.status) + row('Deck', rate(r.rDeck)) + row('Beams', rate(r.rBeams)) + row('Supports', rate(r.rSupports)) + row('Culvert', rate(r.rCulvert)) +
      row('Flood erosion risk', r.scour === 'Yes' ? 'Yes' : '') + row('Year built', r.year) + row('Vehicles a day', r.adt != null ? fmt(r.adt) + (r.adtNote ? ' (looks wrong)' : '') : '') +
      row('Type', r.type) + row('Length', r.lengthFt ? fmt(r.lengthFt) + ' ft' : '') + row('Last inspected', r.inspected) + row('Live camera', r.cam === 'Yes' ? r.camIds : '') +
      '</table><p><a href="' + esc(r.link) + '">Open in WV Bridge Explorer</a> · ' +
      '<a href="https://www.google.com/maps/@?api=1&amp;map_action=pano&amp;viewpoint=' + r.lat + ',' + r.lon + '">Street View</a></p></div>';
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function doDownload(kind) {
    var all = document.querySelector('input[name=dl-scope]:checked').value === 'all';
    var list = all ? ALL : shown, btn = $(kind === 'kml' ? 'dl-kml' : 'dl-xlsx'), stat = $(kind === 'kml' ? 'kml-stat' : 'xlsx-stat');
    if (!list.length) { stat.className = 'dlstat err'; stat.textContent = 'No bridges match your filters. Choose all bridges or select Clear.'; return; }
    var ft = filterText();
    var scope = all || !ft ? 'All ' + fmt(list.length) + ' bridges' : fmt(list.length) + ' bridges matching: ' + ft;
    var stamp = today(), suffix = all || !ft ? 'all' : 'filtered';
    btn.disabled = true; stat.className = 'dlstat'; stat.textContent = 'Making the file…';
    loadDetail().then(function () {
      var rows = exportRows(list);
      if (kind === 'kml') {
        rows.forEach(function (r) { r.html = kmlHtml(r); });
        var placed = rows.filter(function (r) { return r.lat != null; }).length;
        return BridgeExport.kml(rows, { title: 'WV bridges (' + suffix + ', ' + stamp + ')', description: scope + '. ' + META.source + '.' }).then(function (blob) {
          saveBlob(blob, 'wv-bridges-' + suffix + '-' + stamp + '.kmz');
          return fmt(placed) + ' bridges saved as pins' + (placed < rows.length ? ' (' + (rows.length - placed) + ' with no map location left out)' : '') + '.';
        });
      }
      return BridgeExport.xlsx(rows, XCOLS, aboutLines(scope)).then(function (blob) {
        saveBlob(blob, 'wv-bridges-' + suffix + '-' + stamp + '.xlsx');
        return fmt(rows.length) + ' bridges saved, one row each.';
      });
    }).then(function (msg) { stat.className = 'dlstat ok'; stat.textContent = 'Done. ' + msg; })
      .catch(function () { stat.className = 'dlstat err'; stat.textContent = 'The file could not be made. Check your connection and try again.'; })
      .then(function () { btn.disabled = false; });
  }

  /* ---------- 3D bridge model (Step 5) ---------- */
  var model = null, modelLib = null, modelToken = 0;
  var PART_HELP = { deck: 'Deck (driving surface)', beams: 'Beams (hold up the deck)', supports: 'Supports (piers and abutments)', culvert: 'Culvert' };
  function modelKind(b, isCulvert) {
    var t = (b.typeName || '').toLowerCase();
    if (isCulvert || t.indexOf('culvert') === 0) return 'culvert';
    if (t === 'slab') return 'slab';
    if (t.indexOf('box') >= 0) return 'box';
    if (t === 'truss (through)') return 'truss-through';
    if (t === 'truss (deck)') return 'truss-deck';
    if (t === 'arch (deck)') return 'arch-deck';
    if (t === 'arch (through)') return 'arch-through';
    if (t === 'suspension') return 'suspension';
    if (t === 'cable-stayed') return 'cable';
    return 'girder';
  }
  function partInfo(name, code) {
    var w = wordFor(code);
    if (!w) return { cls: 'none', text: PART_HELP[name] + ': not rated separately for this bridge.' };
    return { cls: COND[w.cls], text: PART_HELP[name] + ': ' + COND[w.cls] + ', rated ' + w.n + ' of 9 (' + w.word + ').' };
  }
  function modelParts(d, isCulvert) {
    return isCulvert ? { culvert: partInfo('culvert', d.cCulvert) } :
      { deck: partInfo('deck', d.cDeck), beams: partInfo('beams', d.cBeams), supports: partInfo('supports', d.cSupports) };
  }
  function modelSection(b, d, isCulvert) {
    var parts = modelParts(d, isCulvert);
    var chips = Object.keys(parts).map(function (k) {
      var c = parts[k].cls, col = c === 'none' ? '#94a3b8' : COND_COLOR[COND.indexOf(c)];
      return '<span class="chip"><i style="background:' + col + '"></i>' + PART_HELP[k].split(' (')[0] + '</span>';
    }).join('') + (b.scour ? '<span class="chip"><i class="sc"></i>Flood erosion risk</span>' : '');
    return '<div class="sec"><div class="lbl">3D model</div>' +
      '<div class="m3d" id="m3d"><div class="mload">Loading the 3D model…</div><button type="button" class="mreset" id="mreset" title="Reset the view">Reset view</button></div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="mpick" id="mpick">Drag to spin, scroll or pinch to zoom. Tap a part to see its rating.</div>' +
      '<div class="fine">A simple model drawn from this bridge\'s length, width, spans and type. Each part is colored by its rating. It shows which part has the problem, not the exact spot; that needs the inspection report.' +
      (d.spans > 24 ? ' Only the first 24 spans are drawn.' : '') + '</div></div>';
  }
  function mountModelFor(b, d) {
    var el = $('m3d'); if (!el) return;
    var isCulvert = wordFor(d.cCulvert) !== null;
    var token = ++modelToken;
    var spec = {
      kind: modelKind(b, isCulvert), lengthFt: d.lengthFt, widthFt: d.widthFt, spans: d.spans, maxSpanFt: d.maxSpanFt,
      water: /river|creek|\bcrk\b|\bck\b|\brun\b|fork|branch|lick|stream|lake|\bunt\b|trib|\bbr\b|\br\b|hollow|drain/i.test(d.crosses || b.name),
      scour: !!b.scour, parts: modelParts(d, isCulvert)
    };
    var lib = modelLib || import(new URL('js/model3d.js', document.baseURI).href).then(function (m) { modelLib = Promise.resolve(m); return m; });
    Promise.resolve(lib).then(function (m) {
      if (token !== modelToken || !$('m3d')) return;
      var ld = el.querySelector('.mload'); if (ld) ld.remove();
      model = m.mountModel(el, spec, function (part) {
        var t = $('mpick'); if (!t) return;
        if (!part) { t.textContent = 'Drag to spin, scroll or pinch to zoom. Tap a part to see its rating.'; return; }
        t.textContent = part === 'scour' ? 'Flood erosion risk at the supports. ' + (SCOUR[d.scour] || '') : spec.parts[part].text;
      });
      $('mreset').addEventListener('click', function () { model && model.reset(); });
      if (model.partial) $('mpick').textContent = 'Showing the middle spans of this long bridge. Scroll or pinch out to see all of it. Tap a part to see its rating.';
    }).catch(function () {
      var ld = el.querySelector('.mload'); if (ld) ld.textContent = 'The 3D model could not be loaded on this computer.';
    });
  }
  function disposeModel() { modelToken++; if (model) { try { model.dispose(); } catch (e) {} model = null; } }

  /* ---------- Live cameras (Step 4) ---------- */
  var hlsLoading = null, player = null, camStopTimer = null;
  var CAM_MINUTES = 5;  // stop each stream after 5 minutes to save bandwidth, like WV511 does after 30

  function attachCams(data) {
    if (!data) return;
    CAMS = data;
    Object.keys(data.bridges).forEach(function (id) {
      var b = BY_ID[id];
      if (!b) return;
      b.cams = data.bridges[id];  // [[camId, miles, inView], ...], closest first
      b.cams.forEach(function (m) { (CAM_BRIDGES[m[0]] = CAM_BRIDGES[m[0]] || []).push([id, m[1]]); });
    });
  }
  function cam(id) { var c = CAMS.cams[id]; return { id: id, name: c[0], route: c[1], lat: c[2], lon: c[3], stream: c[4] }; }

  function camSection(b) {
    var tabs = b.cams.length > 1 ? '<div class="camtabs">' + b.cams.map(function (m, i) {
      return '<button type="button" data-i="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>Camera ' + (i + 1) + '</button>';
    }).join('') + '</div>' : '';
    return '<div class="sec"><div class="lbl">Live camera</div>' + tabs +
      '<div class="cam"><video id="camvid" muted playsinline></video><span class="live" id="camlive" hidden>LIVE</span>' +
      '<div class="msg" id="cammsg">Connecting to the camera…</div></div>' +
      '<div class="camcap" id="camcap"></div></div>';
  }
  function camCaption(b, i) {
    var m = b.cams[i], c = cam(m[0]);
    return '<b>' + esc(c.name) + '</b> · WV511 camera <span class="id">' + esc(c.id) + '</span><br>' +
      m[1] + ' mi from the bridge. ' + (m[2] ? 'The bridge should be in or near the view.' : 'The camera watches the same road near the bridge.') +
      ' Cameras point at traffic, so they may not show the bridge structure itself.';
  }
  function wireCam(b) {
    var tabs = document.querySelectorAll('.camtabs button');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.toggle('on', x === t); });
        playCam(b, +t.dataset.i);
      });
    });
    playCam(b, 0);
  }
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (!hlsLoading) {
      hlsLoading = new Promise(function (ok, fail) {
        var sc = document.createElement('script');
        sc.src = 'vendor/hls.min.js'; sc.onload = ok; sc.onerror = function () { hlsLoading = null; fail(); };
        document.head.appendChild(sc);
      });
    }
    return hlsLoading;
  }
  function camMsg(html) {
    var el = $('cammsg'); if (!el) return;
    if (html) { el.innerHTML = '<div>' + html + '</div>'; el.hidden = false; } else el.hidden = true;
    var lv = $('camlive'); if (lv) lv.hidden = !!html;
  }
  function playCam(b, i) {
    stopCam();
    var v = $('camvid'); if (!v) return;
    var c = cam(b.cams[i][0]);
    $('camcap').innerHTML = camCaption(b, i);
    camMsg('Connecting to the camera…');
    var token = {};
    player = { token: token, video: v, hls: null };
    var offline = function () { if (player && player.token === token) { stopCam(); camMsg('This camera is offline right now. WV511 cameras go down from time to time; try again later.'); } };
    var started = function () { if (player && player.token === token) camMsg(null); };
    v.addEventListener('playing', started);
    camStopTimer = setTimeout(function () {
      if (!player || player.token !== token) return;
      stopCam();
      camMsg('The video stopped after ' + CAM_MINUTES + ' minutes to save data.<br><button class="btn" type="button" id="camagain">Keep watching</button>');
      var again = $('camagain'); if (again) again.addEventListener('click', function () { playCam(b, i); });
    }, CAM_MINUTES * 60 * 1000);
    var giveUp = setTimeout(function () { if (player && player.token === token && v.readyState < 2) offline(); }, 20000);
    player.giveUp = giveUp;
    if (v.canPlayType('application/vnd.apple.mpegurl')) {  // Safari and iPhone play these streams natively
      v.src = c.stream; v.addEventListener('error', offline); v.play().catch(function () {});
      return;
    }
    loadHls().then(function () {
      if (!player || player.token !== token) return;
      if (!window.Hls.isSupported()) { camMsg('This browser cannot play live video.'); return; }
      var h = new window.Hls({ maxBufferLength: 10, liveSyncDurationCount: 2 });
      player.hls = h;
      h.on(window.Hls.Events.ERROR, function (e, data) { if (data.fatal) offline(); });
      h.loadSource(c.stream); h.attachMedia(v);
      h.on(window.Hls.Events.MANIFEST_PARSED, function () { v.play().catch(function () {}); });
    }).catch(function () { camMsg('The video player could not be loaded. Check your connection.'); });
  }
  function stopCam() {
    clearTimeout(camStopTimer);
    if (!player) return;
    clearTimeout(player.giveUp);
    if (player.hls) { try { player.hls.destroy(); } catch (e) {} }
    try { player.video.pause(); player.video.removeAttribute('src'); player.video.load(); } catch (e) {}
    player = null;
  }

  function addCamLayer() {
    if (!CAMS) return;
    // Gold square with a navy border, drawn once and used as the camera marker.
    var size = 32, cv = document.createElement('canvas'); cv.width = cv.height = size;
    var x = cv.getContext('2d');
    x.fillStyle = '#002855'; x.beginPath(); x.roundRect(3, 3, 26, 26, 6); x.fill();
    x.fillStyle = '#EAAA00'; x.beginPath(); x.roundRect(6, 6, 20, 20, 4); x.fill();
    x.fillStyle = '#002855'; x.fillRect(9, 12, 10, 8); x.beginPath(); x.moveTo(19, 16); x.lineTo(24, 12); x.lineTo(24, 20); x.closePath(); x.fill();
    map.addImage('cam-icon', x.getImageData(0, 0, size, size), { pixelRatio: 2 });
    var feats = Object.keys(CAMS.cams).filter(function (id) { return CAM_BRIDGES[id]; }).map(function (id) {
      var c = cam(id); return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { id: id } };
    });
    map.addSource('cams', { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
    map.addLayer({
      id: 'cams', type: 'symbol', source: 'cams', minzoom: 7,
      layout: { 'icon-image': 'cam-icon', 'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.75, 12, 1.1], 'icon-allow-overlap': true }
    });
    map.on('mouseenter', 'cams', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cams', function () { map.getCanvas().style.cursor = ''; });
    map.on('click', 'cams', function (e) {
      var id = e.features[0].properties.id, c = cam(id);
      var list = (CAM_BRIDGES[id] || []).slice().sort(function (a, b) { return a[1] - b[1]; });
      var html = '<div class="pop"><div class="t">' + esc(c.name) + '</div><div class="cl">' +
        '<small>WV511 camera ' + esc(id) + '. Bridges that show this camera:</small>' +
        list.map(function (r) { var b = BY_ID[r[0]]; return '<a data-id="' + esc(b.id) + '"><span class="pill" style="background:' + COND_COLOR[b.cond] + '">' + COND[b.cond] + '</span> ' + esc(b.name) + ' <small>(' + r[1] + ' mi)</small></a>'; }).join('') +
        '</div></div>';
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ offset: 14, maxWidth: '320px' }).setLngLat([c.lon, c.lat]).setHTML(html).addTo(map);
      popup.getElement().querySelectorAll('a[data-id]').forEach(function (a) { a.addEventListener('click', function () { select(a.dataset.id, true); }); });
      e.preventDefault();
    });
  }

  /* ---------- Layers ---------- */
  function addLayers(counties, outline) {
    map.addSource('counties', { type: 'geojson', data: counties });
    map.addSource('outline', { type: 'geojson', data: outline });
    map.addSource('bridges', { type: 'geojson', data: toGeo(shown) });
    map.addLayer({ id: 'county-lines', type: 'line', source: 'counties', paint: { 'line-color': '#ffffff', 'line-opacity': 0.35, 'line-width': 0.8 } });
    map.addLayer({ id: 'wv-outline', type: 'line', source: 'outline', paint: { 'line-color': '#EAAA00', 'line-width': 2.2 } });
    var rad = function (add) { return ['interpolate', ['linear'], ['zoom'], 6, 2.6 + add, 9, 4.5 + add, 12, 7 + add, 15, 10 + add]; };
    var r = rad(0);
    map.addLayer({
      id: 'scour', type: 'circle', source: 'bridges', minzoom: 8.5, filter: ['==', ['get', 'scour'], 1],
      paint: { 'circle-radius': rad(3), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 2.2 }
    });
    map.addLayer({
      id: 'bridges', type: 'circle', source: 'bridges',
      layout: { 'circle-sort-key': ['get', 'cond'] },
      paint: {
        'circle-radius': r,
        'circle-color': ['match', ['get', 'cond'], 0, COND_COLOR[0], 1, COND_COLOR[1], COND_COLOR[2]],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.5]
      }
    });
    map.addLayer({
      id: 'selected', type: 'circle', source: 'bridges', filter: ['==', ['get', 'id'], ''],
      paint: { 'circle-radius': rad(5), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#EAAA00', 'circle-stroke-width': 3.5 }
    });
    map.on('click', 'bridges', function (e) {
      if (map.getLayer('cams') && map.queryRenderedFeatures(e.point, { layers: ['cams'] }).length) return;  // camera marker on top wins
      select(e.features[0].properties.id, false);
    });
    map.on('mouseenter', 'bridges', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'bridges', function () { map.getCanvas().style.cursor = ''; });
  }

  /* ---------- Wire up ---------- */
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function wire() {
    $('about-open').addEventListener('click', function () { $('about').showModal(); });
    $('about-close').addEventListener('click', function () { $('about').close(); });
    $('about').addEventListener('click', function (e) { if (e.target === $('about')) $('about').close(); });
    document.querySelectorAll('.tabs button').forEach(function (t) { t.addEventListener('click', function () { showTab(t.dataset.tab); }); });
    $('cty-sort').addEventListener('change', renderSummary);
    $('w-min').addEventListener('change', renderWatch);
    $('w-csv').addEventListener('click', watchCsv);
    document.querySelectorAll('#wt th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.k;
        watchSort = { k: k, dir: watchSort.k === k ? -watchSort.dir : (k === 'name' || k === 'county' ? 1 : -1) };
        renderWatch();
      });
    });
    $('dl-kml').addEventListener('click', function () { doDownload('kml'); });
    $('dl-xlsx').addEventListener('click', function () { doDownload('xlsx'); });
    $('wt').querySelector('tbody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]'); if (!tr) return;
      showTab('map'); select(tr.dataset.id, true);
    });
    $('back').addEventListener('click', clearSelection);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && selectedId && !$('about').open && !e.target.closest('input,select')) clearSelection(); });
    $('q').addEventListener('input', debounce(function () { apply(false); }, 200));
    $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { apply(true); if (shown.length === 1) select(shown[0].id, true); } });
    ['f-cond', 'f-type', 'f-year', 'f-owner', 'f-scour', 'f-cam'].forEach(function (id) { $(id).addEventListener('change', function () { apply(false); }); });
    ['f-county', 'f-route'].forEach(function (id) { $(id).addEventListener('change', function () { apply(true); }); });
    $('clear').addEventListener('click', function () {
      $('q').value = '';
      ['f-cond', 'f-county', 'f-route', 'f-type', 'f-year', 'f-owner'].forEach(function (id) { $(id).value = ''; });
      $('f-scour').checked = false;
      $('f-cam').checked = false;
      apply(false); homeView();
    });
    $('list').addEventListener('click', function (e) { var li = e.target.closest('li[data-id]'); if (li) select(li.dataset.id, true); });
    $('list').addEventListener('keydown', function (e) { var li = e.target.closest('li[data-id]'); if (li && e.key === 'Enter') select(li.dataset.id, true); });
    $('b-3d').addEventListener('click', function () { set3D(!is3D); });
    $('b-home').addEventListener('click', homeView);
    document.querySelectorAll('.basemap button').forEach(function (btn) { btn.addEventListener('click', function () { setBase(btn.dataset.base); }); });
  }

  // Start as soon as the map style is ready. Waiting for the 'load' event also waits for every
  // background tile, and when USGS returns errors for some tiles that event can stall indefinitely.
  var dataReady = load(), started = false;
  function start() {
    if (started) return;
    started = true;
    dataReady.then(function (res) {
      prepare(res[0]);
      attachCams(res[3]);
      countyBounds(res[1]);
      fillFilters();
      $('asof').textContent = META.source + ' · ' + fmt(ALL.length) + ' bridges';
      $('src').textContent = 'Source: ' + META.source + '.';
      var camDate = CAMS && CAMS.checked ? new Date(CAMS.checked).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'not available';
      $('ab-src').textContent = 'the ' + META.source.replace('FHWA ', '');
      $('ab-cam').textContent = camDate;
      $('asof2').textContent = 'Bridge data file built ' + META.built + '; cameras checked ' + camDate + '.';
      shown = ALL.slice();
      addLayers(res[1], res[2]);
      addCamLayer();
      set3D(true);
      wire();
      apply(false);
      $('loading').hidden = true;
      var m = location.hash.match(/bridge=([^&]+)/);
      var linked = m ? decodeURIComponent(m[1]) : null;
      if (linked && BY_ID[linked]) select(linked, true);
      else {
        homeView();
        if (linked) {
          // A saved link to a bridge that is not in the current federal file (replaced, removed or renumbered).
          history.replaceState(null, '', location.pathname + location.search);
          var n = $('linknote');
          if (n) {
            n.textContent = 'Bridge ' + linked + ' is not in the ' + (META.edition || 'current') + ' federal bridge file, so it is not on the map. It may have been replaced, removed or given a new ID.';
            n.hidden = false; setTimeout(function () { n.hidden = true; }, 15000);
          }
        }
      }
    }).catch(function (err) {
      var el = $('loading');
      el.textContent = 'The bridge data could not be loaded. Refresh the page to try again.';
      el.classList.add('err');
      console.error(err);
    });
  }
  map.on('style.load', start);
  map.on('load', start);
  if (map.isStyleLoaded()) start();
  // Safety net: if the map has not drawn after a few seconds, ask it to redraw.
  [3000, 7000].forEach(function (ms) {
    setTimeout(function () { if (!$('loading').hidden || !started) { map.resize(); map.triggerRepaint(); if (!started && map.isStyleLoaded()) start(); } }, ms);
  });

  // If the labeled satellite map keeps failing at USGS, switch to Photo only and say so.
  var baseChosen = false, hybridErrors = 0, baseNoteShown = false;
  document.querySelectorAll('.basemap button').forEach(function (btn) { btn.addEventListener('click', function () { baseChosen = true; hideBaseNote(); }); });
  function hideBaseNote() { var n = $('basenote'); if (n) n.hidden = true; }
  // The map library ignores 'not found' tiles silently, so check the USGS service directly:
  // a quick test of three statewide tiles at startup, plus a count of failed tiles while browsing
  // (browsers that report tile status, such as Chrome and Edge).
  function hybridFailing() {
    if (baseChosen || baseNoteShown) return;
    if (!map.getLayer('hybrid') || map.getLayoutProperty('hybrid', 'visibility') === 'none') return;
    baseNoteShown = true;
    setBase('photo');
    var n = $('basenote');
    if (n) {
      n.innerHTML = 'The labeled satellite map isn\u2019t loading from USGS right now, so the map is showing <b>Photo only</b>. You can switch back with the buttons above.';
      n.hidden = false; setTimeout(hideBaseNote, 15000);
    }
  }
  var probes = ['7/48/35', '7/48/36', '7/49/35'].map(function (t) {
    return fetch(USGS + 'USGSImageryTopo/MapServer/tile/' + t, { mode: 'cors', cache: 'no-store' })
      .then(function (r) { return r.ok; }, function () { return false; });
  });
  Promise.all(probes).then(function (ok) {
    if (ok.filter(function (x) { return !x; }).length >= 2) {
      if (started && map.isStyleLoaded()) hybridFailing(); else map.once('style.load', hybridFailing);
    }
  });
  if (window.PerformanceObserver) {
    try {
      new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) {
          if (e.name.indexOf('USGSImageryTopo') !== -1 && e.responseStatus >= 400) { hybridErrors++; if (hybridErrors >= 8) hybridFailing(); }
        });
      }).observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }
})();
