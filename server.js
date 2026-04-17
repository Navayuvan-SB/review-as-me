#!/usr/bin/env node
/**
 * Code Review UI — no dependencies, run with: node server.js
 * Opens at http://localhost:7842
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const REVIEWS_DIR = path.join(os.homedir(), '.review-as-me');
const PORT = 7842;

// ─── Markdown parser (server-side) ───────────────────────────────────────────

function parseMd(md) {
  const lines = md.split('\n');
  const meta = {};
  const notes = [];
  let inNotes = false;

  for (const line of lines) {
    if (line.startsWith('# PR Review:'))    meta.title  = line.replace('# PR Review:', '').trim();
    else if (line.startsWith('**Repo:**'))  meta.repo   = line.replace('**Repo:**', '').trim();
    else if (line.startsWith('**Branch:**'))meta.branch = line.replace('**Branch:**', '').replace(/`/g, '').trim();
    else if (line.startsWith('**Author:**'))meta.author = line.replace('**Author:**', '').trim();
    else if (line.startsWith('**SHA:**'))   meta.sha    = line.replace('**SHA:**', '').replace(/`/g, '').trim();
    else if (line.startsWith('## Notes'))   inNotes = true;
    else if (inNotes && line.startsWith('- ')) notes.push(line.replace(/^- /, ''));
  }

  // Data rows: lines starting with | followed by a number
  // Column order: # | Issue | File | Category | Score | State | Published
  const rows = lines
    .filter(l => /^\|\s*\d+\s*\|/.test(l))
    .map(line => {
      const parts = line.split('|');
      const get = i => (parts[i] || '').trim();

      // File column may contain markdown link syntax [text](url)
      const rawFile = get(3);
      const linkMatch = rawFile.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const fileDisplay = linkMatch ? linkMatch[1] : rawFile.replace(/`/g, '').trim();
      const link = linkMatch ? linkMatch[2] : null;

      return {
        num:       get(1),
        issue:     get(2),
        file:      fileDisplay,
        link,
        category:  get(4),
        score:     get(5),
        state:     get(6) || 'pending',
        published: get(7) || 'no',
      };
    });

  return { meta, notes, rows };
}

// ─── Markdown serialiser (patches only State + Published cells) ───────────────

function patchMd(md, updatedRows) {
  // Build a lookup map by row number
  const byNum = {};
  updatedRows.forEach(r => { byNum[r.num] = r; });

  return md.split('\n').map(line => {
    if (!/^\|\s*\d+\s*\|/.test(line)) return line;
    const parts = line.split('|');
    const num = (parts[1] || '').trim();
    const row = byNum[num];
    if (!row) return line;
    // Column order: # | Issue | File | Category | Score | State | Published
    parts[6] = ' ' + row.state + ' ';
    parts[7] = ' ' + row.published + ' ';
    return parts.join('|');
  }).join('\n');
}

// ─── HTML (static, no template interpolation issues) ─────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; background: #f5f5f7; color: #1d1d1f; height: 100vh; display: flex; flex-direction: column; }

    header { background: #fff; border-bottom: 1px solid #e0e0e0; padding: 0 20px; height: 52px; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    header h1 { font-size: 15px; font-weight: 600; }
    .pr-title { color: #6e6e73; font-size: 12px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    header select { border: 1px solid #d1d1d6; border-radius: 6px; padding: 4px 8px; font-size: 12px; background: #fff; cursor: pointer; outline: none; }
    .save-pill { font-size: 11px; padding: 3px 9px; border-radius: 10px; font-weight: 500; }
    .save-pill.saving { background: #fff3cd; color: #9a6700; }
    .save-pill.saved  { background: #e6f9ef; color: #248a3d; }
    .save-pill.err    { background: #ffe5e5; color: #c41230; }
    .save-pill.idle   { display: none; }

    .pr-info { background: #fff; border-bottom: 1px solid #e0e0e0; padding: 10px 20px; display: flex; gap: 24px; flex-shrink: 0; flex-wrap: wrap; }
    .pi { display: flex; flex-direction: column; gap: 2px; }
    .pi .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #8e8e93; font-weight: 600; }
    .pi .val { font-size: 12px; color: #1d1d1f; font-family: 'SF Mono', Menlo, monospace; }
    .pi .val.plain { font-family: inherit; }

    .statsbar { background: #fff; border-bottom: 1px solid #e0e0e0; padding: 7px 20px; display: flex; gap: 20px; flex-shrink: 0; align-items: center; }
    .stat { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6e6e73; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .d-pending{background:#8e8e93} .d-accept{background:#34c759} .d-reject{background:#ff3b30} .d-edited{background:#ff9500}
    .pub-count { margin-left: auto; font-size: 11px; color: #248a3d; font-weight: 500; }

    .notes { background: #fffbeb; border-bottom: 1px solid #f0d070; padding: 8px 20px; font-size: 12px; color: #6b4a00; flex-shrink: 0; line-height: 1.6; }

    .wrap { flex: 1; overflow: auto; padding: 16px 20px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    thead th { background: #f2f2f7; padding: 9px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; color: #6e6e73; white-space: nowrap; border-bottom: 1px solid #e0e0e0; }
    tbody tr { border-bottom: 1px solid #f2f2f7; transition: background .1s; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #fafafa !important; }
    tr.s-pending { background: #fff; }
    tr.s-accept  { background: #f0fdf4; }
    tr.s-reject  { background: #fff5f5; }
    tr.s-edited  { background: #fffbf0; }
    td { padding: 9px 12px; vertical-align: top; }
    td.num { color: #8e8e93; font-size: 12px; width: 28px; text-align: right; }

    td.state select { border: 1px solid #d1d1d6; border-radius: 5px; padding: 3px 6px; font-size: 12px; font-weight: 500; cursor: pointer; outline: none; background: #fff; width: 82px; }
    .ss-pending { color: #8e8e93; border-color: #c7c7cc !important; }
    .ss-accept  { color: #248a3d; border-color: #34c759 !important; background: #f0fdf4 !important; }
    .ss-reject  { color: #c41230; border-color: #ff3b30 !important; background: #fff5f5 !important; }
    .ss-edited  { color: #9a6700; border-color: #ff9500 !important; background: #fffbf0 !important; }

    td.pub { width: 70px; }
    .ptog { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; border: 1px solid #d1d1d6; border-radius: 5px; padding: 3px 8px; font-size: 11px; font-weight: 500; background: #fff; user-select: none; transition: all .15s; }
    .ptog.pyes { color: #248a3d; border-color: #34c759; background: #f0fdf4; }
    .ptog.pno  { color: #8e8e93; }
    .pdot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .pyes .pdot { background: #34c759; }
    .pno  .pdot { background: #c7c7cc; }

    .sbadge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .s100 { background: #ffe5e5; color: #c41230; }
    .s75  { background: #fff3cd; color: #9a6700; }
    .s50  { background: #e8f4fd; color: #0071e3; }

    .cbadge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 500; white-space: nowrap; }
    .cSecurity,.cBugSecurity { background: #ffe5e5; color: #c41230; }
    .cBug { background: #fff3cd; color: #9a6700; }
    .cArchitecture { background: #f0e8ff; color: #6e36c1; }
    .cPerformance,.cTypeSafety { background: #e8f4fd; color: #0071e3; }
    .cCleanup,.cStandards { background: #f2f2f7; color: #6e6e73; }
    .cReusability { background: #e6f9ef; color: #248a3d; }

    td.issue { font-size: 12px; line-height: 1.5; max-width: 480px; }
    td.file  { font-family: 'SF Mono', Menlo, monospace; font-size: 11px; color: #6e6e73; max-width: 220px; line-height: 1.4; word-break: break-all; }
    td.file a { color: #0071e3; text-decoration: none; }
    td.file a:hover { text-decoration: underline; }
    td.file a::after { content: ' ↗'; font-size: 10px; opacity: 0.6; }
    .empty { text-align: center; padding: 60px; color: #8e8e93; }
  </style>
</head>
<body>

<header>
  <h1>Code Review</h1>
  <span class="pr-title" id="pr-title">—</span>
  <span class="save-pill idle" id="save-pill"></span>
  <select id="picker" onchange="load(this.value)"><option value="">Choose file…</option></select>
</header>

<div class="pr-info" id="pr-info" style="display:none">
  <div class="pi"><span class="lbl">Repo</span><span class="val plain" id="m-repo">—</span></div>
  <div class="pi"><span class="lbl">Branch</span><span class="val" id="m-branch">—</span></div>
  <div class="pi"><span class="lbl">Author</span><span class="val plain" id="m-author">—</span></div>
  <div class="pi"><span class="lbl">SHA</span><span class="val" id="m-sha">—</span></div>
</div>

<div class="statsbar" id="statsbar" style="display:none">
  <div class="stat"><div class="dot d-pending"></div><span id="c-pending">0 pending</span></div>
  <div class="stat"><div class="dot d-accept"></div><span id="c-accept">0 accept</span></div>
  <div class="stat"><div class="dot d-reject"></div><span id="c-reject">0 reject</span></div>
  <div class="stat"><div class="dot d-edited"></div><span id="c-edited">0 edited</span></div>
  <span class="pub-count" id="c-pub"></span>
</div>

<div class="notes" id="notes" style="display:none"></div>

<div class="wrap">
  <p class="empty" id="empty">Select a review file from the top-right dropdown.</p>
  <table id="tbl" style="display:none">
    <thead><tr><th>#</th><th>Issue</th><th>File</th><th>Category</th><th>Score</th><th>State</th><th>Published</th></tr></thead>
    <tbody id="tbody"></tbody>
  </table>
</div>

<script>
  var currentFile = null;
  var rows = [];
  var saveTimer = null;

  function esc(s) {
    return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Boot: list files
  fetch('/api/reviews').then(function(r){ return r.json(); }).then(function(files) {
    var picker = document.getElementById('picker');
    files.forEach(function(f) {
      var o = document.createElement('option');
      o.value = f; o.textContent = f;
      picker.appendChild(o);
    });
    if (files.length === 1) { picker.value = files[0]; load(files[0]); }
  });

  function load(filename) {
    if (!filename) return;
    currentFile = filename;
    fetch('/api/review?file=' + encodeURIComponent(filename))
      .then(function(r){ return r.json(); })
      .then(function(data) { render(data); });
  }

  function render(data) {
    rows = data.rows;

    // Metadata
    document.getElementById('pr-title').textContent = data.meta.title || currentFile;
    document.getElementById('m-repo').textContent   = data.meta.repo   || '—';
    document.getElementById('m-branch').textContent = data.meta.branch || '—';
    document.getElementById('m-author').textContent = data.meta.author || '—';
    document.getElementById('m-sha').textContent    = (data.meta.sha||'').slice(0,12) || '—';
    document.getElementById('pr-info').style.display  = 'flex';
    document.getElementById('statsbar').style.display = 'flex';

    // Notes
    if (data.notes && data.notes.length) {
      var notesEl = document.getElementById('notes');
      notesEl.innerHTML = data.notes.map(function(n){ return esc(n); }).join('<br>');
      notesEl.style.display = 'block';
    }

    // Table
    document.getElementById('empty').style.display = 'none';
    document.getElementById('tbl').style.display   = '';
    var tbody = document.getElementById('tbody');
    tbody.innerHTML = '';

    rows.forEach(function(row, idx) {
      var tr = document.createElement('tr');
      tr.className = 's-' + row.state;

      // State select
      var stateOpts = ['pending','accept','reject','edited'].map(function(o) {
        return '<option value="' + o + '"' + (o === row.state ? ' selected' : '') + '>' + o + '</option>';
      }).join('');
      var stateHtml = '<select class="ss-' + row.state + '" data-idx="' + idx + '" id="sel-' + idx + '">' + stateOpts + '</select>';

      // Published toggle
      var pubCls = row.published === 'yes' ? 'pyes' : 'pno';
      var pubHtml = '<span class="ptog ' + pubCls + '" data-idx="' + idx + '" id="pub-' + idx + '"><span class="pdot"></span>' + esc(row.published) + '</span>';

      // Score badge
      var sCls = row.score === '100' ? 's100' : row.score === '75' ? 's75' : 's50';
      var scoreBadge = '<span class="sbadge ' + sCls + '">' + esc(row.score) + '</span>';

      // Category badge
      var catKey = (row.category || '').replace(/[^a-zA-Z]/g, '');
      var catBadge = '<span class="cbadge c' + catKey + '">' + esc(row.category) + '</span>';

      var fileHtml = row.link
        ? '<a href="' + esc(row.link) + '" target="_blank" rel="noopener noreferrer">' + esc(row.file) + '</a>'
        : esc(row.file);

      tr.innerHTML =
        '<td class="num">'   + esc(row.num)   + '</td>' +
        '<td class="issue">' + esc(row.issue) + '</td>' +
        '<td class="file">'  + fileHtml        + '</td>' +
        '<td>'               + catBadge        + '</td>' +
        '<td>'               + scoreBadge      + '</td>' +
        '<td class="state">' + stateHtml       + '</td>' +
        '<td class="pub">'   + pubHtml         + '</td>';

      tbody.appendChild(tr);
    });

    // Attach events after DOM is built
    rows.forEach(function(row, idx) {
      var sel = document.getElementById('sel-' + idx);
      if (sel) sel.addEventListener('change', function() { onState(idx, this.value); });
      var pub = document.getElementById('pub-' + idx);
      if (pub) pub.addEventListener('click', function() { onPub(idx); });
    });

    updateStats();
  }

  function onState(idx, val) {
    rows[idx].state = val;
    var sel = document.getElementById('sel-' + idx);
    sel.className = 'ss-' + val;
    sel.closest('tr').className = 's-' + val;
    updateStats();
    scheduleSave();
  }

  function onPub(idx) {
    rows[idx].published = rows[idx].published === 'yes' ? 'no' : 'yes';
    var el = document.getElementById('pub-' + idx);
    var isYes = rows[idx].published === 'yes';
    el.className = 'ptog ' + (isYes ? 'pyes' : 'pno');
    el.innerHTML = '<span class="pdot"></span>' + rows[idx].published;
    updateStats();
    scheduleSave();
  }

  function updateStats() {
    var counts = { pending:0, accept:0, reject:0, edited:0 };
    var pub = 0;
    rows.forEach(function(r) {
      counts[r.state] = (counts[r.state]||0) + 1;
      if (r.published === 'yes') pub++;
    });
    ['pending','accept','reject','edited'].forEach(function(s) {
      document.getElementById('c-' + s).textContent = counts[s] + ' ' + s;
    });
    document.getElementById('c-pub').textContent = pub ? pub + ' published to GitHub' : '';
  }

  function scheduleSave() {
    setSave('saving', 'Saving\u2026');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  function save() {
    if (!currentFile) return;
    fetch('/api/review?file=' + encodeURIComponent(currentFile), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows })
    }).then(function() {
      setSave('saved', 'Saved');
      setTimeout(function(){ setSave('idle',''); }, 2000);
    }).catch(function() { setSave('err', 'Save failed'); });
  }

  function setSave(cls, txt) {
    var el = document.getElementById('save-pill');
    el.className = 'save-pill ' + cls;
    el.textContent = txt;
  }
</script>
</body>
</html>`;

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;

  const json = (data) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  // Serve UI
  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  // List review files
  if (req.method === 'GET' && p === '/api/reviews') {
    const files = fs.readdirSync(REVIEWS_DIR)
      .filter(f => f.endsWith('.md') && !f.startsWith('.'))
      .sort();
    return json(files);
  }

  // Read + parse review file → JSON
  if (req.method === 'GET' && p === '/api/review') {
    const file = parsed.query.file;
    if (!file || file.includes('..')) { res.writeHead(400); return res.end('Bad request'); }
    const filePath = path.join(REVIEWS_DIR, file);
    if (!fs.existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
    const md = fs.readFileSync(filePath, 'utf8');
    return json(parseMd(md));
  }

  // Save updated rows → patch markdown file
  if (req.method === 'PUT' && p === '/api/review') {
    const file = parsed.query.file;
    if (!file || file.includes('..')) { res.writeHead(400); return res.end('Bad request'); }
    const filePath = path.join(REVIEWS_DIR, file);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { rows } = JSON.parse(body);
        const md = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(filePath, patchMd(md, rows), 'utf8');
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = 'http://localhost:' + PORT;
  console.log('\n  Code Review UI →', addr, '\n');
  require('child_process').exec('open ' + addr);
});
