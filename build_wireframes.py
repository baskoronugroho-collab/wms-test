#!/usr/bin/env python3
"""Build the wireframe audit page: every screen draft in PRD.md at full size.

The PRD shows its screens inside a 640 px text column, where the 860 px
frames get cut off on the right. This page has no text column: each screen
gets the full width, in PRD order, with the section it belongs to and a
verdict and note box for the review. Notes are kept in the artifact's shared
store (db capability, collection "notes", one document per screen id) so
they can be read back after the audit.

    python build_wireframes.py      -> Wireframes.html
"""
import html
import pathlib
import re

HERE = pathlib.Path(__file__).parent
DOCS = HERE / "docs"

_bits = re.split(r"<!-- @screen ([\w-]+) -->", (DOCS / "wi-screens.html").read_text(encoding="utf-8"))
SCREENS = {k: v.strip() for k, v in zip(_bits[1::2], _bits[2::2])}
SCREEN_CSS = "\n".join((DOCS / n).read_text(encoding="utf-8") for n in ("wi-screens.css", "wi-screens-hiryu.css"))
SCREEN_JS = (DOCS / "wi-screens.js").read_text(encoding="utf-8")


def walk(path):
    """Screens in document order, each with the ## and ### heading above it."""
    h2 = h3 = ""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            h2 = h3 = ""
        elif line.startswith("## "):
            h2, h3 = line[3:].strip(), ""
        elif line.startswith("### "):
            h3 = line[4:].strip()
        elif line.startswith("#### "):
            h3 = line[5:].strip()
        m = re.match(r"^<!--screen:([\w-]+)-->$", line.strip())
        if m:
            out.append((m.group(1), h2, h3))
    return out


def clean(t):
    t = re.sub(r"\*\*\[[^\]]*\]\*\*", "", t)        # [DECIDED ...] badges
    t = re.sub(r"[*_`]", "", t)
    return t.strip()


en = walk(HERE / "PRD.md")
id_map = {k: (a, b) for k, a, b in walk(HERE / "PRD.id.md")} if (HERE / "PRD.id.md").exists() else {}

seen = set()
items = []
for key, h2, h3 in en:
    if key in seen or key not in SCREENS or key == "process-map":
        continue
    seen.add(key)
    i2, i3 = id_map.get(key, (h2, h3))
    items.append({"key": key, "en2": clean(h2), "en3": clean(h3), "id2": clean(i2), "id3": clean(i3)})
unused = [k for k in SCREENS if k not in seen]


def sec_no(h):
    m = re.match(r"^([A-C]?\d+(?:\.\d+)?)", h)
    return m.group(1) if m else ""


cards, rail = [], []
last_group = None
for n, it in enumerate(items, 1):
    hiryu = it["key"].startswith(("hiryu", "grab"))
    kind_en, kind_id = ("Hiryu redraw", "Gambar ulang Hiryu") if hiryu else ("WMS draft", "Draf WMS")
    where_en = it["en3"] or it["en2"]
    where_id = it["id3"] or it["id2"]
    group_en, group_id = it["en2"], it["id2"]
    if group_en != last_group:
        rail.append(f'<li class="grp"><span class="l-en">{html.escape(group_en)}</span>'
                    f'<span class="l-id">{html.escape(group_id)}</span></li>')
        last_group = group_en
    rail.append(f'<li><a href="#{it["key"]}" data-key="{it["key"]}"><span class="dot" aria-hidden="true"></span>'
                f'<span class="rn">{n:02d}</span><span class="rk"><span class="l-en">{html.escape(where_en)}</span>'
                f'<span class="l-id">{html.escape(where_id)}</span></span></a></li>')
    cards.append(f'''
<section class="card" id="{it["key"]}" data-key="{it["key"]}" data-kind="{"hiryu" if hiryu else "wms"}">
  <header class="card__head">
    <span class="card__no">{n:02d}</span>
    <div class="card__title">
      <h2><span class="l-en">{html.escape(where_en)}</span><span class="l-id">{html.escape(where_id)}</span></h2>
      <p class="card__meta"><code>{it["key"]}</code><span class="tag tag--{"hiryu" if hiryu else "wms"}"><span class="l-en">{kind_en}</span><span class="l-id">{kind_id}</span></span>
        <span class="crumb"><span class="l-en">{html.escape(group_en)}</span><span class="l-id">{html.escape(group_id)}</span></span></p>
    </div>
  </header>
  <div class="stage"><div class="stage__inner">{SCREENS[it["key"]]}</div></div>
  <div class="audit" data-audit>
    <div class="verdicts" role="group" aria-label="Verdict">
      <button type="button" data-v="ok"><span class="l-en">Looks right</span><span class="l-id">Sudah benar</span></button>
      <button type="button" data-v="change"><span class="l-en">Needs a change</span><span class="l-id">Perlu diubah</span></button>
      <button type="button" data-v="question"><span class="l-en">Question</span><span class="l-id">Pertanyaan</span></button>
    </div>
    <label class="note"><span class="sr"><span class="l-en">Note</span><span class="l-id">Catatan</span></span>
      <textarea id="note-{it["key"]}" rows="2" placeholder="What should change on this screen?" data-ph-en="What should change on this screen?" data-ph-id="Apa yang perlu diubah di layar ini?"></textarea></label>
    <span class="saved" data-saved></span>
  </div>
</section>''')

