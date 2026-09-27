#!/usr/bin/env node
'use strict';
/*
 * Zero-dependency static site generator.
 * Reads meal-prep/*.md and groceries/{SHOPPING-LIST,INVENTORY,PURCHASES}.md
 * and writes a mobile-friendly HTML site into docs/ for GitHub Pages.
 *
 * Markdown stays the source of truth: edit the .md files as usual, then
 * run `node site/build.js` to regenerate docs/ before pushing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const TODAY = new Date();

// ---------------------------------------------------------------------
// tiny markdown -> HTML
// ---------------------------------------------------------------------

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderLink(text, url, ctx) {
  if (/^https?:\/\//.test(url)) {
    return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  }
  if (/recipes\//.test(url) || /CLAUDE\.md/.test(url) || /templates\//.test(url)) {
    // Not part of the site yet -- render as plain emphasized text.
    return `<strong>${text}</strong>`;
  }
  if (/SHOPPING-LIST\.md/.test(url)) return `<a href="${ctx.prefix}groceries/shopping-list.html">${text}</a>`;
  if (/INVENTORY\.md/.test(url)) return `<a href="${ctx.prefix}groceries/inventory.html">${text}</a>`;
  if (/PURCHASES\.md/.test(url)) return `<a href="${ctx.prefix}groceries/purchases.html">${text}</a>`;
  return `<strong>${text}</strong>`;
}

function inline(text, ctx) {
  let out = escapeHtml(text);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, url) => renderLink(t, url, ctx));
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function renderMarkdown(md, ctx) {
  // strip HTML comments (single-line and multi-line blocks)
  const withoutComments = md.replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutComments.replace(/\r\n/g, '\n').split('\n');

  const html = [];
  let i = 0;
  let paraBuf = [];

  function flushPara() {
    if (paraBuf.length) {
      html.push(`<p>${inline(paraBuf.join(' '), ctx)}</p>`);
      paraBuf = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    const h3 = /^###\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h1 = /^#\s+(.*)/.exec(line);
    if (h1 || h2 || h3) {
      flushPara();
      const [, text] = h1 || h2 || h3;
      const tag = h1 ? 'h1' : h2 ? 'h2' : 'h3';
      html.push(`<${tag}>${inline(text, ctx)}</${tag}>`);
      i++;
      continue;
    }

    if (line.trim() === '---') {
      flushPara();
      html.push('<hr>');
      i++;
      continue;
    }

    const checklistMatch = /^-\s\[([ xX])\]\s(.*)/.exec(line);
    if (checklistMatch) {
      flushPara();
      const items = [];
      while (i < lines.length) {
        const m = /^-\s\[([ xX])\]\s(.*)/.exec(lines[i]);
        if (!m) break;
        items.push({ checked: m[1].toLowerCase() === 'x', text: m[2] });
        i++;
      }
      html.push('<ul class="checklist">');
      for (const item of items) {
        const key = `${ctx.pageKey}:${ctx.checkboxCounter++}`;
        html.push(
          `<li><label><input type="checkbox" data-key="${key}" ${item.checked ? 'checked' : ''}>` +
            `<span>${inline(item.text, ctx)}</span></label></li>`
        );
      }
      html.push('</ul>');
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      html.push('<div class="table-wrap"><table>');
      html.push('<thead><tr>' + header.map((c) => `<th>${inline(c, ctx)}</th>`).join('') + '</tr></thead>');
      html.push('<tbody>');
      for (const row of rows) {
        html.push('<tr>' + row.map((c) => `<td>${inline(c, ctx)}</td>`).join('') + '</tr>');
      }
      html.push('</tbody></table></div>');
      continue;
    }

    const bulletMatch = /^-\s(.*)/.exec(line);
    if (bulletMatch) {
      flushPara();
      const items = [];
      while (i < lines.length) {
        const m = /^-\s(.*)/.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      html.push('<ul>' + items.map((t) => `<li>${inline(t, ctx)}</li>`).join('') + '</ul>');
      continue;
    }

    paraBuf.push(line.trim());
    i++;
  }
  flushPara();
  return html.join('\n');
}

// ---------------------------------------------------------------------
// page shell
// ---------------------------------------------------------------------

function navLink(href, label, current) {
  const cls = current === href ? ' class="active"' : '';
  return `<a href="${href}"${cls}>${label}</a>`;
}

function page({ title, prefix, body, current }) {
  const nav = [
    navLink(`${prefix}index.html`, 'Home', current),
    navLink(`${prefix}groceries/shopping-list.html`, 'Shopping List', current),
    navLink(`${prefix}groceries/inventory.html`, 'Inventory', current),
    navLink(`${prefix}groceries/purchases.html`, 'Purchases', current),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Cooking</title>
<link rel="stylesheet" href="${prefix}style.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="${prefix}index.html">🍳 Cooking</a>
  <nav>${nav}</nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">Generated from Markdown — <code>node site/build.js</code></footer>
<script src="${prefix}app.js"></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------
// content-specific helpers
// ---------------------------------------------------------------------

function parseInventoryNearUseBy(md) {
  const lines = md.split('\n');
  const flagged = [];
  for (const line of lines) {
    if (!isTableRow(line) || isTableSeparator(line)) continue;
    const cells = splitRow(line);
    if (cells[0] === 'Item' || cells.length < 3) continue;
    const useByRaw = cells[2];
    const m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(useByRaw);
    if (!m) continue;
    const [, mo, da, yr] = m;
    const date = new Date(Number(yr), Number(mo) - 1, Number(da));
    const days = Math.round((date - TODAY) / (1000 * 60 * 60 * 24));
    if (days <= 10) {
      flagged.push({ item: cells[0], quantity: cells[1], useBy: useByRaw, days });
    }
  }
  return flagged.sort((a, b) => a.days - b.days);
}

function weekDateFromFilename(fname) {
  const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(fname);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------
// build
// ---------------------------------------------------------------------

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(rel, content) {
  const full = path.join(DOCS, rel);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content);
}

function build() {
  ensureDir(DOCS);

  // ---- meal-prep weeks ----
  const mealPrepDir = path.join(ROOT, 'meal-prep');
  const weekFiles = fs.existsSync(mealPrepDir)
    ? fs.readdirSync(mealPrepDir).filter((f) => weekDateFromFilename(f)).sort().reverse()
    : [];

  const weeks = [];
  for (const fname of weekFiles) {
    const date = weekDateFromFilename(fname);
    const md = fs.readFileSync(path.join(mealPrepDir, fname), 'utf8');
    const ctx = { prefix: '../', pageKey: `meal-prep-${date}`, checkboxCounter: 0 };
    const body = renderMarkdown(md, ctx);
    const html = page({
      title: `Week of ${date}`,
      prefix: '../',
      current: `../meal-prep/${date}.html`,
      body,
    });
    writeFile(`meal-prep/${date}.html`, html);
    weeks.push(date);
  }

  // ---- groceries ----
  const groceriesDir = path.join(ROOT, 'groceries');
  const groceryFiles = {
    'shopping-list.html': { file: 'SHOPPING-LIST.md', title: 'Shopping List' },
    'inventory.html': { file: 'INVENTORY.md', title: 'Inventory' },
    'purchases.html': { file: 'PURCHASES.md', title: 'Purchase History' },
  };

  let nearUseBy = [];
  for (const [outName, cfg] of Object.entries(groceryFiles)) {
    const full = path.join(groceriesDir, cfg.file);
    if (!fs.existsSync(full)) continue;
    const md = fs.readFileSync(full, 'utf8');
    if (cfg.file === 'INVENTORY.md') nearUseBy = parseInventoryNearUseBy(md);
    const ctx = { prefix: '../', pageKey: `groceries-${outName}`, checkboxCounter: 0 };
    const body = renderMarkdown(md, ctx);
    const html = page({
      title: cfg.title,
      prefix: '../',
      current: `../groceries/${outName}`,
      body,
    });
    writeFile(`groceries/${outName}`, html);
  }

  // ---- homepage ----
  const currentWeek = weeks[0];
  const archive = weeks.slice(1);

  let homeBody = '<h1>Cooking</h1>';

  if (currentWeek) {
    homeBody += `
<section class="card">
  <h2>This Week</h2>
  <p><a class="button" href="meal-prep/${currentWeek}.html">Week of ${currentWeek} →</a></p>
</section>`;
  }

  if (nearUseBy.length) {
    homeBody += `
<section class="card warning">
  <h2>Use soon</h2>
  <ul>
    ${nearUseBy
      .map(
        (i) =>
          `<li><strong>${escapeHtml(i.item)}</strong> (${escapeHtml(i.quantity)}) — use by ${escapeHtml(i.useBy)}${
            i.days < 0 ? ' (past use-by)' : i.days === 0 ? ' (today)' : ` (${i.days}d)`
          }</li>`
      )
      .join('\n    ')}
  </ul>
  <p><a href="groceries/inventory.html">Full inventory →</a></p>
</section>`;
  }

  homeBody += `
<section class="card">
  <h2>Groceries</h2>
  <ul class="link-list">
    <li><a href="groceries/shopping-list.html">Shopping List</a></li>
    <li><a href="groceries/inventory.html">Inventory</a></li>
    <li><a href="groceries/purchases.html">Purchase History</a></li>
  </ul>
</section>`;

  if (archive.length) {
    homeBody += `
<section class="card">
  <h2>Past Weeks</h2>
  <ul class="link-list">
    ${archive.map((d) => `<li><a href="meal-prep/${d}.html">Week of ${d}</a></li>`).join('\n    ')}
  </ul>
</section>`;
  }

  writeFile('index.html', page({ title: 'Home', prefix: '', current: 'index.html', body: homeBody }));

  // ---- static assets ----
  fs.copyFileSync(path.join(__dirname, 'style.css'), path.join(DOCS, 'style.css'));
  fs.copyFileSync(path.join(__dirname, 'app.js'), path.join(DOCS, 'app.js'));
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');

  console.log(`Built ${weeks.length} meal-prep week(s) and ${Object.keys(groceryFiles).length} grocery page(s) into docs/`);
}

build();
