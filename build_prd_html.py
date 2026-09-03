#!/usr/bin/env python3
"""Wrap PRD.md in a designed HTML shell for publishing as a Substrait/Claude artifact.

Single source of truth is PRD.md. Re-run this after editing it.
"""
import pathlib

HERE = pathlib.Path(__file__).parent
md = (HERE / "PRD.md").read_text(encoding="utf-8")

# Only sequence that could break out of a raw-text <script> block.
md_safe = md.replace("</script", "<\\/script")

HTML = r"""<title>Ninja Kilat WMS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Newsreader:opsz,wght@6..72,380;6..72,500;6..72,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{
  --paper:#F6F5F2;
  --surface:#FFFFFF;
  --surface-2:#EEECE6;
  --ink:#191A1C;
  --ink-2:#4B4C50;
  --ink-3:#7D7B77;
  --rule:#DDD9D2;
  --rule-strong:#C3BEB5;
  --signal:#C0202D;
  --signal-soft:#F8E9EA;
  --accept:#1C7346;
  --warn:#8E5F07;
  --code-bg:#ECEAE3;
  --shadow:0 1px 2px rgba(25,26,28,.05);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#131315;
    --surface:#1A1B1E;
    --surface-2:#232429;
    --ink:#EFEDE7;
    --ink-2:#B7B4AE;
    --ink-3:#89867F;
    --rule:#2E2F34;
    --rule-strong:#43444A;
    --signal:#EE5C66;
    --signal-soft:#2B1719;
    --accept:#4FBE86;
    --warn:#D6A244;
    --code-bg:#212227;
    --shadow:0 1px 2px rgba(0,0,0,.4);
  }
}
:root[data-theme="dark"]{
  --paper:#131315;
  --surface:#1A1B1E;
  --surface-2:#232429;
  --ink:#EFEDE7;
  --ink-2:#B7B4AE;
  --ink-3:#89867F;
  --rule:#2E2F34;
  --rule-strong:#43444A;
  --signal:#EE5C66;
  --signal-soft:#2B1719;
  --accept:#4FBE86;
  --warn:#D6A244;
  --code-bg:#212227;
  --shadow:0 1px 2px rgba(0,0,0,.4);
}

*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:1.5rem}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}

body{
  margin:0;
  background:var(--paper);
  color:var(--ink);
  font-family:Newsreader,Georgia,"Times New Roman",serif;
  font-size:17.5px;
  line-height:1.62;
  -webkit-font-smoothing:antialiased;
}

.wrap{
  max-width:1220px;
  margin:0 auto;
  padding:0 clamp(1.1rem,4vw,2.5rem) 6rem;
  display:grid;
  grid-template-columns:238px minmax(0,1fr);
  gap:clamp(2rem,5vw,4.5rem);
  align-items:start;
}
@media (max-width:960px){ .wrap{grid-template-columns:minmax(0,1fr);gap:0} }

/* ---------- masthead ---------- */
.masthead{
  grid-column:1/-1;
  border-bottom:2px solid var(--ink);
  padding:clamp(2.2rem,6vw,3.6rem) 0 1.6rem;
  margin-bottom:2.4rem;
}
.eyebrow{
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.68rem;
  font-weight:500;
  letter-spacing:.16em;
  text-transform:uppercase;
  color:var(--signal);
  display:flex;
  flex-wrap:wrap;
  gap:.55rem;
  align-items:center;
  margin-bottom:1rem;
}
.eyebrow span:not(:last-child)::after{content:"/";margin-left:.55rem;color:var(--rule-strong)}
.eyebrow .muted{color:var(--ink-3)}
h1.title{
  font-family:Archivo,"Helvetica Neue",Arial,sans-serif;
  font-weight:700;
  font-size:clamp(2.1rem,6vw,3.5rem);
  line-height:1.02;
  letter-spacing:-.028em;
  margin:0 0 .7rem;
  text-wrap:balance;
  max-width:18ch;
}
.standfirst{
  font-size:clamp(1.02rem,2.2vw,1.2rem);
  color:var(--ink-2);
  max-width:58ch;
  margin:0 0 2rem;
}
.figs{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(128px,1fr));
  gap:1px;
  background:var(--rule);
  border:1px solid var(--rule);
  margin-bottom:1.8rem;
}
.fig{background:var(--paper);padding:.85rem 1rem}
.fig b{
  display:block;
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-variant-numeric:tabular-nums;
  font-size:1.5rem;
  font-weight:600;
  letter-spacing:-.02em;
  line-height:1.1;
}
.fig i{
  display:block;
  font-style:normal;
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.63rem;
  letter-spacing:.13em;
  text-transform:uppercase;
  color:var(--ink-3);
  margin-top:.3rem;
}
.meta-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(215px,1fr));
  gap:.1rem 2rem;
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.755rem;
  line-height:1.55;
}
.meta-grid div{display:flex;gap:.6rem;padding:.3rem 0;border-bottom:1px solid var(--rule)}
.meta-grid dt{color:var(--ink-3);letter-spacing:.06em;text-transform:uppercase;font-size:.68rem;flex:0 0 6.4rem;margin:0}
.meta-grid dd{margin:0;color:var(--ink-2)}

/* ---------- contents rail ---------- */
nav.toc{position:sticky;top:1.5rem;max-height:calc(100vh - 3rem);overflow-y:auto;padding-right:.4rem}
nav.toc h2{
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.63rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink-3);margin:0 0 .75rem;font-weight:500;
}
nav.toc ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
nav.toc a{
  display:grid;grid-template-columns:2.1rem 1fr;gap:.35rem;
  padding:.3rem 0;
  font-family:Archivo,sans-serif;font-size:.815rem;line-height:1.32;
  color:var(--ink-2);text-decoration:none;border-left:2px solid transparent;padding-left:.7rem;
  transition:color .15s,border-color .15s;
}
nav.toc a .n{font-family:"IBM Plex Mono",monospace;font-size:.7rem;color:var(--ink-3);font-variant-numeric:tabular-nums}
nav.toc a:hover{color:var(--ink)}
nav.toc a.on{color:var(--signal);border-left-color:var(--signal);font-weight:600}
nav.toc a.on .n{color:var(--signal)}
nav.toc a:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.toc-mobile{display:none}
@media (max-width:960px){
  nav.toc{position:static;max-height:none;margin-bottom:2.4rem}
  .toc-mobile{display:block}
  nav.toc>ol{display:none}
  nav.toc[open-toc]>ol{display:flex}
}

/* ---------- prose ---------- */
main{min-width:0}
main h2{
  font-family:Archivo,sans-serif;font-weight:700;
  font-size:clamp(1.5rem,3.4vw,2.05rem);line-height:1.1;letter-spacing:-.022em;
  margin:3.6rem 0 1.1rem;padding-top:1.6rem;border-top:1px solid var(--rule-strong);
  text-wrap:balance;
}
main h2:first-child{margin-top:0;border-top:none;padding-top:0}
main h3{
  font-family:Archivo,sans-serif;font-weight:600;
  font-size:1.18rem;line-height:1.25;letter-spacing:-.012em;
  margin:2.5rem 0 .7rem;text-wrap:balance;
}
main h4{
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:600;
  font-size:.79rem;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-2);
  margin:1.9rem 0 .6rem;
}
main p{margin:0 0 1.05rem;max-width:68ch}
main ul,main ol{margin:0 0 1.15rem;padding-left:1.35rem;max-width:68ch}
main li{margin:0 0 .42rem}
main li::marker{color:var(--ink-3)}
main ul ul,main ol ol,main ul ol,main ol ul{margin-top:.42rem;margin-bottom:.15rem}
main a{color:var(--signal);text-decoration-thickness:1px;text-underline-offset:2px}
main hr{border:none;border-top:1px solid var(--rule);margin:2.6rem 0}
main strong{font-weight:600}
main em{font-style:italic;color:var(--ink-2)}

/* section h2 numbering pulled from the source headings, so it stays true to the spec */
.h2wrap{display:flex;gap:.75rem;align-items:baseline}

/* requirement ids — M1.3.4 / E8 / Q1 / G1 — the document's own addressing scheme */
li>strong.req{
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.79em;font-weight:600;letter-spacing:.02em;
  color:var(--signal);
  background:var(--signal-soft);
  padding:.08em .38em;border-radius:2px;margin-right:.15em;
  white-space:nowrap;
}

/* decision badges */
.badge{
  display:inline-block;vertical-align:.09em;
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.6rem;font-weight:600;letter-spacing:.11em;text-transform:uppercase;
  padding:.22em .5em;border-radius:2px;margin-left:.5rem;
  background:var(--accept);color:var(--paper);
}
.badge.derived{background:var(--ink-3)}

/* code */
code{
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.845em;
  background:var(--code-bg);
  padding:.1em .34em;border-radius:2px;
  word-break:break-word;
}
pre{
  background:var(--surface-2);
  border:1px solid var(--rule);
  border-left:3px solid var(--rule-strong);
  padding:1.05rem 1.15rem;
  overflow-x:auto;
  margin:0 0 1.4rem;
  font-size:.79rem;line-height:1.55;
}
pre code{background:none;padding:0;font-size:1em;white-space:pre}

/* tables */
.tablewrap{overflow-x:auto;margin:0 0 1.6rem;border:1px solid var(--rule);background:var(--surface);box-shadow:var(--shadow)}
table{border-collapse:collapse;width:100%;font-size:.845rem;line-height:1.45}
th,td{padding:.6rem .85rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--rule)}
thead th{
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.65rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);background:var(--surface-2);
  border-bottom:1px solid var(--rule-strong);white-space:nowrap;
}
tbody tr:last-child td{border-bottom:none}
td{font-family:Newsreader,Georgia,serif;font-variant-numeric:tabular-nums}
td:first-child{color:var(--ink)}
table code{font-size:.8em}

/* nested basket table inside a list item */
main li .tablewrap{margin:.7rem 0 1rem}

footer.colophon{
  grid-column:1/-1;
  margin-top:4rem;padding-top:1.4rem;border-top:2px solid var(--ink);
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:.68rem;letter-spacing:.05em;color:var(--ink-3);
  display:flex;flex-wrap:wrap;gap:.5rem 1.6rem;justify-content:space-between;
}

.themetoggle{
  position:fixed;right:1rem;bottom:1rem;z-index:10;
  font-family:"IBM Plex Mono",monospace;font-size:.63rem;letter-spacing:.1em;text-transform:uppercase;
  background:var(--surface);color:var(--ink-2);border:1px solid var(--rule-strong);
  padding:.5rem .7rem;cursor:pointer;border-radius:2px;box-shadow:var(--shadow);
}
.themetoggle:hover{color:var(--ink)}
.themetoggle:focus-visible{outline:2px solid var(--signal);outline-offset:2px}

@media print{
  .themetoggle,nav.toc{display:none}
  .wrap{grid-template-columns:1fr;max-width:none}
  body{background:#fff;color:#000;font-size:10.5pt}
  main h2{break-after:avoid}
  .tablewrap,pre{break-inside:avoid}
}
</style>

<div class="wrap">
  <header class="masthead">
    <div class="eyebrow">
      <span>Product Requirements</span><span>v0.1</span><span class="muted">Draft for review</span>
    </div>
    <h1 class="title" id="doc-title">Ninja Kilat WMS</h1>
    <p class="standfirst" id="standfirst">The physical-inventory layer underneath the GrabMart Kilat POS: where a unit goes, where a picker finds it, and whether it is actually still there.</p>
    <div class="figs">
      <div class="fig"><b>118</b><i>Wardah SKUs</i></div>
      <div class="fig"><b>10</b><i>stations at scale</i></div>
      <div class="fig"><b>28</b><i>exceptions deferred</i></div>
      <div class="fig"><b>16</b><i>open questions</i></div>
    </div>
    <dl class="meta-grid" id="meta"></dl>
  </header>

  <nav class="toc" aria-label="Contents">
    <h2>Contents</h2>
    <ol id="toc"></ol>
  </nav>

  <main id="doc"></main>

  <footer class="colophon">
    <span>Ninja Van &times; GrabMart Kilat &middot; fulfilment</span>
    <span>Sources: HANDOFF.md &middot; Space Model &middot; Substrait deploy contract</span>
    <span>3 September 2026</span>
  </footer>
</div>

<button class="themetoggle" id="tt" type="button">Theme</button>

<script type="text/markdown" id="src">
__MARKDOWN__
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
(function(){
  var raw = document.getElementById('src').textContent;
  var mount = document.getElementById('doc');

  if (typeof marked === 'undefined') {
    var pre = document.createElement('pre');
    pre.textContent = raw;
    mount.appendChild(pre);
    return;
  }

  marked.setOptions({ gfm: true, breaks: false });
  mount.innerHTML = marked.parse(raw);

  /* lift the H1 and the metadata table out of the flow into the masthead */
  var h1 = mount.querySelector('h1');
  if (h1) h1.remove();

  var first = mount.querySelector('table');
  if (first) {
    var dl = document.getElementById('meta');
    first.querySelectorAll('tbody tr').forEach(function(tr){
      var c = tr.querySelectorAll('td');
      if (c.length < 2) return;
      var row = document.createElement('div');
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = c[0].textContent.replace(/\s+/g,' ').trim();
      dd.innerHTML = c[1].innerHTML;
      row.appendChild(dt); row.appendChild(dd); dl.appendChild(row);
    });
    var w = first.closest('.tablewrap') || first;
    w.remove();
  }

  /* wrap every remaining table so wide ones scroll inside themselves */
  mount.querySelectorAll('table').forEach(function(t){
    if (t.parentElement && t.parentElement.classList.contains('tablewrap')) return;
    var d = document.createElement('div');
    d.className = 'tablewrap';
    t.parentNode.insertBefore(d, t);
    d.appendChild(t);
  });

  /* requirement ids get the document's own mono addressing treatment */
  var ID = /^(?:M\d|E\d|Q\d|G\d|NG\d|\d+\.\d)/;
  mount.querySelectorAll('li > strong:first-child').forEach(function(s){
    if (ID.test(s.textContent.trim())) s.classList.add('req');
  });

  /* [DECIDED] / [FALLS OUT OF THE SPACE MODEL] become badges on their heading */
  mount.querySelectorAll('h3 strong').forEach(function(s){
    var t = s.textContent.trim();
    if (t.charAt(0) !== '[') return;
    var b = document.createElement('span');
    b.className = 'badge' + (t.indexOf('DECIDED') === -1 ? ' derived' : '');
    b.textContent = t.replace(/^\[|\]$/g,'');
    s.replaceWith(b);
  });

  /* ids + contents rail, numbered from the spec's own section numbers */
  var toc = document.getElementById('toc');
  var seen = {};
  mount.querySelectorAll('h2').forEach(function(h){
    var text = h.textContent.trim();
    var m = text.match(/^(\d+)\.\s*(.*)$/);
    var num = m ? m[1] : '';
    var label = m ? m[2] : text;
    var slug = label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'section';
    if (seen[slug]) { slug += '-' + (++seen[slug]); } else { seen[slug] = 1; }
    h.id = slug;

    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + slug;
    a.innerHTML = '<span class="n">' + (num ? num : '&mdash;') + '</span><span>' + label + '</span>';
    li.appendChild(a); toc.appendChild(li);
  });

  /* scroll spy */
  var links = Array.prototype.slice.call(toc.querySelectorAll('a'));
  var heads = Array.prototype.slice.call(mount.querySelectorAll('h2'));
  if ('IntersectionObserver' in window) {
    var vis = new Map();
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ vis.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0); });
      var best = null, bestTop = Infinity;
      heads.forEach(function(h){
        var r = h.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.4 && r.top > -window.innerHeight && r.top < bestTop) { }
      });
      var above = heads.filter(function(h){ return h.getBoundingClientRect().top <= 120; });
      best = above.length ? above[above.length - 1] : heads[0];
      links.forEach(function(a){ a.classList.toggle('on', a.getAttribute('href') === '#' + best.id); });
    }, { rootMargin: '-100px 0px -60% 0px', threshold: [0, 1] });
    heads.forEach(function(h){ io.observe(h); });
  }

  /* theme toggle — respects the three-state model */
  var tt = document.getElementById('tt');
  tt.addEventListener('click', function(){
    var r = document.documentElement;
    var cur = r.getAttribute('data-theme');
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var showingDark = cur ? cur === 'dark' : systemDark;
    r.setAttribute('data-theme', showingDark ? 'light' : 'dark');
  });
})();
</script>
"""

out = HTML.replace("__MARKDOWN__", md_safe)
(HERE / "PRD.html").write_text(out, encoding="utf-8")
print("wrote PRD.html", len(out), "bytes")
