/* Aba "Negacionismo" · negacionismo.js
   Lê negacionismo_dados.json (ou negacionismo_dados.js em file://) e mostra, para cada declaração ou ato de Jair, Flávio e outros
   membros da família sobre ciência, saúde, clima, dados oficiais, história e urnas: o que foi dito, o que dizem a ciência e os dados,
   a resposta de quem foi citado e a fonte. Texto sempre via textContent. */
(() => {
  'use strict';

  const DATA_URL = 'negacionismo_dados.json';
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
  const chipRefs = new Map();
  let allOpen = false;

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
      ].join(' ')),
    }));

    $('nz-lead').textContent = `${plural(regs.length, 'registro', 'registros')} de declarações e atos de ${pessoas.get('jair').nome}, ${pessoas.get('flavio').nome} e ${pessoas.get('eduardo').nome} sobre covid-19, vacinas, clima, dados oficiais, ditadura e urnas, cada um com a fonte, o que dizem a ciência e os dados, e a resposta de quem foi citado. Carlos, Michelle e outros parentes aparecem na seção "Sem registro", com o que encontrei.`;

    drawSummary();
    drawPeopleChips();
    drawOrder();
    bindUi();
    render();
    // os links para a linha do tempo precisam dos eventos carregados
    if (window.LTF) window.LTF.ready.then(render).catch(() => {});
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
    return [r.fonte_url, ...(r.fontes_extra || []).map((f) => f.url), ...(r.ciencia || []).map((c) => c.fonte_url)].filter(Boolean);
  }

  function drawSummary() {
    const fontes = new Set(regs.flatMap(fontesDe));
    const stat = (n, label) => { const s = el('div', 'stat'); s.append(el('b', null, String(n)), el('span', null, label)); return s; };
    $('nz-summary').replaceChildren(
      stat(regs.length, 'registros'),
      stat(new Set(regs.map((r) => r.pessoa)).size, 'pessoas com registro'),
      stat(new Set(regs.map((r) => r.tema)).size, 'temas'),
      stat(fontes.size, 'matérias e documentos'),
    );
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
    const open = el('span', 'pl-open', ciencia.length ? `${plural(ciencia.length, 'bloco de checagem', 'blocos de checagem')}` : 'Ver o registro');
    foot.append(badges, open);
    sum.append(meta, el('h3', null, r.titulo), says, foot);
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

    if (ciencia.length) {
      body.appendChild(el('p', 'pl-body-h', 'O que dizem a ciência e os dados'));
      ciencia.forEach((c) => body.appendChild(evidBlock(c)));
    }
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
