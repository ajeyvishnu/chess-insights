/* Standalone data loader.
   The dashboard code (app.js) was written for the Tableau Extensions API. On GitHub Pages there is no Tableau,
   so this file exposes ChessData.getSources() and a field-projected CSV reader.
   The standalone app uses that reader instead of Tableau initialization and live queries.
   Chart calculations and design are preserved from the Tableau version.
   To refresh the data: replace the two CSV files in /data with new exports (same columns) and commit. */
(function () {
  function parseCSV(t) {
    t = t.replace(/^﻿/, '');
    var rows = [], r = [], f = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { r.push(f); f = ''; }
      else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f || r.length) { r.push(f); rows.push(r); }
    return rows;
  }
  var TEXT = ['game_url', 'ended_at_utc', 'game_date_et', 'color', 'opponent_username', 'game_result', 'time_control', 'Game_Type', 'opening_eco', 'opening_url', 'Reason', 'termination', 'phase'];
  function source(name, file) {
    var cache = null;
    return {
      name: name, id: name,
      readMetadataAsync: function () { return Promise.resolve({ data: [] }); },
      queryAsync: function (q) {
        cache = cache || fetch(file).then(function (r) { if (!r.ok) throw new Error('Could not load ' + file + ' (' + r.status + ')'); return r.text(); }).then(parseCSV);
        return cache.then(function (rows) {
          var hd = rows[0], ix = {};
          hd.forEach(function (h, i) { ix[h] = i; });
          var caps = q.fields.map(function (f) { return f.fieldCaption; });
          var missing = caps.filter(function (c) { return ix[c] === undefined; });
          if (missing.length) throw new Error(file + ' is missing columns: ' + missing.join(', '));
          return {
            data: rows.slice(1).filter(function (r) { return r.length > 1; }).map(function (r) {
              var o = {};
              caps.forEach(function (c) { var v = r[ix[c]]; o[c] = (v === '' || v === undefined) ? null : (TEXT.indexOf(c) >= 0 ? v : Number(v)); });
              return o;
            })
          };
        });
      }
    };
  }
  var list = [source('Chess Games', 'data/chess_blender_analysis.csv'), source('Chess Move Timing', 'data/chess_move_timing.csv')];
  window.ChessData = { getSources: function () { return list; } };
})();
