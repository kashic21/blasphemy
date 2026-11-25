/* Blasphemy — client. Renders whatever the server says the room looks like. */
(() => {
  const socket = io();
  const $app = document.getElementById('app');
  const LS = 'blasphemy-session';
  let S = null;          // latest room state from the server
  let offset = 0;        // server clock - local clock
  const ui = {           // local-only UI state
    hostStep: 'topics', customTopic: false, customSub: false, editing: false,
    name: localStorage.getItem('blasphemy-name') || '',
    code: (new URLSearchParams(location.search).get('code') || '').toUpperCase(),
    draft: '', busy: false, spunAt: {}, rules: false, pickTopic: null, accusePick: null, accuseKey: '', cpick: {}, cpickKey: '', daSeen: {},
  };

  // ---------- helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => S && S.players.find(p => p.id === S.you);
  const isHost = () => S && S.hostId === S.you;
  const P = id => S.players.find(p => p.id === id) || { name: '???', color: '#D9D6CC' };
  const save = (v) => v ? localStorage.setItem(LS, JSON.stringify(v)) : localStorage.removeItem(LS);
  const load = () => { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } };
  const emit = (ev, data) => new Promise(r => socket.emit(ev, data, r));
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

  const icon = {
    arrow: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 13 L13 3 M13 3 H6 M13 3 V10" stroke="#fff" stroke-width="2"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8 L7 12 L13 4" stroke="#fff" stroke-width="2.2"/></svg>',
    gavel: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 L12 12 M10 6 L16 12 M8 8 L14 2 L22 10 L16 16 Z M3 22 H11" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 L5 8 L10 13" stroke="#1A1A1A" stroke-width="2"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="9" r="6" stroke="currentColor" stroke-width="1.6"/><path d="M8 6 V9 L10 10 M6 1 H10" stroke="currentColor" stroke-width="1.6"/></svg>',
    plus: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 V14 M2 8 H14" stroke="#1A1A1A" stroke-width="2.2"/></svg>',
    mask: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="#E8553A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 C8 5 16 5 20 7 C20 14 17 19 12 20 C7 19 4 14 4 7 Z"/><path d="M6 6 L4.5 2.5 L8.5 5.2 M18 6 L19.5 2.5 L15.5 5.2"/><path d="M8 11 Q9.5 10 11 11 M13 11 Q14.5 10 16 11 M9 15 Q12 17 15 15"/></g></svg>',
    star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" stroke="#fff" stroke-width="1.8"/><path d="M12 7 L13.4 10.6 L17 12 L13.4 13.4 L12 17 L10.6 13.4 L7 12 L10.6 10.6 Z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    gavelInk: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 L12 12 M10 6 L16 12 M8 8 L14 2 L22 10 L16 16 Z M3 22 H11" stroke="#1A1A1A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    sealGavel: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19 L12 12 M10 6 L16 12 M8 8 L14 2 L22 10 L16 16 Z" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    scales: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="#1A1A1A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 V21 M7 21 H17 M4 7 H20"/><path d="M4 7 L1.5 13 H6.5 Z M20 7 L17.5 13 H22.5 Z"/></g></svg>',
    scalesWhite: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 V21 M7 21 H17 M4 7 H20"/><path d="M4 7 L1.5 13 H6.5 Z M20 7 L17.5 13 H22.5 Z"/></g></svg>',
    eyeOff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/><path d="M3 21 L21 3"/></g></svg>',
    maskBig: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="#E8553A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7 C8 5 16 5 20 7 C20 14 17 19 12 20 C7 19 4 14 4 7 Z"/><path d="M6 6 L4.5 2.5 L8.5 5.2 M18 6 L19.5 2.5 L15.5 5.2"/><path d="M8 11 Q9.5 10 11 11 M13 11 Q14.5 10 16 11 M9 15 Q12 17 15 15"/></g></svg>',
    lattice: '<svg width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden="true"><path d="M1 1 L13 13 M7 1 L19 13 M13 1 L21 9 M1 7 L7 13 M21 1 L9 13 M15 1 L3 13 M9 1 L1 9 M21 7 L15 13" stroke="#F2C230" stroke-width="1.2"/></svg>',
    thumbUp: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 11 V21 H4 V11 Z M7 11 L11 3 C12.5 3 13.5 4 13 6 L12 10 H19 C20.5 10 21.3 11.4 20.8 12.7 L18.5 19.5 C18.2 20.4 17.4 21 16.5 21 H7" stroke="#1A1A1A" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    thumbDown: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><g transform="rotate(180 12 12)"><path d="M7 11 V21 H4 V11 Z M7 11 L11 3 C12.5 3 13.5 4 13 6 L12 10 H19 C20.5 10 21.3 11.4 20.8 12.7 L18.5 19.5 C18.2 20.4 17.4 21 16.5 21 H7" stroke="#1A1A1A" stroke-width="1.8" stroke-linejoin="round"/></g></svg>',
    lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="10" stroke="#1A1A1A" stroke-width="2"/><path d="M8 11 V7 A4 4 0 0 1 16 7 V11" stroke="#1A1A1A" stroke-width="2"/></svg>',
  };
  const cta = (label, action, { meta = '', box = '', ic = icon.arrow, disabled = false } = {}) =>
    `<button class="cta" data-a="${action}" ${disabled ? 'disabled' : ''}><span class="box ${box}">${ic}</span><span class="lbl">${esc(label)}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</button>`;
  const back = (label, action) => `<button class="back mono" data-a="${action}">${icon.back}<span>${esc(label)}</span></button>`;
  const head = (p, sm) => `<span class="chip-head ${sm ? 'sm' : ''}" style="background:${p.color}" aria-hidden="true">${esc(p.name[0] || '?')}</span>`;
  const person = p => `<span class="person">${head(p, true)}${esc(p.name)}</span>`;
  const mug = (p, { big = false, host = false, button = '', on = false, off = false, rot = 0, data = '' } = {}) => {
    const inner = `${host ? '<span class="hosttag">HOST</span>' : ''}<div class="chart"><div class="head" style="background:${p.color}">${esc(p.name[0] || '?')}</div></div><div class="name">${esc(p.name)}</div>`;
    const style = rot ? `style="transform:rotate(${rot}deg)"` : '';
    return button
      ? `<button class="mug ${big ? 'big' : ''} ${on ? 'on' : ''}" data-a="${button}" data-id="${p.id}" ${data} aria-pressed="${on}" ${style}>${inner}</button>`
      : `<div class="mug ${big ? 'big' : ''} ${off ? 'off' : ''}" ${style}>${inner}</div>`;
  };
  const counter = (label, n, total) => `<span class="mono counter">${label} <span class="n">${n}</span> / ${total}</span>`;
  const timerEl = () => S.deadline ? `<span class="timer" data-deadline="${S.deadline}">${icon.clock}<span class="t">0:00</span></span>` : '';
  const topicLine = () => [S.settings.topic, S.settings.sub].filter(Boolean).join(' · ');
  const rot = i => [-3, 2, -1.5, 2.5, -2, 1.5][i % 6];
  const MODES = { accusations: { name: 'Accusations', bg: 'var(--blue)', fg: '#fff' }, confession: { name: 'Confession', bg: 'var(--yellow)', fg: 'var(--ink)' } };
  const mode = () => MODES[(S && S.settings.mode) || 'accusations'];
  const modeBox = () => `<span class="box-tag" style="background:${mode().bg};color:${mode().fg};border-color:${mode().fg === '#fff' ? mode().bg : 'var(--ink)'}">${mode().name}</span>`;

  // ---------- shared pieces ----------
  const roundKey = () => S.round ? `${S.round.index}-${S.round.text.length}` : '';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const sticky = (text, bg, rotDeg, extra = '') => `<span class="sticky" style="background:${bg};transform:rotate(${rotDeg}deg);${extra}">${esc(text)}</span>`;
  const polaroid = (p, stampHtml, note, noteBg = 'var(--mint)') => `
    <div class="hero">
      <div class="hero-mug">${mug(p, { rot: -3 })}<span class="tape" style="left:56px;top:-10px;background:rgba(242,194,48,.75)"></span></div>
      <div class="hero-stamp">${stampHtml}</div>
      ${note ? `<div class="hero-note">${sticky(note, noteBg, 5)}</div>` : ''}
    </div>`;
  const sealedCard = (title, body) => `
    <div class="sealed mt16"><span class="seal" aria-hidden="true">${icon.sealGavel}</span>
      <span><span class="mono sm">${title}</span><br><span style="font-size:13px;line-height:1.4">${body}</span></span></div>`;
  const pointsRow = (p, why, pts, hot) => `<div class="row">${p ? head(p) : '<span class="chip-head" style="background:var(--tab)">?</span>'}<span class="hand" style="font-weight:700;font-size:20px">${p ? esc(p.name) : '???'}</span><span class="mono sm muted grow">${esc(why)}</span><span class="pixel" style="font-size:26px;color:${hot ? 'var(--red)' : pts > 0 ? 'var(--ink)' : 'var(--muted)'}">${pts > 0 ? '+' + pts : pts}</span></div>`;
  const newCaseButtons = () => isHost() ? `
      ${cta('New topic', 'new-game')}
      <button class="btn yellow mt8" data-a="change-mode" style="font-family:var(--mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase">Change game mode</button>`
    : `<div class="hand center">waiting for ${esc(P(S.hostId).name)} to open a new case…</div>`;

  function rulesOverlay() {
    return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="rules-title"><div class="card shadow inner stack gap8" style="max-width:380px;width:100%">
      <div class="between"><h2 class="h2" id="rules-title">House rules</h2><button class="btn small" data-a="rules-close">Close</button></div>
      <div class="mono sm" style="color:var(--blue)">Accusations</div>
      <p style="margin:0;font-size:14px;line-height:1.45">Everyone secretly files a hot take. Each one takes the stand anonymously and everyone accuses who wrote it. +1 for every right accusation. If the writer isn't the single most-accused, they escape for +2.</p>
      <div class="mono sm" style="color:#9a7400">Confession</div>
      <p style="margin:0;font-size:14px;line-height:1.45">Everyone anonymously confesses an opinion or story. A secret devil's advocate must defend each one. Vote agree or disagree in public, then secretly guess who confessed (+1) and who the devil's advocate is (+1). The devil's advocate gets +1 for every juror who accuses <i>them</i> of confessing. A reveal wheel decides who gets unmasked.</p>
      <p class="hand muted" style="margin:0">rule no. 1 — no take is too hot. nobody moves on until everyone has voted.</p>
    </div></div>`;
  }

  // ---------- screens ----------
  function home() {
    return `
      <div class="topbar"><span class="row mono"><span class="dot" style="background:#1E8F3A"></span>Court in session</span><button class="btn small" data-a="rules">House rules</button></div>
      <div class="logo-block mt16">
        <span class="tag" style="position:absolute;left:0;top:6px;transform:rotate(-6deg)">Spill a secret</span>
        <span class="tag" style="position:absolute;right:0;top:-6px;transform:rotate(5deg);background:var(--yellow)">NO PAROLE</span>
        <div class="hand" style="font-size:22px;margin-top:18px">Court of Public Opinion</div>
        <svg width="64" height="8" viewBox="0 0 64 8" aria-hidden="true"><path d="M2 5 Q10 1 18 5 T34 5 T50 5 T62 4" fill="none" stroke="#1A1A1A" stroke-width="1.5" stroke-linecap="round"/></svg>
        <div class="logo-box mt4"><h1>BLASPHEMY</h1></div>
        <div class="between" style="width:100%;margin-top:12px;align-items:flex-start">
          <span class="row" style="gap:4px">${sticky('Semi-Safe Space', 'var(--yellow)', -3)}<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 19 L18 4 M18 4 L10 5 M18 4 L17 12" fill="none" stroke="#1A1A1A" stroke-width="1.5" stroke-linecap="round"/></svg></span>
          <span class="row" style="gap:4px"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M19 19 L4 4 M4 4 L12 5 M4 4 L5 12" fill="none" stroke="#1A1A1A" stroke-width="1.5" stroke-linecap="round"/></svg>${sticky('jury of ur homies', 'var(--mint)', 3)}</span>
        </div>
      </div>
      <p class="center" style="font-weight:700;font-size:28px;line-height:1.12;letter-spacing:-.02em;margin:22px 0 0">Say the unsayable.<br>Let the jury decide.</p>
      <form class="card soft inner stack gap12 mt24" data-form="join" style="padding:22px 18px 18px">
        <span class="tape" style="left:-10px;top:-8px;transform:rotate(-30deg)"></span>
        <span class="tape" style="right:-10px;top:-8px;transform:rotate(30deg);background:rgba(242,194,48,.7)"></span>
        <label class="field"><span class="mono">Your name, for the record</span><input class="input" name="name" maxlength="16" autocomplete="nickname" placeholder="e.g. Maya" value="${esc(ui.name)}" required></label>
        <label class="field"><span class="mono">Court Room #.</span><input class="input code" name="code" maxlength="5" autocapitalize="characters" placeholder="ABCDE" value="${esc(ui.code)}"></label>
        ${cta('Enter the courtroom', 'join-submit', { disabled: ui.busy })}
      </form>
      <button class="btn yellow mt20" data-a="create">${icon.gavelInk} Open a new case</button>
      <div class="spacer"></div>
      <div class="hand center muted">rule no. 1 — no take is too hot.</div>
      ${ui.rules ? rulesOverlay() : ''}`;
  }

  function waitingForHost() {
    const host = P(S.hostId);
    return `
      <div class="topbar"><span class="mono">Court Room <span class="pixel" style="font-size:22px">${esc(S.code)}</span></span><span class="tag" style="transform:rotate(3deg);background:${mode().bg};color:${mode().fg}">${mode().name.toUpperCase()}</span></div>
      <div class="stack center mt24" style="align-items:center">
        <div class="hand">all rise…</div>
        <h2 class="h1 mt4">${esc(host.name)} is choosing the case</h2>
        <p class="hand muted mt8">hang tight — the host is picking a topic.</p>
      </div>
      <div class="mono mt24">The lineup · ${S.players.length}</div>
      <div class="grid3 mt12">${S.players.map((p, i) => mug(p, { host: p.id === S.hostId, rot: rot(i), off: !p.connected })).join('')}</div>
      <div class="spacer"></div>
      <button class="linkbtn" data-a="leave">Leave court</button>`;
  }

  function topics() {
    const picked = ui.pickTopic || S.settings.topic;
    let n = 0;
    return `
      <div class="topbar">${back('Court', 'leave')}<span></span></div>
      <div class="hand">what's on trial today?</div>
      <h1 class="h1">The Docket</h1>
      <div class="split mt12">
        <button data-a="custom-topic">${icon.plus}<span><span class="mono sm">Create your own</span><span class="sub">write your own prompt</span></span></button>
        <button data-a="wildcard">${icon.star}<span><span class="mono sm">Wildcard</span><span class="sub">say anything you want</span></span></button>
      </div>
      ${ui.customTopic ? `<form class="card inner stack gap8 mt12" data-form="custom-topic"><label class="field"><span class="mono">Your prompt</span><input class="input" name="topic" maxlength="40" placeholder="e.g. Group projects" required autofocus></label><button class="btn dark">Use this topic</button></form>` : ''}
      ${TOPIC_GROUPS.map(g => `
        <section class="mt20" aria-label="${esc(g.name)}">
          <div class="row"><span class="glabel" style="background:${g.label};color:${g.labelText}">${esc(g.name)}</span><span class="hand muted grow" style="font-size:17px">${esc(g.sub)}</span><span class="mono sm muted">${g.topics.length} →</span></div>
          <div class="shelf mt8">
            ${g.topics.map(t => { n++; const on = picked === t.name; return `
              <button class="folder ${g.color === '#FFFFFF' ? 'white' : ''} ${on ? 'on' : ''}" style="--c:${g.color}" data-a="pick-topic" data-group="${esc(g.name)}" data-topic="${esc(t.name)}" aria-pressed="${on}">
                <div class="ftab"></div>
                <div class="fbody">
                  <div class="between"><span class="mono sm">Exhibit ${String(n).padStart(2, '0')}</span>${t.live ? '<span class="mono sm" style="color:var(--red)">● Live</span>' : ''}${t.adult ? '<span class="mono sm" style="background:var(--ink);color:#fff;padding:0 4px">18+</span>' : ''}</div>
                  <div class="ftitle" style="${Math.max(...t.name.split(' ').map(w => w.length)) >= 9 || t.name.length > 14 ? 'font-size:19px' : ''}">${esc(t.name)}</div>
                  <div class="fblurb">${esc(t.blurb)}</div>
                </div>
                ${on ? `<span class="fcheck">${icon.check}</span>` : ''}
              </button>`; }).join('')}
          </div>
        </section>`).join('')}
      <div class="spacer"></div>
      <div class="sticky-bottom">${cta('Continue', 'continue-topic', { meta: picked ? picked.toUpperCase() : '', disabled: !picked })}</div>`;
  }

  function findTopic(name) { for (const g of TOPIC_GROUPS) for (const t of g.topics) if (t.name === name) return t; return null; }

  function setup() {
    const st = S.settings;
    const t = findTopic(st.topic);
    const subs = t ? t.subs : [];
    const chip = s => `<button class="chip ${st.sub === s ? 'on' : ''}" data-a="pick-sub" data-sub="${esc(s)}" aria-pressed="${st.sub === s}">${st.sub === s ? '✓ ' : ''}${esc(s)}</button>`;
    const chips = [`<button class="chip dark" data-a="custom-sub">+Custom</button>`];
    if (st.sub && !subs.includes(st.sub)) chips.push(chip(st.sub));
    chips.push(...subs.slice(0, 1).map(chip));
    if (subs.length) chips.push(`<button class="chip" data-a="surprise-sub">Surprise me</button>`);
    chips.push(...subs.slice(1).map(chip));
    const seg = (key, opts, fmt) => `<div class="seg" role="group">${opts.map(o => `<button data-a="set" data-key="${key}" data-val="${o}" class="${String(st[key]) === String(o) ? 'on' : ''}" aria-pressed="${String(st[key]) === String(o)}">${fmt ? fmt(o) : o}</button>`).join('')}</div>`;
    const time = v => v < 120 ? v + 's' : (v / 60) + 'm';
    const conf = st.mode === 'confession';
    return `
      <div class="topbar">${back('Topics', 'to-topics')}<span class="tag" style="transform:rotate(3deg)">NEW CASE</span></div>
      <div class="row gap12 mt8" style="align-items:flex-start">
        <div class="card soft" style="padding:8px 8px 0;width:168px;flex:none;transform:rotate(-3deg)">
          <span class="tape" style="left:55px;top:-9px"></span>
          <div class="exhibit-a">
            <span class="mono sm" style="position:absolute;left:6px;top:6px;color:var(--tab)">Exhibit A</span>
            <span class="pixel" style="color:#fff;border:2px solid var(--red);padding:2px 10px;font-size:${(st.topic || '').length > 8 ? 26 : 42}px;text-align:center;max-width:140px;overflow-wrap:anywhere">${esc((st.topic || '').toUpperCase())}</span>
          </div>
          <div class="hand center" style="font-size:17px;padding:4px 0 6px">fig. 1 — the topic on trial</div>
        </div>
        <div class="hand" style="font-size:21px;line-height:1.1;padding-top:16px">Charge:<br><b>${esc(st.topic)} Blasphemy</b></div>
      </div>
      <div class="mono mt20">Narrow the charges</div>
      <div class="hand muted" style="font-size:16px">Only narrow if needed · swipe for more</div>
      <div class="chips mt8">${chips.join('')}</div>
      ${ui.customSub ? `<form class="card inner stack gap8 mt8" data-form="custom-sub"><label class="field"><span class="mono">Custom sub-topic</span><input class="input" name="sub" maxlength="60" placeholder="e.g. Pineapple on pizza" required autofocus></label><button class="btn dark">Use it</button></form>` : ''}
      <div class="mono mt16">Choose proceedings</div>
      <div class="tabs mt8" role="tablist">
        <button class="${!conf ? 'on' : ''}" role="tab" aria-selected="${!conf}" data-a="set-mode" data-mode="accusations" style="background:var(--blue);color:#fff">Accusations</button>
        <button class="${conf ? 'on' : ''}" role="tab" aria-selected="${conf}" data-a="set-mode" data-mode="confession" style="background:var(--yellow)">Confession</button>
        <button role="tab" aria-selected="false" disabled style="background:var(--green)" title="Coming soon">Testimony</button>
      </div>
      ${conf ? `
      <div class="panel yellow">
        <div class="between"><span class="mono sm">● Proceeding 02</span>${icon.scales}</div>
        <div class="ptitle">Confession</div>
        <p class="pbody">Everyone anonymously confesses an unpopular opinion or story. Discuss, vote agree or disagree in public, then secretly guess who confessed. A secret devil's advocate has to defend the confession.</p>
        <div class="settings">
          <span class="mono sm">Settings</span>
          <div class="setting"><span><span class="mono">Round timer</span><br><span class="hand" style="font-size:15px">keeps deliberations moving</span></span>${seg('timerOn', [false, true], v => v ? 'On' : 'Off')}</div>
          ${st.timerOn ? `<div class="stack gap8"><span class="mono">Time per confession</span>${seg('voteSeconds', [60, 120, 300, 600], time)}</div>` : ''}
          <div class="setting"><span><span class="mono">Agree / disagree vote</span><br><span class="hand" style="font-size:15px">the public vote on each confession</span></span>${seg('agreeOn', [false, true], v => v ? 'On' : 'Off')}</div>
          <div class="setting"><span><span class="mono">Reveal randomizer</span><br><span class="hand" style="font-size:15px">might unmask confessors &amp; voters</span></span>${seg('revealOn', [false, true], v => v ? 'On' : 'Off')}</div>
          ${st.revealOn ? `<div class="stack gap8"><span class="mono">Spin the reveal randomizer</span>${seg('revealWhen', ['round', 'end'], v => v === 'round' ? 'After each round' : 'End of game')}</div>
          <span class="hand" style="font-size:15px">${st.revealWhen === 'round' ? 'after each round: 6 slots, reveal · seal, one spin per confession' : 'end of game: one spin decides for everyone, and the winner tips the scale'}</span>` : '<span class="hand" style="font-size:15px">off: everyone gets unmasked at the end of the game</span>'}
        </div>
      </div>` : `
      <div class="panel blue">
        <div class="between"><span class="mono sm" style="color:#fff">● Proceeding 01</span>${icon.scalesWhite}</div>
        <div class="ptitle">Accusations</div>
        <p class="pbody">A hot take takes the stand. Everyone interrogates everyone. Everyone points a finger at who they think wrote the blasphemous statement.</p>
        <div class="settings">
          <span class="mono sm" style="color:#fff">Settings</span>
          <div class="setting"><span><span class="mono" style="color:#fff">Round timer</span><br><span class="hand" style="font-size:15px">keeps deliberations moving</span></span>${seg('timerOn', [false, true], v => v ? 'On' : 'Off')}</div>
          ${st.timerOn ? `<div class="stack gap8"><span class="mono" style="color:#fff">Time per exhibit</span>${seg('voteSeconds', [60, 120, 300, 600], time)}</div>` : ''}
        </div>
      </div>`}
      <div class="hand mt16" style="text-align:right">Court room # to join jury ↓</div>
      ${cta('Open court', 'open-court', { meta: S.code })}`;
  }

  function lobby() {
    const n = S.players.filter(p => p.connected).length;
    const fill = Math.max(S.minPlayers - S.players.length, (3 - (S.players.length % 3)) % 3);
    const open = Math.min(fill, S.maxPlayers - S.players.length);
    const link = `${location.origin}/?code=${S.code}`;
    const d = new Date();
    return `
      <div class="topbar">${isHost() ? back('Case', 'edit-case') : `<span></span>`}<span class="row mono"><span class="dot" style="background:var(--red)"></span>Court assembling</span></div>
      <div class="pad mt8" style="transform:rotate(1deg)">
        <span class="tape" style="left:40%;top:-9px"></span>
        <span class="filed" aria-hidden="true">FILED<br>${d.getMonth() + 1}·${d.getDate()}</span>
        <div class="mono">Docket no.</div>
        <div class="pixel" style="font-size:64px;letter-spacing:.12em">${esc(S.code)}</div>
        <div class="hand">jurors enter this code to join</div>
        <div class="row mt8"><button class="btn small" data-a="copy" data-link="${esc(link)}">Copy</button>${navigator.share ? `<button class="btn small dark" data-a="share" data-link="${esc(link)}">Send link</button>` : ''}</div>
      </div>
      <div class="row mt16" style="flex-wrap:wrap"><span class="box-tag">${esc(S.settings.topic)}</span>${S.settings.sub ? `<span class="box-tag">${esc(S.settings.sub)}</span>` : ''}${modeBox()}${S.settings.timerOn ? `<span class="box-tag">⏱ timer on</span>` : ''}</div>
      <div class="between mt20"><span class="mono">The lineup</span><span><span class="pixel" style="font-size:22px">${n}/${S.maxPlayers}</span> <span class="mono sm">jurors</span></span></div>
      <div class="grid3 mt12">${S.players.map((p, i) => mug(p, { host: p.id === S.hostId, rot: rot(i), off: !p.connected })).join('')}${Array.from({ length: open }, () => '<div class="seat"><span>+<br>seat open</span></div>').join('')}</div>
      <div class="spacer"></div>
      <div class="hand center">${n < S.minPlayers ? `need ${S.minPlayers - n} more juror${S.minPlayers - n > 1 ? 's' : ''} to begin` : "all rise when you're ready"}</div>
      ${isHost() ? cta('Begin proceedings', 'start', { box: 'red', disabled: n < S.minPlayers }) : `<div class="hand center muted">waiting for ${esc(P(S.hostId).name)} (host) to begin…</div>`}
      <button class="linkbtn center" data-a="leave">Leave court</button>`;
  }

  function writing() {
    const filed = !!S.myOpinion && !ui.editing;
    const n = S.players.filter(p => p.connected).length;
    const conf = S.settings.mode === 'confession';
    return `
      <div class="topbar"><span class="mono">${conf ? 'Confess' : 'File your take'}</span><span class="mono sm muted">no timer — take your time</span></div>
      <div class="row mt8">${modeBox()}<span class="mono sm">${esc(topicLine())}</span></div>
      ${filed ? `
        <div class="pad mt20"><span class="tape" style="left:-10px;top:-4px;transform:rotate(28deg)"></span>
          <div class="mono">Filed under seal</div>
          <p style="font-weight:700;font-size:24px;line-height:1.15;margin:8px 0 0">“${esc(S.myOpinion)}”</p>
          <div class="hand mt8">— that's yours. don't tell anyone.</div></div>
        <button class="linkbtn mt8" data-a="edit-take">Edit</button>
        <div class="stack center mt24" style="align-items:center"><div class="pixel" style="font-size:48px">${S.submittedCount}/${n}</div><div class="mono">${conf ? 'confessions' : 'takes'} filed</div>
        <div class="heads mt12">${S.players.filter(p => p.connected).map(p => `<span style="opacity:${p.submitted ? 1 : .35}">${head(p)}</span>`).join('')}</div></div>
        <div class="spacer"></div>
        <div class="hand center muted">the trial starts once everyone has filed…</div>`
      : `
        <h2 class="h1 mt20">${conf ? 'What do you need to confess?' : "What's your unpopular opinion?"}</h2>
        <p class="hand muted" style="margin:4px 0 0">about <b>${esc(topicLine() || 'anything')}</b> — it's anonymous… for now.</p>
        <form class="stack gap8 mt16" data-form="opinion">
          <label class="sr" for="op">Your ${conf ? 'confession' : 'opinion'}</label>
          <textarea id="op" class="input" name="text" maxlength="200" placeholder="${conf ? 'I secretly think…' : 'Pineapples r the best fruit by far'}" required>${esc(ui.draft || S.myOpinion || '')}</textarea>
          <div class="between"><span class="hand muted" style="font-size:16px">${conf ? 'an unpopular opinion or a story time — stays anonymous' : 'the jury will try to guess it was you'}</span><span class="mono sm" data-count>${(ui.draft || S.myOpinion || '').length}/200</span></div>
          <div class="spacer"></div>
          ${cta(conf ? 'File my confession' : 'File my take', 'opinion-submit', { box: 'red', ic: icon.gavel })}
        </form>`}`;
  }

  // ---------- Accusations ----------
  function voting() {
    const r = S.round;
    const suspects = S.players.filter(p => p.id !== S.you);
    const total = S.players.filter(p => p.connected).length;
    const pick = ui.accusePick || S.myVote;
    const locked = S.myVote && S.myVote === pick;
    return `
      <div class="topbar">${counter('Exhibit', r.index + 1, r.total)}${timerEl()}</div>
      ${S.deadline ? `<div class="progress mt8"><i data-progress="${S.deadline}" data-span="${S.settings.voteSeconds}"></i></div>` : ''}
      <div class="row mt12">${modeBox()}<span class="mono sm">${esc(topicLine())}</span></div>
      <div class="pad mt16" style="transform:rotate(1deg)">
        <span class="tape" style="left:-12px;top:-2px;transform:rotate(28deg)"></span><span class="tape" style="right:-12px;top:-2px;transform:rotate(-28deg)"></span>
        <div class="mono">The take on trial</div>
        <p style="font-weight:700;font-size:28px;line-height:1.1;letter-spacing:-.02em;margin:8px 0 0">“${esc(r.text)}”</p>
        <div class="hand mt8">— filed anonymously</div>
      </div>
      ${r.yours ? sticky("this one's yours — act natural & accuse someone else", 'var(--yellow)', -2, 'align-self:flex-start;margin-top:12px') : ''}
      ${S.timeUp ? `<div class="sticky mt12" style="background:var(--red);color:#fff;transform:rotate(-1deg);align-self:flex-start">time's up — lock in your accusation</div>` : ''}
      <h2 class="h2 mt20">Who in this courtroom is a <span style="color:var(--red)">Blasphemer</span>?</h2>
      <div class="hand muted" style="font-size:17px">Blasphemer: the individual who wrote this statement</div>
      <div class="grid2 mt12">${suspects.map(p => {
        const on = pick === p.id;
        return `<div style="position:relative">${mug(p, { button: 'pick-suspect', on })}${on ? '<span class="stamp sm" style="position:absolute;right:-4px;top:22px;transform:rotate(12deg)">ACCUSE</span>' : ''}</div>`;
      }).join('')}</div>
      <div class="spacer"></div>
      <div class="between mt16"><span class="mono">${S.votedCount}/${total} votes in</span>${locked ? '<span class="mono" style="color:var(--green)">✓ locked in</span>' : ''}</div>
      <div class="mt8">${pick
        ? cta(locked ? `Accused: ${P(pick).name}` : `Accuse: ${P(pick).name}`, 'accuse', { box: 'red', disabled: locked, meta: locked ? `${S.votedCount}/${total}` : '' })
        : cta('Pick a suspect', 'accuse', { box: 'red', disabled: true })}</div>
      <div class="hand center muted mt4" style="font-size:15px">nobody moves on until every juror has voted</div>`;
  }

  function tallyRows(tally) {
    const counts = Object.fromEntries(tally.map(t => [t.id, t.voters.length]));
    const max = Math.max(1, ...Object.values(counts));
    const top = Math.max(0, ...Object.values(counts));
    const rows = S.players.slice().sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
    return `<div class="stack gap8 mt8">${rows.map(p => { const c = counts[p.id] || 0; return `<div class="row"><span class="hand" style="font-weight:700;font-size:20px;width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span><div class="bar ${c && c === top ? 'hot' : ''}"><i style="width:${c / max * 100}%"></i></div><span class="pixel" style="font-size:24px;width:22px;text-align:right">${c}</span></div>`; }).join('')}</div>`;
  }

  function decision() {
    const d = S.decision, r = S.round;
    const single = d.top.length === 1 ? P(d.top[0]) : null;
    const total = d.tally.reduce((n, t) => n + t.voters.length, 0);
    const accusedVotes = single ? d.tally.find(t => t.id === single.id).voters.length : 0;
    return `
      <div class="topbar"><span class="mono">The verdict</span>${counter('Exhibit', r.index + 1, r.total)}</div>
      ${single ? polaroid(single, '<span class="stamp">ACCUSED<small>OF BLASPHEMY</small></span>', `${accusedVotes} of ${total} votes`)
        : `<div class="row mt16" style="justify-content:center">${d.top.map(id => `<div style="width:120px">${mug(P(id), { rot: rot(id.length) })}</div>`).join('')}</div><div class="center mt8"><span class="stamp blue" style="transform:rotate(-6deg)">HUNG JURY<small>IT'S A TIE</small></span></div>`}
      <p style="font-size:17px;margin:12px 0 0">${single ? `The jury accuses <b>${esc(single.name)}</b> of <span style="color:var(--red)">blasphemy</span>:` : 'The jury is split:'}</p>
      <p class="hand" style="font-weight:700;font-size:26px;line-height:1.05;margin:4px 0 0">“${esc(r.text)}”</p>
      <div class="mono mt16">The tally</div>
      ${tallyRows(d.tally)}
      <div class="spacer"></div>
      ${isHost() ? cta(single ? `${single.name}’s Verdict` : 'Reveal the verdict', 'advance') : '<div class="hand center">the host will reveal the verdict…</div>'}`;
  }

  function verdict() {
    const v = S.verdict, r = S.round;
    const tie = v.top.length !== 1;
    const subject = v.caught ? P(v.authorId) : (!tie ? P(v.top[0]) : null);
    const last = r.index + 1 >= r.total;
    const note = subject ? `${v.votesFor[subject.id] || 0} of ${v.totalVotes} votes` : '';
    let points;
    if (v.caught) {
      points = v.calls.map(c => c.author ? pointsRow(P(c.id), 'caught', 0, true) : pointsRow(P(c.id), c.ok ? 'called it' : c.voted ? 'wrong call' : 'no vote', c.ok ? 1 : 0)).sort((a, b) => b.includes('+1') - a.includes('+1')).join('');
    } else points = pointsRow(null, 'evaded detection', 2);
    return `
      <div class="topbar"><span class="mono">The suspect verdict</span>${counter('Exhibit', r.index + 1, r.total)}</div>
      ${subject ? polaroid(subject, v.caught ? '<span class="stamp">GUILTY<small>OF BLASPHEMY</small></span>' : '<span class="stamp blue" style="font-size:44px">NOT GUILTY<small>BLASPHEMER AT LARGE</small></span>', note, v.caught ? 'var(--mint)' : 'var(--yellow)')
        : `<div class="center mt20"><span class="stamp blue" style="transform:rotate(-6deg)">HUNG JURY<small>NOBODY CONVICTED</small></span></div>`}
      <h2 class="h2 mt8">${v.caught ? `${esc(subject.name)} wrote it. Guilty as charged.` : tie ? 'The jury couldn’t agree.' : `${esc(subject.name)} didn't write this one.`}</h2>
      <p class="hand" style="font-weight:700;font-size:24px;line-height:1.05;margin:4px 0 0">“${esc(r.text)}”</p>
      ${!v.caught ? sealedCard('Identity sealed', 'The real blasphemer slipped past the jury. Their name is revealed at the end of the game.') + '<div class="hand muted mt8" style="font-size:16px">a tie works the same way — nobody gets unmasked yet</div>' : ''}
      <div class="mono mt16">Points awarded</div>
      <div class="list mt8">${points}</div>
      <div class="spacer"></div>
      ${isHost() ? cta(last ? 'See the truth' : 'Next exhibit', 'advance', { meta: last ? '' : `${r.index + 2}/${r.total}` }) : '<div class="hand center">waiting for the host…</div>'}`;
  }

  function standings(reason, note) {
    const sorted = S.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted.length ? sorted[0].score : 0; let rank = 0, prev = null;
    const winners = sorted.filter(p => p.score === top);
    return `
      <div class="winners mt16">
        <div class="mono sm center" style="color:var(--yellow)">${winners.length > 1 ? 'Winners · tie for first' : 'Winner'}</div>
        <div class="row mt12" style="justify-content:center;gap:16px;position:relative">${winners.slice(0, 3).map((p, i) => `<div class="stack gap8" style="width:110px;align-items:center">${mug(p, { rot: i % 2 ? 3 : -3 })}<span class="pixel" style="color:#fff;font-size:30px">${p.score} PTS</span></div>`).join('')}
          <span class="tag" style="position:absolute;left:50%;top:-6px;transform:translateX(-50%) rotate(-4deg);background:var(--yellow)">${winners.length > 1 ? 'WINNERS' : 'WINNER'}</span></div>
      </div>
      <div class="mono mt20">Final standings</div>
      <div class="list mt8">${sorted.map((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; } return `<div class="row" style="${p.score === top ? 'background:rgba(242,194,48,.25)' : ''}"><span class="pixel" style="font-size:26px;width:18px">${rank}</span>${head(p)}<span class="hand" style="font-weight:700;font-size:20px">${esc(p.name)}${p.id === S.you ? ' (you)' : ''}</span><span class="mono sm muted grow">${esc(reason(S.stats[p.id] || {}))}</span><span class="pixel" style="font-size:26px">${p.score}</span></div>`; }).join('')}</div>
      ${note ? `<div class="hand muted mt8" style="font-size:15px">${note}</div>` : ''}`;
  }

  function results() {
    const reason = s => [s.calls ? plural(s.calls, 'call') : '', s.escapes ? plural(s.escapes, 'escape') : '', s.caught ? (s.caught > 1 ? `caught ×${s.caught}` : 'caught') : ''].filter(Boolean).join(' · ') || '—';
    return `
      <div class="topbar"><span class="row mono"><span class="dot"></span>Case closed</span><span class="mono"><span class="pixel" style="font-size:22px">${S.results.reveal.length} / ${S.results.reveal.length}</span> exhibits</span></div>
      <div class="hand">the court is adjourned…</div>
      <h1 class="h1" style="font-size:34px">The truth, revealed.</h1>
      ${standings(reason)}
      <div class="mono mt20">Who said what</div>
      <div class="hand muted" style="font-size:16px">all ${S.results.reveal.length} exhibits · swipe for more</div>
      <div class="hscroll mt8">${S.results.reveal.map(x => `
        <div class="exhibit"><div class="between"><span class="mono sm">Exhibit ${String(x.n).padStart(2, '0')}</span><span class="box-tag" style="background:${x.caught ? 'var(--red)' : 'var(--mint)'};color:${x.caught ? '#fff' : 'var(--ink)'}">${x.caught ? 'Caught' : 'Escaped'}</span></div>
        <b style="font-size:15px;line-height:1.25">“${esc(x.text)}”</b><div class="spacer" style="min-height:4px"></div><span class="hand" style="font-weight:700">— ${esc(P(x.authorId).name)}</span></div>`).join('')}</div>
      <div class="spacer"></div>
      <div class="hand center muted">the court stays in session — same lobby, same jury</div>
      ${newCaseButtons()}
      <button class="linkbtn center" data-a="leave">Leave court</button>`;
  }

  // ---------- Confession ----------
  const SPIN_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 3300;
  function wheelSvg(slots) {
    const n = slots.length, step = 360 / n; let out = '';
    slots.forEach((k, i) => {
      const c = i * step, a0 = (c - step / 2) * Math.PI / 180, a1 = (c + step / 2) * Math.PI / 180;
      const f = v => v.toFixed(2);
      out += `<path d="M0 0 L${f(Math.cos(a0) * 95)} ${f(Math.sin(a0) * 95)} A95 95 0 0 1 ${f(Math.cos(a1) * 95)} ${f(Math.sin(a1) * 95)} Z" fill="${k === 'R' ? '#A8DDC6' : '#1A1A1A'}" stroke="#1A1A1A" stroke-width="2"/>`;
      const flip = Math.cos(c * Math.PI / 180) < -0.01;
      out += `<text transform="rotate(${c}) translate(60 0)${flip ? ' rotate(180)' : ''}" text-anchor="middle" dominant-baseline="central" font-family="'Jersey 10', monospace" font-size="${n > 6 ? 17 : 20}" fill="${k === 'R' ? '#1A1A1A' : '#F2C230'}">${k === 'R' ? 'REVEAL' : 'SEAL'}</text>`;
    });
    return `<svg viewBox="-100 -100 200 200" width="100%" height="100%" aria-hidden="true">${out}<circle r="96" fill="none" stroke="#1A1A1A" stroke-width="3"/><circle r="16" fill="#F7F5EF" stroke="#1A1A1A" stroke-width="2.5"/><circle r="5" fill="#1A1A1A"/></svg>`;
  }
  function wheel(slots, index, key, size = 150) {
    const step = 360 / slots.length;
    const jitter = key ? ((key.length * 37) % 50 - 25) / 100 * step : 0;
    const final = index == null ? 0 : -(1440 + index * step + jitter);
    const start = index == null || ui.spunAt[key] ? final : 0;
    return `<div class="wheel" style="width:${size}px;height:${size}px" role="img" aria-label="Reveal randomizer wheel with ${slots.length} slots">
      <div class="wheel-rot" ${index == null ? '' : `data-spin-key="${key}" data-final="${final}"`} style="transform:rotate(${start}deg)">${wheelSvg(slots)}</div>
      <svg class="pointer" width="26" height="24" viewBox="0 0 24 22" aria-hidden="true"><path d="M1 11 L23 1 V21 Z" fill="#E8553A" stroke="#1A1A1A" stroke-width="1.8" stroke-linejoin="round"/></svg></div>`;
  }
  const spinning = key => !ui.spunAt[key] || Date.now() - ui.spunAt[key] < SPIN_MS;
  function afterRenderSpins() {
    document.querySelectorAll('[data-spin-key]').forEach(el => {
      const k = el.dataset.spinKey; if (ui.spunAt[k]) return;
      ui.spunAt[k] = Date.now();
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.15,.8,.2,1)`; el.style.transform = `rotate(${el.dataset.final}deg)`; }));
      setTimeout(render, SPIN_MS + 80);
    });
  }
  const plusChips = (ids, empty = 'nobody') => ids.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${ids.map(id => `<span class="person">${head(P(id), true)}${esc(P(id).name)}<span class="mono sm" style="margin-left:2px">+1</span></span>`).join('')}</div>` : `<span class="hand muted" style="font-size:16px">${empty}</span>`;
  const daPill = id => `<span class="person" style="background:var(--ink);color:#fff;border-color:var(--red)">${icon.mask}${head(P(id), true)}${esc(P(id).name)}</span>`;
  const stepHead = (n, title, note, extra = '') => `<div class="row gap12"><span class="chip-head" style="background:var(--ink);color:#fff">${n}</span><span class="grow"><span class="mono">${title}</span><br><span class="hand muted" style="font-size:16px">${note}</span></span>${extra}</div>`;
  const guessRows = (rows) => rows.map(g => `<div class="row">${head(P(g.id), true)}<span class="hand grow" style="font-weight:700;font-size:18px">${esc(P(g.id).name)} <span style="font-weight:400;color:var(--muted)">guessed</span> ${esc(P(g.guess).name)}</span><span class="box-tag" style="background:${g.ok ? 'var(--mint)' : '#fff'};color:${g.ok ? 'var(--ink)' : 'var(--red)'}">${g.ok ? '✓ +1' : '✗ 0'}</span></div>`).join('');

  function daSecret() {
    const r = S.round;
    return `
      <div class="topbar"><span class="row mono" style="color:var(--red)">${icon.eyeOff} Only you can see this</span>${counter('Confession', r.index + 1, r.total)}</div>
      <div class="secret mt16">
        <span class="stamp sm" style="position:absolute;right:10px;top:-16px;transform:rotate(-8deg);background:var(--ink);font-size:24px">TOP SECRET</span>
        ${icon.maskBig}
        <div class="mono sm" style="color:var(--yellow)">You've been chosen</div>
        <div style="font-weight:700;font-size:28px;letter-spacing:-.02em;line-height:1.08">You're the devil's advocate.</div>
        <p style="font-size:15px;line-height:1.4;margin:0;color:var(--tab)">Secretly defend this confession even if you think it's ridiculous. While finding out who you are defending.</p>
      </div>
      <div class="pad mt16" style="padding:12px 14px 14px 42px"><div class="mono sm">You're defending</div><b style="font-size:20px;line-height:1.15;display:block;margin-top:4px">“${esc(r.text)}”</b></div>
      <div class="mono mt16">The rules</div>
      <div class="stack gap8 mt8">${[["Don't tell anyone you're the devil's advocate.", 'var(--red)'], ['Jurors will try to spot you, each right guess earns them a point. Be clever.', 'var(--pink)'], ['+1 point for every juror who accuses you.', 'var(--mint)'], ["You might be the confessor. That's fine, act natural.", 'var(--yellow)']].map(([t, c]) => `<div class="row" style="align-items:flex-start;gap:10px"><span style="width:10px;height:10px;margin-top:5px;flex:none;background:${c};border:1.5px solid var(--ink)"></span><span style="font-size:14px;line-height:1.35">${t}</span></div>`).join('')}</div>
      <div class="spacer"></div>
      ${cta('Got it — hide this', 'da-hide', { box: 'red' })}`;
  }

  function cDeliberate() {
    const r = S.round;
    if (r.youAreDA && !ui.daSeen[roundKey()]) return daSecret();
    const n = S.players.filter(p => p.connected).length;
    return `
      <div class="topbar">${counter('Confession', r.index + 1, r.total)}${timerEl()}</div>
      ${S.deadline ? `<div class="progress mt8"><i data-progress="${S.deadline}" data-span="${S.settings.voteSeconds}"></i></div>` : ''}
      <div class="row mt12">${modeBox()}<span class="mono sm">${esc(topicLine())}</span></div>
      <div class="card shadow mt16">
        <div class="between" style="background:var(--ink);color:#fff;padding:8px 14px"><span class="mono sm">Anonymous confession</span>${icon.lattice}</div>
        <div class="inner" style="padding:18px 16px"><p style="font-weight:700;font-size:28px;line-height:1.1;letter-spacing:-.02em;margin:0">“${esc(r.text)}”</p><div class="hand muted mt8">— someone in this room</div></div>
        <span class="tape" style="right:-10px;top:-8px;transform:rotate(-20deg)"></span>
      </div>
      ${r.yours ? sticky("this one's yours — act natural", 'var(--yellow)', -2, 'align-self:flex-start;margin-top:12px') : ''}
      ${r.youAreDA ? `<button class="sticky" data-a="da-show" style="background:var(--ink);color:#fff;transform:rotate(-1deg);align-self:flex-start;margin-top:12px;border:0">${icon.mask} you're the devil's advocate — tap to see your brief</button>`
        : `<div class="card inner mt16" style="border:1.5px dashed var(--red);background:transparent">
          <span class="box-tag" style="background:var(--ink);color:#fff;border-color:var(--red)">${icon.mask} Devil's advocate</span>
          <div style="font-weight:700;font-size:16px;margin-top:8px">One of you was secretly told to defend this.</div>
          <div class="hand muted" style="font-size:17px">they could even be the confessor. stay suspicious.</div></div>`}
      <div class="mono mt20">Deliberate out loud</div>
      <div class="hand" style="font-size:21px">agree? disagree? argue it out irl.</div>
      <div class="row mt8"><span class="heads">${S.players.filter(p => p.connected).map(p => head(p)).join('')}</span><span class="hand muted" style="font-size:17px">${n} jurors in session</span></div>
      <div class="spacer"></div>
      <div class="hand center muted" style="font-size:16px">${S.deadline ? 'voting opens when the timer runs out' : 'voting opens when the host is ready'}</div>
      ${isHost() ? cta('Open voting now', 'advance', { meta: 'HOST' }) : ''}`;
  }

  function cVote() {
    const r = S.round, mine = S.myCVote || {}, agreeOn = S.settings.agreeOn;
    const key = roundKey();
    if (ui.cpickKey !== key) { ui.cpickKey = key; ui.cpick = { stance: mine.stance, confessor: mine.confessor, da: mine.da }; }
    const v = ui.cpick;
    const others = S.players.filter(p => p.id !== S.you);
    const total = S.players.filter(p => p.connected).length;
    const complete = (!agreeOn || v.stance) && v.confessor && (v.da || r.youAreDA);
    const locked = mine.locked && mine.stance === v.stance && mine.confessor === v.confessor && mine.da === v.da;
    const pub = S.publicStances || [];
    let n = 0;
    return `
      <div class="topbar">${counter('Confession', r.index + 1, r.total)}<span class="mono sm muted">no timer — everyone votes</span></div>
      <div class="pad mt8" style="padding:12px 14px 12px 42px"><div class="mono sm">On trial</div><b style="font-size:19px;line-height:1.2;display:block;margin-top:4px">“${esc(r.text)}”</b></div>
      ${agreeOn ? `
      <div class="mt20">${stepHead(++n, 'Public vote', 'everyone sees this')}</div>
      <div class="row mt8 gap12" style="position:relative">
        <button class="vote-btn agree ${v.stance === 'agree' ? 'on' : ''}" data-a="cpick" data-key="stance" data-val="agree" aria-pressed="${v.stance === 'agree'}">${icon.thumbUp}<span class="pixel" style="font-size:30px">AGREE</span>${v.stance === 'agree' ? '<span class="yourvote">YOUR VOTE</span>' : ''}</button>
        <button class="vote-btn disagree ${v.stance === 'disagree' ? 'on' : ''}" data-a="cpick" data-key="stance" data-val="disagree" aria-pressed="${v.stance === 'disagree'}">${icon.thumbDown}<span class="pixel" style="font-size:30px">DISAGREE</span>${v.stance === 'disagree' ? '<span class="yourvote">YOUR VOTE</span>' : ''}</button>
      </div>
      <div class="row mt8 gap12"><span class="heads grow">${pub.filter(x => x.stance === 'agree').map(x => head(P(x.id), true)).join('')}</span><span class="heads grow">${pub.filter(x => x.stance === 'disagree').map(x => head(P(x.id), true)).join('')}</span></div>` : ''}
      <div class="mt20">${stepHead(++n, 'Secret guess', 'Who said this? · +1 if right', icon.lock)}</div>
      <div class="grid4 mt8">${others.map(p => `<div style="position:relative">${mug(p, { button: 'cpick', on: v.confessor === p.id, data: `data-key="confessor" data-val="${p.id}"` })}${v.confessor === p.id ? '<span class="stamp sm" style="position:absolute;left:50%;top:26px;transform:translateX(-50%) rotate(-10deg);font-size:15px">MY GUESS</span>' : ''}</div>`).join('')}</div>
      ${r.youAreDA ? `<div class="card inner mt20" style="border-style:dashed;background:transparent"><span class="hand" style="font-size:17px">you're the devil's advocate — no third vote for you.</span></div>`
        : `<div class="mt20">${stepHead(++n, "Spot the devil's advocate", "anonymous · +1 point if you're right", icon.mask)}</div>
      <div class="grid4 mt8">${others.map(p => `<button class="pick ${v.da === p.id ? 'on' : ''}" data-a="cpick" data-key="da" data-val="${p.id}" aria-pressed="${v.da === p.id}">${head(p)}<span>${esc(p.name)}</span>${v.da === p.id ? `<span class="pick-badge">${icon.mask}</span>` : ''}</button>`).join('')}</div>`}
      <div class="spacer"></div>
      <div class="between mt16"><span class="mono">${S.doneCount}/${total} jurors locked in</span>${locked ? '<span class="mono" style="color:var(--green)">✓ locked in</span>' : ''}</div>
      <div class="mt8">${cta(locked ? 'Votes locked in' : 'Lock in votes', 'lock-votes', { disabled: !complete || locked, meta: locked ? `${S.doneCount}/${total}` : '' })}</div>
      <div class="hand center muted mt4" style="font-size:15px">nobody moves on until every juror has locked in</div>`;
  }

  function cResults() {
    const r = S.cresult, rd = S.round, agreeOn = S.settings.agreeOn;
    const verdict = r.agree.length > r.disagree.length ? 'THE JURY AGREES' : r.agree.length < r.disagree.length ? 'THE JURY DISAGREES' : 'SPLIT DECISION';
    const key = `round-${roundKey()}`;
    const last = rd.index + 1 >= rd.total;
    const spun = r.spin && !spinning(key);
    let reveal = '';
    if (r.spin && spun && r.revealed) reveal = `
      <div class="card inner stack gap8 mt16">
        <span class="mono sm" style="color:var(--red)">Unmasked</span>
        <div class="row">${head(P(r.authorId))}<b style="font-size:18px">${esc(P(r.authorId).name)} has been caught.</b></div>
        <div class="row" style="flex-wrap:wrap">${daPill(r.daId)}<span class="hand" style="font-weight:700;font-size:19px">was ${esc(P(r.daId).name)} · +${r.daPts}</span></div>
        <span class="hand muted" style="font-size:16px">${r.fooled.length ? 'fooled ' + r.fooled.map(id => esc(P(id).name)).join(', ') : 'fooled nobody'}</span>
      </div>
      <div class="mono mt20">Secret votes</div>
      <div class="hand muted" style="font-size:16px">revealed by the wheel · +1 for every right guess</div>
      <div class="list mt8">
        <div class="between"><span class="mono sm">Who confessed?</span><span class="box-tag" style="background:var(--ink);color:#fff">Answer: ${esc(P(r.authorId).name)}</span></div>
        ${guessRows(r.confGuess)}
        <div class="between" style="border-top:1.5px solid var(--tab)"><span class="mono sm">Who was the devil's advocate?</span><span class="box-tag" style="background:var(--ink);color:#fff">Answer: ${esc(P(r.daId).name)}</span></div>
        ${guessRows(r.daGuess)}
      </div>`;
    else if (r.spin && spun) reveal = sealedCard('The confessor stays anonymous.', "Secret guesses and the devil's advocate stay locked until the end of the game.") + `<div class="hand muted mt8" style="font-size:16px">points still count — you just won't know who earned them yet</div>`;
    else if (!r.spin) reveal = sealedCard('Identities stay hidden for now.', S.settings.revealOn ? 'At the end of the game the winner tips the wheel — one spin decides if everyone gets unmasked.' : 'Everyone gets unmasked at the end of the game.');
    return `
      <div class="topbar"><span class="mono">The jury has spoken</span>${counter('Confession', rd.index + 1, rd.total)}</div>
      <p class="hand" style="font-weight:700;font-size:26px;line-height:1.05;margin:8px 0 0">“${esc(rd.text)}”</p>
      ${agreeOn ? `
      <div class="mono mt16">Public vote</div>
      <div class="split-bar mt8" style="position:relative">
        <span class="tag" style="position:absolute;left:50%;top:-14px;transform:translateX(-50%) rotate(3deg);background:var(--yellow);z-index:2">${verdict}</span>
        <div style="flex:${Math.max(r.agree.length, .001)};background:var(--mint)"><span class="pixel" style="font-size:40px">${r.agree.length}</span> <span class="mono sm">Agree</span><div class="heads mt4">${r.agree.map(id => head(P(id), true)).join('')}</div></div>
        <div style="flex:${Math.max(r.disagree.length, .001)};background:var(--pink)"><span class="pixel" style="font-size:40px">${r.disagree.length}</span> <span class="mono sm">Disagree</span><div class="heads mt4">${r.disagree.map(id => head(P(id), true)).join('')}</div></div>
      </div>` : ''}
      ${r.spin ? `
        <div class="mono mt20">Reveal randomizer · 6 slots</div>
        <div class="row gap16 mt8">${wheel(r.spin.slots, r.spin.index, key)}<div class="stack"><span class="hand muted">the wheel says…</span><span class="pixel" style="font-size:48px;color:${spun ? (r.revealed ? 'var(--red)' : 'var(--ink)') : 'var(--tab)'}">${spun ? (r.revealed ? 'REVEAL' : 'SEALED') : '…'}</span></div></div>` : ''}
      ${reveal}
      <div class="spacer"></div>
      ${isHost() ? cta(last ? (S.settings.revealOn && S.settings.revealWhen === 'end' ? 'Final spin' : 'See the results') : 'Next confession', 'advance', { meta: last ? '' : `${rd.index + 2}/${rd.total}` }) : '<div class="hand center">waiting for the host…</div>'}`;
  }

  // winner tips the wheel (c-tip) and the final reveal (results) share one layout, like the Figma frame
  function tipCard(winnerId, score, fs) {
    const w = P(winnerId), amWinner = S.you === winnerId, canTip = !fs && (amWinner || (isHost() && !w.connected));
    const s = (S.stats && S.stats[winnerId]) || null;
    const chosen = fs && fs.choice;
    const spun = fs && !spinning('final');
    const btn = (choice, label, sub, yellow) => `<button class="tipbtn ${yellow ? 'y' : ''} ${chosen === choice ? 'chosen' : ''}" ${canTip ? `data-a="tip" data-choice="${choice}"` : 'disabled'}><span class="mono">${label}</span><span class="hand" style="font-size:16px">${sub}</span></button>`;
    return `
      <div class="winners mt16" style="text-align:left">
        <div class="row gap16"><div style="width:110px;flex:none">${mug(w, { rot: -3 })}</div><div class="stack"><span class="mono sm" style="color:var(--yellow)">Winner</span><span class="pixel" style="font-size:46px;color:#fff">${score} PTS</span>${s ? `<span class="hand" style="color:var(--tab);font-size:16px">${plural(s.confRight, 'confessor')} · ${s.daSpotted} devil's advocate${s.daSpotted === 1 ? '' : 's'} spotted${s.daPts ? ` · +${s.daPts} as devil's advocate` : ''}</span>` : ''}</div></div>
        <hr style="border:0;border-top:1px solid rgba(255,255,255,.25);margin:14px 0">
        <div class="mono sm" style="color:var(--yellow)">${esc(w.name)} tips the wheel</div>
        <div class="row gap12 mt8">${btn('seal', 'Keep them hidden', '+2 seal slots', false)}${btn('reveal', 'Reveal everything', '+2 reveal slots', true)}</div>
        <div class="row gap16 mt12">${fs ? wheel(fs.slots, fs.index, 'final', 96) : wheel(['R', 'S', 'R', 'S', 'R', 'S'], null, null, 96)}
          <div class="stack"><span class="hand" style="color:var(--tab);font-size:16px">${fs ? 'tipped to 8 slots · the wheel says' : amWinner ? 'pick a side — 2 slots get added your way' : canTip ? `${esc(w.name)} left — as host, you tip it for them` : `waiting for ${esc(w.name)}…`}</span>
          ${fs ? `<span class="pixel" style="font-size:40px;color:${spun ? (fs.revealed ? 'var(--red)' : 'var(--yellow)') : 'var(--muted)'}">${spun ? (fs.revealed ? 'REVEAL' : 'SEALED') : '…'}</span>` : ''}</div></div>
      </div>`;
  }

  function cTip() {
    return `
      <div class="topbar"><span class="row mono"><span class="dot"></span>Case closed</span></div>
      <div class="hand">the court is adjourned…</div>
      <h1 class="h1" style="font-size:32px">The confessions, revealed?</h1>
      ${tipCard(S.tip.winnerId, S.tip.score, null)}
      <div class="spacer"></div>`;
  }

  function cFinal() {
    const res = S.results, fs = res.finalSpin;
    const spun = !fs || !spinning('final');
    const sorted = S.players.slice().sort((a, b) => b.score - a.score);
    const reason = s => [s.confRight ? plural(s.confRight, 'confessor') : '', s.daSpotted ? plural(s.daSpotted, 'DA') : '', s.daPts ? `DA +${s.daPts}` : ''].filter(Boolean).join(' · ') || '—';
    return `
      <div class="topbar"><span class="row mono"><span class="dot"></span>Case closed</span><span class="mono"><span class="pixel" style="font-size:22px">${res.reveal.length} / ${res.reveal.length}</span> confessions</span></div>
      <div class="hand">the court is adjourned…</div>
      <h1 class="h1" style="font-size:32px">The confessions, revealed?</h1>
      ${fs ? tipCard(fs.by, (S.players.find(p => p.id === fs.by) || {}).score ?? sorted[0].score, fs) : ''}
      ${spun ? `
      ${fs ? `<div class="mono mt20">Final standings</div><div class="list mt8">${(() => { let rank = 0, prev = null; const top = sorted[0].score; return sorted.map((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; } return `<div class="row" style="${p.score === top ? 'background:rgba(242,194,48,.25)' : ''}"><span class="pixel" style="font-size:26px;width:18px">${rank}</span>${head(p)}<span class="hand" style="font-weight:700;font-size:20px">${esc(p.name)}${p.id === S.you ? ' (you)' : ''}</span><span class="mono sm muted grow">${esc(reason(S.stats[p.id] || {}))}</span><span class="pixel" style="font-size:26px">${p.score}</span></div>`; }).join(''); })()}</div>
        <div class="hand muted mt8" style="font-size:15px">+1 per confessor guessed · +1 per devil's advocate spotted (DA) · devil's advocates earn +1 per juror who accuses them</div>`
        : standings(reason, "+1 per confessor guessed · +1 per devil's advocate spotted (DA) · devil's advocates earn +1 per juror who accuses them")}
      <div class="mono mt20">The confessions</div>
      <div class="hand muted" style="font-size:16px">who confessed, who called it, and the devil's advocate · swipe</div>
      <div class="hscroll wide mt8">${res.reveal.map(x => `
        <div class="exhibit gap8">
          <span class="mono sm">Confession ${String(x.n).padStart(2, '0')}</span>
          <b style="font-size:15px;line-height:1.25">“${esc(x.text)}”</b>
          ${x.revealed ? `
            <div class="row">${head(P(x.authorId))}<span class="hand" style="font-weight:700">confessed by ${esc(P(x.authorId).name)}</span></div>
            <div class="stack gap4"><span class="mono sm muted">Guessed right</span>${plusChips(x.confRight)}</div>
            <hr style="border:0;border-top:1.5px solid rgba(0,0,0,.15);width:100%;margin:2px 0">
            <div class="stack gap4"><span class="mono sm" style="color:var(--red)">Devil's advocate</span>${daPill(x.daId)}</div>
            <div class="stack gap4"><span class="mono sm muted">Spotted by</span>${plusChips(x.daRight)}</div>`
          : `<div class="card inner" style="background:transparent;border-style:dashed"><b>Sealed.</b> <span class="hand">this one stays anonymous forever.</span></div>`}
          ${S.settings.agreeOn ? `<span class="mono sm muted">${x.agree} agreed · ${x.disagree} disagreed</span>` : ''}
        </div>`).join('')}</div>
      <div class="spacer"></div>
      <div class="hand center muted">the court stays in session — same lobby, same jury</div>
      ${newCaseButtons()}
      <button class="linkbtn center" data-a="leave">Leave court</button>` : '<div class="spacer"></div>'}`;
  }

  // ---------- render ----------
  function render() {
    const focused = document.activeElement && document.activeElement.name;
    const caret = focused && document.activeElement.selectionStart;
    const typed = {}; $app.querySelectorAll('input[name],textarea[name]').forEach(el => { typed[el.name] = el.value; });
    let html;
    if (!S) html = home();
    else switch (S.phase) {
      case 'setup': html = isHost() ? (ui.hostStep === 'setup' && S.settings.topic ? setup() : topics()) : waitingForHost(); break;
      case 'lobby': html = lobby(); break;
      case 'writing': html = writing(); break;
      case 'voting': html = voting(); break;
      case 'decision': html = decision(); break;
      case 'verdict': html = verdict(); break;
      case 'c-deliberate': html = cDeliberate(); break;
      case 'c-vote': html = cVote(); break;
      case 'c-results': html = cResults(); break;
      case 'c-tip': html = cTip(); break;
      case 'results': html = S.results.mode === 'confession' ? cFinal() : results(); break;
      default: html = home();
    }
    $app.innerHTML = html;
    $app.querySelectorAll('input[name],textarea[name]').forEach(el => { if (typed[el.name] && !el.value) el.value = typed[el.name]; });
    if (focused) { const el = $app.querySelector(`[name="${focused}"]`); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} } }
    tick();
    afterRenderSpins();
  }

  function tick() {
    document.querySelectorAll('[data-deadline]').forEach(el => {
      const left = Math.max(0, Math.round((+el.dataset.deadline - (Date.now() + offset)) / 1000));
      el.querySelector('.t').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      el.classList.toggle('low', left <= 10);
    });
  }
  setInterval(tick, 250);

  // ---------- events ----------
  async function enter(kind) {
    const form = $app.querySelector('[data-form="join"]');
    const name = form.name.value.trim(); const code = form.code.value.trim().toUpperCase();
    ui.name = name; ui.code = code; localStorage.setItem('blasphemy-name', name);
    if (!name) return toast('Enter a name for the record.');
    if (kind === 'join' && code.length < 5) return toast('Enter the 5-letter docket no.');
    ui.busy = true;
    const res = await emit(kind === 'join' ? 'join' : 'create', { name, code });
    ui.busy = false;
    if (res.error) return toast(res.error);
    save({ code: res.code, playerId: res.playerId });
    ui.hostStep = 'topics';
    history.replaceState(null, '', '/');
  }

  $app.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.dataset.form;
    if (f === 'join') return enter('join');
    if (f === 'custom-topic') { const t = e.target.topic.value.trim(); if (!t) return; ui.customTopic = false; socket.emit('settings', { group: 'Custom', topic: t, sub: null }); ui.hostStep = 'setup'; return; }
    if (f === 'custom-sub') { const s = e.target.sub.value.trim(); if (!s) return; ui.customSub = false; socket.emit('settings', { sub: s }); return; }
    if (f === 'opinion') {
      const text = e.target.text.value.trim();
      const res = await emit('submitOpinion', { text });
      if (res.error) return toast(res.error);
      ui.draft = ''; ui.editing = false; render();
    }
  });

  $app.addEventListener('input', e => {
    if (e.target.name === 'text') { ui.draft = e.target.value; const c = $app.querySelector('[data-count]'); if (c) c.textContent = `${e.target.value.length}/200`; }
    if (e.target.name === 'code') e.target.value = e.target.value.toUpperCase();
  });

  $app.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'join-submit') { e.preventDefault(); return enter('join'); }
    if (a === 'create') return enter('create');
    if (a === 'rules') { ui.rules = true; return render(); }
    if (a === 'rules-close') { ui.rules = false; return render(); }
    if (a === 'pick-topic') { ui.pickTopic = b.dataset.topic; ui.pickGroup = b.dataset.group; return render(); }
    if (a === 'continue-topic') {
      const topic = ui.pickTopic || S.settings.topic; if (!topic) return;
      if (topic !== S.settings.topic) socket.emit('settings', { group: ui.pickGroup, topic, sub: null });
      ui.pickTopic = null; ui.hostStep = 'setup'; window.scrollTo(0, 0); return render();
    }
    if (a === 'surprise-sub') { const tp = findTopic(S.settings.topic); const subs = (tp ? tp.subs : []).filter(s => s !== S.settings.sub); if (subs.length) socket.emit('settings', { sub: subs[Math.floor(Math.random() * subs.length)] }); return; }
    if (a === 'pick-suspect') { ui.accusePick = b.dataset.id; return render(); }
    if (a === 'accuse') { if (!ui.accusePick) return; const r = await emit('vote', { suspectId: ui.accusePick }); if (r.error) toast(r.error); return; }
    if (a === 'cpick') { ui.cpick[b.dataset.key] = b.dataset.val; return render(); }
    if (a === 'lock-votes') {
      const v = ui.cpick, patch = { confessor: v.confessor, lock: true };
      if (S.settings.agreeOn) patch.stance = v.stance;
      if (!S.round.youAreDA) patch.da = v.da;
      const r = await emit('cvote', patch); if (r.error) toast(r.error); return;
    }
    if (a === 'da-hide') { ui.daSeen[roundKey()] = true; window.scrollTo(0, 0); return render(); }
    if (a === 'da-show') { delete ui.daSeen[roundKey()]; window.scrollTo(0, 0); return render(); }
    if (a === 'change-mode') { ui.nextStep = 'setup'; return socket.emit('newGame', { keepTopic: true }); }
    if (a === 'wildcard') { socket.emit('settings', { group: 'Wildcard', topic: 'Wildcard', sub: null }); ui.hostStep = 'setup'; return; }
    if (a === 'custom-topic') { ui.customTopic = !ui.customTopic; return render(); }
    if (a === 'to-topics') { ui.hostStep = 'topics'; return render(); }
    if (a === 'pick-sub') return socket.emit('settings', { sub: S.settings.sub === b.dataset.sub ? null : b.dataset.sub });
    if (a === 'custom-sub') { ui.customSub = !ui.customSub; return render(); }
    if (a === 'set') { const v = b.dataset.val; return socket.emit('settings', { [b.dataset.key]: v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v }); }
    if (a === 'set-mode') return socket.emit('settings', { mode: b.dataset.mode });
    if (a === 'tip') return socket.emit('tip', { choice: b.dataset.choice });
    if (a === 'open-court') return socket.emit('openCourt');
    if (a === 'edit-case') { ui.hostStep = 'setup'; return socket.emit('editCase'); }
    if (a === 'start') { const r = await emit('start'); if (r && r.error) toast(r.error); return; }
    if (a === 'edit-take') { ui.editing = true; ui.draft = S.myOpinion || ''; return render(); }
    if (a === 'advance') return socket.emit('advance');
    if (a === 'new-game') { ui.nextStep = 'topics'; ui.pickTopic = null; return socket.emit('newGame', { keepTopic: false }); }
    if (a === 'copy') { try { await navigator.clipboard.writeText(b.dataset.link); toast('Invite link copied'); } catch { toast(b.dataset.link); } return; }
    if (a === 'share') { try { await navigator.share({ title: 'Join my Blasphemy court', text: `Docket no. ${S.code}`, url: b.dataset.link }); } catch {} return; }
    if (a === 'leave-confirm' || a === 'leave') { socket.emit('leave'); save(null); S = null; ui.hostStep = 'topics'; return render(); }
  });

  // ---------- socket ----------
  socket.on('state', st => {
    const prevPhase = S && S.phase;
    S = st; offset = st.serverNow - Date.now();
    if (st.phase !== prevPhase) { ui.editing = false; ui.customSub = false; ui.customTopic = false; if (prevPhase) window.scrollTo(0, 0); }
    if (st.phase === 'setup' && prevPhase && prevPhase !== 'setup' && prevPhase !== 'lobby') { ui.hostStep = ui.nextStep || 'topics'; ui.nextStep = null; }
    if (st.phase === 'voting') { const k = roundKey(); if (ui.accuseKey !== k) { ui.accuseKey = k; ui.accusePick = null; } }
    render();
  });
  socket.on('connect', async () => {
    const sess = load();
    if (!sess) return render();
    const r = await emit('rejoin', sess);
    if (r.error) { save(null); S = null; render(); }
  });
  socket.on('disconnect', () => toast('Reconnecting…'));
  render();
})();
