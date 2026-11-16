/* WV Bridge Explorer, Step 7: build download files in the browser (no server needed).
   BridgeExport.kml(rows, info)  -> Promise<Blob> (Google Earth .kmz)
   BridgeExport.xlsx(rows, cols, about) -> Promise<Blob> (Excel .xlsx) */
(function (root) {
  'use strict';

  function xml(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- Google Earth (.kml) ---------- */
  var KML_COLOR = { Good: 'ff408e2e', Fair: 'ff0c59e8', Poor: 'ff1c1cb9' };  // KML colors are aabbggrr
  function kml(rows, info) {
    var out = ['<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
      '<name>' + xml(info.title) + '</name>',
      '<description>' + xml(info.description) + '</description>'];
    Object.keys(KML_COLOR).forEach(function (c) {
      out.push('<Style id="' + c + '"><IconStyle><color>' + KML_COLOR[c] + '</color><scale>0.9</scale>' +
        '<Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle>' +
        '<LabelStyle><scale>0</scale></LabelStyle></Style>');
    });
    ['Poor', 'Fair', 'Good'].forEach(function (c) {
      var list = rows.filter(function (r) { return r.cond === c && r.lat != null; });
      out.push('<Folder><name>' + c + ' (' + list.length.toLocaleString('en-US') + ')</name>' + (c === 'Good' ? '<visibility>1</visibility>' : ''));
      list.forEach(function (r) {
        out.push('<Placemark><name>' + xml(r.name) + '</name><styleUrl>#' + c + '</styleUrl>' +
          '<description><![CDATA[' + String(r.html).replace(/]]>/g, ']]&gt;') + ']]></description>' +
          '<Point><coordinates>' + r.lon + ',' + r.lat + ',0</coordinates></Point></Placemark>');
      });
      out.push('</Folder>');
    });
    out.push('</Document></kml>');
    // Packed as .kmz (a zipped .kml), about a tenth of the size; Google Earth opens it directly.
    return zip([{ name: 'doc.kml', text: out.join('\n') }], 'application/vnd.google-earth.kmz');
  }

  /* ---------- zip (for .xlsx) ---------- */
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('deflate-raw');
      var stream = new Blob([u8]).stream().pipeThrough(cs);
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function zip(files, type) {  // files: [{name, text}] -> Promise<Blob>
    var enc = new TextEncoder();
    return Promise.all(files.map(function (f) {
      var raw = enc.encode(f.text);
      return deflate(raw).then(function (z) {
        var useZ = z && z.length < raw.length;
        return { name: enc.encode(f.name), raw: raw, data: useZ ? z : raw, method: useZ ? 8 : 0, crc: crc32(raw) };
      });
    })).then(function (items) {
      var parts = [], central = [], offset = 0;
      var d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      items.forEach(function (it) {
        var h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, it.method, true);
        h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, it.crc, true);
        h.setUint32(18, it.data.length, true); h.setUint32(22, it.raw.length, true); h.setUint16(26, it.name.length, true); h.setUint16(28, 0, true);
        parts.push(new Uint8Array(h.buffer), it.name, it.data);
        var c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, it.method, true);
        c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, it.crc, true);
        c.setUint32(20, it.data.length, true); c.setUint32(24, it.raw.length, true); c.setUint16(28, it.name.length, true);
        c.setUint32(42, offset, true);
        central.push(new Uint8Array(c.buffer), it.name);
        offset += 30 + it.name.length + it.data.length;
      });
      var csize = central.reduce(function (s, p) { return s + p.length; }, 0);
      var e = new DataView(new ArrayBuffer(22));
      e.setUint32(0, 0x06054b50, true); e.setUint16(8, items.length, true); e.setUint16(10, items.length, true);
      e.setUint32(12, csize, true); e.setUint32(16, offset, true);
      return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    });
  }

  /* ---------- Excel (.xlsx) ---------- */
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function cell(ref, v, style) {
    var s = style ? ' s="' + style + '"' : '';
    if (v == null || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
  }
  var NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  // styles: 0 normal, 1 header, 2 whole number with commas, 3 wrapped text, 4 bold title, 5 one decimal
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>' +
    '<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FF002855"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF002855"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function xlsx(rows, cols, about) {
    var last = colName(cols.length - 1), n = rows.length + 1;
    var sd = ['<row r="1" ht="30" customHeight="1">' + cols.map(function (c, i) { return cell(colName(i) + '1', c.h, 1); }).join('') + '</row>'];
    rows.forEach(function (r, ri) {
      var rn = ri + 2;
      sd.push('<row r="' + rn + '">' + cols.map(function (c, i) {
        var v = r[c.k];
        return cell(colName(i) + rn, v, c.num === 'int' && typeof v === 'number' ? 2 : c.num === 'dec' && typeof v === 'number' ? 5 : 0);
      }).join('') + '</row>');
    });
    var sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ' + NS + '>' +
      '<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="13.2"/>' +
      '<cols>' + cols.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.w || 14) + '" customWidth="1"/>'; }).join('') + '</cols>' +
      '<sheetData>' + sd.join('') + '</sheetData>' +
      '<autoFilter ref="A1:' + last + n + '"/></worksheet>';
    var ab = about.map(function (line, i) {
      return '<row r="' + (i + 1) + '">' + cell('A' + (i + 1), line[0], i === 0 ? 4 : 3) + cell('B' + (i + 1), line[1], 3) + '</row>';
    }).join('');
    var sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ' + NS + '>' +
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="13.2"/>' +
      '<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="110" customWidth="1"/></cols>' +
      '<sheetData>' + ab + '</sheetData></worksheet>';
    var files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ' + NS + '>' +
        '<bookViews><workbookView/></bookViews><sheets><sheet name="Bridges" sheetId="1" r:id="rId1"/><sheet name="About" sheetId="2" r:id="rId2"/></sheets>' +
        '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Bridges!$A$1:$' + last + '$' + n + '</definedName></definedNames></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: STYLES },
      { name: 'xl/worksheets/sheet1.xml', text: sheet1 },
      { name: 'xl/worksheets/sheet2.xml', text: sheet2 }
    ];
    return zip(files);
  }

  root.BridgeExport = { kml: kml, xlsx: xlsx };
})(typeof window !== 'undefined' ? window : globalThis);
