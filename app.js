(function () {
  'use strict';
  var root = document.getElementById('app');
  var NS = 'http://www.w3.org/2000/svg';
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- tiny DOM helpers (textContent only; no innerHTML with data) ----------
  function mk(ns, tag, attrs, kids) {
    var e = ns ? document.createElementNS(NS, tag) : document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c === null || c === undefined) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function h(tag, a, k) { return mk(false, tag, a, k); }
  function s(tag, a, k) { return mk(true, tag, a, k); }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
  function fmtN(n) { return Math.round(n).toLocaleString('en-US'); }
  function pct(a, b, d) { return b ? (100 * a / b).toFixed(d === undefined ? 1 : d) + '%' : '—'; }
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) { var p = d.split('-'); return MN[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
  function median(a) { if (!a.length) return null; var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // usable chart width inside a full-width card (re-measured on every draw, so charts fit any screen)
  function CW() { return Math.max(280, (els.content ? els.content.clientWidth : 700) - 34); }

  // ---------- state ----------
  var state = { theme: 'night', chapter: 'king', year: 'all', fmt: 'all', side: 'all', sel: {}, ratingMode: 'mean', timingFmt: 'all' };
  try { var tp = window.localStorage.getItem('chess.theme'); if (tp === 'day' || tp === 'night') state.theme = tp; } catch (e) { }
  var D = { games: [], timing: [], maxDate: '', loadedAt: '' };
  var animSeen = {}, kpiToken = 0;

  // ---------- data ----------
  function extractData(r) { return r && Array.isArray(r.data) ? r.data : []; }
  var GAME_FIELDS = ['game_url', 'ended_at_utc', 'game_date_et', 'color', 'opponent_username', 'game_result', 'time_control', 'Game_Type', 'opening_eco', 'opening_url', 'Reason', 'termination', 'player_rating', 'opponent_rating', 'pgn_plies', 'pgn_move_pairs', 'base_seconds', 'increment_seconds', 'my_first_move_at_or_under_10_seconds', 'my_last_clock_seconds', 'opp_last_clock_seconds'];
  ['opening', 'middlegame', 'late_game'].forEach(function (p) { ['my_moves', 'my_captures', 'my_checks', 'opp_moves', 'opp_captures', 'opp_checks'].forEach(function (m) { GAME_FIELDS.push(p + '_' + m); }); });
  var TIMING_FIELDS = ['game_url', 'phase', 'in_check_before_move', 'under_10_seconds_before_move', 'timed_moves', 'estimated_seconds_spent'];
  function fq(list) { return { fields: list.map(function (f) { return { fieldCaption: f }; }) }; }
  function findDs(list, name) { var f = null; (list || []).forEach(function (d) { if (d && d.name === name) f = d; }); return f; }

  var hourFmt = null;
  try { hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }); } catch (e) { hourFmt = null; }
  function etHour(t) {
    if (isNaN(t)) return null;
    if (hourFmt) { var p = hourFmt.formatToParts(new Date(t)); for (var i = 0; i < p.length; i++) if (p[i].type === 'hour') return (+p[i].value) % 24; }
    return new Date(t - 5 * 3600 * 1000).getUTCHours();
  }
  function reasonNorm(r) {
    r = (r || '').toLowerCase();
    if (r.indexOf('abandon') >= 0) return 'Abandoned';
    if (r.indexOf('timeout vs') >= 0) return 'Timeout vs insufficient material';
    if (r.indexOf('on time') >= 0) return 'On time';
    if (r.indexOf('insufficient') >= 0) return 'Insufficient material';
    if (!r) return 'Unknown';
    return r.charAt(0).toUpperCase() + r.slice(1);
  }
  function openingName(u) {
    if (!u) return 'Unknown opening';
    var sl = String(u).split('/openings/').pop().split('?')[0], parts = sl.split('-'), o = [];
    for (var i = 0; i < parts.length; i++) { if (/^\d+\./.test(parts[i])) break; o.push(parts[i]); }
    var n = o.join(' ').replace(/\.\.\..*$/, '').trim();
    return n || 'Unknown opening';
  }
  // first few plies of the opening line from the Chess.com slug, e.g. "1. e4 c5"
  function openingMoves(u) {
    if (!u) return '';
    var parts = String(u).split('/openings/').pop().split('?')[0].split('-'), out = [], on = false;
    for (var i = 0; i < parts.length && out.length < 4; i++) {
      var p = parts[i];
      if (/^\d+\./.test(p)) on = true;
      if (!on || /^\.+/.test(p) || /^\d+$/.test(p)) continue;
      var m = /^(\d+)\.(\.\.)?(.+)$/.exec(p);
      out.push(m ? (m[2] ? m[1] + '... ' : m[1] + '. ') + m[3] : p);
    }
    return out.join(' ');
  }
  function weekStart(d) {
    var p = d.split('-'), t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])), wd = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - wd);
    return t.toISOString().slice(0, 10);
  }
  // The live query may hand dates back as ISO date, ISO datetime, "YYYY-MM-DD hh:mm:ss", a Date or a number: accept all.
  function normDate(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var t = Date.parse(s);
    if (isNaN(t)) return '';
    var dt = new Date(t);
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return dt.getFullYear() + '-' + z(dt.getMonth() + 1) + '-' + z(dt.getDate());
  }
  function parseUtc(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    return Date.parse(s);
  }
  function prep(r) {
    var d = normDate(r.game_date_et), p = d.split('-');
    var g = {
      id: r.game_url, utc: parseUtc(r.ended_at_utc), date: d, year: +p[0], month: d.slice(0, 7),
      wd: (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7, hour: etHour(parseUtc(r.ended_at_utc)),
      week: weekStart(d), color: r.color, res: r.game_result, fmt: r.Game_Type ? r.Game_Type : 'Unknown',
      me: +r.player_rating, opp: +r.opponent_rating, pairs: +r.pgn_move_pairs, plies: +r.pgn_plies,
      reason: reasonNorm(r.Reason), tc: r.time_control, open: openingName(r.opening_url), openUrl: r.opening_url, moves: openingMoves(r.opening_url),
      cross: (r.my_first_move_at_or_under_10_seconds === null || r.my_first_move_at_or_under_10_seconds === '' || r.my_first_move_at_or_under_10_seconds === undefined) ? null : +r.my_first_move_at_or_under_10_seconds,
      ph: {}
    };
    g.gap = g.opp - g.me;
    ['opening', 'middlegame', 'late_game'].forEach(function (k) { g.ph[k] = { mv: +r[k + '_my_moves'] || 0, cap: +r[k + '_my_captures'] || 0, chk: +r[k + '_my_checks'] || 0 }; });
    return g;
  }

  // ---------- scope ----------
  function inScope(g, skipYear) {
    return (skipYear || state.year === 'all' || g.year === +state.year) && (state.fmt === 'all' || g.fmt === state.fmt) && (state.side === 'all' || g.color === state.side);
  }
  function scope(skipYear) { return D.games.filter(function (g) { return inScope(g, skipYear); }); }
  function tally(a) { var t = { n: a.length, W: 0, L: 0, D: 0 }; a.forEach(function (g) { if (g.res === 'Win') t.W++; else if (g.res === 'Loss') t.L++; else t.D++; }); return t; }
  function days(a) { var o = {}; a.forEach(function (g) { o[g.date] = 1; }); return Object.keys(o).length; }
  function groupBy(a, f) { var m = {}; a.forEach(function (g) { var k = f(g); (m[k] = m[k] || []).push(g); }); return m; }
  function scopeLabel() {
    var y = state.year === 'all' ? 'All years' : state.year + (+state.year === 2026 ? ' (partial)' : '');
    return y + ' | ' + (state.fmt === 'all' ? 'All formats' : state.fmt) + ' | ' + (state.side === 'all' ? 'Both sides' : state.side);
  }
  var GAPB = [['Opp ≥100 lower', function (x) { return x <= -100; }], ['Opp 26–99 lower', function (x) { return x < -25 && x > -100; }], ['Within ±25', function (x) { return x >= -25 && x <= 25; }], ['Opp 26–99 higher', function (x) { return x > 25 && x < 100; }], ['Opp ≥100 higher', function (x) { return x >= 100; }]];


  // ---------- plain-language help shown behind the (i) button on every card ----------
  var INFO = {
    'king-games': 'Every game you played on Chess.com within the filters above. Won, drawn and lost add up to the total. Win rate = wins ÷ all games (a draw is not a win). Active days = days with at least one game.',
    'king-side': 'In chess one player moves first and plays the white pieces; the other plays black. Moving first gives white a small built-in advantage. These panels compare your results with each colour. ✓ = games won, ✕ = games lost, grey = draws.',
    'king-fmt': 'Time format = how much time each player gets for the whole game. Bullet: very fast, under 3 minutes each. Blitz: fast, roughly 3 to 10 minutes. Rapid: slower, 10 minutes or more. The panels show your results in each.',
    'king-gap': 'A rating is a number that estimates playing strength (higher = stronger). Gap = your opponent’s rating minus yours. "Opp ≥100 higher" means the opponent was rated at least 100 points above you, so winning is harder; "Opp ≥100 lower" means you were the favourite.',
    'king-ytd': 'Compares each year using only games up to today’s date (Jan 1 to the same calendar day), so the current partial year is not unfairly compared with full years. Ignores the Year filter.',
    'king-reasons': 'How games finished. Checkmate: a king cannot escape attack. Resignation: a player gives up. On time: a player ran out of clock. Abandoned: a player left the game. Stalemate, repetition, agreement and insufficient material are ways to draw.',
    'bishop-list': 'An opening is the first moves of a game. Each row is a named opening you have played, ranked by how often. The results show how often you won, drew and lost with it. "Key move" is the move that defines this variation. Click a row to see its detail.',
    'bishop-d': 'Detail for the opening selected on the left: your overall results, results against stronger and weaker opponents (by rating gap), and how many games you played with it each year.',
    'bishop-year': 'How many games you played with your five most-used openings in each year, to show how your choices have changed over time.',
    'drill': 'The most recent games behind your selection (up to 25). "Gap" is opponent rating minus yours. Use "Game" to replay it on Chess.com.',
    'knight-week': 'Each bar is one week of play. Height = games played that week, split into wins (green), draws (grey) and losses (red). Click a bar to list that week’s games.',
    'knight-month': 'Games played per month, stacked by time format: Bullet (under 3 min), Blitz (about 3-10 min) and Rapid (10+ min).',
    'knight-len': 'A "move pair" is one move by white plus one by black. Games are grouped by length so you can see whether you tend to win short or long games. The median is the middle value.',
    'knight-strip': 'Your last 40 games in order, oldest to newest: green = win, grey = draw, red = loss. The current win streak counts wins in a row up to your latest game.',
    'pawn-line': 'Your rating over time in each format. A rating estimates strength: it goes up when you win and down when you lose. Circles mark your single highest rating in each format. "Monthly mean" smooths the line; "Every game" shows each game.',
    'pawn-ups': 'Upsets are wins against opponents rated higher than you, ranked by the size of the gap. A bigger gap means a more impressive win.',
    'rook-phase': 'Average seconds you spend per move. Opening = moves 1-10, middlegame = moves 11-30, late game = move 31 onwards (a simple split by move number). "In check" means your king was under attack, which forces you to respond.',
    'rook-low': 'Compares how long you think per move when you have more than 10 seconds left on your clock with when you have 10 seconds or less (time trouble).',
    'rook-res': 'Average seconds per move in games you won, drew and lost: does spending more or less time go with the result?',
    'rook-time': '"Reached 10 s or less" = games where your clock dropped to 10 seconds or less at some point. "Lost on time" = you ran out of clock. This shows an association only; it does not prove one causes the other.',
    'rook-cap': 'A capture takes an opponent’s piece; a check attacks the opposing king. Shown per 10 of your moves in each phase as a rough sense of how aggressive your play is.',
    'queen-cal': 'Each square is one day; darker green = more games that day (Eastern time). Click a day or a month name to filter the charts below.',
    'queen-wd': 'Games by day of the week. Bar height = number of games (green wins, grey draws, red losses). The number under each bar is your win rate %.',
    'queen-hr': 'Games by the hour of the day (US Eastern time) the game ended. The number under each bar is your win rate %. Shows when you play most and when you play best.',
    'queen-mo': 'Games played per month. Click a month to filter the charts above.'
  };
  var infoOpen = null;
  function closePops() {
    var had = false;
    Array.prototype.forEach.call(document.querySelectorAll('.infopop.on'), function (p) { p.classList.remove('on'); had = true; });
    Array.prototype.forEach.call(document.querySelectorAll('.info[aria-expanded="true"]'), function (b) { b.setAttribute('aria-expanded', 'false'); });
    return had;
  }
  function addInfo(root2) {
    Array.prototype.forEach.call(root2.querySelectorAll('.card[data-info]'), function (c) {
      var pop = h('div', { class: 'infopop', role: 'note', text: c.getAttribute('data-info') });
      var pawn = s('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true', style: 'max-width:none' }, [s('circle', { cx: 12, cy: 6.2, r: 3.4, fill: 'currentColor' }), s('rect', { x: 8.4, y: 10.2, width: 7.2, height: 1.9, rx: 0.95, fill: 'currentColor' }), s('path', { d: 'M9.9 12.3h4.2l1.1 5.6H8.8z', fill: 'currentColor' }), s('rect', { x: 6.4, y: 18.2, width: 11.2, height: 2.8, rx: 1.4, fill: 'currentColor' })]);
      var b = h('button', { class: 'info', type: 'button', title: 'What is this?', 'aria-label': 'About this chart', 'aria-expanded': 'false', onclick: function (e) { e.stopPropagation(); var open = pop.classList.contains('on'); closePops(); if (!open) { pop.classList.add('on'); b.setAttribute('aria-expanded', 'true'); } } }, [pawn]);
      c.appendChild(b); c.appendChild(pop);
    });
  }
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.infopop')) closePops(); });

  // ---------- animation ----------
  function chartCard(id, key, cls, title, sub) {
    var changed = animSeen[id] !== key; animSeen[id] = key;
    var c = h('section', { class: 'card ' + cls, 'data-anim': changed && !REDUCED ? '1' : '0', 'data-info': INFO[id] || null }, [h('h3', { text: title })]);
    if (sub) c.appendChild(h('p', { class: 'sub', text: sub }));
    return c;
  }
  function runAnims(container) {
    if (REDUCED) return;
    var cards = container.querySelectorAll('[data-anim="1"]');
    var targets = [];
    Array.prototype.forEach.call(cards, function (c) { Array.prototype.forEach.call(c.querySelectorAll('[data-g]'), function (e) { targets.push(e); }); });
    targets.forEach(function (e) {
      var g = e.getAttribute('data-g');
      e.style.transition = 'none';
      if (g === 'x') e.style.transform = 'scaleX(0)';
      else if (g === 'y') e.style.transform = 'scaleY(0)';
      else if (g === 'fade') e.style.opacity = '0';
      else if (g === 'line') { e.style.strokeDasharray = '1'; e.style.strokeDashoffset = '1'; }
      else if (g === 'arc') { e.style.strokeDasharray = '0 1000'; }
    });
    void container.offsetWidth;
    requestAnimationFrame(function () {
      targets.forEach(function (e) {
        var g = e.getAttribute('data-g');
        e.style.transition = 'transform 420ms cubic-bezier(.2,.8,.2,1),opacity 420ms ease,stroke-dashoffset 600ms ease,stroke-dasharray 520ms ease';
        if (g === 'x' || g === 'y') e.style.transform = '';
        else if (g === 'fade') e.style.opacity = '';
        else if (g === 'line') e.style.strokeDashoffset = '0';
        else if (g === 'arc') e.style.strokeDasharray = e.getAttribute('data-dash');
      });
    });
  }
  function countUp(el, to, dec, suffix, instant) {
    var tok = kpiToken, t0 = performance.now();
    function f(v) { return (dec ? v.toFixed(dec) : fmtN(v)) + (suffix || ''); }
    if (REDUCED || instant) { el.textContent = f(to); return; }
    function step(t) {
      if (tok !== kpiToken) return;
      var p = Math.min(1, (t - t0) / 420), e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(to * e);
      if (p < 1) requestAnimationFrame(step); else el.textContent = f(to);
    }
    requestAnimationFrame(step);
  }

  // ---------- components ----------
  function legendWDL() { return h('div', { class: 'legend' }, [h('span', {}, [h('i', { class: 'seg-w' }), 'Win']), h('span', {}, [h('i', { class: 'seg-d' }), 'Draw']), h('span', {}, [h('i', { class: 'seg-l' }), 'Loss'])]); }
  function tipWDL(label, t) { return label + '\n' + fmtN(t.n) + ' games · ' + t.W + 'W ' + t.L + 'L ' + t.D + 'D · win rate ' + pct(t.W, t.n); }
  function hbarList(rows, o) {
    // rows: {label,key,t:{n,W,L,D}}; stacked W/D/L (or single green when o.plain)
    var max = 0; rows.forEach(function (r) { if (r.t.n > max) max = r.t.n; });
    var wrap = h('div', { class: 'fill' });
    rows.forEach(function (r) {
      var segs = [];
      if (o && o.plain) segs.push(h('span', { class: 'seg-g', style: 'width:' + (100 * r.t.n / max) + '%' }));
      else [['W', 'seg-w'], ['D', 'seg-d'], ['L', 'seg-l']].forEach(function (x) { if (r.t[x[0]]) segs.push(h('span', { class: x[1], style: 'width:' + (100 * r.t[x[0]] / max) + '%;' })); });
      var bar = h('div', { class: 'bar', 'data-g': 'x', style: 'width:100%' }, segs);
      // stacked bars scale together: wrapper width proportional to n, children share proportions
      var wsegs = [];
      if (o && o.plain) bar = h('div', { class: 'bar ' + (o.tone === 'Win' ? 'seg-w' : o.tone === 'Loss' ? 'seg-l' : o.tone === 'Draw' ? 'seg-d' : 'seg-g'), 'data-g': 'x', style: 'width:' + (100 * r.t.n / max) + '%' });
      else { bar = h('div', { class: 'bar', 'data-g': 'x', style: 'width:' + (100 * r.t.n / max) + '%' }, [W(r.t.W, 'seg-w'), W(r.t.D, 'seg-d'), W(r.t.L, 'seg-l')].filter(Boolean)); }
      function W(v, c) { return v ? h('span', { class: c, style: 'width:' + (100 * v / r.t.n) + '%' }) : null; }
      var btn = h('button', {
        class: 'row', type: 'button', 'data-tip': tipWDL(r.label, r.t), 'aria-pressed': o && o.onSelect ? (o.selected === r.key ? 'true' : 'false') : null,
        onclick: o && o.onSelect ? function () { o.onSelect(o.selected === r.key ? null : r.key); } : null
      }, [h('span', { class: 'nm', text: r.label }), h('span', { class: 'tr' }, [bar]), h('span', { class: 'ct', text: fmtN(r.t.n) })]);
      if (!(o && o.onSelect)) btn.style.cursor = 'default';
      wrap.appendChild(btn);
    });
    return wrap;
  }
  // ---- Chess.com-Insights-style pieces: badges, rounded W/D/L bar, found-vs-missed rows, yearly area, opening table
  function fmtIcon(f) {
    var P = { Bullet: ['#F0A51C', 'M12 2c3 2.4 4.6 5.8 4.6 9v6.5H7.4V11c0-3.2 1.6-6.6 4.6-9zM7 19h10v3H7z'], Blitz: ['#F7D23E', 'M13.5 2 4.5 13.5h6L9.5 22l10-12.5h-6.5z'], Rapid: ['#81B64C', 'M9 2h6v2.2h-2v1.6a8 8 0 1 1-2 0V4.2H9zM12 9v5.3l3.2 1.9'] };
    var p = P[f] || ['#9298A1', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1 13h2v2h-2zm1-9a3 3 0 0 1 1 5.8c-.7.3-1 .6-1 1.2h-2c0-1.7 1-2.4 1.8-2.8A1 1 0 1 0 11 9H9a3 3 0 0 1 3-2z'];
    var st = f === 'Rapid';
    return s('svg', { class: 'fmti', viewBox: '0 0 24 24', width: 32, height: 32, 'aria-hidden': 'true' }, [s('path', st ? { d: p[1], fill: 'none', stroke: p[0], 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } : { d: p[1], fill: p[0] })]);
  }
  function badge(k, g) { return h('i', { class: 'bd ' + k, text: g }); }
  function wdlBar(t, big) {
    var segs = [];
    [['W', 'seg-w'], ['D', 'seg-d'], ['L', 'seg-l']].forEach(function (x) { if (t[x[0]] && t.n) segs.push(h('span', { class: x[1], style: 'width:' + (100 * t[x[0]] / t.n) + '%' })); });
    return h('div', { class: 'wdl' + (big ? ' big' : ''), 'data-g': 'x', 'data-tip': tipWDL('', t).replace(/^\n/, '') }, segs);
  }
  function insightRows(list, o) {
    var wrap = h('div', { class: 'fill' + (o && o.grid ? ' ir-grid' : '') });
    list.forEach(function (r) {
      if (r.head) { wrap.appendChild(h('div', { class: 'ir-g', text: r.head })); return; }
      var t = r.t;
      if (!t.n) return;
      wrap.appendChild(h('div', { class: 'ir', 'data-tip': tipWDL(r.label, t) }, [
        h('div', { class: 'ir-h' }, [r.icon || null, h('div', {}, [h('div', { class: 'ir-n', text: r.label }), h('div', { class: 'ir-s', text: r.sub || (fmtN(t.n) + ' games') })])]),
        h('div', { class: 'ir-p' }, [h('span', {}, [badge('w', '✓'), h('span', { text: pct(t.W, t.n) })]), h('span', { class: 'dd', text: t.D ? pct(t.D, t.n) + ' drawn' : '' }), h('span', {}, [h('span', { text: pct(t.L, t.n) }), badge('l', '✕')])]),
        wdlBar(t),
        h('div', { class: 'ir-c' }, [h('span', { text: fmtN(t.W) + ' won' }), h('span', { text: fmtN(t.L) + ' lost' })])
      ]));
    });
    return wrap;
  }
  function areaYears(items, o) {
    var host = h('div', { class: 'area-host' });
    host._build = function () { clear(host); var w = host.clientWidth || 720, hh = host.clientHeight || 220; host.appendChild(areaSvg(items, o, w, hh)); };
    return host;
  }
  function areaSvg(items, o, W, H) {
    var m = { l: 46, r: 6, t: 8, b: 24 }, iw = W - m.l - m.r, ih = H - m.t - m.b, max = 1;
    items.forEach(function (i) { if (i.n > max) max = i.n; });
    var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), st = [1, 2, 5, 10].filter(function (x) { return x * mag >= raw; })[0] * mag, top = Math.ceil(max / st) * st;
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, style: 'max-width:none', role: 'img', 'aria-label': 'Games per year' });
    for (var v = 0; v <= top; v += st) { var y = m.t + ih * (1 - v / top); svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: 'var(--line)' })); svg.appendChild(s('text', { x: m.l - 6, y: y + 3, 'text-anchor': 'end', text: fmtN(v) })); }
    var bw = iw / Math.max(1, items.length);
    items.forEach(function (it, i) {
      var hh = ih * it.n / top, on = o.selected === it.key;
      svg.appendChild(s('rect', { class: 'ab' + (on ? ' on' : ''), x: m.l + i * bw, y: m.t + ih - hh, width: bw, height: hh, 'data-g': 'y', style: 'transform-box:fill-box;transform-origin:bottom', 'data-tip': it.tip, onclick: function () { o.onSelect(on ? null : it.key); } }));
      svg.appendChild(s('text', { x: m.l + i * bw + bw / 2, y: H - 7, 'text-anchor': 'middle', text: it.label }));
    });
    return svg;
  }
  function openingTable(rows, o) {
    function mini(k, g, v, n) { return h('span', { class: 'mn' }, [badge(k, g), pct(v, n)]); }
    var tb = h('table', { class: 'ot' }, [h('thead', {}, [h('tr', {}, ['Opening', 'Key move', 'Games', 'Results'].map(function (x, i) { return h('th', { class: i === 2 ? 'num' : '', text: x }); }))])]), b = h('tbody', {});
    rows.forEach(function (r) {
      var t = r.t;
      function pick() { o.onSelect(o.selected === r.key ? null : r.key); }
      b.appendChild(h('tr', { class: 'ot-r' + (o.selected === r.key ? ' sel' : ''), tabindex: '0', 'aria-pressed': o.selected === r.key ? 'true' : 'false', 'data-tip': tipWDL(r.label, t), onclick: pick, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } }, [
        h('td', { class: 'ot-n', text: r.label }), h('td', { class: 'ot-m', text: r.moves }), h('td', { class: 'num', text: fmtN(t.n) }),
        h('td', { class: 'ot-res' }, [h('div', { class: 'ot-p' }, [mini('w', '+', t.W, t.n), mini('d', '=', t.D, t.n), mini('l', '−', t.L, t.n)]), wdlBar(t)])
      ]));
    });
    tb.appendChild(b);
    return tb;
  }
  function vbars(items, o) {
    // items: {label,key,t,rate?}; columns stacked W/D/L scaled to max n
    var max = 1; items.forEach(function (i) { if (i.t.n > max) max = i.t.n; });
    var cols = h('div', { class: 'cols' }), ax = h('div', { class: 'axl' }), rt = h('div', { class: 'axl rate' });
    items.forEach(function (i, ix) {
      var hh = 100 * i.t.n / max;
      var stack = h('div', { class: 'stack', 'data-g': 'y', style: 'height:' + hh + '%' }, [['L', 'seg-l'], ['D', 'seg-d'], ['W', 'seg-w']].map(function (x) { return i.t[x[0]] ? h('div', { class: x[1], style: 'height:' + (100 * i.t[x[0]] / i.t.n) + '%' }) : null; }).filter(Boolean));
      cols.appendChild(h('button', { class: 'col', type: 'button', 'aria-pressed': o.selected === i.key ? 'true' : 'false', 'data-tip': tipWDL(i.tipLabel || i.label, i.t), onclick: function () { o.onSelect(o.selected === i.key ? null : i.key); } }, [stack]));
      ax.appendChild(h('div', { text: (o.every && ix % o.every) ? '' : i.label }));
      rt.appendChild(h('div', { text: o.every && ix % o.every ? '' : (i.t.n ? Math.round(100 * i.t.W / i.t.n) + '' : '–') }));
    });
    return h('div', { class: 'fill vb' }, [cols, ax, o.noRate ? null : rt]);
  }
  function donut(t) {
    var C = 2 * Math.PI * 40, off = 0, svg = s('svg', { viewBox: '0 0 120 120', width: 150, height: 150 });
    [['W', 'var(--win)'], ['D', 'var(--draw)'], ['L', 'var(--loss)']].forEach(function (x) {
      var len = t.n ? C * t[x[0]] / t.n : 0, dash = len + ' ' + (C - len);
      svg.appendChild(s('circle', { cx: 60, cy: 60, r: 40, fill: 'none', stroke: x[1], 'stroke-width': 18, 'data-g': 'arc', 'data-dash': dash, style: 'stroke-dasharray:' + dash + ';stroke-dashoffset:' + (-off) + ';transform:rotate(-90deg);transform-origin:60px 60px', 'data-tip': { W: 'Wins', D: 'Draws', L: 'Losses' }[x[0]] + ': ' + t[x[0]] + ' (' + pct(t[x[0]], t.n) + ')' }));
      off += len;
    });
    svg.appendChild(s('text', { x: 60, y: 64, 'text-anchor': 'middle', style: 'font-size:15px;font-weight:700;fill:var(--text)', text: pct(t.W, t.n) }));
    return svg;
  }
  function lineChart(o) {
    var W = o.w || 720, H = o.h || 220, m = { l: 44, r: 12, t: 10, b: 24 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    function X(v) { return m.l + iw * (v - o.x[0]) / ((o.x[1] - o.x[0]) || 1); }
    function Y(v) { return m.t + ih * (1 - (v - o.y[0]) / ((o.y[1] - o.y[0]) || 1)); }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': o.aria || 'chart' });
    o.yTicks.forEach(function (v) { svg.appendChild(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: 'var(--line)', 'stroke-width': 1 })); svg.appendChild(s('text', { x: m.l - 6, y: Y(v) + 3, 'text-anchor': 'end', text: o.yFmt ? o.yFmt(v) : String(v) })); });
    o.xTicks.forEach(function (t) { svg.appendChild(s('text', { x: X(t.v), y: H - 6, 'text-anchor': 'middle', text: t.l })); });
    o.series.forEach(function (se) {
      if (se.pts.length > 1) svg.appendChild(s('path', { d: se.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(''), fill: 'none', stroke: se.color, 'stroke-width': se.w || 2, pathLength: 1, 'data-g': 'line', 'stroke-linejoin': 'round', 'stroke-dasharray': '1', 'stroke-dashoffset': '0' }));
      if (!se.noDots) se.pts.forEach(function (p) { svg.appendChild(s('circle', { cx: X(p.x), cy: Y(p.y), r: se.pts.length > 60 ? 2.2 : 3.2, fill: se.color, 'data-tip': p.tip, 'data-g': 'fade' })); });
    });
    (o.marks || []).forEach(function (mk2) { svg.appendChild(s('circle', { cx: X(mk2.x), cy: Y(mk2.y), r: 6, fill: 'none', stroke: mk2.color, 'stroke-width': 2, 'data-tip': mk2.tip })); });
    return svg;
  }
  function gamesTable(games, o) {
    o = o || {};
    var tb = h('table', {}, [h('thead', {}, [h('tr', {}, ['Date (ET)', 'Format', 'Side', 'Rating', 'Opp', 'Gap', 'Result', 'Ended', 'Move pairs', ''].map(function (x, i) { return h('th', { class: (i === 3 || i === 4 || i === 5 || i === 8) ? 'num' : '', text: x }); }))])]);
    var b = h('tbody', {});
    games.slice(0, o.limit || 25).forEach(function (g) {
      b.appendChild(h('tr', {}, [h('td', { text: fmtDate(g.date) }), h('td', { text: g.fmt }), h('td', { text: g.color }), h('td', { class: 'num', text: String(g.me) }), h('td', { class: 'num', text: String(g.opp) }), h('td', { class: 'num', text: (g.gap > 0 ? '+' : '') + g.gap }), h('td', {}, [h('span', { class: 'pill ' + g.res, text: g.res })]), h('td', { text: g.reason }), h('td', { class: 'num', text: String(g.pairs) }), h('td', {}, [h('a', { href: g.id, target: '_blank', rel: 'noopener noreferrer', text: 'Game ↗' })])]));
    });
    tb.appendChild(b);
    return tb;
  }
  function drill(grid, title, games, filterText, onClear) {
    var c = h('section', { class: 'card s12', 'data-info': INFO.drill }, [h('h3', {}, [title + ' ', onClear ? h('button', { class: 'clear', type: 'button', text: 'Clear selection', onclick: onClear }) : null]), h('p', { class: 'sub', text: filterText + ' · showing ' + Math.min(25, games.length) + ' most recent of ' + fmtN(games.length) + ' games' })]);
    c.appendChild(games.length ? gamesTable(games.slice().sort(function (a, b) { return b.utc - a.utc; })) : h('div', { class: 'empty', text: 'No games in this selection.' }));
    grid.appendChild(c);
  }
  function setSel(k, v) { if (v === null || v === undefined) delete state.sel[k]; else state.sel[k] = v; draw(); }
  function emptyMsg(grid) { grid.appendChild(h('div', { class: 'card s12 empty', text: 'No games match the current Year / Format / Side filters. Use Reset to clear them.' })); }

  // ---------- chapters ----------
  function kingChapter(grid, sc) {
    var t = tally(sc), ad = days(sc), key = JSON.stringify([state.year, state.fmt, state.side]);
    var hero = h('div', { class: 'hero', text: t.n ? fmtN(t.n) + ' games over ' + fmtN(ad) + ' active days | ' + pct(t.W, t.n) + ' won (' + fmtN(t.W) + ' W, ' + fmtN(t.L) + ' L, ' + fmtN(t.D) + ' D)' : 'No games in this scope.' });
    grid.parentNode.insertBefore(hero, grid);
    if (!t.n) return emptyMsg(grid);
    // ---- Games played: big number, W/D/L badges, stacked bar, games per year
    var gc = chartCard('king-games', key, 's12', 'Games played', scopeLabel() + ' | win rate = W ÷ (W+L+D)');
    var big = h('div', { class: 'v big-n', text: '0' });
    gc.appendChild(h('div', { class: 'bigrow' }, [h('i', { class: 'chk' }), big, h('div', { class: 'l' }, [h('b', { text: fmtN(ad) }), ' active days | ', h('b', { text: (t.n / ad).toFixed(1) }), ' games per active day'])]));
    gc.appendChild(h('div', { class: 'wdl3' }, [['w', '+', 'Won', t.W], ['d', '=', 'Drawn', t.D], ['l', '−', 'Lost', t.L]].map(function (x) {
      return h('div', { class: 'st ' + x[0], 'data-tip': fmtN(x[3]) + ' ' + x[2].toLowerCase() + ' of ' + fmtN(t.n) }, [h('div', { class: 'sp' }, [badge(x[0], x[1]), h('span', { text: pct(x[3], t.n) })]), h('div', { class: 'sl', text: fmtN(x[3]) + ' ' + x[2] })]);
    })));
    gc.appendChild(wdlBar(t, true));
    grid.appendChild(gc);
    var kseen = animSeen['king-kpi'] === key; animSeen['king-kpi'] = key;
    countUp(big, t.n, 0, '', kseen);
    // ---- side card and format card (separate containers, panels side by side)
    var fm = groupBy(sc, function (g) { return g.fmt; }), sd = groupBy(sc, function (g) { return g.color; }), sl = [], fl = [];
    ['White', 'Black'].forEach(function (c) { if (sd[c]) sl.push({ label: c, icon: h('i', { class: 'sd ' + (c === 'White' ? 'sw' : 'sb'), text: '♚' }), t: tally(sd[c]) }); });
    ['Bullet', 'Blitz', 'Rapid'].forEach(function (f) { if (fm[f]) fl.push({ label: f, icon: fmtIcon(f), t: tally(fm[f]) }); });
    var cs = chartCard('king-side', key, 's6', 'White vs Black', 'How you score with each colour | ' + scopeLabel());
    cs.appendChild(insightRows(sl, { grid: true })); grid.appendChild(cs);
    var cf = chartCard('king-fmt', key, 's6', 'Bullet, Blitz and Rapid', 'Results by time format | all formats reconcile: ' + ['Bullet', 'Blitz', 'Rapid', 'Unknown'].filter(function (f) { return fm[f]; }).map(function (f) { return fmtN(fm[f].length); }).join(' + ') + ' = ' + fmtN(t.n) + (fm.Unknown ? ' (' + fm.Unknown.length + ' unknown control)' : ''));
    cf.appendChild(insightRows(fl, { grid: true })); grid.appendChild(cf);
    // ---- rating gap
    var gb = groupBy(sc, function (g) { for (var i = 0; i < GAPB.length; i++) if (GAPB[i][1](g.gap)) return i; return 2; });
    var c3 = chartCard('king-gap', key, 's12', 'Results by opponent rating gap', 'Gap = opponent rating − your rating at game time');
    c3.appendChild(insightRows(GAPB.map(function (b, i) { return { label: b[0], t: tally(gb[i] || []) }; }), { grid: true })); grid.appendChild(c3);
    // ---- YTD recap, ignores year filter
    var all = scope(true), cutoff = D.maxDate.slice(5), yrs = {};
    all.forEach(function (g) { if (g.date.slice(5) <= cutoff) (yrs[g.year] = yrs[g.year] || []).push(g); });
    var ylist = Object.keys(yrs).sort().map(function (y) { return { label: y + (+y === +D.maxDate.slice(0, 4) ? ' (partial)' : ''), sub: fmtN(yrs[y].length) + ' games | ' + fmtN(days(yrs[y])) + ' active days', t: tally(yrs[y]) }; });
    var yc = chartCard('king-ytd', key, 's12', 'Year-to-date, matched cutoff', 'Jan 1 – ' + MN[+cutoff.slice(0, 2) - 1] + ' ' + (+cutoff.slice(3)) + ' each year (Format/Side apply; Year filter does not)');
    yc.appendChild(insightRows(ylist, { grid: true })); grid.appendChild(yc);
    // ---- ending reasons
    var rc = chartCard('king-reasons', key, 's12', 'How games ended', 'Ending reason by result (same filters as everything on this page)');
    var rg = groupBy(sc, function (g) { return g.res; }), cols = h('div', { class: 'grid cols3' });
    [['Win', 'Wins'], ['Loss', 'Losses'], ['Draw', 'Draws']].forEach(function (rs) {
      var arr = rg[rs[0]] || [], by = groupBy(arr, function (g) { return g.reason; }), rows = Object.keys(by).map(function (k) { return { label: k, key: k, t: tally(by[k]) }; }).sort(function (a, b) { return b.t.n - a.t.n; }).slice(0, 4);
      cols.appendChild(h('div', { class: 'rcol' }, [h('div', { class: 'note', text: rs[1] + ' (' + fmtN(arr.length) + ')' }), arr.length ? hbarList(rows, { plain: true, tone: rs[0] }) : h('div', { class: 'note', text: 'None' })]));
    });
    rc.appendChild(cols); grid.appendChild(rc);
  }

  function bishopChapter(grid, sc) {
    var key = JSON.stringify([state.year, state.fmt, state.side]);
    var by = groupBy(sc, function (g) { return g.open; }), rows = Object.keys(by).map(function (k) { return { label: k, key: k, t: tally(by[k]), g: by[k] }; }).sort(function (a, b) { return b.t.n - a.t.n; });
    var hero = h('div', { class: 'hero', text: rows.length ? 'Most played' + (state.side === 'all' ? '' : ' as ' + state.side) + ': ' + rows[0].label + ' | ' + fmtN(rows[0].t.n) + ' games, ' + pct(rows[0].t.W, rows[0].t.n) + ' won' : 'No games in this scope.' });
    grid.parentNode.insertBefore(hero, grid);
    if (!rows.length) return emptyMsg(grid);
    var sel = state.sel.opening && by[state.sel.opening] ? state.sel.opening : rows[0].key;
    function movesOf(g) { var m = ''; function rank(x) { return (/^1\. /.test(x) ? 0 : 1000) + x.length; } g.forEach(function (x) { if (x.moves && (!m || rank(x.moves) < rank(m))) m = x.moves; }); return m || '—'; }
    var c1 = chartCard('bishop-list', key + sel, 's7', 'How you perform in your 10 most played openings', 'Click a row to inspect it | ' + scopeLabel() + (state.side === 'all' ? ' | tip: pick White or Black above for a repertoire per side' : ''));
    c1.appendChild(openingTable(rows.slice(0, 10).map(function (r) { return { label: r.label, key: r.key, t: r.t, moves: movesOf(r.g) }; }), { selected: sel, onSelect: function (k) { setSel('opening', k); } }));
    c1.appendChild(h('p', { class: 'note', text: 'Opening name is read from the Chess.com opening link (name before the move list); Key move = the move that defines the line in the Chess.com link (not the full move list). ' + rows.length + ' distinct lines in scope.' }));
    grid.appendChild(c1);
    var d = h('section', { class: 'card s5', 'data-info': INFO['bishop-d'], 'data-anim': (animSeen['bishop-d'] !== key + sel && !REDUCED) ? '1' : '0' }); animSeen['bishop-d'] = key + sel;
    var r = rows.filter(function (x) { return x.key === sel; })[0], t = r.t;
    d.appendChild(h('h3', { text: r.label }));
    d.appendChild(h('p', { class: 'sub', text: fmtN(t.n) + ' games | ' + t.W + 'W ' + t.L + 'L ' + t.D + 'D | median ' + median(r.g.map(function (g) { return g.pairs; })) + ' move pairs' + (sel === rows[0].key && !state.sel.opening ? ' | showing your most played' : '') }));
    var gb = groupBy(r.g, function (g) { for (var i = 0; i < GAPB.length; i++) if (GAPB[i][1](g.gap)) return i; return 2; });
    var dl = [{ head: 'Overall' }, { label: 'All games', t: t }, { head: 'By opponent rating gap' }].concat(GAPB.map(function (b, i) { return { label: b[0], t: tally(gb[i] || []) }; }));
    d.appendChild(insightRows(dl));
    var yy = groupBy(r.g, function (g) { return g.year; }), yrows = Object.keys(yy).sort().map(function (y) { return { label: y, key: y, t: tally(yy[y]) }; });
    d.appendChild(h('div', { class: 'ir-g', text: 'Repertoire by year (games, W/D/L)' })); d.appendChild(hbarList(yrows, {}));
    var op = r.g.filter(function (g) { return g.openUrl; })[0];
    if (op) d.appendChild(h('p', { class: 'note' }, [h('a', { href: op.openUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Open this line on Chess.com ↗' })]));
    grid.appendChild(d);
    var yc = chartCard('bishop-year', key, 's12', 'Top 5 lines | games per year', 'Repertoire evolution (counts, within filters; ' + (state.year === 'all' ? 'all years' : 'the selected year only') + ')');
    var yrs = Object.keys(groupBy(sc, function (g) { return g.year; })).sort();
    var top5 = rows.slice(0, 5), tbl = h('table', {}, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Opening' })].concat(yrs.map(function (y) { return h('th', { class: 'num', text: y }); })))])]), tbd = h('tbody', {});
    top5.forEach(function (r) { var yg = groupBy(r.g, function (g) { return g.year; }); tbd.appendChild(h('tr', {}, [h('td', { text: r.label })].concat(yrs.map(function (y) { return h('td', { class: 'num', text: fmtN((yg[y] || []).length) }); })))); });
    tbl.appendChild(tbd); yc.appendChild(tbl); grid.appendChild(yc);
    drill(grid, 'Games: ' + sel, by[sel], scopeLabel(), null);
  }

  function knightChapter(grid, sc) {
    var key = JSON.stringify([state.year, state.fmt, state.side]);
    var chron = sc.slice().sort(function (a, b) { return a.utc - b.utc; }), best = { n: 0 }, cur = 0, curStart = 0, i;
    for (i = 0; i < chron.length; i++) {
      if (chron[i].res === 'Win') { if (!cur) curStart = i; cur++; if (cur > best.n) best = { n: cur, a: chron[curStart], b: chron[i] }; } else cur = 0;
    }
    var hero = h('div', { class: 'hero', text: chron.length ? 'Longest winning streak: ' + best.n + ' games' + (best.n ? ' | ' + (best.a.date === best.b.date ? fmtDate(best.a.date) : fmtDate(best.a.date) + ' → ' + fmtDate(best.b.date)) : '') + ' | a draw or loss breaks it' : 'No games in this scope.' });
    grid.parentNode.insertBefore(hero, grid);
    if (!chron.length) return emptyMsg(grid);
    var wk = groupBy(sc, function (g) { return g.week; }), wkeys = Object.keys(wk).sort(), selw = state.sel.week && wk[state.sel.week] ? state.sel.week : null;
    var c1 = chartCard('knight-week', key + selw, 's12', 'Weekly activity', 'Games per week (Monday start, Eastern completion date) · click a bar to list that week · hover for W/L/D');
    c1.appendChild(legendWDL());
    c1.appendChild(vbars(wkeys.map(function (k, ix) { return { label: ix % 8 === 0 ? MN[+k.slice(5, 7) - 1] + ' ' + k.slice(2, 4) : '', tipLabel: 'Week of ' + fmtDate(k), key: k, t: tally(wk[k]) }; }), { selected: selw, onSelect: function (k) { setSel('week', k); }, noRate: true }));
    grid.appendChild(c1);
    var mo = groupBy(sc, function (g) { return g.month; }), mk2 = Object.keys(mo).sort(), maxm = 1;
    mk2.forEach(function (k) { if (mo[k].length > maxm) maxm = mo[k].length; });
    var c2 = chartCard('knight-month', key, 's7', 'Monthly volume by format', 'Games per month, stacked by format');
    c2.appendChild(h('div', { class: 'legend' }, ['Bullet', 'Blitz', 'Rapid', 'Unknown'].map(function (f) { return h('span', {}, [h('i', { style: 'background:var(--' + (f === 'Unknown' ? 'unk' : f.toLowerCase()) + ')' }), f]); })));
    var cols = h('div', { class: 'cols' }), ax = h('div', { class: 'axl' });
    mk2.forEach(function (k, ix) {
      var fg = groupBy(mo[k], function (g) { return g.fmt; });
      cols.appendChild(h('div', { class: 'col', 'data-tip': MN[+k.slice(5) - 1] + ' ' + k.slice(0, 4) + '\n' + mo[k].length + ' games\n' + ['Bullet', 'Blitz', 'Rapid', 'Unknown'].map(function (f) { return f + ': ' + (fg[f] || []).length; }).join(' · ') }, [h('div', { class: 'stack', 'data-g': 'y', style: 'height:' + (100 * mo[k].length / maxm) + '%' }, ['Unknown', 'Rapid', 'Blitz', 'Bullet'].map(function (f) { return (fg[f] || []).length ? h('div', { style: 'height:' + (100 * fg[f].length / mo[k].length) + '%;background:var(--' + (f === 'Unknown' ? 'unk' : f.toLowerCase()) + ')' }) : null; }).filter(Boolean))]));
      ax.appendChild(h('div', { text: (ix % 3 === 0) ? MN[+k.slice(5) - 1] + (k.slice(5) === '01' ? ' ' + k.slice(2, 4) : '') : '' }));
    });
    c2.appendChild(h('div', { class: 'fill vb' }, [cols, ax])); grid.appendChild(c2);
    // game length histogram
    var bins = [], bw = 5, nb = 12;
    for (i = 0; i < nb; i++) bins.push([]);
    sc.forEach(function (g) { var b = Math.min(nb - 1, Math.floor((g.pairs - 1) / bw)); bins[Math.max(0, b)].push(g); });
    var c3 = chartCard('knight-len', key, 's5', 'Game length', 'Move pairs per game (ceil(plies ÷ 2)), bins of 5; last bin = 56+');
    c3.appendChild(legendWDL());
    c3.appendChild(vbars(bins.map(function (b, ix) { return { label: ix % 2 === 0 ? String(ix * bw + 1) : '', key: ix, t: tally(b) }; }), { selected: null, onSelect: function () { }, noRate: true }));
    var med = ['Win', 'Loss', 'Draw'].map(function (r) { var m = median(sc.filter(function (g) { return g.res === r; }).map(function (g) { return g.pairs; })); return r + ' ' + (m === null ? '—' : m); });
    c3.appendChild(h('p', { class: 'note', text: 'Median move pairs: ' + med.join(' · ') }));
    grid.appendChild(c3);
    // last 40 strip + streak card
    var c4 = chartCard('knight-strip', key, 's12', 'Last 40 results in this scope', 'A recent sample (oldest → newest), separate from the longest streak above. Current win streak: ' + (function () { var n = 0; for (var j = chron.length - 1; j >= 0 && chron[j].res === 'Win'; j--) n++; return n; })());
    c4.appendChild(h('div', { class: 'strip' }, chron.slice(-40).map(function (g) { return h('i', { 'data-g': 'fade', style: 'background:var(--' + (g.res === 'Win' ? 'win' : g.res === 'Loss' ? 'loss' : 'draw') + ')', 'data-tip': fmtDate(g.date) + ' · ' + g.res + ' · ' + g.fmt + ' · ' + g.color }); })));
    c4.appendChild(legendWDL()); grid.appendChild(c4);
    var streakGames = best.n ? chron.slice(chron.indexOf(best.a), chron.indexOf(best.b) + 1) : [];
    if (selw) drill(grid, 'Games in week of ' + fmtDate(selw), wk[selw], scopeLabel(), function () { setSel('week', null); });
    else if (streakGames.length) drill(grid, 'The longest winning streak (' + best.n + ' games)', streakGames, scopeLabel(), null);
  }

  function pawnChapter(grid, sc) {
    var key = JSON.stringify([state.year, state.fmt, state.side, state.ratingMode]);
    var fm = groupBy(sc, function (g) { return g.fmt; }), fl = ['Bullet', 'Blitz', 'Rapid', 'Unknown'].filter(function (f) { return fm[f]; });
    var hero = h('div', { class: 'hero', text: fl.length ? 'Peak ratings | ' + fl.map(function (f) { var mx = Math.max.apply(null, fm[f].map(function (g) { return g.me; })); return f + ' ' + mx; }).join(' | ') : 'No games in this scope.' });
    grid.parentNode.insertBefore(hero, grid);
    if (!fl.length) return emptyMsg(grid);
    var c = chartCard('pawn-line', key, 's12', 'Rating over time by format', state.ratingMode === 'mean' ? 'Monthly mean of your rating at game time · circles = single-game peak per format' : 'Your rating after every game · circles = single-game peak per format');
    var tg = h('div', { class: 'toggle' }, [['mean', 'Monthly mean'], ['game', 'Every game']].map(function (m) { return h('button', { type: 'button', 'aria-pressed': state.ratingMode === m[0] ? 'true' : 'false', text: m[1], onclick: function () { state.ratingMode = m[0]; draw(); } }); }));
    c.appendChild(tg);
    var t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity, series = [], marks = [];
    function tv(g) { return g.utc; }
    sc.forEach(function (g) { t0 = Math.min(t0, tv(g)); t1 = Math.max(t1, tv(g)); lo = Math.min(lo, g.me); hi = Math.max(hi, g.me); });
    lo = Math.floor(lo / 100) * 100; hi = Math.ceil(hi / 100) * 100;
    var colr = { Bullet: 'var(--bullet)', Blitz: 'var(--blitz)', Rapid: 'var(--rapid)', Unknown: 'var(--unk)' };
    fl.forEach(function (f) {
      var gs = fm[f].slice().sort(function (a, b) { return a.utc - b.utc; }), pts;
      if (state.ratingMode === 'mean') {
        var mo = groupBy(gs, function (g) { return g.month; });
        pts = Object.keys(mo).sort().map(function (k) { var ms = mo[k], x = Date.UTC(+k.slice(0, 4), +k.slice(5) - 1, 15); return { x: x, y: mean(ms.map(function (g) { return g.me; })), tip: f + ' · ' + MN[+k.slice(5) - 1] + ' ' + k.slice(0, 4) + '\nmean rating ' + mean(ms.map(function (g) { return g.me; })).toFixed(0) + ' (n=' + ms.length + ' games)' }; });
      } else pts = gs.map(function (g) { return { x: g.utc, y: g.me, tip: f + ' · ' + fmtDate(g.date) + '\nrating ' + g.me }; });
      series.push({ name: f, color: colr[f], pts: pts, w: state.ratingMode === 'mean' ? 2.2 : 1.2, noDots: state.ratingMode === 'game' });
      var pk = gs.reduce(function (a, g) { return g.me > a.me ? g : a; }, gs[0]);
      marks.push({ x: pk.utc, y: pk.me, color: colr[f], tip: f + ' single-game peak ' + pk.me + '\n' + fmtDate(pk.date) });
    });
    var xt = [], y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    for (var y = y0; y <= y1 + 1; y++) if (Date.UTC(y, 0, 1) >= t0 - 3e9 && Date.UTC(y, 0, 1) <= t1) xt.push({ v: Date.UTC(y, 0, 1), l: String(y) });
    var yt = []; for (var v = lo; v <= hi; v += 100) yt.push(v);
    c.appendChild(h('div', { class: 'legend' }, fl.map(function (f) { return h('span', {}, [h('i', { style: 'background:' + colr[f] }), f + ' (' + fmtN(fm[f].length) + ' games)']); })));
    c.appendChild(lineChart({ w: CW(), x: [t0, t1], y: [lo, hi], series: series, marks: marks, xTicks: xt, yTicks: yt, h: Math.max(190, Math.min(340, Math.round(CW() * 0.34))), aria: 'Rating by format over time' }));
    grid.appendChild(c);
    var ups = sc.filter(function (g) { return g.res === 'Win' && g.gap > 0; }).sort(function (a, b) { return b.gap - a.gap || a.utc - b.utc; }), top = ups.slice(0, 15);
    var uc = chartCard('pawn-ups', key, 's12', 'Best upsets', top.length ? 'Wins against higher-rated opponents only (gap > 0), ranked by gap · top ' + top.length + ' of ' + fmtN(ups.length) + ' upset wins · these rows span ' + fmtDate(top.reduce(function (a, g) { return g.date < a ? g.date : a; }, top[0].date)) + ' – ' + fmtDate(top.reduce(function (a, g) { return g.date > a ? g.date : a; }, top[0].date)) : 'No upset wins in this scope.');
    if (top.length) {
      var tb = h('table', {}, [h('thead', {}, [h('tr', {}, ['#', 'Date (ET)', 'Format', 'Side', 'You', 'Opponent', 'Gap', 'Ended', 'Move pairs', ''].map(function (x, i) { return h('th', { class: (i === 0 || i >= 4 && i <= 6 || i === 8) ? 'num' : '', text: x }); }))])]), b = h('tbody', {});
      top.forEach(function (g, i) { b.appendChild(h('tr', {}, [h('td', { class: 'num', text: String(i + 1) }), h('td', { text: fmtDate(g.date) }), h('td', { text: g.fmt }), h('td', { text: g.color }), h('td', { class: 'num', text: String(g.me) }), h('td', { class: 'num', text: String(g.opp) }), h('td', { class: 'num', text: '+' + g.gap }), h('td', { text: g.reason }), h('td', { class: 'num', text: String(g.pairs) }), h('td', {}, [h('a', { href: g.id, target: '_blank', rel: 'noopener noreferrer', text: 'Game ↗' })])])); });
      tb.appendChild(b); uc.appendChild(tb);
    }
    grid.appendChild(uc);
  }

  var PH = [['opening', 'Opening', 'Opening'], ['middlegame', 'Middlegame', 'Middlegame'], ['late_game', 'Late game', 'Late game']];
  function rookChapter(grid, sc) {
    var key = JSON.stringify([state.year, state.fmt, state.side]);
    var ids = {}; sc.forEach(function (g) { ids[g.id] = g; });
    var rows = D.timing.filter(function (r) { return ids[r.game_url]; });
    function agg(f) { var n = 0, sec = 0, gs = {}; rows.forEach(function (r) { if (f(r)) { n += r.timed_moves; sec += r.estimated_seconds_spent; gs[r.game_url] = 1; } }); return { n: n, sec: sec, games: Object.keys(gs).length, avg: n ? sec / n : null }; }
    function sv(a) { return a.avg === null ? 'n/a' : a.avg.toFixed(2) + ' s'; }
    var allA = agg(function () { return true; }), lowA = agg(function (r) { return r.under_10_seconds_before_move === 1; }), hiA = agg(function (r) { return r.under_10_seconds_before_move === 0; });
    var hero = h('div', { class: 'hero', text: allA.n ? sv(allA) + ' per move on average (' + fmtN(allA.n) + ' timed moves) | ' + sv(lowA) + ' with ≤10 s left vs ' + sv(hiA) + ' with more' : 'No timed moves in this scope.' });
    grid.parentNode.insertBefore(hero, grid);
    if (!allA.n) return emptyMsg(grid);
    var warn = state.fmt === 'all' ? ' | mixed time controls: pick one Format for like-for-like' : '';
    function mb(label, val, max, color, txt) {
      return h('div', { class: 'mb' }, [h('span', { class: 'mbl', text: label }), h('span', { class: 'mbt' }, [h('span', { class: 'mbf', 'data-g': 'x', style: 'width:' + (val === null || !max ? 0 : Math.max(2, 100 * val / max)) + '%;background:' + color })]), h('span', { class: 'mbv', text: txt })]);
    }
    function panel(title, sub, kids, icon) {
      return h('div', { class: 'ir' }, [h('div', { class: 'ir-h' }, [icon || null, h('div', {}, [h('div', { class: 'ir-n', text: title }), h('div', { class: 'ir-s', text: sub })])])].concat(kids));
    }
    var PHR = { opening: 'moves 1–10', middlegame: 'moves 11–30', late_game: 'moves 31+' };
    // ---- 1. seconds per move overall + by phase (in check vs not)
    var c1 = chartCard('rook-phase', key, 's12', 'Seconds per move', 'Weighted: Σ seconds ÷ Σ timed moves | phases by move number, not true endgame entry' + warn);
    c1.appendChild(h('div', { class: 'bigrow' }, [fmtIcon('Rapid'), h('div', { class: 'v big-n', text: sv(allA) }), h('div', { class: 'l' }, [h('b', { text: fmtN(allA.n) }), ' timed moves in ', h('b', { text: fmtN(allA.games) }), ' games'])]));
    var cells = [], mxP = 0;
    PH.forEach(function (p) { var o = agg(function (r) { return r.phase === p[2] && r.in_check_before_move === 0; }), k = agg(function (r) { return r.phase === p[2] && r.in_check_before_move === 1; }), t = agg(function (r) { return r.phase === p[2]; }); cells.push({ p: p, o: o, k: k, t: t }); [o, k].forEach(function (a) { if (a.avg > mxP) mxP = a.avg; }); });
    var pg = h('div', { class: 'fill ir-grid', style: 'margin-top:14px' });
    cells.forEach(function (c) {
      pg.appendChild(panel(c.p[1], PHR[c.p[0]] + ' | ' + fmtN(c.t.n) + ' moves', [h('div', { class: 'pv', text: sv(c.t) }), mb('Not in check', c.o.avg, mxP, 'var(--accent)', sv(c.o)), mb('In check', c.k.avg, mxP, 'var(--bullet)', sv(c.k))], fmtIcon('Rapid')));
    });
    c1.appendChild(pg); grid.appendChild(c1);
    // ---- 2. clock pressure grouped columns
    var c2 = chartCard('rook-low', key, 's6', 'Slower or faster under 10 seconds?', 'Average seconds per move by phase | with more than 10 s on your clock vs 10 s or less');
    c2.appendChild(h('div', { class: 'legend' }, [h('span', {}, [h('i', { class: 'seg-g' }), 'More than 10 s left']), h('span', {}, [h('i', { style: 'background:var(--bullet)' }), '10 s or less'])]));
    var gmax = 0, grp = PH.map(function (p) { var a = agg(function (r) { return r.phase === p[2] && r.under_10_seconds_before_move === 0; }), b = agg(function (r) { return r.phase === p[2] && r.under_10_seconds_before_move === 1; }); [a, b].forEach(function (x) { if (x.avg > gmax) gmax = x.avg; }); return { p: p, a: a, b: b }; });
    var gb = h('div', { class: 'gb' });
    grp.forEach(function (g) {
      function bar(x, color, lab) { return h('div', { class: 'gbc', 'data-tip': g.p[1] + ' | ' + lab + '\n' + (x.avg === null ? 'no timed moves' : x.avg.toFixed(2) + ' s avg over ' + fmtN(x.n) + ' moves') }, [h('span', { class: 'gbv', text: x.avg === null ? 'n/a' : x.avg.toFixed(2) + 's' }), h('div', { class: 'gbb', 'data-g': 'y', style: 'height:' + (x.avg === null || !gmax ? 0 : 100 * x.avg / gmax) + '%;background:' + color })]); }
      gb.appendChild(h('div', { class: 'gbg' }, [h('div', { class: 'gbp' }, [bar(g.a, 'var(--accent)', 'more than 10 s left'), bar(g.b, 'var(--bullet)', '10 s or less')]), h('div', { class: 'gbl', text: g.p[1] })]));
    });
    c2.appendChild(gb);
    c2.appendChild(h('p', { class: 'note', text: '“n/a” = no timed moves met that condition, never shown as 0 s.' }));
    grid.appendChild(c2);
    // ---- 3. seconds per move by result
    var c3 = chartCard('rook-res', key, 's6', 'Time per move by result', 'Do you think longer in games you win or lose?');
    var rr = [['Win', 'Won', 'var(--win)'], ['Draw', 'Drawn', 'var(--draw)'], ['Loss', 'Lost', 'var(--loss)']].map(function (x) { return { k: x, a: agg(function (r) { return ids[r.game_url].res === x[0]; }) }; }), rmax = 0;
    rr.forEach(function (x) { if (x.a.avg > rmax) rmax = x.a.avg; });
    var rl = h('div', { class: 'fill' });
    rr.forEach(function (x) { rl.appendChild(h('div', { class: 'ir', 'data-tip': x.k[1] + ' games\n' + fmtN(x.a.games) + ' games | ' + fmtN(x.a.n) + ' timed moves' }, [h('div', { class: 'ir-h' }, [badge(x.k[0] === 'Win' ? 'w' : x.k[0] === 'Loss' ? 'l' : 'd', x.k[0] === 'Win' ? '+' : x.k[0] === 'Loss' ? '−' : '='), h('div', {}, [h('div', { class: 'ir-n', text: x.k[1] + ' games' }), h('div', { class: 'ir-s', text: fmtN(x.a.games) + ' games | ' + fmtN(x.a.n) + ' timed moves' })])]), mb('Avg per move', x.a.avg, rmax, x.k[2], sv(x.a))])); });
    c3.appendChild(rl); grid.appendChild(c3);
    // ---- 4. reaching 10 s vs losing on time
    var withX = sc.filter(function (g) { return g.cross !== null; }), noX = sc.filter(function (g) { return g.cross === null; });
    function lt(a) { var l = a.filter(function (g) { return g.res === 'Loss'; }), tl = l.filter(function (g) { return g.reason === 'On time'; }); return tl.length; }
    var mm = median(withX.map(function (g) { return g.cross; }));
    var c4 = chartCard('rook-time', key, 's6', 'Hitting 10 seconds and losing on time', 'Results when your clock reached 10 s or less vs never did | descriptive, not causal');
    c4.appendChild(insightRows([
      { label: 'Reached 10 s or less', icon: fmtIcon('Blitz'), sub: fmtN(withX.length) + ' games | ' + fmtN(lt(withX)) + ' lost on time (' + pct(lt(withX), withX.length) + ')', t: tally(withX) },
      { label: 'Never under 10 s', icon: fmtIcon('Rapid'), sub: fmtN(noX.length) + ' games | ' + fmtN(lt(noX)) + ' lost on time (' + pct(lt(noX), noX.length) + ')', t: tally(noX) }
    ]));
    c4.appendChild(h('p', { class: 'note', text: 'Median move number of the first ≤10 s reading: ' + (mm === null ? 'n/a' : mm) + ' (from my_first_move_at_or_under_10_seconds).' }));
    grid.appendChild(c4);
    // ---- 5. captures and checks by phase
    var c5 = chartCard('rook-cap', key, 's6', 'Captures and checks you made', 'Per 10 of your moves in each phase | descriptive');
    var pc = PH.map(function (p) { var mv = 0, cp = 0, ck = 0; sc.forEach(function (g) { var q = g.ph[p[0]]; mv += q.mv; cp += q.cap; ck += q.chk; }); return { p: p, mv: mv, cp: mv ? 10 * cp / mv : null, ck: mv ? 10 * ck / mv : null }; }), cmax = 0;
    pc.forEach(function (x) { [x.cp, x.ck].forEach(function (v) { if (v > cmax) cmax = v; }); });
    var cg = h('div', { class: 'fill ir-grid' });
    pc.forEach(function (x) { cg.appendChild(panel(x.p[1], fmtN(x.mv) + ' of your moves', [mb('Captures', x.cp, cmax, 'var(--loss)', x.cp === null ? 'n/a' : x.cp.toFixed(2)), mb('Checks', x.ck, cmax, 'var(--bullet)', x.ck === null ? 'n/a' : x.ck.toFixed(2))])); });
    c5.appendChild(cg); grid.appendChild(c5);
  }

  function queenChapter(grid, sc) {
    var S = state.sel, key = JSON.stringify([state.year, state.fmt, state.side]);
    function sub(ex) { return sc.filter(function (g) { return (ex === 'wd' || S.wd === undefined || g.wd === S.wd) && (ex === 'hr' || S.hr === undefined || g.hour === S.hr) && (ex === 'day' || S.day === undefined || g.date === S.day) && (ex === 'mo' || S.mo === undefined || g.month === S.mo); }); }
    var chosen = sub('none'), t = tally(sc);
    var hero = h('div', { class: 'hero', text: t.n ? fmtN(t.n) + ' games | bars show volume, numbers show win rate %' : 'No games in this scope.' });
    grid.parentNode.insertBefore(hero, grid);
    if (!t.n) return emptyMsg(grid);
    var selKey = JSON.stringify(S);
    // calendar heatmap by year
    var cal = sub('day').filter(function () { return true; });
    var calBase = sc.filter(function (g) { return (S.wd === undefined || g.wd === S.wd) && (S.hr === undefined || g.hour === S.hr); });
    var byDay = groupBy(calBase, function (g) { return g.date; }), mx = 1; Object.keys(byDay).forEach(function (k) { if (byDay[k].length > mx) mx = byDay[k].length; });
    var years = Object.keys(groupBy(sc, function (g) { return g.year; })).sort();
    var cc = chartCard('queen-cal', key + selKey, 's12', 'Daily calendar heatmap', 'Colour = games that Eastern day (darker = more; max ' + mx + ') · click a day or a month label to filter · empty = none');
    years.forEach(function (y) {
      var CS = Math.max(9, Math.min(40, Math.floor((CW() - 34) / 54))), svg = s('svg', { viewBox: '0 0 ' + (30 + 54 * CS) + ' ' + (20 + 7 * CS), width: 30 + 54 * CS, height: 20 + 7 * CS, style: 'max-width:none', 'data-g': 'fade' });
      var jan1 = (new Date(Date.UTC(+y, 0, 1)).getUTCDay() + 6) % 7;
      svg.appendChild(s('text', { x: 0, y: 14, text: y, style: 'font-weight:700;fill:var(--text);font-size:11px' }));
      for (var mi = 0; mi < 12; mi++) {
        var dd = Math.round((Date.UTC(+y, mi, 1) - Date.UTC(+y, 0, 1)) / 864e5), mkey = y + '-' + (mi < 9 ? '0' : '') + (mi + 1);
        svg.appendChild(s('text', { x: 30 + Math.floor((dd + jan1) / 7) * CS, y: 12, text: MN[mi], style: 'cursor:pointer;' + (S.mo === mkey ? 'fill:var(--accent);font-weight:700' : ''), onclick: (function (k) { return function () { setSel('mo', S.mo === k ? null : k); }; })(mkey) }));
      }
      WD.forEach(function (w, i) { if (i % 2 === 0) svg.appendChild(s('text', { x: 18, y: 20 + i * CS + 9, 'text-anchor': 'end', text: w, style: 'font-size:8px' })); });
      var ndays = Math.round((Date.UTC(+y + 1, 0, 1) - Date.UTC(+y, 0, 1)) / 864e5);
      for (var di = 0; di < ndays; di++) {
        var dt = new Date(Date.UTC(+y, 0, 1 + di)), ds = dt.toISOString().slice(0, 10), cnt = (byDay[ds] || []).length, col = Math.floor((di + jan1) / 7), row = (di + jan1) % 7;
        var gt = tally(byDay[ds] || []), op = cnt ? 0.2 + 0.8 * Math.pow(cnt / mx, 0.6) : 0.06;
        svg.appendChild(s('rect', { x: 30 + col * CS, y: 20 + row * CS, width: CS - 2, height: CS - 2, rx: 2, fill: cnt ? 'var(--accent)' : 'var(--muted)', 'fill-opacity': op, stroke: S.day === ds ? 'var(--text)' : 'none', 'stroke-width': 1.5, style: 'cursor:pointer', 'data-tip': fmtDate(ds) + ' (' + WD[row] + ')\n' + (cnt ? cnt + ' games · ' + gt.W + 'W ' + gt.L + 'L ' + gt.D + 'D' : 'No games'), onclick: (function (k) { return function () { setSel('day', S.day === k ? null : k); }; })(ds) }));
      }
      cc.appendChild(h('div', { class: 'hscroll' }, [svg]));
    });
    grid.appendChild(cc);
    // weekday
    var wb = sub('wd'), wg = groupBy(wb, function (g) { return g.wd; });
    var wc = chartCard('queen-wd', key + selKey, 's5', 'By weekday', 'Bars = volume · numbers = win rate % · click to filter' + (Object.keys(S).length ? ' (cross-filtered by your other selections)' : ''));
    wc.appendChild(legendWDL());
    wc.appendChild(vbars(WD.map(function (w, i) { return { label: w, key: i, t: tally(wg[i] || []) }; }), { selected: S.wd, onSelect: function (k) { setSel('wd', k); } }));
    grid.appendChild(wc);
    var hb = sub('hr'), hg = groupBy(hb, function (g) { return g.hour; }), hrs = [];
    for (var i = 0; i < 24; i++) hrs.push({ tipLabel: 'Hour ' + i + ':00–' + i + ':59 ET', label: i === 0 ? '12a' : i < 12 ? i + 'a' : i === 12 ? '12p' : (i - 12) + 'p', key: i, t: tally(hg[i] || []) });
    var hc = chartCard('queen-hr', key + selKey, 's7', 'By hour of day (Eastern, completion time)', 'Bars = volume · numbers = win rate % (blank hour = no games) · click to filter');
    hc.appendChild(legendWDL());
    hc.appendChild(vbars(hrs, { selected: S.hr, onSelect: function (k) { setSel('hr', k); }, every: 2 }));
    grid.appendChild(hc);
    // month overview
    var mb = sc.filter(function (g) { return (S.wd === undefined || g.wd === S.wd) && (S.hr === undefined || g.hour === S.hr) && (S.day === undefined || g.date === S.day); }), mg = groupBy(mb, function (g) { return g.month; });
    var allM = Object.keys(groupBy(sc, function (g) { return g.month; })).sort();
    var mc = chartCard('queen-mo', key + selKey, 's12', 'Month overview', 'Games per month · click to filter');
    mc.appendChild(vbars(allM.map(function (k, ix) { return { label: MN[+k.slice(5) - 1] + (k.slice(5) === '01' ? ' ' + k.slice(2, 4) : ''), key: k, t: tally(mg[k] || []) }; }), { selected: S.mo, onSelect: function (k) { setSel('mo', k); }, noRate: true, every: 3 }));
    grid.appendChild(mc);
    var parts = []; if (S.wd !== undefined) parts.push(WD[S.wd]); if (S.hr !== undefined) parts.push('hour ' + S.hr); if (S.day) parts.push(fmtDate(S.day)); if (S.mo) parts.push(S.mo);
    drill(grid, parts.length ? 'Games: ' + parts.join(' · ') : 'Recent games', chosen, scopeLabel(), parts.length ? function () { state.sel = {}; draw(); } : null);
  }

  var CHAPTERS = [
    { id: 'king', n: 'King', t: 'Your Kingdom at a Glance', g: '♚', f: kingChapter },
    { id: 'queen', n: 'Queen', t: 'The Queen\u2019s Calendar: When You Play and Win', g: '♛', f: queenChapter },
    { id: 'rook', n: 'Rook', t: 'The Rook\u2019s Clock: Where Your Time Goes', g: '♜', f: rookChapter },
    { id: 'bishop', n: 'Bishop', t: 'Bishop\u2019s Playbook: Your Opening Lines', g: '♝', f: bishopChapter },
    { id: 'knight', n: 'Knight', t: 'Knight Moves: Streaks and Momentum', g: '♞', f: knightChapter },
    { id: 'pawn', n: 'Pawn', t: 'Pawn to Queen: Rating Climb and Giant-Killers', g: '♟', f: pawnChapter }
  ];
  // ---------- shell ----------
  var els = {};
  function chip(group, val, label) {
    return h('button', { class: 'chip', type: 'button', 'data-g': group, 'data-v': val, 'aria-pressed': 'false', text: label, onclick: function () { state[group] = val; state.sel = {}; draw(); } });
  }
  function buildShell() {
    clear(root);
    var rail = h('nav', { class: 'rail', 'aria-label': 'Chapters' }, [h('div', { class: 'brand', text: 'CHESS' })]);
    CHAPTERS.forEach(function (c) { rail.appendChild(h('button', { class: 'pc', type: 'button', 'data-c': c.id, title: c.n + ' · ' + c.t, 'aria-label': c.n + ' — ' + c.t, onclick: function () { state.chapter = c.id; draw(); } }, [c.g, h('small', { text: c.n })])); });
    rail.appendChild(h('div', { class: 'sp' }));
    els.theme = h('button', { class: 'theme', type: 'button', onclick: function () { state.theme = state.theme === 'night' ? 'day' : 'night'; try { window.localStorage.setItem('chess.theme', state.theme); } catch (e) { } draw(); } });
    rail.appendChild(els.theme);
    var yrs = Object.keys(groupBy(D.games, function (g) { return g.year; })).sort(), maxY = D.maxDate.slice(0, 4);
    var filt = h('div', { class: 'filters' }, [
      h('div', { class: 'fg' }, [h('span', { text: 'Year' }), chip('year', 'all', 'All')].concat(yrs.map(function (y) { return chip('year', y, y === maxY ? y + ' (partial)' : y); }))),
      h('div', { class: 'fg' }, [h('span', { text: 'Format' })].concat(['all', 'Bullet', 'Blitz', 'Rapid', 'Unknown'].map(function (f) { return chip('fmt', f, f === 'all' ? 'All' : f); }))),
      h('div', { class: 'fg' }, [h('span', { text: 'Side' })].concat(['all', 'White', 'Black'].map(function (f) { return chip('side', f, f === 'all' ? 'Both' : f); }))),
      h('button', { class: 'reset', type: 'button', text: 'Reset all', onclick: function () { state.year = 'all'; state.fmt = 'all'; state.side = 'all'; state.sel = {}; state.ratingMode = 'mean'; draw(); } })
    ]);
    els.title = h('h1', {}); els.asof = h('span', { class: 'asof' });
    els.grid = h('div', { class: 'grid' }); els.content = h('div', {}, [els.grid]);
    root.appendChild(rail);
    root.appendChild(h('main', {}, [h('header', { class: 'top' }, [els.title]), filt, els.content]));
    els.filt = filt; els.rail = rail;
  }
  function draw() {
    if (!els.grid) return;
    var cur = CHAPTERS.filter(function (c) { return c.id === state.chapter; })[0], y = window.scrollY;
    document.documentElement.setAttribute('data-theme', state.theme);
    els.theme.textContent = state.theme === 'night' ? '☀ Day' : '☾ Night';
    els.title.textContent = cur.g + ' ' + cur.t;
    Array.prototype.forEach.call(els.filt.querySelectorAll('.chip'), function (b) { b.setAttribute('aria-pressed', String(state[b.getAttribute('data-g')]) === b.getAttribute('data-v') ? 'true' : 'false'); });
    Array.prototype.forEach.call(els.rail.querySelectorAll('.pc'), function (b) { b.setAttribute('aria-current', b.getAttribute('data-c') === state.chapter ? 'true' : 'false'); });
    kpiToken++;
    lastW = els.content.clientWidth;
    var content = els.content; clear(content);
    var grid = h('div', { class: 'grid' }); content.appendChild(grid); els.grid = grid;
    var chapterKey = state.chapter;
    try { cur.f(grid, scope(false)); } catch (e) { grid.appendChild(h('div', { class: 'err', text: 'Render error: ' + (e && e.message || e) })); }
    // let tables stretch to the card height so paired cards have no dead space
    Array.prototype.forEach.call(grid.querySelectorAll('.card > table'), function (tb) { var w = h('div', { class: 'fill' }); tb.parentNode.insertBefore(w, tb); w.appendChild(tb); });
    addInfo(grid);
    Array.prototype.forEach.call(grid.querySelectorAll('.area-host'), function (ah) { if (ah._build) ah._build(); });
    runAnims(content);
    window.scrollTo(0, y);
  }

  // tooltip (outside re-render so hover never restarts animations)
  var tip = h('div', { id: 'tip' }); document.body.appendChild(tip);
  document.addEventListener('mouseover', function (e) { var t = e.target.closest ? e.target.closest('[data-tip]') : null; if (t) { tip.textContent = t.getAttribute('data-tip'); tip.style.display = 'block'; } else tip.style.display = 'none'; });
  document.addEventListener('mousemove', function (e) { if (tip.style.display === 'block') { var x = Math.min(window.innerWidth - 290, e.clientX + 14); tip.style.left = Math.max(4, x) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && closePops()) return;
    if (e.key === 'Escape' && Object.keys(state.sel).length) { state.sel = {}; draw(); } });

  var rzT = null, lastW = 0;
  window.addEventListener('resize', function () { clearTimeout(rzT); rzT = setTimeout(function () { var w = els.content ? els.content.clientWidth : 0; if (w && Math.abs(w - lastW) > 8) { lastW = w; draw(); } }, 150); });

  function note(msg) { clear(root); root.appendChild(h('p', { class: 'err', text: msg })); }
  function boot() {
    if (!window.ChessData) { note('Data loader unavailable. Please reload the page.'); return; }
    root.appendChild(h('p', { class: 'empty', text: 'Loading games…' }));
    Promise.resolve().then(function () {
      return ChessData.getSources();
    }).then(function (list) {
      var gds = findDs(list, 'Chess Games'), tds = findDs(list, 'Chess Move Timing');
      if (!gds || !tds) throw new Error('Expected datasources "Chess Games" and "Chess Move Timing"; found: ' + (list || []).map(function (d) { return d.name; }).join(', '));
      return Promise.all([gds.queryAsync(fq(GAME_FIELDS)), tds.queryAsync(fq(TIMING_FIELDS))]);
    }).then(function (res) {
      var gr = extractData(res[0]), tr = extractData(res[1]);
      var badRows = gr.filter(function (r) { return !normDate(r.game_date_et); }).length;
      if (badRows === gr.length && gr.length) throw new Error('Unreadable game_date_et values, e.g. ' + JSON.stringify(gr[0].game_date_et));
      D.games = gr.filter(function (r) { return normDate(r.game_date_et); }).map(prep).filter(function (g) { return g.date && !isNaN(g.utc); }).sort(function (a, b) { return a.utc - b.utc; });
      D.timing = tr.map(function (r) { return { game_url: r.game_url, phase: r.phase, in_check_before_move: +r.in_check_before_move, under_10_seconds_before_move: +r.under_10_seconds_before_move, timed_moves: +r.timed_moves || 0, estimated_seconds_spent: +r.estimated_seconds_spent || 0 }; });
      if (!D.games.length) throw new Error('Chess Games returned no rows');
      D.maxDate = D.games.reduce(function (a, g) { return g.date > a ? g.date : a; }, '0000-00-00');
      buildShell(); draw();
      window.__chess = { D: D, state: state, scope: scope, tally: tally, draw: draw };
    }).catch(function (err) { note('Unable to load chess data: ' + ((err && (err.message || err.errorCode)) || String(err))); });
  }
  boot();
})();
