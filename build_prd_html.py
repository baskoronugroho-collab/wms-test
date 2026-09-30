#!/usr/bin/env python3
"""Wrap PRD.md in a designed HTML shell for publishing as a Substrait/Claude artifact.

Single source of truth is PRD.md. Re-run this after editing it.
"""
import pathlib
import re

HERE = pathlib.Path(__file__).parent
md = (HERE / "PRD.md").read_text(encoding="utf-8")

# Only sequence that could break out of a raw-text <script> block.
# Screen drafts: a line <!--screen:ID--> in PRD.md becomes the block under
# "<!-- @screen ID -->" in docs/wi-screens.html. Blank lines are dropped so that
# markdown keeps each block as one HTML block.
_bits = re.split(r"<!-- @screen ([\w-]+) -->",
                 (HERE / "docs" / "wi-screens.html").read_text(encoding="utf-8"))
SCREENS = {
    key: "\n".join(line.strip() for line in html.strip().splitlines() if line.strip())
    for key, html in zip(_bits[1::2], _bits[2::2])
}


def _screen(m):
    key = m.group(1)
    if key not in SCREENS:
        raise SystemExit(f"PRD.md asks for screen '{key}', not in docs/wi-screens.html")
    return SCREENS[key]


def _prep(text):
    text = re.sub(r"^<!--screen:([\w-]+)-->$", _screen, text, flags=re.M)
    return text.replace("</script", "<\\/script")


