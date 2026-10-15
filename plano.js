/* Aba "Plano de governo" · plano.js
   Lê plano_governo.json (ou plano_governo.js em file://) e mostra, para cada declaração do plano, as críticas publicadas,
   com quem as fez, o tipo de fonte, ressalvas, respostas da campanha e o link da matéria. Texto sempre via textContent. */
(() => {
  'use strict';

  const DATA_URL = 'plano_governo.json';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const safeUrl = (u) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch { return null; }
  };
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const fmtData = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return d ? `${d}/${m}/${y}` : m ? `${m}/${y}` : y;
  };
  const link = (url, text, cls) => {
    const href = safeUrl(url);
    if (!href) return document.createTextNode(text || '');
    const a = el('a', cls, text || href);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };

  const TIPOS = [
    ['especialista', 'Especialista'],
    ['checagem', 'Checagem'],
    ['dados', 'Dados ou registro oficial'],
    ['imprensa', 'Reportagem'],
    ['entidade', 'Entidade ou sindicato'],
    ['politica', 'Parlamentares'],
  ];
  const TIPO_LABEL = Object.fromEntries(TIPOS);

  async function load() {
    if (window.LTF_EMBUTIDO && window.DADOS_PLANO) return window.DADOS_PLANO;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (window.DADOS_PLANO) return window.DADOS_PLANO;   // file:// bloqueia fetch()
      throw err;
    }
  }

  const state = { cap: null, tipos: new Set(), q: '' };
  const openIds = new Set();
  let doc = null, caps = new Map(), decls = [];
  const chipRefs = new Map();
  let allOpen = false;

  load().then(init).catch((err) => {
    console.error('Falha ao carregar o plano de governo', err);
    $('pl-list').replaceChildren(el('p', 'pl-empty', 'Não foi possível carregar plano_governo.json. Abra a página por um servidor local ou mantenha o arquivo plano_governo.js na mesma pasta.'));
  });

  function init(data) {
    doc = data;
    caps = new Map(doc.capitulos.map((c) => [c.id, c]));
    decls = doc.declaracoes.map((d) => ({
      ...d,
      _hay: norm([
        d.titulo, d.declaracao, caps.get(d.capitulo)?.titulo || '', caps.get(d.capitulo)?.tema || '',
        ...d.criticas.map((c) => `${c.quem} ${c.texto} ${c.fonte_nome}`),
        ...(d.contexto || []).map((c) => `${c.quem} ${c.texto}`),
      ].join(' ')),
    }));

    const d0 = doc.documento;
    $('pl-lead').textContent = `Cada cartão traz um trecho do plano "${d0.titulo}", de ${d0.candidato}, o que foi apontado de negativo sobre ele e por quem.`;
    const p = $('pl-doc');
    p.append(link(d0.url_pdf, `Ler o plano completo (PDF, ${d0.paginas} páginas)`), document.createTextNode(` · ${d0.url_pdf_nome}. As páginas citadas nos cartões são as do PDF.`));

    drawSummary();
    drawTypeChips();
    bindUi();
    render();
    // os links para a linha do tempo precisam dos eventos carregados
    if (window.LTF) window.LTF.ready.then(render).catch(() => {});
  }

  /* ---------- filtros ---------- */
  const tokens = () => norm(state.q).split(/\s+/).filter(Boolean);
  const matchQ = (d, tk) => tk.every((t) => d._hay.includes(t));
  const critOf = (d) => (state.tipos.size ? d.criticas.filter((c) => state.tipos.has(c.tipo)) : d.criticas);

  function visible() {
    const tk = tokens();
    return decls.filter((d) => (!state.cap || d.capitulo === state.cap) && matchQ(d, tk) && critOf(d).length > 0);
  }

  /* ---------- resumo ---------- */
  function drawSummary() {
    const nCrit = decls.reduce((s, d) => s + d.criticas.length, 0);
    const fontes = new Set(decls.flatMap((d) => d.criticas.map((c) => c.fonte_url)));
    const stat = (n, label) => { const s = el('div', 'stat'); s.append(el('b', null, String(n)), el('span', null, label)); return s; };
    $('pl-summary').replaceChildren(
      stat(decls.length, 'declarações do plano'),
      stat(nCrit, 'críticas publicadas'),
      stat(fontes.size, 'matérias e documentos'),
      stat(new Set(decls.map((d) => d.capitulo)).size, 'capítulos do plano'),
    );
  }

  function drawTypeChips() {
    const host = $('pl-types');
    host.replaceChildren(...TIPOS.map(([key, label]) => {
      const b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      const sw = el('span', `tipo-sw t-${key}`);
      b.append(sw, el('span', 'lbl', label));
      const n = el('span', 'n', '0');
      b.appendChild(n);
      b.addEventListener('click', () => {
        if (state.tipos.has(key)) state.tipos.delete(key); else state.tipos.add(key);
        render();
      });
      chipRefs.set(key, { b, n });
      return b;
    }));
  }

  function syncChips() {
    // contagem por tipo respeita busca e capítulo, mas não o próprio filtro de tipo
    const tk = tokens();
    const base = decls.filter((d) => (!state.cap || d.capitulo === state.cap) && matchQ(d, tk));
    TIPOS.forEach(([key]) => {
      const n = base.reduce((s, d) => s + d.criticas.filter((c) => c.tipo === key).length, 0);
      const ref = chipRefs.get(key);
      ref.n.textContent = String(n);
      ref.b.setAttribute('aria-pressed', String(state.tipos.has(key)));
      ref.b.classList.toggle('is-empty', n === 0 && !state.tipos.has(key));
    });
  }

  /* ---------- barras por capítulo (também são o filtro de capítulo) ---------- */
  function drawBars() {
    const tk = tokens();
    const base = decls.filter((d) => matchQ(d, tk));
    const rows = doc.capitulos.map((c) => {
      const ds = base.filter((d) => d.capitulo === c.id);
      return { c, nDecl: ds.length, n: ds.reduce((s, d) => s + critOf(d).length, 0) };
    }).filter((r) => decls.some((d) => d.capitulo === r.c.id));
    const max = Math.max(1, ...rows.map((r) => r.n));
    $('pl-bars').replaceChildren(...rows.map(({ c, n }) => {
      const b = el('button', 'pl-bar-row');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.cap === c.id));
      b.setAttribute('aria-label', `${c.titulo}, ${c.tema}: ${plural(n, 'crítica', 'críticas')}`);
      const lbl = el('span');
      lbl.append(document.createTextNode(c.titulo), el('small', null, `${c.tema} · p. ${c.paginas.replace(' a ', '–')}`));
      const track = el('span', 'track');
      const fill = el('span', 'fill');
      fill.style.width = `${(n / max) * 100}%`;
      track.appendChild(fill);
      b.append(lbl, track, el('span', 'num', String(n)));
      b.addEventListener('click', () => { state.cap = state.cap === c.id ? null : c.id; render(); });
      return b;
    }));
  }

  /* ---------- cartões ---------- */
  function critBlock(c) {
    const box = el('div', `crit t-${c.tipo}`);
    const top = el('div', 'crit-top');
    const tipo = el('span', 'tipo');
    tipo.append(el('i', 'tipo-sw'), document.createTextNode(TIPO_LABEL[c.tipo] || c.tipo));
    top.append(tipo, el('span', 'crit-quem', c.quem));
    box.appendChild(top);
    box.appendChild(el('p', null, c.texto));
    if (c.ressalva) {
      const r = el('p', 'ressalva');
      r.append(el('b', null, 'Ressalva: '), document.createTextNode(c.ressalva));
      box.appendChild(r);
    }
    const src = el('div', 'crit-src');
    src.append(document.createTextNode('Fonte: '), link(c.fonte_url, c.fonte_nome, 'pl-link-src'));
    if (c.data) src.appendChild(document.createTextNode(` · ${fmtData(c.data)}`));
    box.appendChild(src);
    return box;
  }

  function ctxBlock(c) {
    const box = el('div', 'ctx');
    box.appendChild(el('p', 'ctx-label', c.rotulo || 'Contexto'));
    box.appendChild(el('span', 'ctx-quem', c.quem));
    box.appendChild(el('p', null, c.texto));
    if (c.fonte_url) {
      const src = el('div', 'crit-src');
      src.append(document.createTextNode('Fonte: '), link(c.fonte_url, c.fonte_nome, 'pl-link-src'));
      box.appendChild(src);
    }
    return box;
  }

  function card(d) {
    const crits = critOf(d);
    const det = el('details', 'pl-card');
    det.dataset.id = d.id;
    if (openIds.has(d.id)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) openIds.add(d.id); else openIds.delete(d.id); syncToggle(); });

    const sum = el('summary');
    const cap = caps.get(d.capitulo);
    const meta = el('div', 'pl-meta');
    meta.append(el('span', 'pill', cap ? cap.titulo : d.capitulo), document.createTextNode(`p. ${d.pagina} do PDF`));
    const says = el('p', 'pl-says');
    says.append(el('b', null, 'O plano diz: '), document.createTextNode(d.declaracao));
    const foot = el('div', 'pl-foot');
    const badges = el('div', 'pl-badges');
    TIPOS.forEach(([key, label]) => {
      const n = crits.filter((c) => c.tipo === key).length;
      if (!n) return;
      const t = el('span', `tipo t-${key}`);
      t.append(el('i', 'tipo-sw'), document.createTextNode(n > 1 ? `${label} ×${n}` : label));
      badges.appendChild(t);
    });
    const open = el('span', 'pl-open', `${plural(crits.length, 'crítica', 'críticas')}${state.tipos.size && crits.length < d.criticas.length ? ` de ${d.criticas.length}` : ''}`);
    foot.append(badges, open);
    sum.append(meta, el('h3', null, d.titulo), says, foot);
    det.appendChild(sum);

    const body = el('div', 'pl-body');
    body.appendChild(el('p', 'pl-body-h', 'O que foi apontado'));
    crits.forEach((c) => body.appendChild(critBlock(c)));
    if (d.contexto && d.contexto.length) {
      body.appendChild(el('p', 'pl-body-h', 'Contexto e respostas'));
      d.contexto.forEach((c) => body.appendChild(ctxBlock(c)));
    }
    const evs = window.LTF ? window.LTF.events : [];
    const links = (d.ligacoes || []).map((id) => evs.find((e) => e.id === id)).filter(Boolean);
    if (links.length) {
      body.appendChild(el('p', 'pl-body-h', 'Relacionado na linha do tempo'));
      const row = el('div', 'pl-links');
      links.forEach((e) => {
        const b = el('button', 'chip', e.titulo);
        b.type = 'button';
        b.addEventListener('click', () => window.LTF.focusEvent(e.id));
        row.appendChild(b);
      });
      body.appendChild(row);
    }
    det.appendChild(body);
    return det;
  }

  function syncToggle() {
    const shown = [...$('pl-list').querySelectorAll('details')];
    allOpen = shown.length > 0 && shown.every((x) => x.open);
    $('pl-toggle').textContent = allOpen ? 'Recolher todas' : 'Expandir todas';
  }

  function render() {
    const list = visible();
    drawBars();
    syncChips();
    const nCrit = list.reduce((s, d) => s + critOf(d).length, 0);
    $('pl-count').textContent = `${list.length} de ${decls.length} declarações · ${plural(nCrit, 'crítica', 'críticas')}`;
    $('pl-reset').hidden = !(state.cap || state.tipos.size || state.q);
    if (!list.length) {
      $('pl-list').replaceChildren(el('p', 'pl-empty', 'Nenhuma declaração corresponde a esses filtros. Limpe os filtros ou mude a busca.'));
    } else {
      $('pl-list').replaceChildren(...list.map(card));
    }
    syncToggle();
  }

  function bindUi() {
    $('pl-q').addEventListener('input', (ev) => { state.q = ev.target.value; render(); });
    $('pl-toggle').addEventListener('click', () => {
      const shown = [...$('pl-list').querySelectorAll('details')];
      const target = !shown.every((x) => x.open);
      shown.forEach((x) => { x.open = target; });
      syncToggle();
    });
    $('pl-reset').addEventListener('click', () => {
      state.cap = null; state.tipos.clear(); state.q = ''; $('pl-q').value = ''; render();
    });
  }
})();
