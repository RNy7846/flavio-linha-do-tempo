/* Aba "Explorar os dados" · explorar.js
   1) pontos que se reagrupam conforme a rolagem; 2) explorador de nomes; 3) ranking de valores; 4) do fato à notícia.
   Usa os eventos e o cartão compartilhado expostos por app.js (window.LTF). Texto dos dados sempre via textContent. */
(() => {
  'use strict';

  const LTF = window.LTF;
  if (!LTF || typeof d3 === 'undefined') return;
  const { el, fmtStr, fmtShort, fmtValor, scopeOf, bindTip, reduceMotion, CAT_ORDER } = LTF;

  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const SCOPES = [
    { cls: 's-fato', label: 'Caso de Flávio' },
    { cls: 's-familia', label: 'Caso de outro familiar' },
    { cls: 's-carreira', label: 'Marco da carreira' },
  ];
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // texto com **negrito** sem usar innerHTML
  const rich = (parent, str) => {
    str.split('**').forEach((part, i) => {
      if (part) parent.appendChild(i % 2 ? el('b', null, part) : document.createTextNode(part));
    });
  };
  const goSection = (id) => {
    $(id).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  LTF.ready.then(init).catch(() => {
    const msg = el('p', 'rank-empty', 'Não foi possível carregar os dados desta aba. Abra a página por um servidor local ou mantenha dados_investigacoes.js na mesma pasta.');
    $('panel-explorar').appendChild(msg);
  });

  function init(data) {
    document.querySelectorAll('[data-total]').forEach((n) => { n.textContent = String(data.length); });
    document.querySelectorAll('.ex-nav [data-go]').forEach((b) => b.addEventListener('click', () => goSection(b.dataset.go)));
    initScrolly(data);
    initWho(data);
    initRank(data);
    initDumb(data);
  }

  /* ======================================================================
     1) PONTOS NARRADOS
     ====================================================================== */
  const byDate = (a, b) => a._date - b._date;

  // grade única com todos os fatos, em ordem cronológica
  function layoutAll(data, W, H) {
    const n = data.length;
    let s = 8, cols = Math.max(1, Math.floor((W - 8) / 8));
    for (let t = 34; t >= 8; t--) {
      const c = Math.max(1, Math.floor((W - 8) / t));
      if (Math.ceil(n / c) * t <= H - 8) { s = t; cols = c; break; }
    }
    const rows = Math.ceil(n / cols);
    const x0 = (W - Math.min(cols, n) * s) / 2, y0 = (H - rows * s) / 2;
    const pos = new Map();
    data.slice().sort(byDate).forEach((d, i) => {
      pos.set(d.id, { x: x0 + (i % cols) * s + s / 2, y: y0 + Math.floor(i / cols) * s + s / 2, k: (s * 0.4) / 10 });
    });
    return { pos, labels: [] };
  }

  // nomes curtos dos temas para palcos estreitos (celular), onde o título do bloco precisa caber
  const SHORT_THEME = {
    'Campanhas e contas eleitorais': 'Campanhas e contas',
    'Família: imóveis e patrimônio': 'Família: imóveis',
    'Família: gabinetes, cheques e presentes': 'Família: gabinetes',
    'Caso Master / Dark Horse': 'Caso Master',
    'Honra, imagem e propaganda': 'Honra e imagem',
    'Outras investigações e representações': 'Outras investigações',
    'Emendas e cota parlamentar': 'Emendas e cota',
    'Família: trama golpista e coação': 'Família: golpe e coação',
  };

  // blocos de grupos com título; escolhe o maior espaçamento que cabe no palco
  function layoutBlocks(groups, W, H, opt = {}) {
    const padX = 2, labelH = 22, gapY = 12, gapX = 24;
    let best = null;
    search: for (let s = opt.sMax || 34; s >= 8; s--) {
      for (const bc of [1, 2, 3]) {
        const blockW = (W - padX * 2 - gapX * (bc - 1)) / bc;
        const cols = Math.floor(blockW / s);
        if (cols < 3 || (bc > 1 && blockW < 120)) continue;   // blocos estreitos demais cortariam o título
        const colH = new Array(bc).fill(0);
        const placed = groups.map((g) => {
          const rows = Math.max(1, Math.ceil(g.items.length / cols));
          let c = 0;
          for (let i = 1; i < bc; i++) if (colH[i] < colH[c]) c = i;
          const y0 = colH[c];
          colH[c] += labelH + rows * s + gapY;
          return { g, c, y0 };
        });
        const total = Math.max(...colH) - gapY;
        if (total <= H) { best = { s, bc, cols, blockW, placed, total }; break search; }
      }
    }
    if (!best) {   // palco pequeno demais: usa o mínimo possível
      const s = 8, bc = 3, blockW = (W - padX * 2 - gapX * 2) / 3, cols = Math.max(3, Math.floor(blockW / s));
      const colH = [0, 0, 0];
      const placed = groups.map((g) => {
        let c = 0;
        for (let i = 1; i < bc; i++) if (colH[i] < colH[c]) c = i;
        const y0 = colH[c];
        colH[c] += labelH + Math.max(1, Math.ceil(g.items.length / cols)) * s + gapY;
        return { g, c, y0 };
      });
      best = { s, bc, cols, blockW, placed, total: Math.max(...colH) - gapY };
    }
    const { s, cols, blockW, placed, total } = best;
    const top = Math.max(0, (H - total) / 2);
    const pos = new Map(), labels = [];
    placed.forEach(({ g, c, y0 }) => {
      const x0 = padX + c * (blockW + gapX);
      g.items.forEach((d, j) => {
        const r = opt.radius ? opt.radius(d, s) : s * 0.4;
        pos.set(d.id, {
          x: x0 + (j % cols) * s + s / 2,
          y: top + y0 + labelH + Math.floor(j / cols) * s + s / 2,
          k: r / 10,
        });
      });
      const maxCh = Math.max(6, Math.floor((blockW - 30) / 6.6));
      const base = blockW < 215 && SHORT_THEME[g.label] ? SHORT_THEME[g.label] : g.label;
      const text = base.length > maxCh ? `${base.slice(0, maxCh - 1).trimEnd()}…` : base;
      labels.push({ x: x0, y: top + y0 + 14, text, full: g.label, sub: String(g.items.length), anchor: 'start' });
    });
    return { pos, labels };
  }

  // colunas por ano de notícia (só anos com fatos)
  function layoutYears(data, W, H) {
    const years = [...new Set(data.map((d) => d._date.getFullYear()))].sort((a, b) => a - b);
    const by = d3.group(data, (d) => d._date.getFullYear());
    const rank = { 's-fato': 0, 's-familia': 1, 's-carreira': 2 };
    const padX = 6, padB = 30, padT = 26;
    const colW = (W - padX * 2) / years.length;
    const maxStack = d3.max(years, (y) => by.get(y).length);
    const s = Math.max(6, Math.min(colW * 0.9, 24, (H - padB - padT) / maxStack));
    const pos = new Map(), labels = [];
    years.forEach((y, i) => {
      const cx = padX + colW * (i + 0.5);
      by.get(y).slice().sort((a, b) => rank[scopeOf(a)] - rank[scopeOf(b)] || byDate(a, b)).forEach((d, j) => {
        pos.set(d.id, { x: cx, y: H - padB - s * (j + 0.5), k: (s * 0.42) / 10 });
      });
      if (colW >= 20 || i % 2 === 0) {
        labels.push({ x: cx, y: H - 10, text: colW >= 34 ? String(y) : `’${String(y).slice(2)}`, anchor: 'middle', cls: 'sub' });
      }
    });
    labels.push({ x: padX, y: 12, text: 'Cada coluna é um ano de notícia; anos sem fatos não aparecem', anchor: 'start', cls: 'sub' });
    return { pos, labels };
  }

  function initScrolly(data) {
    const host = $('stage-svg'), stage = $('stage'), legend = $('stage-legend'), stepsEl = $('steps');
    const total = data.length;
    const sorted = data.slice().sort(byDate);

    /* ----- números usados nos textos ----- */
    const scopeGroups = SCOPES.map((s) => ({ key: s.cls, label: s.label, items: sorted.filter((d) => scopeOf(d) === s.cls) }))
      .filter((g) => g.items.length);   // tipos que não existem nos dados não viram bloco
    const cnt = Object.fromEntries(scopeGroups.map((g) => [g.key, g.items.length]));
    const scopeText = (() => {
      const p = [];
      if (cnt['s-fato']) p.push(`**${cnt['s-fato']}** envolvem diretamente Flávio`);
      if (cnt['s-familia']) p.push(`**${cnt['s-familia']}** são casos de outros parentes (Jair, Carlos, Eduardo, Michelle e outros)`);
      if (cnt['s-carreira']) p.push(`**${cnt['s-carreira']}** são marcos da carreira, como mandatos e eleições`);
      return `${p.length > 1 ? `${p.slice(0, -1).join(', ')} e ${p[p.length - 1]}` : p[0] || ''}.`;
    })();
    const themeGroups = [...d3.group(sorted, (d) => d.categoria)]
      .map(([label, items]) => ({ key: label, label, items }))
      .sort((a, b) => (CAT_ORDER.indexOf(a.label) < 0 ? 99 : CAT_ORDER.indexOf(a.label)) - (CAT_ORDER.indexOf(b.label) < 0 ? 99 : CAT_ORDER.indexOf(b.label)));
    const themeRank = themeGroups.slice().sort((a, b) => b.items.length - a.items.length);
    const yearCount = d3.rollup(data, (v) => v.length, (d) => d._date.getFullYear());
    const years = [...yearCount.keys()].sort((a, b) => a - b);
    const topYear = [...yearCount].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const lastYear = years[years.length - 1];
    const beforeLast = data.filter((d) => d._date.getFullYear() < lastYear).length;
    let win = { from: years[0], n: 0 };
    for (let y = years[0]; y <= years[years.length - 1] - 2; y++) {
      const n = (yearCount.get(y) || 0) + (yearCount.get(y + 1) || 0) + (yearCount.get(y + 2) || 0);
      if (n > win.n) win = { from: y, n };
    }
    const lagged = sorted.filter((d) => d.data_fato);
    const withVal = sorted.filter((d) => d.valor_estimado > 0).sort((a, b) => b.valor_estimado - a.valor_estimado);
    const noVal = sorted.filter((d) => !(d.valor_estimado > 0));
    const vMin = d3.min(withVal, (d) => d.valor_estimado), vMax = d3.max(withVal, (d) => d.valor_estimado);
    const vScale = d3.scaleLog().domain([vMin, vMax]).range([0.34, 1]).clamp(true);
    const valueRadius = (d, s) => (d.valor_estimado > 0 ? s * 0.5 * vScale(d.valor_estimado) : s * 0.2);

    const steps = [
      {
        title: `${total} fatos, ${total} pontos`,
        text: 'Cada ponto é um fato desfavorável a Flávio Bolsonaro ou envolvendo a família: investigações, decisões da Justiça, ações e reportagens. Role a página para reagrupá-los.',
        layout: (W, H) => layoutAll(data, W, H),
      },
      {
        title: 'De quem é o caso',
        text: scopeText,
        layout: (W, H) => layoutBlocks(scopeGroups, W, H),
      },
      {
        title: 'Sobre o quê',
        text: `Os fatos se dividem em **${themeGroups.length} temas**. O maior é "${themeRank[0].label}", com **${themeRank[0].items.length}**; em seguida vêm "${themeRank[1].label}" (**${themeRank[1].items.length}**) e "${themeRank[2].label}" (**${themeRank[2].items.length}**).`,
        layout: (W, H) => layoutBlocks(themeGroups, W, H),
      },
      {
        title: 'Quando viraram notícia',
        text: `Os fatos aparecem entre **${years[0]}** e **${lastYear}**. **${beforeLast}** dos ${total} são anteriores a ${lastYear}, ano de eleição. O ano com mais registros é **${topYear[0]}** (**${topYear[1]}**), e **${win.n}** dos ${total} foram noticiados entre **${win.from}** e **${win.from + 2}**.`,
        layout: (W, H) => layoutYears(data, W, H),
      },
      {
        title: 'O fato e a notícia',
        text: `Em **${lagged.length}** casos o fato é de uma época anterior à da notícia ou da decisão, às vezes de anos antes. Nos outros **${total - lagged.length}**, não há data anterior registrada. A seção 4, mais abaixo, mostra cada intervalo.`,
        layout: (W, H) => layoutBlocks([
          { key: 'ant', label: 'Fato anterior à notícia', items: lagged },
          { key: 'mesma', label: 'Sem data anterior registrada', items: sorted.filter((d) => !d.data_fato) },
        ], W, H),
      },
      {
        title: 'Quanto dinheiro aparece',
        text: `**${withVal.length}** fatos têm valor citado nas reportagens, de ${fmtValor(vMin)} a ${fmtValor(vMax)}; os outros **${noVal.length}** não têm valor público informado. O tamanho do ponto acompanha o valor, em escala logarítmica, e o cartão de cada ponto explica a que o valor se refere.`,
        layout: (W, H) => {
          const L = layoutBlocks([
            { key: 'com', label: 'Com valor citado', items: withVal },
            { key: 'sem', label: 'Sem valor público citado', items: noVal },
          ], W, H, { radius: valueRadius, sMax: 40 });
          L.dim = new Set(noVal.map((d) => d.id));   // sem valor: pontos pequenos e apagados
          return L;
        },
      },
      {
        title: 'Agora é com você',
        text: 'Passe o mouse ou toque nos pontos para ler os resumos e abrir as fontes. As seções abaixo permitem buscar um nome, comparar valores e ver o intervalo entre o fato e a notícia.',
        layout: (W, H) => layoutBlocks(scopeGroups, W, H),
        cta: true,
      },
    ];

    /* ----- palco ----- */
    const svg = svgEl('svg', { 'aria-hidden': 'true', focusable: 'false' });
    const gDots = svgEl('g'), gLabels = svgEl('g');
    svg.append(gLabels, gDots);
    host.appendChild(svg);

    const pts = new Map();
    sorted.forEach((d) => {
      const g = svgEl('g', { class: 'pt s-neutro' });
      const inner = svgEl('g', { class: 'in' });
      inner.append(svgEl('circle', { class: 'hit', r: 14 }), svgEl('circle', { class: 'dot', r: 10 }));
      g.appendChild(inner);
      g.style.transform = 'translate(0px, 0px)';
      inner.style.transform = 'scale(0.01)';
      bindTip(g, d);
      gDots.appendChild(g);
      pts.set(d.id, { g, inner });
    });

    legend.replaceChildren(...SCOPES.map((s) => {
      const r = el('span', 'ref');
      r.append(el('span', `sw ${s.cls}`), document.createTextNode(s.label));
      return r;
    }));

    /* ----- passos de texto ----- */
    const stepEls = steps.map((st, i) => {
      const li = el('li', 'step');
      const card = el('div', 'step-card');
      card.appendChild(el('p', 'step-n', `Passo ${i + 1} de ${steps.length}`));
      card.appendChild(el('h4', null, st.title));
      const p = el('p');
      rich(p, st.text);
      card.appendChild(p);
      if (st.cta) {
        const row = el('div', 'step-cta');
        const a = el('button', 'btn-solid', 'Ver na linha do tempo');
        a.type = 'button';
        a.addEventListener('click', () => { LTF.goto('linha'); window.scrollTo(0, 0); });
        const b = el('button', 'chip', 'Buscar um nome');
        b.type = 'button';
        b.addEventListener('click', () => goSection('ex-nomes'));
        row.append(a, b);
        card.appendChild(row);
      }
      li.appendChild(card);
      stepsEl.appendChild(li);
      return li;
    });

    /* ----- aplicar um passo ----- */
    let cur = 0, size = { w: 0, h: 0 };

    function swapLabels(labels) {
      const old = gLabels.lastElementChild;
      if (old) { old.classList.add('is-out'); setTimeout(() => old.remove(), 420); }
      const g = svgEl('g', { class: 'stage-labels is-out' });
      labels.forEach((l) => {
        const t = svgEl('text', { class: l.cls === 'sub' ? 'stage-sub' : 'stage-label', x: l.x, y: l.y, 'text-anchor': l.anchor || 'start' });
        t.appendChild(document.createTextNode(l.text));
        if (l.sub) {
          const ts = svgEl('tspan', { class: 'stage-sub', dx: 6 });
          ts.textContent = l.sub;
          t.appendChild(ts);
        }
        if (l.full && l.full !== l.text) { const ti = svgEl('title'); ti.textContent = l.full; t.appendChild(ti); }
        g.appendChild(t);
      });
      gLabels.appendChild(g);
      requestAnimationFrame(() => requestAnimationFrame(() => g.classList.remove('is-out')));
    }

    function apply(i, instant) {
      cur = i;
      stepEls.forEach((li, j) => li.classList.toggle('is-active', j === i));
      legend.style.opacity = i === 0 ? '0' : '1';
      if (!size.w || !size.h) return;
      const L = steps[i].layout(size.w, size.h);
      if (instant) host.classList.add('no-anim');
      let n = 0;
      sorted.forEach((d) => {
        const { g, inner } = pts.get(d.id);
        const p = L.pos.get(d.id);
        g.setAttribute('class', `pt ${i === 0 ? 's-neutro' : scopeOf(d)}${L.dim && L.dim.has(d.id) ? ' is-dim' : ''}`);
        const delay = instant || reduceMotion ? 0 : Math.min(n++ * 7, 450);
        g.style.transitionDelay = `${delay}ms`;
        inner.style.transitionDelay = `${delay}ms`;
        g.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        inner.style.transform = `scale(${p.k.toFixed(3)})`;
      });
      swapLabels(L.labels);
      if (instant) requestAnimationFrame(() => requestAnimationFrame(() => host.classList.remove('no-anim')));
    }

    new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h || (w === size.w && h === size.h)) return;
      size = { w, h };
      apply(cur, true);   // ao redimensionar (ou ao abrir a aba), reposiciona sem animar
    }).observe(host);

    /* ----- qual passo está em foco ----- */
    const desktop = window.matchMedia('(min-width: 900px)');
    let raf = 0;
    function pick() {
      raf = 0;
      if ($('panel-explorar').hidden) return;
      const vh = window.innerHeight;
      const ref = desktop.matches ? vh * 0.5 : stage.getBoundingClientRect().bottom + (vh - stage.getBoundingClientRect().bottom) * 0.35;
      let idx = -1;
      stepEls.forEach((li, i) => {
        const r = li.getBoundingClientRect();
        if (r.top <= ref && r.bottom > ref) idx = i;
      });
      if (idx < 0) idx = stepEls[0].getBoundingClientRect().top > ref ? 0 : stepEls.length - 1;
      if (idx !== cur) apply(idx, false);
    }
    const queue = () => { if (!raf) raf = requestAnimationFrame(pick); };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    document.addEventListener('ltf:tab', queue);
    apply(0, true);
  }

  /* ======================================================================
     2) EXPLORADOR DE NOMES
     ====================================================================== */
  const SUBJECT = 'Flávio Bolsonaro';
  const ALIAS = {
    'Adriano Magalhães da Nóbrega': 'Adriano da Nóbrega',
    'Ronald Paulo Alves Pereira': 'Ronald Pereira',
    'Mario Frias': 'Mário Frias',
    'Lula': 'Luiz Inácio Lula da Silva',
  };
  const GRUPOS = [
    ['Família', /Bolsonaro|Ana Cristina Siqueira Valle|^Ex-mulheres/],
    ['Partidos', /^(PL|PP|PSC|PSL|PSL-RJ|PSOL|PT|PSB|PDT|Rede Sustentabilidade|Federação Brasil da Esperança|Campanha de Lula)$/],
    ['Imprensa, empresas e entidades', /^(UOL|O Globo|Folha de S\.Paulo|O Estado de S\. Paulo|Veja|X|TikTok|Metrópoles|Aos Fatos|Banco Master|BRB|Santander|Neon E\. Motors|Gramazini Granitos e Mármores Thomazini|Grupo CRM|Ifop|Copenhagen Consultoria e Assessoria|Contábil Correa|Trustee DTVM|Bravo Grafeno|Voga Serviços Contábeis|Alcazar Holdings|Fraction 024|Prime You|WT Administração de Imóveis e Bens|União Química|Instituto de Medicina e Projeto \(IMP\)|Instituto de Medicina e Projeto|Glágio do Brasil|Inbra-Tecnologia|Vasco da Gama|Grupo Sarkis|BNDES|Alerj|Havengate|Go UP Entertainment|NR Sports|Santos FC|Sport 70|Bolsotini Chocolates e Café|Jornal Nacional|GloboNews|Agência Lupa|ICL Notícias|piauí|Twitter|Facebook|CNBB|UFRJ|Record TV|Época|Estadão|SBT|Ibama|Alesp|Prevent Senior|Codevasf|Bolsonaro Jr\. Eventos e Mídia)$/],
    ['Justiça e órgãos de controle', /Ministério Público|MP-DF|Polícia Federal|PGR|Procuradoria|Coaf|TCU|TCE|CGU|Receita Federal|CPMI|Senado Federal|Defensoria|AGU|STF|STJ|TSE|TJDFT|TJ-RJ|Vara|Turma|Justiça|Conselho de Ética|Órgão Especial|Aras|Gonet|Moraes|André Mendonça|Nunes Marques|Cármen Lúcia|Lewandowski|Fachin|Gilmar|Barroso|Rosa Weber|Toffoli|Marco Aurélio|Bellizze|Itabaiana|Jardon|Ivani|Keyla|Galliza|Bruna Araujo|Cavalcanti|Fragoso|Humberto Jacques|Eduardo Benones|Comissão de Segurança|Flávio Dino|Zanin|Sanseverino|Gabriela Guimarães|CPI da Pandemia|MPDFT|Polícia Civil/],
  ];
  const OUTROS = 'Pessoas e outros';
  const GROUP_CHIPS = ['Família', 'Justiça e órgãos de controle', 'Partidos', 'Imprensa, empresas e entidades', OUTROS];

  const canon = (raw) => {
    let n = String(raw).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^Coaf\b/.test(n)) n = 'Coaf';
    return ALIAS[n] || n;
  };
  const groupOf = (name) => {
    if (name === SUBJECT) return 'Personagem central';
    for (const [g, re] of GRUPOS) if (re.test(name)) return g;
    return OUTROS;
  };

  function initWho(data) {
    const total = data.length;
    const namesOf = new Map();
    const people = new Map();
    data.forEach((d) => {
      const names = [...new Set((d.envolvidos || []).map(canon))].filter(Boolean);
      namesOf.set(d.id, names);
      names.forEach((n) => {
        if (!people.has(n)) people.set(n, { name: n, group: groupOf(n), events: [] });
        people.get(n).events.push(d);
      });
    });
    const all = [...people.values()].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name, 'pt'));
    const themeTotals = d3.rollup(data, (v) => v.length, (d) => d.categoria);
    const themes = [...themeTotals.keys()].sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    const q = $('who-q'), chipsHost = $('who-groups'), ul = $('who-ul'), profile = $('who-profile');
    // nome inicial: o mais citado depois do próprio personagem central (regra de contagem, sem escolha editorial)
    let selected = (all.find((p) => p.name !== SUBJECT) || all[0]).name;
    let group = null;
    let stripState = null;

    /* ----- lista ----- */
    const chipRefs = new Map();
    function mkChip(key, label) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.append(el('span', 'lbl', label));
      b.addEventListener('click', () => { group = group === key ? null : key; drawList(); });
      chipRefs.set(key, b);
      return b;
    }
    chipsHost.replaceChildren(...GROUP_CHIPS.map((g) => mkChip(g, g)));

    function drawList() {
      const tokens = norm(q.value).split(/\s+/).filter(Boolean);
      const rows = all.filter((p) => (!group || p.group === group) && tokens.every((t) => norm(p.name).includes(t)));
      chipRefs.forEach((b, key) => b.setAttribute('aria-pressed', String(group === key)));
      if (!rows.length) {
        ul.replaceChildren(el('li', 'who-empty', 'Nenhum nome encontrado. Tente outra grafia ou limpe o tipo.'));
        return;
      }
      ul.replaceChildren(...rows.map((p) => {
        const li = el('li');
        const b = el('button', 'who-item');
        b.type = 'button';
        b.setAttribute('aria-current', String(p.name === selected));
        b.append(el('span', null, p.name), el('span', 'n', String(p.events.length)));
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = `${(p.events.length / total) * 100}%`;
        bar.appendChild(fill);
        b.appendChild(bar);
        b.addEventListener('click', () => select(p.name, true));
        li.appendChild(b);
        return li;
      }));
    }

    q.addEventListener('input', drawList);
    q.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const first = ul.querySelector('.who-item');
      if (first) first.click();
    });

    function select(name, fromUser) {
      selected = name;
      LTF.tip.hide();
      drawList();
      renderProfile();
      if (fromUser && window.matchMedia('(max-width: 899px)').matches) {
        profile.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
    }

    /* ----- linha de pontos no tempo ----- */
    const T0 = new Date(2002, 6, 1), T1 = new Date(2027, 3, 1);
    function drawStrip(host, evs) {
      const W = host.clientWidth;
      if (!W) return;
      const svg = svgEl('svg', { class: 'wp-strip', role: 'group', 'aria-label': 'Quando os fatos foram noticiados' });
      const x = d3.scaleTime().domain([T0, T1]).range([10, W - 10]);
      const r = 6, step = 13;
      const placed = [];
      let maxK = 0;
      const dots = evs.slice().sort(byDate).map((d) => {
        const cx = x(d._date);
        let k = 0;
        while (placed.some((p) => p.k === k && Math.abs(p.cx - cx) < step)) k++;
        placed.push({ cx, k });
        maxK = Math.max(maxK, k);
        return { d, cx, k };
      });
      const base = 10 + maxK * step + r;
      const H = base + r + 24;
      svg.setAttribute('height', H);
      svg.setAttribute('width', W);
      const axis = svgEl('g', { class: 'axis', transform: `translate(0,${base + r + 8})` });
      axis.appendChild(svgEl('line', { x1: 10, x2: W - 10, y1: 0, y2: 0 }));
      [2005, 2010, 2015, 2020, 2025].forEach((y) => {
        const gx = x(new Date(y, 0, 1));
        const tk = svgEl('g', { transform: `translate(${gx},0)` });
        tk.appendChild(svgEl('line', { y1: 0, y2: 4 }));
        const tx = svgEl('text', { y: 17, 'text-anchor': 'middle' });
        tx.textContent = String(y);
        tk.appendChild(tx);
        axis.appendChild(tk);
      });
      svg.appendChild(axis);
      dots.forEach(({ d, cx, k }) => {
        const g = svgEl('g', { class: `sdot ${scopeOf(d)}`, transform: `translate(${cx},${base - k * step})`, tabindex: '0', role: 'button', 'aria-label': `${d.titulo}, ${fmtStr(d.data)}` });
        g.appendChild(svgEl('circle', { r }));
        bindTip(g, d);
        svg.appendChild(g);
      });
      host.replaceChildren(svg);
    }
    new ResizeObserver(() => {
      if (!stripState) return;
      const w = stripState.host.clientWidth;
      if (w && Math.abs(w - stripState.w) > 2) { stripState.w = w; LTF.tip.hide(); drawStrip(stripState.host, stripState.evs); }
    }).observe(profile);

    /* ----- painel do nome ----- */
    function renderProfile() {
      const p = people.get(selected);
      if (!p) return;
      const evs = p.events.slice().sort(byDate);
      const n = evs.length;
      const parts = [];

      const head = el('div', 'wp-head');
      head.append(el('h4', 'wp-name', p.name), (() => {
        const pill = el('span', 'pill', p.group);
        return pill;
      })());
      parts.push(head);

      const stat = el('p', 'wp-stat');
      stat.append(el('strong', null, String(n)), document.createTextNode(` de ${total} fatos citam este nome (${Math.round((n / total) * 100)}%)`));
      parts.push(stat);

      const actions = el('div', 'wp-actions');
      const hb = el('button', 'btn-solid', 'Destacar na linha do tempo');
      hb.type = 'button';
      hb.addEventListener('click', () => {
        LTF.goto('linha');
        LTF.setHighlight(evs.map((d) => d.id), `${p.name} (${plural(n, 'fato', 'fatos')})`);
        const target = $('grafico');
        window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 70);
      });
      actions.appendChild(hb);
      parts.push(actions);

      // por tema: parcela dos fatos do nome x peso do tema no conjunto
      const sec1 = el('div', 'wp-sec');
      sec1.append(el('h4', null, 'Em quais temas aparece'));
      sec1.append(el('p', 'wp-note', `A barra mostra a parcela dos fatos deste nome em cada tema. O traço branco marca o peso do tema entre os ${total} fatos.`));
      const grid = el('div', 'wp-themes');
      const mine = d3.rollup(evs, (v) => v.length, (d) => d.categoria);
      themes.filter((t) => mine.has(t)).sort((a, b) => mine.get(b) - mine.get(a)).forEach((t) => {
        const row = el('div', 'th-row');
        const track = el('div', 'th-track');
        const fill = el('div', `th-fill ${LTF.catScope(t)}`);
        fill.style.width = `${(mine.get(t) / n) * 100}%`;
        const avg = el('div', 'th-avg');
        avg.style.left = `${(themeTotals.get(t) / total) * 100}%`;
        avg.title = `${t}: ${plural(themeTotals.get(t), 'fato', 'fatos')} de ${total} no total`;
        track.append(fill, avg);
        row.append(el('span', 'lbl', t), track, el('span', 'num', String(mine.get(t))));
        grid.appendChild(row);
      });
      sec1.appendChild(grid);
      parts.push(sec1);

      // quando
      const sec2 = el('div', 'wp-sec');
      sec2.append(el('h4', null, 'Quando foi noticiado'));
      const stripHost = el('div');
      sec2.appendChild(stripHost);
      parts.push(sec2);

      // com quem aparece
      const co = new Map();
      evs.forEach((d) => namesOf.get(d.id).forEach((o) => {
        if (o !== selected && o !== SUBJECT) co.set(o, (co.get(o) || 0) + 1);
      }));
      const coTop = [...co].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt')).slice(0, 8);
      if (coTop.length) {
        const sec3 = el('div', 'wp-sec');
        sec3.append(el('h4', null, 'Citado junto com'));
        const row = el('div', 'wp-with');
        coTop.forEach(([name, c]) => {
          const b = el('button', 'chip');
          b.type = 'button';
          b.append(el('span', 'lbl', name), el('span', 'n', String(c)));
          b.addEventListener('click', () => select(name, false));
          row.appendChild(b);
        });
        sec3.appendChild(row);
        parts.push(sec3);
      }

      // lista de fatos
      const sec4 = el('div', 'wp-sec');
      sec4.append(el('h4', null, `${plural(n, 'fato', 'fatos')}, em ordem cronológica`));
      const list = el('ul', 'wp-events');
      evs.forEach((d) => {
        const li = el('li', 'wp-ev');
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', `${d.titulo}. ${fmtStr(d.data)}. Enter abre o cartão com a fonte.`);
        li.append(el('span', 'd', fmtShort(d.data)), el('span', 't', d.titulo));
        const v = fmtValor(d.valor_estimado);
        if (v) li.appendChild(el('span', 'v', v));
        li.appendChild(el('span', 'c', d.categoria));
        bindTip(li, d);
        list.appendChild(li);
      });
      sec4.appendChild(list);
      parts.push(sec4);

      profile.replaceChildren(...parts);
      stripState = { host: stripHost, evs, w: stripHost.clientWidth };
      drawStrip(stripHost, evs);
    }

    drawList();
    renderProfile();
  }

  /* ======================================================================
     3) RANKING DE VALORES
     ====================================================================== */
  const TICKS_VALOR = [[1e4, 'R$ 10 mil'], [1e5, 'R$ 100 mil'], [1e6, 'R$ 1 mi'], [1e7, 'R$ 10 mi'], [1e8, 'R$ 100 mi']];

  // linhas de grade verticais como camadas de gradiente (posição em %)
  const gridBackground = (percents) => percents.map((p) =>
    `linear-gradient(to right, transparent calc(${p}% - 0.5px), rgba(255,255,255,.12) calc(${p}% - 0.5px), rgba(255,255,255,.12) calc(${p}% + 0.5px), transparent calc(${p}% + 0.5px))`).join(',');

  function initRank(data) {
    const host = $('rank'), q = $('rank-q'), sortSeg = $('rank-sort'), count = $('rank-count');
    const items = data.filter((d) => d.valor_estimado > 0);
    const semValor = data.length - items.length;
    const x = d3.scaleLog().domain([1e4, 3e8]).range([0, 100]);
    host.style.setProperty('--grid-bg', gridBackground(TICKS_VALOR.map(([v]) => x(v))));
    let sort = 'valor';

    const hay = new Map(items.map((d) => [d.id, norm([d.titulo, d.categoria, d.valor_descricao || '', ...(d.envolvidos || [])].join(' '))]));

    function draw() {
      LTF.tip.hide();
      const rows = items.slice().sort(sort === 'valor' ? (a, b) => b.valor_estimado - a.valor_estimado : (a, b) => b._date - a._date);
      const tokens = norm(q.value).split(/\s+/).filter(Boolean);
      const isHit = (d) => tokens.every((t) => hay.get(d.id).includes(t));
      const hits = tokens.length ? rows.filter(isHit).length : rows.length;

      const axis = el('div', 'rank-axis');
      axis.append(el('span', 'h', sort === 'valor' ? 'Fato (do maior valor ao menor)' : 'Fato (do mais recente ao mais antigo)'));
      const ticks = el('div', 'ticks');
      TICKS_VALOR.forEach(([v, label]) => {
        const t = el('span', 'tick-l', label);
        t.style.left = `${x(v)}%`;
        ticks.appendChild(t);
      });
      axis.appendChild(ticks);

      const list = rows.map((d, i) => {
        const row = el('div', `rank-row${tokens.length && !isHit(d) ? ' is-dim' : ''}`);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${d.titulo}. ${fmtValor(d.valor_estimado)}. ${fmtStr(d.data)}. Enter abre o cartão com a fonte.`);
        const t = el('div', 'rank-t');
        t.appendChild(el('strong', null, d.titulo));
        t.appendChild(el('span', null, `${fmtShort(d.data)} · ${d.valor_descricao || d.categoria}`));
        const track = el('div', 'rank-track');
        const p = x(clamp(d.valor_estimado, 1e4, 3e8));
        const dot = el('i', `rank-dot ${scopeOf(d)}`);
        dot.style.left = `${p}%`;
        const val = el('span', 'rank-val', fmtValor(d.valor_estimado));
        if (p > 50) val.style.right = `calc(${100 - p}% + 14px)`; else val.style.left = `calc(${p}% + 14px)`;   // rótulo para o lado com espaço
        track.append(dot, val);
        row.append(el('span', 'rank-n', String(i + 1)), t, track);
        bindTip(row, d, dot);
        return row;
      });

      host.replaceChildren(axis, ...list);
      count.textContent = tokens.length
        ? `${plural(hits, 'fato destacado', 'fatos destacados')} de ${items.length}`
        : `${items.length} fatos com valor citado, de ${data.length}`;
      let note = host.parentElement.querySelector('.rank-note');
      if (!note) {
        note = el('p', 'ex-sub rank-note', `${semValor} fatos não têm valor público citado e não aparecem neste gráfico.`);
        note.style.marginTop = '10px';
        host.after(note);
      }
    }

    q.addEventListener('input', draw);
    sortSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      sort = b.dataset.sort;
      sortSeg.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      draw();
    }));
    draw();
  }

  /* ======================================================================
     4) DO FATO À NOTÍCIA
     ====================================================================== */
  function initDumb(data) {
    const host = $('dumb'), sortSeg = $('dumb-sort'), count = $('dumb-count');
    const items = data.filter((d) => d.data_fato);
    const yf = (date) => date.getFullYear() + date.getMonth() / 12;
    const y0 = Math.floor(d3.min(items, (d) => yf(d._dateFato)) / 5) * 5 - 1, y1 = 2027;
    const x = d3.scaleLinear().domain([y0, y1]).range([0, 100]);
    const tickYears = d3.range(Math.ceil(y0 / 5) * 5, 2026, 5);
    host.style.setProperty('--grid-bg', gridBackground(tickYears.map((y) => x(y))));
    let sort = 'intervalo';
    count.textContent = `${items.length} fatos com data anterior à da notícia`;

    function draw() {
      LTF.tip.hide();
      const rows = items.slice().sort(sort === 'intervalo'
        ? (a, b) => (b._date - b._dateFato) - (a._date - a._dateFato)
        : (a, b) => a._dateFato - b._dateFato);

      const axis = el('div', 'dumb-axis');
      axis.appendChild(el('span', 'h', sort === 'intervalo' ? 'Fato (do maior intervalo ao menor)' : 'Fato (do mais antigo ao mais recente)'));
      const ticks = el('div', 'ticks');
      tickYears.forEach((y) => {
        const t = el('span', 'tick-l', String(y));
        t.style.left = `${x(y)}%`;
        ticks.appendChild(t);
      });
      axis.appendChild(ticks);

      const list = rows.map((d) => {
        const row = el('div', 'dumb-row');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${d.titulo}. Fatos: ${d.periodo_fato || fmtStr(d.data_fato)}. Notícia: ${fmtStr(d.data)}. Enter abre o cartão com a fonte.`);
        const t = el('div', 'dumb-t');
        t.appendChild(el('strong', null, d.titulo));
        t.appendChild(el('span', null, `Fatos: ${d.periodo_fato || fmtStr(d.data_fato)} · Notícia: ${fmtShort(d.data)}`));
        const track = el('div', 'dumb-track');
        const a = x(yf(d._dateFato)), b = x(yf(d._date));
        const line = el('i', 'dumb-line');
        line.style.left = `${a}%`;
        line.style.width = `${Math.max(0, b - a)}%`;
        const from = el('i', 'dumb-dot from');
        from.style.left = `${a}%`;
        const to = el('i', `dumb-dot to ${scopeOf(d)}`);
        to.style.left = `${b}%`;
        track.append(line, from, to);
        row.append(t, track);
        bindTip(row, d, to);
        return row;
      });
      host.replaceChildren(axis, ...list);
    }

    sortSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      sort = b.dataset.sort;
      sortSeg.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      draw();
    }));
    draw();
  }
})();
