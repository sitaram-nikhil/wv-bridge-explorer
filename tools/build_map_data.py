"""Slim map file + WV/county outlines for the static site. Reads only tools/work/bridges.json (bridge records)."""
import json, re, os, pandas as pd, geopandas as gpd
import bridge_record as br
OUT = br.ROOT + 'data/'
D = br.load(); B = D['bridges']
def tgroup(t):
    for k in ('Culvert', 'Slab', 'Arch', 'Truss'):
        if t.startswith(k): return k
    if 'Box' in t: return 'Box beam'
    if t in ('Beam or girder', 'Girder and floorbeam', 'Tee beam', 'Channel beam'): return 'Beam or girder'
    return 'Other'
TYPES = ['Beam or girder', 'Box beam', 'Slab', 'Arch', 'Truss', 'Culvert', 'Other']
rows = []
for b in B:
    rows.append([b['id'], re.sub(r'\b(Wv|Us|Cr|Sr)(?=\d)', lambda m: m.group(1).upper(), b['name']), b['county'], b['route'],
                 br.ROUTE_CLASSES.index(b['route_class']), b['lat'], b['lon'], 'GFP'.index(b['overall'][0]), TYPES.index(tgroup(b['type'])),
                 1 if b['wvdoh'] else 0, b['owner'], b['year_built'], b['adt'], 1 if b['scour_risk'] else 0,
                 {'': 0, 'Not in listed county': 1, 'No location': 2, 'Outside WV': 1}[b['loc_flag']],
                 1 if (b['adt'] or 0) > 200000 else 0,  # WV's busiest bridges carry ~135k/day; above 200k is a data-entry error
                 b['type'], b['location'], b['common_name']])
meta = {'source': D['source'], 'edition': D['edition'], 'built': pd.Timestamp.today().strftime('%Y-%m-%d'),
        'fields': ['id', 'name', 'county', 'route', 'routeClass', 'lat', 'lon', 'cond', 'type', 'wvdoh', 'owner', 'year', 'adt', 'scour',
                   'locFlag', 'adtOdd', 'typeName', 'place', 'alias'],
        'routeClasses': br.ROUTE_CLASSES, 'conditions': ['Good', 'Fair', 'Poor'], 'types': TYPES}
json.dump({'meta': meta, 'rows': rows}, open(OUT + 'bridges-map.json', 'w'), separators=(',', ':'))
c = gpd.read_file('zip://' + br.RAW + 'counties.zip'); c = c[c.STATEFP == '54'][['NAME', 'geometry']].to_crs(4326)
st = c.dissolve().boundary.simplify(0.002).to_frame('geometry')  # outline from full-detail counties, so no slivers
c['geometry'] = c.geometry.simplify(0.003, preserve_topology=True)
c.to_file(OUT + 'counties.geojson', driver='GeoJSON', COORDINATE_PRECISION=4); st.to_file(OUT + 'wv-outline.geojson', driver='GeoJSON', COORDINATE_PRECISION=4)
R = pd.DataFrame(rows, columns=meta['fields'])
print('map:', len(R), 'bridges', R.cond.value_counts().sort_index().to_dict(), '| routes parsed', (R.route != '').sum(),
      '|', os.path.getsize(OUT + 'bridges-map.json') // 1024, 'KB')