md_en = _prep(md)
_id_file = HERE / "PRD.id.md"
md_id = _prep(_id_file.read_text(encoding="utf-8")) if _id_file.exists() else ""
MARKED_JS = (HERE / "docs" / "marked.min.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
SCREEN_CSS = "\n".join(
    (HERE / "docs" / name).read_text(encoding="utf-8")
    for name in ("wi-screens.css", "wi-screens-hiryu.css")
)
SCREEN_JS = (HERE / "docs" / "wi-screens.js").read_text(encoding="utf-8")



HTML = r"""<meta charset="utf-8">
<title>Ninja Kilat WMS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Newsreader:opsz,wght@6..72,380;6..72,500;6..72,600&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap">
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
.meta-grid dd{margin:0;color:var(--ink-2);overflow-wrap:anywhere;min-width:0}

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
  font-family:Archivo,sans-serif;font-weight:600;
  font-size:1.02rem;line-height:1.3;color:var(--ink);
  margin:2rem 0 .6rem;text-wrap:balance;
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

.dock{position:fixed;right:1rem;bottom:calc(1rem + env(safe-area-inset-bottom, 0px));z-index:10;display:flex;gap:.5rem;align-items:center}
.langswitch{display:inline-flex;border:1px solid var(--rule-strong);border-radius:2px;overflow:hidden;background:var(--surface);box-shadow:var(--shadow)}
.langswitch button{font-family:"IBM Plex Mono",monospace;font-size:.68rem;font-weight:600;letter-spacing:.08em;background:transparent;color:var(--ink-2);border:0;padding:.5rem .7rem;cursor:pointer}
.langswitch button+button{border-left:1px solid var(--rule-strong)}
.langswitch button.on{background:var(--signal);color:var(--paper)}
.langswitch button:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
/* v4.1: step cards, term boxes, links to and from the process map */
main ol.steps{list-style:none;padding-left:0;counter-reset:step;display:flex;flex-direction:column;gap:.55rem;max-width:72ch}
main ol.steps>li{counter-increment:step;position:relative;margin:0;padding:.7rem .9rem .75rem 2.9rem;border:1px solid var(--rule);border-radius:4px;background:var(--surface)}
main ol.steps>li::before{content:counter(step);position:absolute;left:.8rem;top:.72rem;width:1.45rem;height:1.45rem;border-radius:50%;background:var(--ink);color:var(--paper);font:600 .74rem/1.45rem "IBM Plex Mono",monospace;text-align:center}
main ol.steps>li>p{margin:.15rem 0 .35rem}
main ol.steps>li>p:first-child{margin-top:0}
main ol.steps>li>p:first-child>strong:first-child{font-family:Archivo,sans-serif;font-size:.95rem}
main ol.steps>li>p:last-child{margin-bottom:0}
main ol.steps>li>ul{margin:.3rem 0 .4rem}
main p.see{color:var(--accept);font-size:.92rem}
main blockquote{margin:1.1rem 0 1.4rem;padding:.8rem 1rem;border-left:4px solid var(--rule-strong);background:var(--surface-2);border-radius:0 4px 4px 0;max-width:68ch}
main blockquote p{margin:0 0 .35rem}
main blockquote p:last-child{margin-bottom:0}
main blockquote.term{border-left-color:var(--warn)}
main blockquote.term>p:first-child>strong:first-child{display:block;font-family:"IBM Plex Mono",monospace;font-size:.72rem;letter-spacing:.07em;text-transform:uppercase;color:var(--warn);margin-bottom:.2rem}
main a.up{font-family:"IBM Plex Mono",monospace;font-size:.62rem;font-weight:600;letter-spacing:.06em;color:var(--ink-3);text-decoration:none;margin-left:.6rem;white-space:nowrap;vertical-align:middle}
main a.up:hover{color:var(--signal)}
main :target{scroll-margin-top:1.2rem}
main h3:target,main h4:target{background:var(--signal-soft);box-shadow:0 0 0 .35rem var(--signal-soft);border-radius:2px}
@media print{main a.up{display:none}}
.fb{margin:1.1rem 0 1.8rem;padding:.7rem .8rem .75rem;border:1px dashed var(--rule-strong);border-radius:4px;background:var(--surface);display:flex;flex-direction:column;gap:.5rem}
.fb.has{border-style:solid;border-color:var(--ink-3)}
.fb__top{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .6rem}
.fb__label{font-family:"IBM Plex Mono",monospace;font-size:.66rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-right:auto}
.fb__v{font:600 .72rem/1 Archivo,sans-serif;border:1px solid var(--rule-strong);background:transparent;color:var(--ink-2);border-radius:999px;padding:.32rem .65rem;cursor:pointer}
.fb__v:hover{color:var(--ink);border-color:var(--ink-3)}
.fb__v[aria-pressed="true"][data-v="ok"]{background:var(--accept);border-color:var(--accept);color:var(--paper)}
.fb__v[aria-pressed="true"][data-v="change"]{background:var(--signal);border-color:var(--signal);color:var(--paper)}
.fb__v[aria-pressed="true"][data-v="question"]{background:var(--warn);border-color:var(--warn);color:var(--paper)}
.fb textarea{width:100%;min-height:2.4rem;resize:vertical;border:1px solid var(--rule);border-radius:3px;background:var(--paper);color:var(--ink);padding:.45rem .55rem;font:inherit;font-size:.92rem;line-height:1.45}
.fb textarea:focus{outline:2px solid var(--signal);outline-offset:1px}
.fb__saved{font-family:"IBM Plex Mono",monospace;font-size:.62rem;color:var(--ink-3);min-height:.8rem}
.fbbtn{font-family:"IBM Plex Mono",monospace;font-size:.63rem;letter-spacing:.08em;text-transform:uppercase;background:var(--surface);color:var(--ink-2);border:1px solid var(--rule-strong);padding:.5rem .7rem;cursor:pointer;border-radius:2px;box-shadow:var(--shadow)}
.fbbtn b{color:var(--signal)}
.fbbtn:hover{color:var(--ink)}
.fbbtn:focus-visible,.fb__v:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.fbtoast{position:fixed;left:50%;bottom:calc(4.2rem + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);background:var(--ink);color:var(--paper);font-size:.8rem;padding:.5rem .8rem;border-radius:3px;z-index:11}
@media print{.fb,.fbbtn{display:none}}
.l-id{display:none}
html[lang="id"] .l-id{display:inline}
html[lang="id"] .l-en{display:none}
.themetoggle{
  font-family:"IBM Plex Mono",monospace;font-size:.63rem;letter-spacing:.1em;text-transform:uppercase;
  background:var(--surface);color:var(--ink-2);border:1px solid var(--rule-strong);
  padding:.5rem .7rem;cursor:pointer;border-radius:2px;box-shadow:var(--shadow);
}
.themetoggle:hover{color:var(--ink)}
.themetoggle:focus-visible{outline:2px solid var(--signal);outline-offset:2px}

@media print{
  .dock,nav.toc{display:none}
  .wrap{grid-template-columns:1fr;max-width:none}
  body{background:#fff;color:#000;font-size:10.5pt}
  main h2{break-after:avoid}
  .tablewrap,pre{break-inside:avoid}
}
__SCREEN_CSS__
</style>

<div class="wrap">
  <header class="masthead">
    <div class="eyebrow">
      <span data-en="Requirements and working instruction" data-id="Kebutuhan sistem dan instruksi kerja">Requirements and working instruction</span><span>v3.3</span><span class="muted" data-en="Kahf and Labore go-live" data-id="Go-live Kahf dan Labore">Kahf and Labore go-live</span>
    </div>
    <h1 class="title" id="doc-title">Ninja Kilat WMS</h1>
    <p class="standfirst" id="standfirst" data-en="How the dark-store WMS works for GrabMart Kilat, step by step for staff, supervisors and Ops HQ, and what the build team has to make. Hiryu and the WMS are not linked yet, so orders cross by copy and paste and stock by typing." data-id="Cara kerja WMS dark store untuk GrabMart Kilat, langkah demi langkah untuk staf, supervisor dan Ops HQ, dan apa yang harus dibuat tim pengembang. Hiryu dan WMS belum terhubung, jadi pesanan dipindahkan dengan salin dan tempel, dan stok dengan diketik.">How the dark-store WMS works for GrabMart Kilat, step by step for staff, supervisors and Ops HQ, and what the build team has to make. Hiryu and the WMS are not linked yet, so orders cross by copy and paste and stock by typing.</p>
    <div class="figs">
      <div class="fig"><b>105</b><i data-en="SKUs: Kahf 68, Labore 37" data-id="SKU: Kahf 68, Labore 37">SKUs: Kahf 68, Labore 37</i></div>
      <div class="fig"><b>2</b><i data-en="hubs: MA5, then KJ5" data-id="hub: MA5, lalu KJ5">hubs: MA5, then KJ5</i></div>
      <div class="fig"><b>__NSCREENS__</b><i data-en="screen drafts, __NHIRYU__ of them Hiryu" data-id="draf layar, __NHIRYU__ dari Hiryu">screen drafts, __NHIRYU__ of them Hiryu</i></div>
      <div class="fig"><b>10</b><i data-en="minutes to Mark ready" data-id="menit sampai Mark ready">minutes to Mark ready</i></div>
    </div>
    <dl class="meta-grid" id="meta"></dl>
  </header>

  <nav class="toc" aria-label="Contents">
    <h2 data-en="Contents" data-id="Daftar isi">Contents</h2>
    <ol id="toc"></ol>
  </nav>

  <main id="doc"></main>

  <footer class="colophon">
    <span data-en="Ninja Van &times; GrabMart Kilat &middot; fulfilment" data-id="Ninja Van &times; GrabMart Kilat &middot; fulfilment">Ninja Van &times; GrabMart Kilat &middot; fulfilment</span>
    <span data-en="Governed by: QC Systems, Hiryu, WMS, TMS (ChangWen) &middot; owner decisions 3 to 30 Sep &middot; screens are drafts" data-id="Acuan: QC Systems, Hiryu, WMS, TMS (ChangWen) &middot; keputusan pemilik 3 sampai 30 Sep &middot; layar masih draf">Governed by: QC Systems, Hiryu, WMS, TMS (ChangWen) &middot; owner decisions 3 to 30 Sep &middot; screens are drafts</span>
    <span>30 September 2026</span>
  </footer>
</div>

<div class="dock">
  <div class="langswitch" role="group" aria-label="Language / Bahasa">
    <button type="button" data-lang="en" class="on" aria-pressed="true">EN</button><button type="button" data-lang="id" aria-pressed="false">ID</button>
  </div>
  <button class="fbbtn" id="fbcopy" type="button" title="Copy all feedback"><span data-en="Feedback" data-id="Masukan">Feedback</span> <b id="fbcount">0</b></button>
  <button class="themetoggle" id="tt" type="button" data-en="Theme" data-id="Tema">Theme</button>
</div>

<script type="text/markdown" id="src-en">
__MARKDOWN_EN__
</script>
<script type="text/markdown" id="src-id">
__MARKDOWN_ID__
</script>
<script>
__MARKED_JS__
</script>
<script>
(function(){
  var mount = document.getElementById('doc');
  var toc = document.getElementById('toc');
  var dl = document.getElementById('meta');
  var io = null;
  var SRC = {
    en: document.getElementById('src-en').textContent,
    id: document.getElementById('src-id').textContent
  };
  if (!SRC.id.trim()) SRC.id = SRC.en;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function render(lang) {
    var raw = SRC[lang] || SRC.en;
    document.documentElement.setAttribute('lang', lang);
    document.querySelectorAll('[data-en][data-id]').forEach(function(el){
      el.innerHTML = el.getAttribute('data-' + lang);
    });
    document.querySelectorAll('.langswitch button').forEach(function(b){
      var on = b.getAttribute('data-lang') === lang;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    if (typeof marked === 'undefined') {
      mount.innerHTML = '';
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
    dl.innerHTML = '';
    var first = mount.querySelector('table');
    if (first) {
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
      first.remove();
    }

    /* wrap every remaining table so wide ones scroll inside themselves */
    mount.querySelectorAll('table').forEach(function(t){
      if (t.closest('.dev, .hy')) return;
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

    /* [DECIDED] / [DIPUTUSKAN] become badges on their heading */
    mount.querySelectorAll('h3 strong').forEach(function(s){
      var t = s.textContent.trim();
      if (t.charAt(0) !== '[') return;
      var b = document.createElement('span');
      b.className = 'badge' + (/DECIDED|DIPUTUSKAN/.test(t) ? '' : ' derived');
      b.textContent = t.replace(/^\[|\]$/g,'');
      s.replaceWith(b);
    });

    /* ids + contents rail, numbered from the spec's own section numbers */
    toc.innerHTML = '';
    var seen = {};
    mount.querySelectorAll('h1, h2').forEach(function(h, i){
      var text = h.textContent.trim();
      if (h.tagName === 'H1') {
        h.classList.add('part');
        var pl = document.createElement('li');
        pl.className = 'part';
        pl.textContent = text.replace(/^(?:Part|Bagian)\s+([A-Z])\.\s*/, '$1 · ');
        toc.appendChild(pl);
        return;
      }
      var m = text.match(/^([A-C]?\d+)\.\s*(.*)$/);
      var num = m ? m[1] : '';
      var label = m ? m[2] : text;
      var slug = (num ? 's' + num.toLowerCase() : /^(Process map|Peta proses)$/.test(label) ? 'process-map' : label.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')) || 'section';
      if (seen[slug]) { slug += '-' + (++seen[slug]); } else { seen[slug] = 1; }
      h.id = slug;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + slug;
      a.innerHTML = '<span class="n">' + (num ? num : '&middot;') + '</span><span>' + label + '</span>';
      li.appendChild(a); toc.appendChild(li);
    });

    /* scroll spy */
    var links = Array.prototype.slice.call(toc.querySelectorAll('a'));
    var heads = Array.prototype.slice.call(mount.querySelectorAll('h2'));
    if (io) io.disconnect();
    if ('IntersectionObserver' in window && heads.length) {
      io = new IntersectionObserver(function(){
        var above = heads.filter(function(h){ return h.getBoundingClientRect().top <= 120; });
        var best = above.length ? above[above.length - 1] : heads[0];
        links.forEach(function(a){ a.classList.toggle('on', a.getAttribute('href') === '#' + best.id); });
      }, { rootMargin: '-100px 0px -60% 0px', threshold: [0, 1] });
      heads.forEach(function(h){ io.observe(h); });
    }

    if (window.WMS_initRacks) window.WMS_initRacks();
    widenShots();
    addFeedback();
    decorate(lang);
  }

  /* Screen drafts are wider than the text column. Let each one use the free
     space to the right of the column, up to its real width, so tables are
     not cut off; only a window too narrow for the frame still scrolls. */
  function widenShots() {
    mount.querySelectorAll('figure.shot').forEach(function (f) {
      f.style.width = ''; f.style.maxWidth = '';
      var natural = 0;
      Array.prototype.forEach.call(f.children, function (c) { natural = Math.max(natural, c.scrollWidth); });
      var room = document.documentElement.clientWidth - f.getBoundingClientRect().left - 20;
      var w = Math.min(natural + 2, room);
      if (w > f.clientWidth) { f.style.width = w + 'px'; f.style.maxWidth = 'none'; }
    });
  }
  var widenTimer = null;
  window.addEventListener('resize', function () { clearTimeout(widenTimer); widenTimer = setTimeout(widenShots, 150); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(widenShots);


  /* ---------- feedback: a box under every numbered point ----------
     Saved to the artifact's own store (db capability, collection
     "feedback", one document per point) so Claude can read it back.
     Where that store is not available (the downloaded file) it is kept
     in this browser, and the Feedback button copies everything as text. */
  var FB = {}, fbDb = null, fbTimers = {};
  var FB_TXT = {
    en: { label: 'Feedback on', ok: 'Looks right', change: 'Change', question: 'Question',
          ph: 'Type your feedback on this point', saved: 'Saved', local: 'Saved in this browser',
          copied: 'All feedback copied. Paste it to Claude.', none: 'No feedback yet' },
    id: { label: 'Masukan untuk', ok: 'Sudah benar', change: 'Ubah', question: 'Tanya',
          ph: 'Tulis masukan untuk poin ini', saved: 'Tersimpan', local: 'Tersimpan di browser ini',
          copied: 'Semua masukan disalin. Tempel ke Claude.', none: 'Belum ada masukan' }
  };
  function fbLang() { return document.documentElement.getAttribute('lang') === 'id' ? 'id' : 'en'; }
  try { FB = JSON.parse(store('wms-prd-feedback') || '{}') || {}; } catch (e) { FB = {}; }

  function fbCount() {
    var n = Object.keys(FB).filter(function (k) { var f = FB[k]; return f && (f.note || f.verdict); }).length;
    var el = document.getElementById('fbcount'); if (el) el.textContent = n;
    return n;
  }
  function fbWhen(iso) {
    try { return new Date(iso).toLocaleString(fbLang() === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function fbPaint(box) {
    var key = box.getAttribute('data-key'), f = FB[key] || {}, T = FB_TXT[fbLang()];
    box.querySelectorAll('.fb__v').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === f.verdict ? 'true' : 'false'); });
    var ta = box.querySelector('textarea');
    if (document.activeElement !== ta && ta.value !== (f.note || '')) ta.value = f.note || '';
    box.classList.toggle('has', !!(f.note || f.verdict));
    box.querySelector('.fb__saved').textContent = f.at ? (fbDb ? T.saved : T.local) + ' · ' + fbWhen(f.at) : '';
  }
  function fbSave(key, title) {
    var f = FB[key] || (FB[key] = {});
    f.title = title; f.at = new Date().toISOString();
    store('wms-prd-feedback', JSON.stringify(FB));
    fbCount();
    var box = mount.querySelector('.fb[data-key="' + key + '"]'); if (box) fbPaint(box);
    if (!fbDb) return;
    clearTimeout(fbTimers[key]);
    fbTimers[key] = setTimeout(function () {
      fbDb.doc('feedback/s' + key).set({ section: key, title: f.title || '', verdict: f.verdict || '', note: f.note || '', at: f.at })
        .catch(function () { /* stays in this browser; the copy button still has it */ });
    }, 600);
  }
  function addFeedback() {
    var T = FB_TXT[fbLang()];
    var heads = Array.prototype.slice.call(mount.querySelectorAll('h2, h3, h4'));
    heads.forEach(function (h, i) {
      if (h.tagName === 'H2') return;
      var m = h.textContent.trim().match(/^(\d+(?:\.\d+)+)\s+(.*)$/);
      if (!m) return;
      var key = m[1], title = m[2].replace(/\s+/g, ' ').trim();
      var box = document.createElement('div');
      box.className = 'fb'; box.setAttribute('data-key', key);
      box.innerHTML =
        '<div class="fb__top"><span class="fb__label">' + T.label + ' ' + key + '</span>' +
        '<button type="button" class="fb__v" data-v="ok">' + T.ok + '</button>' +
        '<button type="button" class="fb__v" data-v="change">' + T.change + '</button>' +
        '<button type="button" class="fb__v" data-v="question">' + T.question + '</button></div>' +
        '<textarea id="fb-' + key.replace(/\./g, '-') + '" rows="2" aria-label="' + T.label + ' ' + key + '" placeholder="' + T.ph + '"></textarea>' +
        '<span class="fb__saved"></span>';
      /* the box closes the point: just before the next heading, or at the end */
      var next = heads[i + 1];
      if (next) next.parentNode.insertBefore(box, next); else mount.appendChild(box);
      box.querySelectorAll('.fb__v').forEach(function (b) {
        b.addEventListener('click', function () {
          var f = FB[key] || (FB[key] = {});
          f.verdict = f.verdict === b.getAttribute('data-v') ? '' : b.getAttribute('data-v');
          fbSave(key, title);
        });
      });
      box.querySelector('textarea').addEventListener('input', function (e) {
        (FB[key] || (FB[key] = {})).note = e.target.value; fbSave(key, title);
      });
      fbPaint(box);
    });
    fbCount();
  }
  function fbToast(msg) {
    var t = document.createElement('div'); t.className = 'fbtoast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function fbText() {
    var names = { ok: 'Looks right', change: 'Change', question: 'Question' };
    return Object.keys(FB).filter(function (k) { return FB[k] && (FB[k].note || FB[k].verdict); })
      .sort(function (a, b) {
        var x = a.split('.').map(Number), y = b.split('.').map(Number);
        for (var i = 0; i < Math.max(x.length, y.length); i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
        return 0;
      })
      .map(function (k) { var f = FB[k]; return k + ' ' + (f.title || '') + (f.verdict ? ' [' + names[f.verdict] + ']' : '') + (f.note ? '\n' + f.note : ''); })
      .join('\n\n');
  }
  document.getElementById('fbcopy').addEventListener('click', function () {
    var T = FB_TXT[fbLang()], text = fbText();
    if (!text) { fbToast(T.none); return; }
    var done = function () { fbToast(T.copied); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { fbToast(T.none); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  });
  if (window.claude && window.claude.use) {
    window.claude.use('db').then(function (d) {
      if (!d) return;
      fbDb = d;
      fbDb.collection('feedback').onSnapshot(function (snap) {
        /* The shared store is the record: a point cleared there (feedback
           closed) is cleared here too. Only an edit still on its way up
           (typed in the last few seconds) is kept. */
        var fresh = {}, now = Date.now();
        snap.docs.forEach(function (doc) {
          var x = doc.data() || {}, key = x.section || doc.id.replace(/^s/, '');
          fresh[key] = { title: x.title, verdict: x.verdict || '', note: x.note || '', at: x.at };
        });
        Object.keys(FB).forEach(function (key) {
          var local = FB[key], remote = fresh[key];
          var pending = local && local.at && now - Date.parse(local.at) < 5000;
          if (pending && (!remote || !remote.at || local.at > remote.at)) fresh[key] = local;
        });
        FB = fresh;
        store('wms-prd-feedback', JSON.stringify(FB));
        mount.querySelectorAll('.fb').forEach(fbPaint); fbCount();
      }, function () {});
    }, function () {});
  }


  /* v4.1: anchors on every numbered point, step cards, term boxes, and a
     way back to the process map from every section. */
  function decorate(lang) {
    mount.querySelectorAll('h3, h4').forEach(function (h) {
      var m = h.textContent.trim().match(/^(\d+(?:\.\d+)+)\s/);
      if (m) h.id = 's' + m[1].replace(/\./g, '-');
    });
    mount.querySelectorAll('ol').forEach(function (ol) {
      var items = Array.prototype.filter.call(ol.children, function (li) { return li.tagName === 'LI'; });
      var cards = items.filter(function (li) {
        var p = li.firstElementChild;
        return p && p.tagName === 'P' && p.firstElementChild && p.firstElementChild.tagName === 'STRONG' &&
               p.firstElementChild.textContent.indexOf('·') !== -1;
      });
      if (items.length && cards.length === items.length) {
        ol.classList.add('steps');
        if (ol.getAttribute('start')) ol.style.counterReset = 'step ' + (parseInt(ol.getAttribute('start'), 10) - 1);
      }
    });
    mount.querySelectorAll('li > p').forEach(function (p) {
      if (/^\s*✓/.test(p.textContent)) p.classList.add('see');
    });
    mount.querySelectorAll('blockquote').forEach(function (b) {
      var s = b.querySelector('p > strong:first-child');
      if (s && /^(Term|Istilah)\b/.test(s.textContent.trim())) b.classList.add('term');
    });
    if (!document.getElementById('process-map')) return;
    var label = lang === 'id' ? '↑ Peta' : '↑ Map';
    mount.querySelectorAll('h2, h3').forEach(function (h) {
      if (!/^\d/.test(h.textContent.trim())) return;
      var a = document.createElement('a');
      a.className = 'up'; a.href = '#process-map'; a.textContent = label;
      a.setAttribute('aria-label', lang === 'id' ? 'Kembali ke peta proses' : 'Back to the process map');
      h.appendChild(a);
    });
  }

  function currentSection() {
    var heads = Array.prototype.slice.call(mount.querySelectorAll('h2'));
    var above = heads.filter(function(h){ return h.getBoundingClientRect().top <= 120; });
    return above.length ? above[above.length - 1].id : null;
  }

  document.querySelectorAll('.langswitch button').forEach(function(b){
    b.addEventListener('click', function(){
      var lang = b.getAttribute('data-lang');
      var keep = currentSection();
      render(lang);
      store('wms-prd-lang', lang);
      if (keep) {
        var el = document.getElementById(keep);
        if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'auto' });
      }
    });
  });

  var start = (location.hash === '#id' || location.hash === '#en') ? location.hash.slice(1) : (store('wms-prd-lang') || 'en');
  window.WMS_render = render;
  render(start === 'id' ? 'id' : 'en');
  /* deep link: prd.html#s0-6 opens at that section once the page has rendered */
  (function () {
    var h = location.hash.slice(1), el = h && h !== 'id' && h !== 'en' && document.getElementById(h);
    if (el) setTimeout(function () { el.scrollIntoView(); }, 50);
  })();

  /* theme toggle: respects the three-state model */
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
<script>
__SCREEN_JS__
</script>
"""

_used = sorted(set(k for k in re.findall(r"^<!--screen:([\w-]+)-->$", md, flags=re.M) if k != "process-map"))
HTML = (HTML.replace("__NSCREENS__", str(len(_used)))
            .replace("__NHIRYU__", str(sum(1 for k in _used if k.startswith(("hiryu", "grab"))))))
out = (HTML.replace("__SCREEN_CSS__", SCREEN_CSS)
           .replace("__SCREEN_JS__", SCREEN_JS)
           .replace("__MARKED_JS__", MARKED_JS)
           .replace("__MARKDOWN_EN__", md_en)
           .replace("__MARKDOWN_ID__", md_id))
(HERE / "PRD.html").write_text(out, encoding="utf-8")
print("wrote PRD.html", len(out), "bytes", "(with Indonesian)" if md_id else "(English only)")

# A complete page for sharing as a file: works offline apart from the web fonts.
share = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
         '<meta name="viewport" content="width=device-width,initial-scale=1">\n</head>\n<body>\n'
         + out + '\n</body>\n</html>\n')
SHARE = HERE / "Ninja Kilat WMS - Working Instruction v4.2.html"
SHARE.write_text(share, encoding="utf-8")
print("wrote", SHARE.name)
