/* Aba "Negacionismo" · negacionismo.js
   Lê negacionismo_dados.json (ou negacionismo_dados.js em file://) e mostra, para cada declaração ou ato de Jair, Flávio e outros
   membros da família sobre ciência, saúde, clima, dados oficiais, história e urnas: o que foi dito, a cronologia do caso, o que dizem
   a ciência e os dados, os números, o que veio depois, a resposta de quem foi citado, as ligações com outros casos e a fonte.
   Há também um mapa que mostra os registros por tema e por ordem cronológica, ligados entre si. Texto sempre via textContent. */
(() => {
  'use strict';

  const DATA_URL = 'negacionismo_dados.json';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs, text) => {
    const n = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v)));
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
  const fmtNum = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const curto = (s, n) => { const t = String(s); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
  const link = (url, text, cls) => {
    const href = safeUrl(url);
    if (!href) return document.createTextNode(text || '');
    const a = el('a', cls, text || href);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // tipo de evidência -> rótulo e cor (as cores vêm das classes t-* já usadas na aba do plano)
  const TIPOS = [
    ['estudo', 'Estudo ou relatório científico', 'especialista'],
    ['dados', 'Dados oficiais', 'dados'],
    ['orgao', 'Órgão oficial', 'entidade'],
    ['checagem', 'Checagem', 'checagem'],
    ['imprensa', 'Reportagem ou análise', 'imprensa'],
  ];
  const TIPO = Object.fromEntries(TIPOS.map(([k, label, cor]) => [k, { label, cor }]));

  async function load() {
    if (window.LTF_EMBUTIDO && window.DADOS_NEGACIONISMO) return window.DADOS_NEGACIONISMO;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (window.DADOS_NEGACIONISMO) return window.DADOS_NEGACIONISMO;   // file:// bloqueia fetch()
      throw err;
    }
  }

  const state = { pessoa: null, tema: null, q: '', ordem: 'antigos' };
  const openIds = new Set();
  let pessoas = new Map(), temas = new Map(), regs = [], notas = [];
  let byId = new Map(), rel = new Map(), edges = [];
  const chipRefs = new Map();
  let allOpen = false;
  const map = { nodes: new Map(), links: [], order: [], active: null, pointer: 'mouse', built: false };

  load().then(init).catch((err) => {
    console.error('Falha ao carregar os registros de negacionismo', err);
    $('nz-list').replaceChildren(el('p', 'pl-empty', 'Não foi possível carregar negacionismo_dados.json. Abra a página por um servidor local ou mantenha o arquivo negacionismo_dados.js na mesma pasta.'));
  });

  function init(data) {
    pessoas = new Map(data.pessoas.map((p) => [p.id, p]));
    temas = new Map(data.temas.map((t) => [t.id, t]));
    notas = data.sem_registro || [];
    regs = data.registros.map((r) => ({
      ...r,
      _hay: norm([
        r.titulo, r.resumo, ...(r.detalhe || []), pessoas.get(r.pessoa)?.nome || '', temas.get(r.tema)?.titulo || '',
        r.fonte_nome, ...(r.ciencia || []).map((c) => `${c.quem} ${c.texto} ${c.fonte_nome}`),
        r.resposta ? `${r.resposta.quem} ${r.resposta.texto}` : '',
        ...(r.cronologia || []).map((c) => c.texto), ...(r.consequencias || []).map((c) => c.texto),
        ...(r.numeros || []).map((n) => `${n.rotulo} ${n.leitura || ''}`),
      ].join(' ')),
    }));
    byId = new Map(regs.map((r) => [r.id, r]));
    buildLinks();

    $('nz-lead').textContent = `${plural(regs.length, 'registro', 'registros')} de declarações e atos de ${pessoas.get('jair').nome}, ${pessoas.get('flavio').nome} e ${pessoas.get('eduardo').nome} sobre covid-19, vacinas, clima, dados oficiais, ditadura e urnas. Cada caso traz a fonte, a cronologia, o que dizem a ciência e os dados, os números, o que veio depois, a resposta de quem foi citado e as ligações com os outros casos. Carlos, Michelle e outros parentes aparecem no fim da página, com o que encontrei.`;

    drawSummary();
    drawMap();
    drawPeopleChips();
    drawOrder();
    bindUi();
    render();
    // os links para a linha do tempo precisam dos eventos carregados
    if (window.LTF) window.LTF.ready.then(render).catch(() => {});
  }

  /* ---------- ligações entre casos ---------- */
  function buildLinks() {
    rel = new Map(regs.map((r) => [r.id, []]));
    const pares = new Map();
    regs.forEach((r) => (r.relacionados || []).forEach((x) => {
      if (!byId.has(x.id) || x.id === r.id) return;
      rel.get(r.id).push({ id: x.id, motivo: x.motivo });
      const k = [r.id, x.id].sort().join('|');
      if (!pares.has(k)) pares.set(k, [r.id, x.id]);
    }));
    // uma ligação declarada só de um lado aparece também no outro cartão
    regs.forEach((r) => (r.relacionados || []).forEach((x) => {
      const lista = rel.get(x.id);
      if (lista && x.id !== r.id && !lista.some((y) => y.id === r.id)) lista.push({ id: r.id, motivo: x.motivo });
    }));
    edges = [...pares.values()];
  }

  /* ---------- filtros ---------- */
  const tokens = () => norm(state.q).split(/\s+/).filter(Boolean);
  const matchQ = (r, tk) => tk.every((t) => r._hay.includes(t));

  function visible() {
    const tk = tokens();
    const list = regs.filter((r) => (!state.pessoa || r.pessoa === state.pessoa) && (!state.tema || r.tema === state.tema) && matchQ(r, tk));
    const dir = state.ordem === 'antigos' ? 1 : -1;
    return list.sort((a, b) => dir * String(a.data).localeCompare(String(b.data)));
  }

  /* ---------- resumo ---------- */
  function fontesDe(r) {
    return [
      r.fonte_url, ...(r.fontes_extra || []).map((f) => f.url), ...(r.ciencia || []).map((c) => c.fonte_url),
      ...(r.cronologia || []).map((c) => c.fonte_url), ...(r.consequencias || []).map((c) => c.fonte_url),
      ...(r.numeros || []).flatMap((n) => (n.fontes || []).map((f) => f.url)),
    ].filter(Boolean);
  }

  function drawSummary() {
    const fontes = new Set(regs.flatMap(fontesDe));
    const stat = (n, label) => { const s = el('div', 'stat'); s.append(el('b', null, String(n)), el('span', null, label)); return s; };
    $('nz-summary').replaceChildren(
      stat(regs.length, 'registros'),
      stat(new Set(regs.map((r) => r.pessoa)).size, 'pessoas com registro'),
      stat(new Set(regs.map((r) => r.tema)).size, 'temas'),
      stat(edges.length, 'ligações entre casos'),
      stat(fontes.size, 'matérias e documentos'),
    );
  }

  /* ---------- mapa de ligações ---------- */
  function mapLanes() { return [...temas.values()]; }
  // nome curto do tema para a faixa do mapa e para o cabeçalho do painel de ligações
  const ROTULO_CURTO = { dados: 'Dados oficiais', historia: 'História e ditadura' };
  const rotuloTema = (t) => (t && (ROTULO_CURTO[t.id] || t.titulo.split(':')[0])) || '';

  function drawMap() {
    const host = $('nz-map-svg');
    if (!host || map.built) return;
    const lanes = mapLanes();
    const order = regs.slice().sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.id.localeCompare(b.id));
    map.order = order.map((r) => r.id);
    const left = 156, right = 28, laneTop = 92, laneH = 30;
    const W = Math.max(1160, left + right + (order.length - 1) * 25);
    const H = laneTop + lanes.length * laneH + 56;
    const step = order.length > 1 ? (W - left - right) / (order.length - 1) : 0;
    const laneY = new Map(lanes.map((t, i) => [t.id, laneTop + i * laneH + laneH / 2]));
    const xOf = new Map(order.map((r, i) => [r.id, left + i * step]));

    host.setAttribute('viewBox', `0 0 ${W} ${H}`);
    host.replaceChildren();

    // faixas por tema
    const gLanes = svgEl('g');
    lanes.forEach((t) => {
      const y = laneY.get(t.id);
      gLanes.appendChild(svgEl('line', { class: 'nz-lane-line', x1: left - 12, x2: W - right + 12, y1: y, y2: y }));
      gLanes.appendChild(svgEl('text', { class: 'nz-lane-lbl', x: left - 22, y: y + 4, 'text-anchor': 'end' }, rotuloTema(t)));
    });
    host.appendChild(gLanes);

    // marcas de ano (posição de cada ano na sequência; o espaçamento não é uma escala de tempo)
    const gYears = svgEl('g');
    let ano = null, ultimoX = -999, nivel = 0;
    order.forEach((r) => {
      const y = String(r.data).slice(0, 4);
      if (y === ano) return;
      ano = y;
      const x = xOf.get(r.id) - step / 2;
      // anos muito próximos (poucos registros) ganham a etiqueta numa segunda linha, para não se sobreporem
      nivel = x - ultimoX < 40 ? (nivel + 1) % 2 : 0;
      ultimoX = x;
      gYears.appendChild(svgEl('line', { class: 'nz-year-tick', x1: x, x2: x, y1: laneTop - 6, y2: H - 30 + nivel * 13 }));
      gYears.appendChild(svgEl('text', { class: 'nz-year-lbl', x: x + 5, y: H - 12 + nivel * 13 }, y));
    });
    host.appendChild(gYears);

    // ligações (arcos)
    const gLinks = svgEl('g');
    edges.forEach(([a, b]) => {
      const x1 = xOf.get(a), y1 = laneY.get(byId.get(a).tema), x2 = xOf.get(b), y2 = laneY.get(byId.get(b).tema);
      const dx = Math.abs(x2 - x1);
      const topY = Math.min(y1, y2) - Math.min(70, 10 + dx * 0.34);
      const d = `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${topY} ${x2} ${y2}`;
      const p = svgEl('path', { class: 'nz-link', d });
      gLinks.appendChild(p);
      map.links.push({ a, b, p });
    });
    host.appendChild(gLinks);

    // pontos (um por registro)
    const gNodes = svgEl('g');
    order.forEach((r, i) => {
      const g = svgEl('g', {
        class: `nz-node p-${r.pessoa}`, transform: `translate(${xOf.get(r.id)} ${laneY.get(r.tema)})`,
        tabindex: i === 0 ? '0' : '-1', role: 'button',
        'aria-label': `${fmtData(r.data)}. ${pessoas.get(r.pessoa)?.nome || r.pessoa}. ${r.titulo}`,
      });
      g.appendChild(svgEl('title', {}, `${fmtData(r.data)} · ${pessoas.get(r.pessoa)?.nome || r.pessoa}: ${curto(r.titulo, 140)}`));
      g.appendChild(svgEl('circle', { class: 'hit', r: 12 }));
      g.appendChild(svgEl('circle', { class: 'ring', r: 9.5 }));
      g.appendChild(svgEl('circle', { class: 'dot', r: 6 }));
      g.addEventListener('pointerenter', (ev) => { map.pointer = ev.pointerType || 'mouse'; if (map.pointer !== 'touch') setActive(r.id); });
      g.addEventListener('pointerdown', (ev) => { map.pointer = ev.pointerType || 'mouse'; });
      g.addEventListener('focus', () => setActive(r.id));
      g.addEventListener('blur', () => { setTimeout(() => { if (!host.contains(document.activeElement)) setActive(null); }, 0); });
      g.addEventListener('click', () => {
        if (map.pointer === 'touch' && map.active !== r.id) setActive(r.id);
        else focusRecord(r.id);
      });
      g.addEventListener('keydown', (ev) => {
        const i0 = map.order.indexOf(r.id);
        const alvo = { ArrowRight: i0 + 1, ArrowDown: i0 + 1, ArrowLeft: i0 - 1, ArrowUp: i0 - 1, Home: 0, End: map.order.length - 1 }[ev.key];
        if (alvo != null) {
          ev.preventDefault();
          const id = map.order[Math.max(0, Math.min(map.order.length - 1, alvo))];
          map.nodes.forEach((n) => n.g.setAttribute('tabindex', '-1'));
          const n = map.nodes.get(id);
          n.g.setAttribute('tabindex', '0');
          n.g.focus();
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          focusRecord(r.id);
        } else if (ev.key === 'Escape') {
          setActive(null);
        }
      });
      gNodes.appendChild(g);
      map.nodes.set(r.id, { g });
    });
    host.appendChild(gNodes);
    host.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch' && !host.contains(document.activeElement)) setActive(null); });

    // legenda
    $('nz-map-legend').replaceChildren(...[...pessoas.values()].map((p) => {
      const s = el('span', 'nz-leg');
      const dot = el('i', `nz-dot p-${p.id}`);
      dot.setAttribute('aria-hidden', 'true');
      s.append(dot, document.createTextNode(p.nome));
      return s;
    }));
    map.built = true;
    setActive(null);
  }

  function setActive(id) {
    if (!map.built) return;
    map.active = id;
    const wrap = $('nz-map');
    wrap.classList.toggle('has-active', !!id);
    const viz = id ? new Set([id, ...(rel.get(id) || []).map((x) => x.id)]) : null;
    map.nodes.forEach((n, nid) => {
      n.g.classList.toggle('is-hot', !!viz && viz.has(nid));
      n.g.classList.toggle('is-self', nid === id);
    });
    map.links.forEach((l) => l.p.classList.toggle('is-hot', !!id && (l.a === id || l.b === id)));
    drawMapInfo(id);
  }

  function drawMapInfo(id) {
    const box = $('nz-map-info');
    if (!id) {
      box.replaceChildren(el('p', 'nz-map-hint', 'Passe o mouse, toque em um ponto ou use Tab e as setas para ver o que cada caso tem a ver com os outros. Enter abre o cartão.'));
      return;
    }
    const r = byId.get(id);
    const lista = rel.get(id) || [];
    const head = el('div', 'nz-map-head');
    head.append(whoPill(r.pessoa), document.createTextNode(`${fmtData(r.data)} · ${rotuloTema(temas.get(r.tema)) || r.tema}`));
    const title = el('p', 'nz-map-title', r.titulo);
    const open = el('button', 'btn-ghost nz-map-open', 'Ver o cartão deste caso');
    open.type = 'button';
    open.addEventListener('click', () => focusRecord(id));
    const ul = el('ul', 'nz-map-rel');
    lista.forEach((x) => {
      const o = byId.get(x.id);
      const li = el('li');
      li.append(el('b', null, `${fmtData(o.data)} · ${curto(o.titulo, 90)}`), el('span', null, x.motivo));
      ul.appendChild(li);
    });
    box.replaceChildren(head, title, lista.length ? ul : el('p', 'nz-map-hint', 'Sem ligações com outros casos neste painel.'), open);
  }

  function updateMap(list) {
    if (!map.built) return;
    const ids = new Set(list.map((r) => r.id));
    const filtrado = ids.size !== regs.length;
    map.nodes.forEach((n, nid) => n.g.classList.toggle('is-off', filtrado && !ids.has(nid)));
    map.links.forEach((l) => l.p.classList.toggle('is-off', filtrado && !(ids.has(l.a) && ids.has(l.b))));
  }

  /* ---------- pessoas (também é o filtro de pessoa) ---------- */
  function drawPeopleChips() {
    const host = $('nz-people');
    host.replaceChildren(...[...pessoas.values()].map((p) => {
      const b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      const dot = el('span', `nz-dot p-${p.id}`);
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot, el('span', 'lbl', p.nome));
      const n = el('span', 'n', '0');
      b.appendChild(n);
      b.addEventListener('click', () => { state.pessoa = state.pessoa === p.id ? null : p.id; render(); });
      chipRefs.set(p.id, { b, n });
      return b;
    }));
  }

  function syncPeople() {
    // a contagem respeita busca e tema, mas não o próprio filtro de pessoa
    const tk = tokens();
    const base = regs.filter((r) => (!state.tema || r.tema === state.tema) && matchQ(r, tk));
    pessoas.forEach((p) => {
      const n = base.filter((r) => r.pessoa === p.id).length;
      const ref = chipRefs.get(p.id);
      ref.n.textContent = String(n);
      ref.b.setAttribute('aria-pressed', String(state.pessoa === p.id));
      ref.b.classList.toggle('is-empty', n === 0 && state.pessoa !== p.id);
    });
  }

  function drawOrder() {
    const host = $('nz-order');
    host.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { state.ordem = b.dataset.ordem; render(); });
    });
  }

  /* ---------- temas (também é o filtro de tema) ---------- */
  function drawBars() {
    const tk = tokens();
    const base = regs.filter((r) => (!state.pessoa || r.pessoa === state.pessoa) && matchQ(r, tk));
    const rows = [...temas.values()].map((t) => ({ t, n: base.filter((r) => r.tema === t.id).length }));
    const max = Math.max(1, ...rows.map((r) => r.n));
    $('nz-bars').replaceChildren(...rows.map(({ t, n }) => {
      const b = el('button', 'pl-bar-row');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.tema === t.id));
      b.setAttribute('aria-label', `${t.titulo}: ${plural(n, 'registro', 'registros')}`);
      const lbl = el('span');
      lbl.append(document.createTextNode(t.titulo), el('small', null, t.descricao));
      const track = el('span', 'track');
      const fill = el('span', 'fill');
      fill.style.width = `${(n / max) * 100}%`;
      track.appendChild(fill);
      b.append(lbl, track, el('span', 'num', String(n)));
      b.addEventListener('click', () => { state.tema = state.tema === t.id ? null : t.id; render(); });
      return b;
    }));
  }

  /* ---------- cartões ---------- */
  function tipoBadge(tipo, n) {
    const info = TIPO[tipo] || { label: tipo, cor: 'imprensa' };
    const t = el('span', `tipo t-${info.cor}`);
    t.append(el('i', 'tipo-sw'), document.createTextNode(n > 1 ? `${info.label} ×${n}` : info.label));
    return t;
  }

  function evidBlock(c) {
    const info = TIPO[c.tipo] || { label: c.tipo, cor: 'imprensa' };
    const box = el('div', `crit t-${info.cor}`);
    const top = el('div', 'crit-top');
    top.append(tipoBadge(c.tipo, 1), el('span', 'crit-quem', c.quem));
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

  function ctxBlock(label, quem, texto) {
    const box = el('div', 'ctx');
    box.appendChild(el('p', 'ctx-label', label));
    if (quem) box.appendChild(el('span', 'ctx-quem', quem));
    box.appendChild(el('p', null, texto));
    return box;
  }

  function whoPill(id) {
    const p = pessoas.get(id);
    const w = el('span', 'nz-who');
    const dot = el('i', `nz-dot p-${id}`);
    dot.setAttribute('aria-hidden', 'true');
    w.append(dot, document.createTextNode(p ? p.nome : id));
    return w;
  }

  function timelineLinks(ids) {
    const evs = window.LTF ? window.LTF.events : [];
    const links = (ids || []).map((id) => evs.find((e) => e.id === id)).filter(Boolean);
    if (!links.length) return null;
    const wrap = el('div');
    wrap.appendChild(el('p', 'pl-body-h', 'Relacionado na linha do tempo'));
    const row = el('div', 'pl-links');
    links.forEach((e) => {
      const b = el('button', 'chip', e.titulo);
      b.type = 'button';
      b.addEventListener('click', () => window.LTF.focusEvent(e.id));
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }

  // cronologia do caso e desdobramentos: lista vertical datada, cada item com a sua fonte
  function timelineBlock(items, titulo, cls, r) {
    if (!items || !items.length) return null;
    const wrap = el('div');
    wrap.appendChild(el('p', 'pl-body-h', titulo));
    const ol = el('ol', `nz-tl ${cls}`);
    [...items].sort((a, b) => (a.data ? String(a.data) : '9999').localeCompare(b.data ? String(b.data) : '9999')).forEach((it) => {
      const li = el('li');
      if (it.data && it.data === r.data && cls === 'nz-tl--before') li.classList.add('is-core');
      const t = el('time', null, it.data ? fmtData(it.data) : 'sem data');
      if (it.data) t.setAttribute('datetime', it.data);
      const box = el('div');
      box.appendChild(el('p', null, it.texto));
      const src = el('div', 'crit-src');
      src.append(document.createTextNode('Fonte: '), link(it.fonte_url, it.fonte_nome, 'pl-link-src'));
      box.appendChild(src);
      li.append(t, box);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }

  // quadros de números: barras horizontais, cada grupo com leitura, ressalva e fontes
  function numerosBlock(r) {
    const grupos = r.numeros || [];
    if (!grupos.length) return null;
    const wrap = el('div');
    wrap.appendChild(el('p', 'pl-body-h', 'Números'));
    grupos.forEach((g) => {
      const box = el('div', `nz-num p-${r.pessoa}`);
      box.appendChild(el('h4', null, g.rotulo));
      const pct = String(g.unidade || '').trim().startsWith('%');
      if (g.unidade) box.appendChild(el('p', 'nz-unit', `Unidade: ${g.unidade}`));
      const max = Math.max(1, ...g.itens.map((i) => Number(i.valor)));
      g.itens.forEach((i) => {
        const row = el('div', `nz-bar-row${i.destaque ? ' is-hi' : ''}`);
        const track = el('span', 'track');
        track.setAttribute('aria-hidden', 'true');
        const fill = el('span', 'fill');
        fill.style.width = `${Math.max(1.5, (Number(i.valor) / max) * 100)}%`;
        track.appendChild(fill);
        row.append(el('span', 'lbl', i.nome), track, el('span', 'val', `${fmtNum(i.valor)}${pct ? '%' : ''}`));
        box.appendChild(row);
      });
      if (g.leitura) box.appendChild(el('p', 'nz-read', g.leitura));
      if (g.ressalva) {
        const rs = el('p', 'ressalva');
        rs.append(el('b', null, 'Ressalva: '), document.createTextNode(g.ressalva));
        box.appendChild(rs);
      }
      const src = el('div', 'crit-src');
      const fts = g.fontes || [];
      src.appendChild(document.createTextNode(fts.length > 1 ? 'Fontes: ' : 'Fonte: '));
      fts.forEach((f, k) => {
        if (k) src.appendChild(document.createTextNode(' · '));
        src.appendChild(link(f.url, f.nome, 'pl-link-src'));
      });
      box.appendChild(src);
      wrap.appendChild(box);
    });
    return wrap;
  }

  // casos ligados: o motivo da ligação e um botão para abrir o outro cartão
  function relBlock(r) {
    const lista = rel.get(r.id) || [];
    if (!lista.length) return null;
    const wrap = el('div');
    wrap.appendChild(el('p', 'pl-body-h', 'Casos ligados'));
    const ul = el('ul', 'nz-rel');
    lista.forEach((x) => {
      const o = byId.get(x.id);
      const li = el('li');
      const b = el('button', 'nz-rel-btn');
      b.type = 'button';
      b.append(whoPill(o.pessoa), el('span', 'nz-rel-d', fmtData(o.data)), el('span', 'nz-rel-t', curto(o.titulo, 120)));
      b.addEventListener('click', () => focusRecord(o.id));
      li.append(b, el('p', 'nz-rel-m', x.motivo));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function card(r) {
    const det = el('details', 'pl-card');
    det.dataset.id = r.id;
    if (openIds.has(r.id)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) openIds.add(r.id); else openIds.delete(r.id); syncToggle(); });

    const sum = el('summary');
    const t = temas.get(r.tema);
    const meta = el('div', 'pl-meta');
    meta.append(el('span', 'pill', t ? t.titulo : r.tema), whoPill(r.pessoa), document.createTextNode(fmtData(r.data)));
    const says = el('p', 'pl-says');
    says.append(el('b', null, 'Em resumo: '), document.createTextNode(r.resumo));
    const foot = el('div', 'pl-foot');
    const badges = el('div', 'pl-badges');
    const ciencia = r.ciencia || [];
    TIPOS.forEach(([key]) => {
      const n = ciencia.filter((c) => c.tipo === key).length;
      if (n) badges.appendChild(tipoBadge(key, n));
    });
    const extras = [];
    if ((r.cronologia || []).length) extras.push(`${(r.cronologia || []).length} datas na cronologia`);
    if ((r.numeros || []).length) extras.push(plural(r.numeros.length, 'quadro de números', 'quadros de números'));
    const nl = (rel.get(r.id) || []).length;
    if (nl) extras.push(plural(nl, 'caso ligado', 'casos ligados'));
    const open = el('span', 'pl-open', ciencia.length ? `${plural(ciencia.length, 'bloco de checagem', 'blocos de checagem')}` : 'Ver o registro');
    foot.append(badges, open);
    sum.append(meta, el('h3', null, r.titulo), says);
    if (extras.length) sum.appendChild(el('p', 'nz-extras', extras.join(' · ')));
    sum.appendChild(foot);
    det.appendChild(sum);

    const body = el('div', 'pl-body');
    body.appendChild(el('p', 'pl-body-h', 'O que foi dito ou feito'));
    const said = el('div', 'ctx');
    (r.detalhe || []).forEach((par) => said.appendChild(el('p', null, par)));
    const src = el('div', 'crit-src');
    src.append(document.createTextNode('Fonte: '), link(r.fonte_url, r.fonte_nome, 'pl-link-src'));
    (r.fontes_extra || []).forEach((f) => {
      src.append(document.createTextNode(' · '), link(f.url, f.nome, 'pl-link-src'));
    });
    said.appendChild(src);
    body.appendChild(said);

    const cron = timelineBlock(r.cronologia, 'Cronologia do caso', 'nz-tl--before', r);
    if (cron) body.appendChild(cron);

    if (ciencia.length) {
      body.appendChild(el('p', 'pl-body-h', 'O que dizem a ciência e os dados'));
      ciencia.forEach((c) => body.appendChild(evidBlock(c)));
    }
    const nums = numerosBlock(r);
    if (nums) body.appendChild(nums);
    const depois = timelineBlock(r.consequencias, 'O que veio depois', 'nz-tl--after', r);
    if (depois) body.appendChild(depois);

    if (r.resposta) {
      body.appendChild(el('p', 'pl-body-h', 'Resposta'));
      body.appendChild(ctxBlock('Resposta', r.resposta.quem, r.resposta.texto));
    }
    if (r.ressalva) {
      const rr = el('p', 'ressalva');
      rr.append(el('b', null, 'Ressalva: '), document.createTextNode(r.ressalva));
      const holder = el('div', 'crit t-imprensa');
      holder.appendChild(rr);
      body.appendChild(holder);
    }
    const rb = relBlock(r);
    if (rb) body.appendChild(rb);
    const links = timelineLinks(r.ligacoes);
    if (links) body.appendChild(links);
    det.appendChild(body);
    return det;
  }

  function noteCard(n) {
    const box = el('div', 'nz-note');
    box.appendChild(whoPill(n.pessoa));
    box.appendChild(el('p', null, n.texto));
    const src = el('div', 'crit-src');
    src.append(document.createTextNode('Fonte: '), link(n.fonte_url, n.fonte_nome, 'pl-link-src'));
    box.appendChild(src);
    const links = timelineLinks(n.ligacoes);
    if (links) box.appendChild(links);
    return box;
  }

  function drawNotes() {
    const shown = notas.filter((n) => !state.pessoa || n.pessoa === state.pessoa);
    const sec = $('nz-notes-sec');
    sec.hidden = shown.length === 0;
    $('nz-notes').replaceChildren(...shown.map(noteCard));
  }

  function syncToggle() {
    const shown = [...$('nz-list').querySelectorAll('details')];
    allOpen = shown.length > 0 && shown.every((x) => x.open);
    $('nz-toggle').textContent = allOpen ? 'Recolher todos' : 'Expandir todos';
  }

  // abre o cartão de um registro (limpando os filtros se ele estiver escondido) e rola até ele
  function focusRecord(id) {
    if (!byId.has(id)) return;
    if (!visible().some((r) => r.id === id)) { state.pessoa = null; state.tema = null; state.q = ''; $('nz-q').value = ''; }
    openIds.add(id);
    render();
    const node = [...$('nz-list').querySelectorAll('details')].find((d) => d.dataset.id === id);
    if (!node) return;
    node.open = true;
    const top = node.getBoundingClientRect().top + window.scrollY - 76;
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion() ? 'auto' : 'smooth' });
    const s = node.querySelector('summary');
    if (s) s.focus({ preventScroll: true });
  }

  function render() {
    const list = visible();
    drawBars();
    syncPeople();
    $('nz-order').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ordem === state.ordem)));
    $('nz-count').textContent = `${list.length} de ${regs.length} registros`;
    $('nz-reset').hidden = !(state.pessoa || state.tema || state.q);
    if (!list.length) {
      const p = state.pessoa ? pessoas.get(state.pessoa) : null;
      const semNota = p && notas.some((n) => n.pessoa === p.id);
      $('nz-list').replaceChildren(el('p', 'pl-empty', p && !state.tema && !state.q && semNota
        ? `Não há registro de ${p.nome} neste painel. Veja a nota abaixo.`
        : 'Nenhum registro corresponde a esses filtros. Limpe os filtros ou mude a busca.'));
    } else {
      $('nz-list').replaceChildren(...list.map(card));
    }
    updateMap(list);
    drawNotes();
    syncToggle();
  }

  function bindUi() {
    $('nz-q').addEventListener('input', (ev) => { state.q = ev.target.value; render(); });
    $('nz-toggle').addEventListener('click', () => {
      const shown = [...$('nz-list').querySelectorAll('details')];
      const target = !shown.every((x) => x.open);
      shown.forEach((x) => { x.open = target; });
      syncToggle();
    });
    $('nz-reset').addEventListener('click', () => {
      state.pessoa = null; state.tema = null; state.q = ''; $('nz-q').value = ''; render();
    });
  }
})();
