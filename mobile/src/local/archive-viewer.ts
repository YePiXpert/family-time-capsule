/**
 * 开放归档里的离线网页：index.html。双击就能在任何浏览器里翻这份归档。
 *
 * 只有一份 HTML 字符串：内联 CSS（纸色调色板与 App 同源）、原生 JS，不引用任何外部
 * 地址；数据从同目录的 library.js 读（file:// 下 fetch 不可用，所以用 <script src>）。
 * 渲染逻辑挂在 window.ANAN_VIEWER 上，单元测试用桩 DOM 跑一遍。
 */
export const ARCHIVE_VIEWER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>成长记录 · 开放归档</title>
<style>
:root{--paper:#FAF5EC;--card:#FFFFFF;--ink:#3B3129;--muted:#7A6A58;--line:#EBDFCC;--accent:#B2543B;--selected:#F5E7D3}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,"Noto Serif CJK SC","Songti SC","SimSun",serif;line-height:1.6}
header{padding:24px 20px 12px;border-bottom:1px solid var(--line)}
h1{margin:0;font-size:28px;font-weight:600;letter-spacing:.3px}
h2{font-size:22px;font-weight:600;margin:8px 0 12px}
.muted{color:var(--muted);font-size:14px}
.title-motto{color:var(--muted);font-size:16px;line-height:26px;margin:6px 0 0}
nav.tabs{display:flex;flex-wrap:wrap;gap:8px;padding:12px 20px}
button.tab,a.chip{border:1px solid var(--line);background:var(--card);color:var(--accent);border-radius:999px;padding:6px 14px;font:inherit;font-size:14px;cursor:pointer;text-decoration:none;display:inline-block}
button.tab.on,a.chip.on{background:var(--selected);border-color:var(--accent)}
main{display:grid;grid-template-columns:220px 1fr;gap:20px;padding:0 20px 60px}
aside{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding-top:8px}
aside .year{font-weight:600;margin-top:12px}
aside a{display:block;color:var(--ink);text-decoration:none;padding:4px 8px;border-radius:8px;font-size:15px}
aside a.on{background:var(--selected)}
input.search{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;font:inherit;background:var(--card);margin:8px 0 12px;color:var(--ink)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px;box-shadow:0 2px 12px rgba(122,92,62,.06)}
.card h3{margin:4px 0 8px;font-size:20px;font-weight:600}
.date{color:var(--accent);font-size:14px}
.badge{display:inline-block;font-size:12px;color:var(--accent);border:1px solid var(--accent);border-radius:999px;padding:0 8px;margin-left:6px;vertical-align:middle}
.text{white-space:pre-wrap}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:12px}
.media img,.media video{width:100%;border-radius:12px;background:var(--selected);display:block}
.media audio{width:100%}
.media figure{margin:0}
.media figcaption{font-size:12px;color:var(--muted)}
.envelope{text-align:center;padding:32px 16px}
.stamp{width:96px;height:96px;border:2px solid var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:34px;color:var(--accent);font-weight:600}
.sign{text-align:right;margin-top:12px}
.empty{padding:40px;text-align:center;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:var(--selected);display:block}
@media (max-width:720px){main{grid-template-columns:1fr}aside{position:static;max-height:none;display:flex;flex-wrap:wrap;gap:4px}aside .year{width:100%}}
</style>
</head>
<body>
<header><h1 id="title">成长记录</h1><div id="name-story"></div><div class="muted" id="subtitle"></div></header>
<nav class="tabs" id="tabs"></nav>
<main><aside id="side"></aside><section id="content"></section></main>
<script src="library.js"></script>
<script>
(function () {
  var lib = window.ANAN_LIBRARY;
  var state = { tab: "records", year: "", month: "", person: "", query: "" };
  var el = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function src(p) { return p.split("/").map(encodeURIComponent).join("/"); }
  function dayLabel(day) { var p = day.split("-"); return p[0] + "年" + (+p[1]) + "月" + (+p[2]) + "日"; }
  function monthLabel(m) { var p = m.split("-"); return (+p[1]) + "月"; }
  function todayKey() {
    var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function ageAt(birthday, day) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(birthday || "")) return "";
    var b = birthday.split("-").map(Number), d = day.split("-").map(Number);
    var months = (d[0] - b[0]) * 12 + (d[1] - b[1]) - (d[2] < b[2] ? 1 : 0);
    if (months < 0) return "";
    var y = Math.floor(months / 12), m = months % 12;
    return (y ? y + " 岁" : "") + (y && m ? " " : "") + (m || !y ? m + " 个月" : "");
  }
  function mediaHtml(list) {
    if (!list || !list.length) return "";
    return '<div class="media">' + list.map(function (m) {
      var s = src(m.path), name = esc(m.name);
      if (m.kind === "image") return '<figure><img loading="lazy" src="' + s + '" alt="' + name + '"></figure>';
      if (m.kind === "video") return '<figure><video controls preload="metadata" src="' + s + '"></video><figcaption>' + name + '</figcaption></figure>';
      if (m.kind === "audio") return '<figure><audio controls preload="none" src="' + s + '"></audio><figcaption>' + name + '</figcaption></figure>';
      return '<figure><a href="' + s + '" download>' + name + '</a></figure>';
    }).join("") + "</div>";
  }
  function recordCard(r) {
    var head = '<span class="date">' + esc(dayLabel(r.day)) + "</span>";
    var age = ageAt(lib.child.birthday, r.day);
    if (age) head += ' <span class="muted">' + esc(age) + "</span>";
    if (r.first) head += '<span class="badge">第一次</span>';
    if (r.quote) head += '<span class="badge">她说的话</span>';
    var meta = [];
    if (r.location) meta.push(esc(r.location));
    if (r.persons && r.persons.length) meta.push(r.persons.map(esc).join("、"));
    if (r.by) meta.push("落款 " + esc(r.by));
    return '<article class="card" id="r-' + esc(r.id) + '"><div>' + head + "</div><h3>" + esc(r.title) + "</h3>" +
      (meta.length ? '<div class="muted">' + meta.join(" · ") + "</div>" : "") +
      (r.text ? '<p class="text">' + esc(r.text) + "</p>" : "") + mediaHtml(r.media) + "</article>";
  }
  function byDate(a, b) { return Date.parse(a.date) - Date.parse(b.date) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }
  function months() {
    var map = {};
    lib.records.forEach(function (r) { var m = r.day.slice(0, 7); map[m] = (map[m] || 0) + 1; });
    return Object.keys(map).sort().reverse().map(function (m) { return { key: m, count: map[m] }; });
  }
  function filteredRecords() {
    var q = state.query.trim().toLowerCase();
    return lib.records.filter(function (r) {
      if (state.tab === "firsts" && !r.first) return false;
      if (state.tab === "quotes" && !r.quote) return false;
      if (state.year && r.day.slice(0, 4) !== state.year) return false;
      if (state.month && r.day.slice(0, 7) !== state.month) return false;
      if (state.person && (r.persons || []).indexOf(state.person) < 0) return false;
      if (q && (r.title + "\\n" + r.text + "\\n" + r.location).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(byDate);
  }
  function renderSide() {
    if (state.tab !== "records" && state.tab !== "firsts" && state.tab !== "quotes") return "";
    var out = '<a href="#" data-year="" data-month="" class="' + (!state.year && !state.month ? "on" : "") + '">全部</a>';
    var year = "";
    months().forEach(function (m) {
      var y = m.key.slice(0, 4);
      if (y !== year) { year = y; out += '<a href="#" class="year ' + (state.year === y && !state.month ? "on" : "") + '" data-year="' + y + '" data-month="">' + y + " 年</a>"; }
      out += '<a href="#" class="' + (state.month === m.key ? "on" : "") + '" data-year="' + y + '" data-month="' + m.key + '">' + monthLabel(m.key) + ' <span class="muted">' + m.count + "</span></a>";
    });
    return out;
  }
  function renderRecords() {
    var list = filteredRecords();
    var out = '<input class="search" id="q" placeholder="搜索标题、内容或地点" value="' + esc(state.query) + '">';
    if (state.person) out += '<div class="muted">只看有「' + esc(state.person) + '」的记录 · <a href="#" data-person="">全部</a></div>';
    if (!list.length) out += '<div class="empty">' + (lib.records.length ? "没有匹配的记录。" : "这份归档里还没有记录。") + "</div>";
    return out + list.map(recordCard).join("");
  }
  function renderLetters() {
    var today = todayKey();
    if (!lib.letters.length) return '<div class="empty">这份归档里没有信。</div>';
    return lib.letters.map(function (l) {
      var open = !!l.openedAt || l.openAt <= today;
      var title = esc(l.title || "一封信");
      if (!open) return '<article class="card envelope"><div class="stamp">' + esc(Array.from((l.from || "").trim())[0] || "信") + "</div><h3>" + title +
        '</h3><div class="muted">还没到日子 · 封存至 ' + esc(dayLabel(l.openAt)) + (l.from ? " · " + esc(l.from) : "") + '</div><div class="muted">写于 ' + esc(dayLabel(l.writtenAt.slice(0, 10))) + "</div></article>";
      return '<article class="card"><h3>' + title + '</h3><div class="muted">写于 ' + esc(dayLabel(l.writtenAt.slice(0, 10))) +
        (l.openedAt ? " · 拆于 " + esc(dayLabel(l.openedAt.slice(0, 10))) : "") + '</div><p class="text">' + esc(l.text) + "</p>" +
        (l.from ? '<div class="sign">—— ' + esc(l.from) + "</div>" : "") + mediaHtml(l.media) + "</article>";
    }).join("");
  }
  function renderAlbums() {
    if (!lib.albums.length) return '<div class="empty">没有相册。</div>';
    var byId = {};
    lib.records.forEach(function (r) { byId[r.id] = r; });
    return lib.albums.map(function (a) {
      return '<section><h2>' + esc(a.name) + "</h2>" + (a.note ? '<p class="text muted">' + esc(a.note) + "</p>" : "") +
        a.recordIds.map(function (id) { return byId[id] ? recordCard(byId[id]) : ""; }).join("") + "</section>";
    }).join("");
  }
  function renderSeries() {
    if (!lib.series.length) return '<div class="empty">没有时光系列。</div>';
    return lib.series.map(function (t) {
      return '<section class="card"><h3>' + esc(t.name) + '</h3><div class="grid">' + t.items.map(function (i) {
        return '<figure><img loading="lazy" src="' + src(i.path) + '" alt="' + esc(i.month) + '"><figcaption class="muted">' + esc(i.month) + "</figcaption></figure>";
      }).join("") + "</div></section>";
    }).join("");
  }
  function renderNotes() {
    var years = Object.keys(lib.yearNotes).sort().reverse();
    if (!years.length) return '<div class="empty">没有寄语。</div>';
    return years.map(function (y) { return '<article class="card"><h3>' + esc(y) + ' 年的话</h3><p class="text">' + esc(lib.yearNotes[y]) + "</p></article>"; }).join("");
  }
  function renderPersons() {
    if (!lib.persons.length) return '<div class="empty">没有标记过人物。</div>';
    return '<div class="card">' + lib.persons.map(function (p) {
      return '<a href="#" class="chip" data-person="' + esc(p.name) + '">' + esc(p.name) + ' <span class="muted">' + p.records + "</span></a> ";
    }).join("") + "</div>";
  }
  var TABS = [
    ["records", "记录", function () { return true; }],
    ["firsts", "第一次", function () { return lib.records.some(function (r) { return r.first; }); }],
    ["quotes", "她说的话", function () { return lib.records.some(function (r) { return r.quote; }); }],
    ["letters", "时间胶囊", function () { return lib.letters.length > 0; }],
    ["albums", "相册", function () { return lib.albums.length > 0; }],
    ["series", "时光系列", function () { return lib.series.length > 0; }],
    ["notes", "寄语", function () { return Object.keys(lib.yearNotes).length > 0; }],
    ["persons", "人物", function () { return lib.persons.length > 0; }]
  ];
  function render() {
    if (!lib) {
      el("content").innerHTML = '<div class="empty">找不到 library.js。请把 index.html 放回归档文件夹再打开。</div>';
      return;
    }
    var name = lib.child.name || lib.child.fullName || "成长记录";
    var nick = lib.child.name || "";
    var full = lib.child.fullName || "";
    var line = nick && full ? full + " · 小名" + nick : "";
    el("title").innerHTML = esc(name) + "的成长记录";
    el("name-story").innerHTML = (line ? '<div class="muted">' + esc(line) + '</div>' : '') +
      (lib.child.motto ? '<p class="title-motto">' + esc(lib.child.motto) + '</p>' : '');
    var count = lib.records.length + " 条记录";
    if (lib.year) count = lib.year + " 年 · " + count;
    el("subtitle").innerHTML = esc(count) + (lib.child.birthday ? " · 生日 " + esc(dayLabel(lib.child.birthday)) : "") + " · 导出于 " + esc(dayLabel(lib.createdAt.slice(0, 10)));
    el("tabs").innerHTML = TABS.filter(function (t) { return t[2](); }).map(function (t) {
      return '<button class="tab ' + (state.tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>";
    }).join("");
    el("side").innerHTML = renderSide();
    var body = state.tab === "letters" ? renderLetters() : state.tab === "albums" ? renderAlbums() : state.tab === "series" ? renderSeries() :
      state.tab === "notes" ? renderNotes() : state.tab === "persons" ? renderPersons() : renderRecords();
    el("content").innerHTML = body;
  }
  function go(patch) { for (var k in patch) state[k] = patch[k]; render(); }
  function closest(node, attr) {
    while (node && node.getAttribute) { if (node.hasAttribute(attr)) return node; node = node.parentNode; }
    return null;
  }
  el("tabs").addEventListener("click", function (e) {
    var t = closest(e.target, "data-tab");
    if (t) go({ tab: t.getAttribute("data-tab"), person: "" });
  });
  el("side").addEventListener("click", function (e) {
    var a = closest(e.target, "data-month");
    if (!a) return;
    e.preventDefault();
    go({ year: a.getAttribute("data-year"), month: a.getAttribute("data-month") });
  });
  el("content").addEventListener("click", function (e) {
    var p = closest(e.target, "data-person");
    if (!p) return;
    e.preventDefault();
    go({ tab: "records", person: p.getAttribute("data-person"), year: "", month: "" });
  });
  el("content").addEventListener("input", function (e) {
    if (e.target && e.target.id === "q") {
      state.query = e.target.value;
      var q = e.target, at = q.selectionStart;
      render();
      var again = el("q");
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (err) {} }
    }
  });
  window.ANAN_VIEWER = { render: render, go: go, state: state };
  render();
})();
</script>
</body>
</html>
`;
