/* Linha do tempo das investigações e das controvérsias · app.js
   Dependências: D3 v7 (CDN). Dados: dados_investigacoes.json (ou dados_investigacoes.js em file://).
   Todo texto vindo dos dados é inserido com textContent (nunca innerHTML).
   Também controla as abas e expõe window.LTF para explorar.js e plano.js. */
(() => {
  'use strict';

  const TABS = ['linha', 'explorar', 'plano', 'negacionismo'];

  /* API pública para as outras abas: `ready` resolve com os eventos quando os dados carregam */
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  ready.catch(() => {});   // ninguém precisa esperar para o erro não virar aviso no console
  const LTF = (window.LTF = { ready });

  if (typeof d3 === 'undefined') {
    const msg = 'Não foi possível carregar a biblioteca D3 (CDN). Verifique a conexão e recarregue a página.';
    const c = document.getElementById('chart');
    if (c) c.textContent = msg;
    rejectReady(new Error(msg));
    return;
  }

  const DATA_URL = 'dados_investigacoes.json';

  /* ---------- vocabulário fixo ---------- */
  const CAREER = 'Carreira política';
  const CAT_ORDER = [
    CAREER, 'Rachadinha (Alerj)', 'Milícias e Brazão', 'Imóveis e negócios', 'Campanhas e contas eleitorais',
    'Emendas e cota parlamentar', 'Caso INSS (entorno)', 'Benefícios de terceiros',
    'Família: imóveis e patrimônio', 'Família: gabinetes, cheques e presentes', 'Família: trama golpista e coação',
    'Esquema ABIN', 'Caso Master / Dark Horse', 'Disputa judicial', 'Honra, imagem e propaganda',
    'Outras investigações e representações',
  ];

  const DOMAINS = {
    all:    [new Date(2002, 6, 1), new Date(2027, 3, 1)],
    recent: [new Date(2017, 9, 1), new Date(2027, 3, 1)],
  };

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const R_MIN = 9, R_MAX = 26, R_NULL = 7;
  const rScale = d3.scaleLog().domain([2e4, 2e8]).range([R_MIN, R_MAX]).clamp(true);
  const radius = (d) => (d.valor_estimado > 0 ? rScale(d.valor_estimado) : R_NULL);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- utilidades ---------- */
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
  // datas em texto: "2005", "2018-12" ou "2019-01-18" (a precisão vem do tamanho)
  const parseStr = (s) => {
    const [y, m, day] = String(s).split('-').map(Number);
    if (!m) return new Date(y, 6, 1);
    if (!day) return new Date(y, m - 1, 15);
    return new Date(y, m - 1, day);
  };
  const fmtStr = (s) => {
    const [y, m, day] = String(s).split('-').map(Number);
    if (!m) return String(y);
    if (!day) return `${MESES[m - 1]} de ${y}`;
    return `${day} de ${MESES[m - 1]} de ${y}`;
  };
  const fmtShort = (s) => {
    const [y, m, day] = String(s).split('-').map(Number);
    if (!m) return String(y);
    const mm = String(m).padStart(2, '0');
    return day ? `${String(day).padStart(2, '0')}/${mm}/${y}` : `${mm}/${y}`;
  };
  const fmtValor = (v) => {
    if (!(v > 0)) return null;
    const n = (x, max) => x.toLocaleString('pt-BR', { maximumFractionDigits: max });
    if (v >= 1e6) { const m = v / 1e6; return `R$ ${n(m, m < 100 ? 1 : 0)} ${m < 2 ? 'milhão' : 'milhões'}`; }
    if (v >= 1e3) return `R$ ${n(v / 1e3, 1)} mil`;
    return `R$ ${n(v, 0)}`;
  };
  const isCareer = (d) => d.categoria === CAREER;
  // tipo do evento: marco da carreira (cinza), caso de outro familiar (laranja) ou caso de Flávio (azul)
  const scopeOf = (d) => (isCareer(d) ? 's-carreira' : d.escopo === 'familia' ? 's-familia' : 's-fato');

  /* ---------- estado ---------- */
  const state = { data: [], cats: new Set(), period: 'all', basis: 'noticia', hl: null, hlLabel: '' };
  const els = {};
  let svg, root, gGap, gBands, gTop, gBottom, gNodes;
  let pinnedId = null, hoverTimer = 0, closeToken = 0, suppressFocusTip = false;

  const dateOf = (d) => (state.basis === 'fato' ? d._dateFato : d._date);
  const passCat = (d) => state.cats.size === 0 || state.cats.has(d.categoria);
  const passPeriod = (d) => state.period === 'all' || dateOf(d) >= DOMAINS.recent[0];
  const facetVisible = () => state.data.filter(passCat);
  const chartVisible = () => facetVisible().filter(passPeriod);

  /* ---------- carga de dados ---------- */
  async function loadData() {
    // versão de envio (arquivo único): os dados já vêm embutidos, sem buscar o JSON
    if (window.LTF_EMBUTIDO && Array.isArray(window.DADOS_INVESTIGACOES)) return window.DADOS_INVESTIGACOES;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      // file:// bloqueia fetch(); usa a cópia em dados_investigacoes.js
      if (Array.isArray(window.DADOS_INVESTIGACOES)) return window.DADOS_INVESTIGACOES;
      throw err;
    }
  }

  /* ---------- filtros ---------- */
  const chipRefs = new Map();

  function makeChip(key, label, cls, onClick) {
    const b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    if (cls) b.appendChild(el('span', `sw ${cls}`));
    b.appendChild(el('span', 'lbl', label));
    const n = el('span', 'n', '0');
    b.appendChild(n);
    b.addEventListener('click', onClick);
    chipRefs.set(key, { b, n });
    return b;
  }

  function buildChips() {
    const cats = [...new Set(state.data.map((d) => d.categoria))].sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    state.catList = cats;
    els.chipsCat.replaceChildren(
      makeChip('__all', 'Todos', null, () => { state.cats.clear(); update(); }),
      ...cats.map((c) => makeChip(c, c, catScope(c), () => {
        if (state.cats.has(c)) state.cats.delete(c); else state.cats.add(c);
        update();
      })),
    );
  }
  // o marcador do botão segue o tipo predominante dos eventos do tema
  const catScope = (c) => {
    const evs = state.data.filter((d) => d.categoria === c);
    const familia = evs.filter((d) => d.escopo === 'familia').length;
    return c === CAREER ? 's-carreira' : familia > evs.length / 2 ? 's-familia' : 's-fato';
  };

  function syncChips() {
    const set = (key, count, pressed) => {
      const ref = chipRefs.get(key);
      ref.b.setAttribute('aria-pressed', String(pressed));
      ref.n.textContent = String(count);
    };
    set('__all', state.data.length, state.cats.size === 0);
    for (const c of state.catList) set(c, state.data.filter((d) => d.categoria === c).length, state.cats.has(c));
    els.segPeriod.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === state.period)));
    els.segBasis.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.basis === state.basis)));
  }

  function syncCount() {
    const facet = facetVisible().length;
    const shown = chartVisible().length;
    let txt = `${shown} de ${state.data.length} eventos no gráfico`;
    if (facet > shown) txt += ` (${facet - shown} fora do período exibido)`;
    els.count.textContent = txt;
    els.btnReset.hidden = state.cats.size === 0 && state.period === 'all' && state.basis === 'noticia' && !state.hl;
    els.hlBanner.hidden = !state.hl;
    if (state.hl) els.hlText.textContent = state.hlLabel;
  }

  /* ---------- tabela ---------- */
  function drawTable() {
    const rows = facetVisible().sort((a, b) => a._date - b._date).map((d) => {
      const tr = el('tr');
      const tdD = el('td', 't-data');
      tdD.appendChild(document.createTextNode(fmtShort(d.data)));
      if (d.periodo_fato) tdD.appendChild(el('span', 't-sub', `fato: ${d.periodo_fato}`));
      tr.appendChild(tdD);

      const tdT = el('td', 't-titulo');
      tdT.append(el('strong', null, d.titulo), el('span', null, d.categoria));
      tr.appendChild(tdT);

      tr.appendChild(el('td', 't-valor', fmtValor(d.valor_estimado) || '—'));

      const tdF = el('td');
      const href = safeUrl(d.fonte_url);
      if (href) {
        const a = el('a', null, d.fonte_nome || 'Fonte');
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        tdF.appendChild(a);
      } else tdF.textContent = '—';
      tr.appendChild(tdF);
      return tr;
    });
    els.tableBody.replaceChildren(...rows);
  }

  /* ---------- gráfico ---------- */
  function initChart() {
    svg = d3.select(els.chart).append('svg').attr('role', 'group').attr('aria-label', 'Eventos da linha do tempo');
    root = svg.append('g');
    const hatch = svg.append('defs').append('pattern')
      .attr('id', 'hatch').attr('width', 6).attr('height', 6)
      .attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    hatch.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
      .attr('stroke', '#3a3a37').attr('stroke-width', 1.5);

    gGap = root.append('g').attr('class', 'axis-gap').attr('opacity', 0);   // abaixo das faixas: rótulos ficam por cima
    gBands = root.append('g').attr('class', 'bands');
    gGap.append('title');
    gGap.append('rect').attr('class', 'gap-rect');
    gGap.append('line').attr('class', 'gap-line gap-l');
    gGap.append('line').attr('class', 'gap-line gap-r');
    gGap.append('text').attr('class', 'gap-label').attr('text-anchor', 'middle').text('sem eventos');
    gTop = root.append('g').attr('class', 'axis axis-top');
    gBottom = root.append('g').attr('class', 'axis axis-bottom');
    gNodes = root.append('g').attr('class', 'nodes');
  }

  /* maior intervalo sem eventos (>= 3 anos), calculado sobre todos os eventos na base de datas atual */
  function findGap() {
    const ds = state.data.map(dateOf).sort((a, b) => a - b);
    let best = null;
    for (let i = 1; i < ds.length; i++) {
      const y0 = ds[i - 1].getFullYear() + 1, y1 = ds[i].getFullYear();
      if (y1 - y0 >= 3 && (!best || y1 - y0 > best[1] - best[0])) best = [y0, y1];
    }
    return best ? [new Date(best[0], 0, 1), new Date(best[1], 0, 1)] : null;
  }

  function makeScale(innerW) {
    const [d0, d1] = DOMAINS[state.period];
    const gap = state.period === 'all' ? findGap() : null;
    if (!gap) return { x: d3.scaleTime().domain([d0, d1]).range([0, innerW]), gap: null, gapW: 0 };
    const gapW = Math.min(36, innerW * 0.05);
    const real = (d1 - d0) - (gap[1] - gap[0]);
    const leftW = (innerW - gapW) * ((gap[0] - d0) / real);
    return { x: d3.scaleTime().domain([d0, gap[0], gap[1], d1]).range([0, leftW, leftW + gapW, innerW]), gap, gapW };
  }

  /* posiciona as bolhas faixa por faixa; cada faixa tem a altura que o seu conteúdo pede */
  function layoutLanes(nodes, lanes, labelPad) {
    const byLane = d3.group(nodes, (n) => n.categoria);
    const info = new Map();
    let cursor = 0;
    for (const cat of lanes) {
      const group = byLane.get(cat).sort((a, b) => dateOf(a) - dateOf(b));
      group.forEach((n, i) => { n.x = n.x0; n.y = ((i % 3) - 1) * 3; });
      const sim = d3.forceSimulation(group)
        .force('x', d3.forceX((n) => n.x0).strength(1))
        .force('y', d3.forceY(0).strength(0.08))
        .force('collide', d3.forceCollide((n) => n.r + 3).strength(1).iterations(4))
        .stop();
      for (let i = 0; i < 240; i++) sim.tick();
      const lo = d3.min(group, (n) => n.y - n.r), hi = d3.max(group, (n) => n.y + n.r);
      const h = Math.max(70, hi - lo + 30) + labelPad;
      const shift = cursor + labelPad + (h - labelPad) / 2 - (lo + hi) / 2;
      group.forEach((n) => { n.y += shift; });
      info.set(cat, { top: cursor, h });
      cursor += h;
    }
    return { info, total: cursor };
  }

  function draw(animate = true) {
    const visible = chartVisible();
    const host = els.chart;
    if (!host.clientWidth) return;   // aba escondida: o ResizeObserver redesenha quando ela aparecer
    const hostW = host.clientWidth;
    const W = Math.max(hostW - 12, 680);
    const narrow = hostW < 760;
    const margin = { top: 30, right: narrow ? 18 : 26, bottom: 30, left: narrow ? 14 : 196 };
    const innerW = W - margin.left - margin.right;
    const labelPad = narrow ? 26 : 0;

    const lanes = (state.catList || []).filter((c) => visible.some((d) => d.categoria === c));

    els.chart.querySelector('.chart-empty')?.remove();
    if (!visible.length) {
      host.appendChild(el('div', 'chart-empty', 'Nenhum evento corresponde a esses filtros. Limpe os filtros ou amplie o período.'));
    }

    const dur = animate && !reduceMotion ? 650 : 0;
    const t = () => d3.transition().duration(dur).ease(d3.easeCubicInOut);

    /* escala de tempo (com quebra de eixo quando há um intervalo longo sem eventos) */
    const { x, gap, gapW } = makeScale(innerW);

    const nodes = visible.map((d) => ({ ...d, r: radius(d), x0: x(dateOf(d)) }));
    const { info, total: innerH } = layoutLanes(nodes, lanes, labelPad);
    nodes.forEach((n) => { n.x = Math.max(n.r + 2, Math.min(innerW - n.r - 2, n.x)); });
    const H = margin.top + innerH + margin.bottom;

    svg.attr('width', W).attr('height', visible.length ? H : 0);
    root.attr('transform', `translate(${margin.left},${margin.top})`);

    /* eixos */
    const [d0, d1] = DOMAINS[state.period];
    const gapYears = gap ? [gap[0].getFullYear(), gap[1].getFullYear()] : null;
    const realYears = (d1 - d0) / 3.15576e10 - (gap ? (gap[1] - gap[0]) / 3.15576e10 : 0);
    const pxPerYear = (innerW - gapW) / realYears;
    const yrStep = pxPerYear >= 42 ? 1 : 2;
    const ticks = d3.range(d0.getFullYear() + 1, 2027)
      .filter((y) => y % yrStep === 0 && !(gapYears && y >= gapYears[0] && y < gapYears[1]))
      .map((y) => new Date(y, 0, 1));
    const fmtYear = d3.timeFormat('%Y');
    const axisTop = d3.axisTop(x).tickValues(ticks).tickFormat(fmtYear).tickSize(0).tickPadding(10);
    const axisBottom = d3.axisBottom(x).tickValues(ticks).tickFormat(fmtYear).tickSize(-innerH).tickPadding(10);
    gTop.transition(t()).call(axisTop);
    gBottom.transition(t()).attr('transform', `translate(0,${innerH})`).call(axisBottom);
    gBottom.attr('display', visible.length ? null : 'none');
    gTop.attr('display', visible.length ? null : 'none');

    /* quebra de eixo */
    const showGap = !!gap && visible.length > 0;
    const gx0 = gap ? x(gap[0]) : 0, gx1 = gap ? x(gap[1]) : 0;
    gGap.transition(t()).attr('opacity', showGap ? 1 : 0);
    gGap.select('title').text(gap ? `Intervalo de ${gapYears[0]} a ${gapYears[1] - 1} omitido: nenhum evento mapeado nesse período` : '');
    gGap.select('rect.gap-rect').attr('x', gx0).attr('y', 0).attr('width', Math.max(0, gx1 - gx0)).attr('height', innerH);
    gGap.select('line.gap-l').attr('x1', gx0).attr('x2', gx0).attr('y1', 0).attr('y2', innerH);
    gGap.select('line.gap-r').attr('x1', gx1).attr('x2', gx1).attr('y1', 0).attr('y2', innerH);
    gGap.select('text.gap-label')
      .attr('transform', `translate(${(gx0 + gx1) / 2 + 4},${innerH / 2}) rotate(-90)`)
      .style('display', innerH >= 110 ? null : 'none');
    els.axisNote.hidden = !gap;
    if (gap) {
      els.axisNote.textContent = `Atenção ao eixo: o trecho hachurado omite ${gapYears[0]}–${gapYears[1] - 1}, período sem eventos mapeados. As escalas antes e depois dele são lineares.`;
    }

    /* faixas dos temas */
    const laneSel = gBands.selectAll('g.lane').data(lanes, (d) => d).join(
      (enter) => {
        const g = enter.append('g').attr('class', 'lane').attr('opacity', 0)
          .attr('transform', (d) => `translate(0,${info.get(d).top})`);
        g.append('rect').attr('class', 'band');
        g.append('line').attr('class', 'lane-sep');
        g.append('text').attr('class', 'lane-label');
        g.append('text').attr('class', 'lane-count');
        return g;
      },
      (u) => u,
      (exit) => exit.transition(t()).attr('opacity', 0).remove(),
    );
    laneSel.classed('is-alt', (d, i) => i % 2 === 1);
    laneSel.transition(t()).attr('opacity', 1).attr('transform', (d) => `translate(0,${info.get(d).top})`);
    laneSel.select('rect.band').attr('x', -margin.left).attr('width', W).attr('height', (d) => info.get(d).h);
    laneSel.select('line.lane-sep').attr('x1', -margin.left).attr('x2', W - margin.left)
      .attr('y1', (d) => info.get(d).h).attr('y2', (d) => info.get(d).h);
    laneSel.select('text.lane-label').text((d) => d)
      .attr('x', narrow ? 2 : -margin.left + 14)
      .attr('y', (d) => (narrow ? 17 : info.get(d).h / 2 - 3));
    laneSel.select('text.lane-count')
      .text((d) => { const n = visible.filter((e) => e.categoria === d).length; return `${n} ${n === 1 ? 'evento' : 'eventos'}`; })
      .attr('text-anchor', narrow ? 'end' : 'start')
      .attr('x', narrow ? innerW - 2 : -margin.left + 14)
      .attr('y', (d) => (narrow ? 17 : info.get(d).h / 2 + 14));

    /* bolhas */
    const nodeSel = gNodes.selectAll('g.node').data(nodes, (d) => d.id).join(
      (enter) => {
        const g = enter.append('g').attr('tabindex', 0).attr('role', 'button')
          .style('opacity', 0)
          .attr('transform', (d) => `translate(${d.x},${d.y})`);
        g.append('circle').attr('class', 'hit');
        g.append('circle').attr('class', 'dot').attr('r', 0);
        return g;
      },
      (u) => u,
      (exit) => exit.classed('is-exiting', true).transition(t()).style('opacity', 0).remove(),
    );

    nodeSel
      .attr('class', (d) => `node ev-anchor ${scopeOf(d)}${d.id === pinnedId ? ' is-active' : ''}${state.hl && !state.hl.has(d.id) ? ' is-dim' : ''}`)
      .attr('aria-label', (d) => `${d.titulo}. ${fmtStr(d.data)}.${fmtValor(d.valor_estimado) ? ` Valor citado: ${fmtValor(d.valor_estimado)}.` : ''} Enter fixa o cartão com a fonte.`);
    nodeSel.select('circle.hit').attr('r', (d) => d.r + 12);
    nodeSel.transition(t()).style('opacity', 1).attr('transform', (d) => `translate(${d.x},${d.y})`);
    nodeSel.select('circle.dot').transition(t()).attr('r', (d) => d.r);

    nodeSel
      .on('pointerenter', function (ev, d) {
        if (ev.pointerType === 'touch') return;
        clearTimeout(hoverTimer);
        if (pinnedId && pinnedId !== d.id) return;
        showTip(d, this, false);
      })
      .on('pointerleave', () => { if (!pinnedId) scheduleHide(); })
      .on('focus', function (ev, d) { if (!pinnedId && !suppressFocusTip) showTip(d, this, false); })
      .on('blur', () => { if (!pinnedId) scheduleHide(); })
      .on('click', function (ev, d) { ev.stopPropagation(); pinTip(d, this, false); })
      .on('keydown', function (ev, d) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pinTip(d, this, true); }
      });

    // se o evento fixado saiu do gráfico, fecha o cartão
    if (pinnedId && !nodes.some((n) => n.id === pinnedId)) hideTip(true);
  }

  /* ---------- legenda de cor e tamanho ---------- */
  function drawLegend() {
    const NS = 'http://www.w3.org/2000/svg';
    const circle = (r, attrs) => {
      const s = document.createElementNS(NS, 'svg');
      const size = Math.ceil(r * 2 + 4);
      s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', size / 2); c.setAttribute('cy', size / 2); c.setAttribute('r', r);
      Object.entries(attrs).forEach(([k, v]) => c.setAttribute(k, v));
      s.appendChild(c);
      return s;
    };
    const item = (svgEl, text) => { const s = el('span', 'ref'); s.append(svgEl, document.createTextNode(text)); return s; };

    const items = [el('span', 't', 'Cor')];
    const present = new Set(state.data.map(scopeOf));   // só entram na legenda os tipos que existem nos dados
    if (present.has('s-fato')) items.push(item(el('span', 'sw s-fato'), 'Caso de Flávio'));
    if (present.has('s-familia')) items.push(item(el('span', 'sw s-familia'), 'Caso de outro familiar (Jair, Carlos, Eduardo, Michelle e outros)'));
    if (present.has('s-carreira')) items.push(item(el('span', 'sw s-carreira'), 'Marco da carreira política'));
    items.push(el('span', 't', 'Valor citado'));
    for (const v of [5e4, 1e6, 1e7, 1e8]) {
      items.push(item(circle(rScale(v), { fill: 'none', stroke: '#898781', 'stroke-width': '1.5' }), fmtValor(v)));
    }
    items.push(item(circle(R_NULL, { fill: '#898781', opacity: '.55' }), 'sem valor público (tamanho fixo)'));
    els.sizeLegend.replaceChildren(...items);
  }

  /* ---------- cartão flutuante ---------- */
  const ACTIVE = '.node.is-active, .ev-anchor.is-active';

  /* liga um elemento qualquer (ponto, linha de lista) ao cartão do evento `d`.
     `anchor` é o elemento perto do qual o cartão aparece (padrão: o próprio nó). */
  function bindTip(node, d, anchor) {
    const at = () => anchor || node;
    node.classList.add('ev-anchor');
    node.addEventListener('pointerenter', (ev) => {
      if (ev.pointerType === 'touch') return;
      clearTimeout(hoverTimer);
      if (pinnedId && pinnedId !== d.id) return;
      showTip(d, at(), false);
    });
    node.addEventListener('pointerleave', () => { if (!pinnedId) scheduleHide(); });
    node.addEventListener('focus', () => { if (!pinnedId && !suppressFocusTip) showTip(d, at(), false); });
    node.addEventListener('blur', () => { if (!pinnedId) scheduleHide(); });
    node.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;   // links dentro da linha seguem normalmente
      ev.stopPropagation();
      pinTip(d, at(), false);
    });
    node.addEventListener('keydown', (ev) => {
      if (ev.target !== node) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pinTip(d, at(), true); }
    });
  }

  function buildTip(d, pinned) {
    const tip = els.tip;

    const top = el('div', 'tip-top');
    const pill = el('span', 'pill');
    pill.append(el('span', `sw ${scopeOf(d)}`), document.createTextNode(d.categoria));
    const close = el('button', 'tip-close', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Fechar cartão');
    close.addEventListener('click', () => hideTip(true, true));
    top.append(pill, close);

    const parts = [top, el('h3', null, d.titulo), el('p', 'tip-meta', fmtStr(d.data))];
    if (d.periodo_fato) {
      const fato = el('p', 'tip-fato');
      fato.append(el('b', null, 'Quando ocorreu: '), document.createTextNode(d.periodo_fato));
      parts.push(fato);
    }

    const valor = fmtValor(d.valor_estimado);
    if (valor || d.valor_descricao) {
      const v = el('div', 'tip-value');
      if (valor) v.appendChild(el('strong', null, valor));
      if (d.valor_descricao) v.appendChild(el('span', null, d.valor_descricao));
      parts.push(v);
    }
    if (Array.isArray(d.envolvidos) && d.envolvidos.length) {
      const ul = el('ul', 'tags');
      d.envolvidos.forEach((n) => ul.appendChild(el('li', null, n)));
      parts.push(ul);
    }
    parts.push(el('p', null, d.resumo));

    const section = (title, text) => {
      if (!text) return;
      const s = el('div', 'tip-sec');
      s.append(el('h4', null, title), el('p', null, text));
      parts.push(s);
    };
    section('Desdobramento', d.desdobramento);
    section('Contraponto e defesa', d.contraponto);

    const foot = el('div', 'tip-foot');
    const href = safeUrl(d.fonte_url);
    if (href) {
      const a = el('a', 'btn-fonte');
      a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.append(document.createTextNode('Acessar Fonte'), el('span', null, '↗'));
      a.setAttribute('aria-label', `Acessar Fonte: ${d.fonte_nome || href} (abre em nova aba)`);
      foot.appendChild(a);
    }
    if (d.fonte_nome) foot.appendChild(el('span', 'tip-src', d.fonte_nome));
    parts.push(foot);

    const extras = (d.fontes_complementares || []).map((f) => ({ nome: f.nome, href: safeUrl(f.url) })).filter((f) => f.href);
    if (extras.length) {
      const more = el('p', 'tip-more');
      more.appendChild(document.createTextNode('Outras fontes: '));
      extras.forEach((f, i) => {
        const a = el('a', null, f.nome);
        a.href = f.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        more.appendChild(a);
        if (i < extras.length - 1) more.appendChild(document.createTextNode(' · '));
      });
      parts.push(more);
    }

    tip.replaceChildren(...parts);
    tip.setAttribute('aria-label', d.titulo);
    tip.classList.toggle('is-pinned', pinned);
  }

  function placeTip(anchor) {
    const tip = els.tip;
    if (window.matchMedia('(max-width: 640px)').matches) { tip.style.left = ''; tip.style.top = ''; return; }
    const r = (anchor.querySelector('circle.dot') || anchor).getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 12;
    let left = r.right + gap;
    if (left + w > vw - pad) left = r.left - w - gap;
    if (left < pad) left = Math.min(Math.max(r.left + r.width / 2 - w / 2, pad), vw - w - pad);
    let top = r.top + r.height / 2 - h / 2;
    top = Math.min(Math.max(top, pad), Math.max(pad, vh - h - pad));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function showTip(d, anchor, pinned) {
    closeToken++;
    clearTimeout(hoverTimer);
    const tip = els.tip;
    buildTip(d, pinned);
    tip.hidden = false;
    tip._anchor = anchor;
    placeTip(anchor);
    requestAnimationFrame(() => tip.classList.add('is-open'));
  }

  function pinTip(d, anchor, viaKeyboard) {
    if (pinnedId === d.id) { hideTip(true, viaKeyboard); return; }
    document.querySelectorAll(ACTIVE).forEach((n) => n.classList.remove('is-active'));
    pinnedId = d.id;
    anchor.classList.add('is-active');
    showTip(d, anchor, true);
    if (viaKeyboard) els.tip.querySelector('a.btn-fonte')?.focus();
  }

  function scheduleHide() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => hideTip(false), 220);
  }

  function hideTip(force, restoreFocus) {
    if (pinnedId && !force) return;
    clearTimeout(hoverTimer);
    const tip = els.tip;
    const anchor = tip._anchor;
    pinnedId = null;
    document.querySelectorAll(ACTIVE).forEach((n) => n.classList.remove('is-active'));
    tip.classList.remove('is-open', 'is-pinned');
    const token = ++closeToken;
    setTimeout(() => { if (token === closeToken) tip.hidden = true; }, 160);
    if (restoreFocus && anchor && anchor.isConnected) {
      suppressFocusTip = true;   // devolver o foco ao nó não deve reabrir o cartão
      anchor.focus();
      suppressFocusTip = false;
    }
  }

  /* ---------- atualização geral ---------- */
  function update(opts = {}) {
    if (!opts.keepTip) hideTip(true);
    syncChips();
    drawTable();
    draw(opts.animate !== false);
    syncCount();
  }

  function bindUi() {
    els.segPeriod.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { state.period = b.dataset.period; update(); });
    });
    els.segBasis.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => { state.basis = b.dataset.basis; update(); });
    });
    els.btnReset.addEventListener('click', () => {
      state.cats.clear(); state.period = 'all'; state.basis = 'noticia'; state.hl = null; update();
    });
    els.hlClear.addEventListener('click', () => setHighlight(null));
    els.tip.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
    els.tip.addEventListener('pointerleave', () => { if (!pinnedId) scheduleHide(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !els.tip.hidden) hideTip(true, true);
    });
    document.addEventListener('click', (ev) => {
      if (!els.tip.hidden && !ev.target.closest('#tip') && !ev.target.closest('.node, .ev-anchor')) hideTip(true);
    });
    let scrollRaf = 0;
    window.addEventListener('scroll', () => {
      if (els.tip.hidden) return;
      if (!pinnedId) { hideTip(true); return; }
      cancelAnimationFrame(scrollRaf);   // cartão fixado acompanha a bolha
      scrollRaf = requestAnimationFrame(() => { if (els.tip._anchor?.isConnected) placeTip(els.tip._anchor); });
    }, { passive: true });

    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        draw(false);
        if (pinnedId && els.tip._anchor?.isConnected) placeTip(els.tip._anchor);
      });
    }).observe(els.chart);
  }

  /* ---------- destaque de eventos (vindo das outras abas) ---------- */
  function setHighlight(ids, label) {
    state.hl = ids && ids.length ? new Set(ids) : null;
    state.hlLabel = state.hl ? (label || '') : '';
    if (state.hl) { state.cats.clear(); state.period = 'all'; }   // garante que os destacados estejam visíveis
    update({ animate: false });
  }

  function focusEvent(id) {
    const d = state.data.find((e) => e.id === id);
    if (!d) return;
    goto('linha');
    state.cats.clear(); state.period = 'all';
    state.hl = new Set([id]); state.hlLabel = d.titulo;
    update({ animate: false });
    requestAnimationFrame(() => {
      const node = gNodes.selectAll('g.node').filter((n) => n.id === id).node();
      if (!node) return;
      const y = node.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2;
      window.scrollTo(0, Math.max(0, y));
      pinTip(d3.select(node).datum(), node, false);
    });
  }

  /* ---------- abas ---------- */
  const tabFromHash = () => {
    const h = location.hash.replace('#', '');
    return TABS.includes(h) ? h : null;
  };

  function activate(tab, fromUser) {
    if (!TABS.includes(tab)) tab = 'linha';
    const changed = els.activeTab !== tab;
    els.activeTab = tab;
    els.tabBtns.forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    TABS.forEach((t) => { $(`panel-${t}`).hidden = t !== tab; });
    // em tela estreita a barra de abas rola na horizontal: traz a aba ativa para o centro
    const lista = els.tabList;
    const ativa = els.tabBtns.find((b) => b.dataset.tab === tab);
    if (ativa && lista.scrollWidth > lista.clientWidth) {
      const lr = lista.getBoundingClientRect();
      const br = ativa.getBoundingClientRect();
      lista.scrollLeft += (br.left - lr.left) - (lr.width - br.width) / 2;
    }
    if (!changed) return;
    hideTip(true);
    if (fromUser) {
      const top = els.masthead.getBoundingClientRect().bottom + window.scrollY;
      if (window.scrollY > top) window.scrollTo(0, top);
    }
    document.dispatchEvent(new CustomEvent('ltf:tab', { detail: { tab } }));
  }

  // trocar a hash (e não só o painel) mantém o botão Voltar do navegador funcionando entre as abas
  function goto(tab) {
    if (!TABS.includes(tab)) return;
    if (tabFromHash() !== tab) {
      try { history.replaceState(null, '', `#${tab}`); } catch { /* file:// restritivo: segue sem hash */ }
    }
    activate(tab, false);
  }

  function initTabs() {
    els.tabBtns.forEach((b) => {
      b.addEventListener('click', () => {
        if (tabFromHash() !== b.dataset.tab) {
          try { history.pushState(null, '', `#${b.dataset.tab}`); } catch { /* ignora */ }
        }
        activate(b.dataset.tab, true);
      });
    });
    els.tabList.addEventListener('keydown', (ev) => {
      const i = TABS.indexOf(els.activeTab);
      const next = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 }[ev.key];
      if (next == null) return;
      ev.preventDefault();
      const btn = els.tabBtns[next];
      btn.focus();
      btn.click();
    });
    window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t) activate(t, true); });
    activate(tabFromHash() || 'linha', false);
  }

  /* ---------- início ---------- */
  async function init() {
    Object.assign(els, {
      chart: $('chart'), chipsCat: $('chips-cat'), segPeriod: $('seg-period'), segBasis: $('seg-basis'),
      btnReset: $('btn-reset'), count: $('count'), tableBody: $('table-body'), sizeLegend: $('size-legend'),
      tip: $('tip'), axisNote: $('axis-note'), hlBanner: $('hl-banner'), hlText: $('hl-text'), hlClear: $('hl-clear'),
      masthead: document.querySelector('.masthead'), tabList: $('tabs'),
      tabBtns: [...document.querySelectorAll('#tabs [role="tab"]')],
    });
    initTabs();

    try {
      const raw = await loadData();
      state.data = raw.map((d) => ({ ...d, _date: parseStr(d.data), _dateFato: parseStr(d.data_fato || d.data) }))
        .sort((a, b) => a._date - b._date);
    } catch (err) {
      console.error('Falha ao carregar os dados', err);
      els.chart.replaceChildren(el('div', 'chart-empty', 'Não foi possível carregar dados_investigacoes.json. Abra a página por um servidor local (por exemplo, Live Server) ou mantenha o arquivo dados_investigacoes.js na mesma pasta.'));
      rejectReady(err);
      return;
    }

    $('total').textContent = String(state.data.length);
    buildChips();
    drawLegend();
    initChart();
    bindUi();
    update({ animate: false });
    resolveReady(state.data);
  }

  Object.assign(LTF, {
    CAREER, CAT_ORDER, R_MIN, R_MAX, R_NULL, rScale, radius, reduceMotion,
    el, safeUrl, scopeOf, catScope,
    parseStr, fmtStr, fmtShort, fmtValor,
    bindTip, goto, focusEvent, setHighlight,
    tip: {
      hide: (restoreFocus) => hideTip(true, restoreFocus),
      isPinned: () => !!pinnedId,
    },
  });
  // getter à parte: Object.assign copiaria o valor (vazio) e não acompanharia o state.data carregado depois
  Object.defineProperty(LTF, 'events', { get: () => state.data });

  init();
})();