PAGE = r"""<meta charset="utf-8">
<title>Kilat WMS Wireframes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap">
<style>
:root{
  --paper:#F6F5F2; --surface:#FFFFFF; --surface-2:#EEECE6;
  --ink:#191A1C; --ink-2:#4B4C50; --ink-3:#7D7B77;
  --rule:#DDD9D2; --rule-strong:#C3BEB5;
  --signal:#C0202D; --signal-soft:#F8E9EA;
  --accept:#1C7346; --accept-soft:#E4F1E9;
  --warn:#8E5F07; --warn-soft:#F6ECD6;
  --hiryu:#16A34A;
  --shadow:0 1px 2px rgba(25,26,28,.05);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --paper:#131315; --surface:#1A1B1E; --surface-2:#232429;
    --ink:#EFEDE7; --ink-2:#B7B4AE; --ink-3:#89867F;
    --rule:#2E2F34; --rule-strong:#43444A;
    --signal:#EE5C66; --signal-soft:#2B1719;
    --accept:#4FBE86; --accept-soft:#16271E;
    --warn:#D6A244; --warn-soft:#2A2215;
    --hiryu:#4ADE80;
    --shadow:0 1px 2px rgba(0,0,0,.4);
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --paper:#131315; --surface:#1A1B1E; --surface-2:#232429;
  --ink:#EFEDE7; --ink-2:#B7B4AE; --ink-3:#89867F;
  --rule:#2E2F34; --rule-strong:#43444A;
  --signal:#EE5C66; --signal-soft:#2B1719;
  --accept:#4FBE86; --accept-soft:#16271E;
  --warn:#D6A244; --warn-soft:#2A2215;
  --hiryu:#4ADE80;
  --shadow:0 1px 2px rgba(0,0,0,.4);
}
__SCREEN_CSS__

*{box-sizing:border-box}
html{scroll-padding-top:5.5rem}
body{background:var(--paper);color:var(--ink);font:15px/1.55 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.l-id{display:none} html[lang="id"] .l-id{display:inline} html[lang="id"] .l-en{display:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--signal);outline-offset:2px}

.bar{position:sticky;top:env(safe-area-inset-top,0px);z-index:20;background:color-mix(in srgb,var(--paper) 92%,transparent);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--rule)}
.bar__in{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem 1.2rem;padding-block:.7rem;padding-inline:max(16px,2rem)}
.brand{display:flex;align-items:baseline;gap:.6rem;min-width:0}
.brand b{font:700 .8rem/1 "IBM Plex Mono",monospace;letter-spacing:.14em;color:var(--signal)}
.brand h1{margin:0;font:700 1.15rem/1.1 Archivo,sans-serif;letter-spacing:-.01em;text-wrap:balance}
.brand span{color:var(--ink-3);font:500 .8rem "IBM Plex Mono",monospace}
.spacer{flex:1 1 auto}
.counts{display:flex;gap:.9rem;font:500 .8rem "IBM Plex Mono",monospace;color:var(--ink-2);font-variant-numeric:tabular-nums}
.counts i{font-style:normal;display:inline-block;width:.6rem;height:.6rem;border-radius:50%;margin-right:.3rem;vertical-align:.05rem;background:var(--rule-strong)}
.counts .c-ok i{background:var(--accept)} .counts .c-change i{background:var(--signal)} .counts .c-question i{background:var(--warn)}
.seg{display:inline-flex;border:1px solid var(--rule-strong);border-radius:8px;overflow:hidden;background:var(--surface)}
.seg button{border:0;background:none;padding:.35rem .65rem;font:600 .78rem Inter,sans-serif;cursor:pointer;color:var(--ink-2)}
.seg button+button{border-left:1px solid var(--rule)}
.seg button.on{background:var(--ink);color:var(--paper)}
.seglabel{font:600 .7rem "IBM Plex Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.ctl{display:flex;align-items:center;gap:.45rem}

.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:2rem;padding-inline:max(16px,2rem);padding-block:1.5rem 5rem}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)} .rail{display:none}}
.rail{position:sticky;top:5rem;max-height:calc(100vh - 6rem);overflow:auto;font-size:.8rem}
.rail ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px}
.rail .grp{margin-top:.9rem;padding:.2rem .4rem;font:600 .68rem/1.3 Archivo,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.rail .grp:first-child{margin-top:0}
.rail a{display:grid;grid-template-columns:.7rem 1.6rem 1fr;align-items:center;gap:.35rem;padding:.25rem .4rem;border-radius:6px;color:var(--ink-2);text-decoration:none}
.rail a:hover{background:var(--surface-2)}
.rail .rn{font:500 .72rem "IBM Plex Mono",monospace;color:var(--ink-3)}
.rail .rk{font-size:.78rem;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:.55rem;height:.55rem;border-radius:50%;border:1.5px solid var(--rule-strong)}
[data-state="ok"] .dot{background:var(--accept);border-color:var(--accept)}
[data-state="change"] .dot{background:var(--signal);border-color:var(--signal)}
[data-state="question"] .dot{background:var(--warn);border-color:var(--warn)}

.intro{max-width:70ch;margin:0 0 1.6rem;color:var(--ink-2)}
.intro strong{color:var(--ink)}
.cards{display:flex;flex-direction:column;gap:2.2rem;min-width:0}
.card{min-width:0;border-top:1px solid var(--rule-strong);padding-top:1rem;display:flex;flex-direction:column;gap:1rem}
.card__head{display:flex;gap:1rem;align-items:flex-start}
.card__no{font:600 1.6rem/1 "IBM Plex Mono",monospace;color:var(--ink-3);font-variant-numeric:tabular-nums;min-width:2.4rem}
.card__title{min-width:0}
.card h2{margin:0;font:700 1.15rem/1.25 Archivo,sans-serif;letter-spacing:-.01em;text-wrap:balance}
.card__meta{margin:.35rem 0 0;display:flex;flex-wrap:wrap;gap:.35rem .7rem;align-items:center;font-size:.8rem;color:var(--ink-3)}
.card__meta code{font:500 .78rem "IBM Plex Mono",monospace;color:var(--ink-2);background:var(--surface-2);padding:.08rem .4rem;border-radius:4px}
.tag{font:600 .68rem/1 Inter,sans-serif;letter-spacing:.04em;text-transform:uppercase;padding:.25rem .45rem;border-radius:4px;border:1px solid currentColor}
.tag--hiryu{color:var(--hiryu)} .tag--wms{color:var(--signal)}

/* The frame keeps its real size; only this box scrolls sideways when the window is narrower. */
.stage{overflow-x:auto;min-width:0;padding:1.2rem;background:var(--surface-2);border-radius:10px}
.stage__inner{width:max-content;min-width:100%}
.stage figure.shot{margin:0;max-width:none}
.stage figure.shot>*{max-width:none}
.stage .shotscroll{overflow:visible}
.stage figcaption{max-width:90ch}

.audit{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.6rem 1rem;align-items:start}
@media (max-width:760px){.audit{grid-template-columns:minmax(0,1fr)}}
.verdicts{display:flex;flex-wrap:wrap;gap:.4rem}
.verdicts button{border:1px solid var(--rule-strong);background:var(--surface);border-radius:999px;padding:.35rem .8rem;font-size:.82rem;font-weight:600;cursor:pointer;color:var(--ink-2)}
.verdicts button:hover{border-color:var(--ink-3)}
.verdicts button[aria-pressed="true"][data-v="ok"]{background:var(--accept-soft);border-color:var(--accept);color:var(--accept)}
.verdicts button[aria-pressed="true"][data-v="change"]{background:var(--signal-soft);border-color:var(--signal);color:var(--signal)}
.verdicts button[aria-pressed="true"][data-v="question"]{background:var(--warn-soft);border-color:var(--warn);color:var(--warn)}
.note textarea{width:100%;min-height:2.6rem;resize:vertical;border:1px solid var(--rule-strong);border-radius:8px;background:var(--surface);color:var(--ink);padding:.5rem .65rem;font:inherit;font-size:.88rem}
.saved{font:500 .74rem "IBM Plex Mono",monospace;color:var(--ink-3);padding-top:.5rem;white-space:nowrap}
.card[hidden]{display:none}
.offline{font-size:.8rem;color:var(--warn)}
@media (prefers-reduced-motion: reduce){*{transition:none!important;scroll-behavior:auto!important}}
</style>

<div class="bar"><div class="bar__in">
  <div class="brand"><b>NINJA</b><h1><span class="l-en">Kilat WMS wireframes</span><span class="l-id">Wireframe Kilat WMS</span></h1><span>PRD v3.3 · __COUNT__ screens</span></div>
  <span class="spacer"></span>
  <div class="counts" aria-live="polite">
    <span class="c-ok"><i></i><b data-count="ok">0</b> <span class="l-en">right</span><span class="l-id">benar</span></span>
    <span class="c-change"><i></i><b data-count="change">0</b> <span class="l-en">change</span><span class="l-id">ubah</span></span>
    <span class="c-question"><i></i><b data-count="question">0</b> <span class="l-en">question</span><span class="l-id">tanya</span></span>
    <span class="c-open"><i></i><b data-count="open">0</b> <span class="l-en">to do</span><span class="l-id">belum</span></span>
  </div>
  <div class="ctl"><span class="seglabel"><span class="l-en">Show</span><span class="l-id">Tampilkan</span></span>
    <div class="seg" data-seg="filter"><button type="button" data-val="all" class="on"><span class="l-en">All</span><span class="l-id">Semua</span></button><button type="button" data-val="open"><span class="l-en">To do</span><span class="l-id">Belum</span></button><button type="button" data-val="flagged"><span class="l-en">Flagged</span><span class="l-id">Ditandai</span></button><button type="button" data-val="wms">WMS</button><button type="button" data-val="hiryu">Hiryu</button></div></div>
  <div class="ctl"><span class="seglabel">Zoom</span>
    <div class="seg" data-seg="zoom"><button type="button" data-val="fit"><span class="l-en">Fit</span><span class="l-id">Pas</span></button><button type="button" data-val="1" class="on">100%</button><button type="button" data-val="1.25">125%</button><button type="button" data-val="1.5">150%</button></div></div>
  <div class="seg" data-seg="lang"><button type="button" data-val="en" class="on">EN</button><button type="button" data-val="id">ID</button></div>
</div></div>

<div class="layout">
  <nav class="rail" aria-label="Screens"><ol>__RAIL__</ol></nav>
  <main>
    <p class="intro"><span class="l-en">Every screen draft from the PRD, full size and in PRD order. Mark each one <strong>Looks right</strong>, <strong>Needs a change</strong> or <strong>Question</strong> and write what to change. Notes save by themselves and Claude can read them. Green tags are Hiryu screens redrawn from the real app; red tags are WMS drafts.</span><span class="l-id">Semua draf layar dari PRD, ukuran penuh dan urut seperti di PRD. Tandai tiap layar <strong>Sudah benar</strong>, <strong>Perlu diubah</strong> atau <strong>Pertanyaan</strong>, lalu tulis apa yang perlu diubah. Catatan tersimpan sendiri dan bisa dibaca Claude. Label hijau: layar Hiryu yang digambar ulang dari aplikasi aslinya; label merah: draf WMS.</span>
    <span class="offline" data-offline hidden><span class="l-en"> Notes cannot be saved in this view.</span><span class="l-id"> Catatan tidak bisa disimpan di tampilan ini.</span></span></p>
    <div class="cards">__CARDS__</div>
  </main>
</div>

<script>
__SCREEN_JS__
</script>
<script>
(function () {
  var root = document.documentElement;
  var cards = [].slice.call(document.querySelectorAll('.card'));
  var state = {};            // key -> {verdict, note}
  var db = null, filter = 'all';

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---- language ---- */
  function setLang(l) {
    root.setAttribute('lang', l);
    document.querySelectorAll('textarea[data-ph-en]').forEach(function (t) { t.placeholder = t.getAttribute('data-ph-' + l); });
    mark('lang', l); store('wf-lang', l);
  }
  /* ---- zoom: CSS zoom keeps the frame's layout, so the scroll box sizes to it ---- */
  function setZoom(z) {
    cards.forEach(function (c) {
      var inner = c.querySelector('.stage__inner'), stage = c.querySelector('.stage');
      inner.style.zoom = 1;
      var f = z;
      if (z === 'fit') { var room = stage.clientWidth - 40; f = Math.min(1, room / inner.scrollWidth); }
      inner.style.zoom = f;
    });
    mark('zoom', String(z)); store('wf-zoom', String(z));
  }
  function mark(seg, val) {
    document.querySelectorAll('[data-seg="' + seg + '"] button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-val') === val); });
  }
  document.querySelectorAll('[data-seg] button').forEach(function (b) {
    b.addEventListener('click', function () {
      var seg = b.parentNode.getAttribute('data-seg'), v = b.getAttribute('data-val');
      if (seg === 'lang') setLang(v);
      if (seg === 'zoom') setZoom(v === 'fit' ? 'fit' : parseFloat(v));
      if (seg === 'filter') { filter = v; mark('filter', v); paint(); }
    });
  });
  window.addEventListener('resize', function () { if (store('wf-zoom') === 'fit') setZoom('fit'); });

  /* ---- verdicts and notes ---- */
  function paint() {
    var n = { ok: 0, change: 0, question: 0, open: 0 };
    cards.forEach(function (c) {
      var k = c.getAttribute('data-key'), s = state[k] || {}, v = s.verdict || '';
      n[v || 'open']++;
      c.querySelectorAll('.verdicts button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false'); });
      var ta = c.querySelector('textarea');
      if (document.activeElement !== ta && ta.value !== (s.note || '')) ta.value = s.note || '';
      var link = document.querySelector('.rail a[data-key="' + k + '"]');
      if (link) link.setAttribute('data-state', v);
      c.hidden = !(filter === 'all' || (filter === 'open' && !v) || (filter === 'flagged' && (v === 'change' || v === 'question'))
                   || filter === c.getAttribute('data-kind'));
      var sv = c.querySelector('[data-saved]');
      sv.textContent = s.at ? new Date(s.at).toLocaleString(root.lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    });
    Object.keys(n).forEach(function (k) { var el = document.querySelector('[data-count="' + k + '"]'); if (el) el.textContent = n[k]; });
  }

  var timers = {};
  function save(key) {
    var s = state[key] || {};
    s.at = new Date().toISOString();
    state[key] = s; paint();
    if (!db) { store('wf-notes', JSON.stringify(state)); return; }
    clearTimeout(timers[key]);
    timers[key] = setTimeout(function () {
      db.doc('notes/' + key).set({ screen: key, verdict: s.verdict || '', note: s.note || '', at: s.at })
        .catch(function (e) { if (e && e.code === 'invalid_argument') readOnly(); });
    }, 500);
  }
  function readOnly() {
    document.querySelector('[data-offline]').hidden = false;
    document.querySelectorAll('.audit button, .audit textarea').forEach(function (el) { el.disabled = true; });
  }
  cards.forEach(function (c) {
    var key = c.getAttribute('data-key');
    c.querySelectorAll('.verdicts button').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = state[key] || (state[key] = {});
        s.verdict = s.verdict === b.getAttribute('data-v') ? '' : b.getAttribute('data-v');
        save(key);
      });
    });
    var ta = c.querySelector('textarea');
    ta.addEventListener('input', function () { (state[key] || (state[key] = {})).note = ta.value; save(key); });
  });

  /* ---- start ---- */
  setLang(store('wf-lang') === 'id' ? 'id' : 'en');
  var z = store('wf-zoom');
  setZoom(z === 'fit' ? 'fit' : (parseFloat(z) || 1));
  try { state = JSON.parse(store('wf-notes') || '{}') || {}; } catch (e) { state = {}; }
  paint();

  if (window.claude && window.claude.use) {
    window.claude.use('db').then(function (d) {
      if (!d) { document.querySelector('[data-offline]').hidden = false; return; }
      db = d;
      db.collection('notes').onSnapshot(function (snap) {
        snap.docs.forEach(function (doc) {
          var x = doc.data() || {};
          var local = state[doc.id];
          if (!local || !local.at || (x.at && x.at >= local.at)) state[doc.id] = { verdict: x.verdict || '', note: x.note || '', at: x.at };
        });
        paint();
      }, function () {});
    });
  }
})();
</script>
"""

out = (PAGE.replace("__SCREEN_CSS__", SCREEN_CSS)
           .replace("__SCREEN_JS__", SCREEN_JS.replace("</script", "<\\/script"))
           .replace("__RAIL__", "\n".join(rail))
           .replace("__CARDS__", "\n".join(cards))
           .replace("__COUNT__", str(len(items))))
OUT = HERE / "Wireframes.html"
OUT.write_text(out, encoding="utf-8")
print(f"wrote {OUT.name}: {len(items)} screens, {len(out) // 1024} KB", ("; not in PRD: " + ", ".join(unused)) if unused else "")
