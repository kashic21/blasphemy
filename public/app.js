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
    draft: '', busy: false, spunAt: {},
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
  };
  const cta = (label, action, { meta = '', box = '', ic = icon.arrow, disabled = false } = {}) =>
    `<button class="cta" data-a="${action}" ${disabled ? 'disabled' : ''}><span class="box ${box}">${ic}</span><span class="lbl">${esc(label)}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</button>`;
  const back = (label, action) => `<button class="back mono" data-a="${action}">${icon.back}<span>${esc(label)}</span></button>`;
  const head = (p, sm) => `<span class="chip-head ${sm ? 'sm' : ''}" style="background:${p.color}" aria-hidden="true">${esc(p.name[0] || '?')}</span>`;
  const person = p => `<span class="person">${head(p, true)}${esc(p.name)}</span>`;
  const mug = (p, { big = false, judge = false, button = '', on = false, off = false, rot = 0 } = {}) => {
    const inner = `${judge ? '<span class="judge">JUDGE</span>' : ''}<div class="chart"><div class="head" style="background:${p.color}">${esc(p.name[0] || '?')}</div></div><div class="name">${esc(p.name)}</div>`;
    const style = rot ? `style="transform:rotate(${rot}deg)"` : '';
    return button
      ? `<button class="mug ${big ? 'big' : ''} ${on ? 'on' : ''}" data-a="${button}" data-id="${p.id}" aria-pressed="${on}" ${style}>${inner}</button>`
      : `<div class="mug ${big ? 'big' : ''} ${off ? 'off' : ''}" ${style}>${inner}</div>`;
  };
  const counter = (label, n, total) => `<span class="mono counter">${label} <span class="n">${n}</span> / ${total}</span>`;
  const timerEl = () => S.deadline ? `<span class="timer" data-deadline="${S.deadline}">${icon.clock}<span class="t">0:00</span></span>` : '';
  const topicLine = () => [S.settings.topic, S.settings.sub].filter(Boolean).join(' · ');
  const rot = i => [-3, 2, -1.5, 2.5, -2, 1.5][i % 6];
  const MODES = { accusations: { name: 'Accusations', bg: 'var(--blue)', fg: '#fff' }, confession: { name: 'Confession', bg: 'var(--yellow)', fg: 'var(--ink)' } };
  const mode = () => MODES[(S && S.settings.mode) || 'accusations'];
  const modeBox = () => `<span class="box-tag" style="background:${mode().bg};color:${mode().fg};border-color:${mode().fg === '#fff' ? mode().bg : 'var(--ink)'}">${mode().name}</span>`;

  // ---------- screens ----------
  function home() {
    return `
      <div class="topbar"><span class="row mono"><span class="dot" style="background:#1E8F3A"></span>Court in session</span></div>
      <div class="stack center mt24" style="align-items:center;position:relative">
        <span class="tag" style="position:absolute;left:0;top:0;transform:rotate(-6deg)">HOT TAKES ONLY</span>
        <span class="tag" style="position:absolute;right:0;top:-8px;transform:rotate(5deg);background:var(--yellow)">NO APPEALS</span>
        <div class="hand mt20">the court of</div>
        <div class="logo-box mt4"><h1>BLASPHEMY</h1></div>
      </div>
      <p class="center" style="font-weight:700;font-size:28px;line-height:1.12;letter-spacing:-.02em;margin:28px 0 0">Say the unsayable.<br>Let the jury decide.</p>
      <form class="card soft inner stack gap12 mt24" data-form="join" style="padding:22px 18px 18px">
        <span class="tape" style="left:-10px;top:-8px;transform:rotate(-30deg)"></span>
        <span class="tape" style="right:-10px;top:-8px;transform:rotate(30deg);background:rgba(242,194,48,.7)"></span>
        <label class="field"><span class="mono">Your name, for the record</span><input class="input" name="name" maxlength="16" autocomplete="nickname" placeholder="e.g. Maya" value="${esc(ui.name)}" required></label>
        <label class="field"><span class="mono">Docket no.</span><input class="input code" name="code" maxlength="5" autocapitalize="characters" placeholder="ABCDE" value="${esc(ui.code)}"></label>
        ${cta('Enter the courtroom', 'join-submit', { disabled: ui.busy })}
      </form>
      <button class="btn yellow mt20" data-a="create">Open a new case</button>
      <div class="spacer"></div>
      <div class="hand center muted">rule no. 1 — no take is too hot.</div>`;
  }

  function waitingForJudge() {
    const host = P(S.hostId);
    return `
      ${topRoom()}
      <div class="stack center mt24" style="align-items:center">
        <div class="hand">all rise…</div>
        <h2 class="h1 mt4">${esc(host.name)} is choosing the case</h2>
        <p class="hand muted mt8">hang tight — the judge is picking a topic.</p>
      </div>
      <div class="mono mt24">The lineup · ${S.players.length}</div>
      <div class="grid3 mt12">${S.players.map((p, i) => mug(p, { judge: p.id === S.hostId, rot: rot(i), off: !p.connected })).join('')}</div>
      <div class="spacer"></div>
      <button class="linkbtn" data-a="leave">Leave court</button>`;
  }

  function topRoom(left) {
    return `<div class="topbar">${left || `<span class="mono">Docket <span class="pixel" style="font-size:22px">${esc(S.code)}</span></span>`}<span class="tag" style="transform:rotate(3deg);background:${mode().bg};color:${mode().fg}">${mode().name.toUpperCase()}</span></div>`;
  }

  function topics() {
    const st = S.settings;
    let n = 0;
    return `
      <div class="topbar">${back('Court', 'leave-confirm')}<span class="tag" style="background:var(--yellow);transform:rotate(3deg)">HOST ONLY</span></div>
      <div class="hand">what's on trial today?</div>
      <h1 class="h1">Pick a topic</h1>
      <div class="split mt12">
        <button data-a="custom-topic">${icon.plus}<span><span class="mono sm">Create your own</span><span class="sub">write your own prompt</span></span></button>
        <button data-a="wildcard">${icon.star}<span><span class="mono sm">Wildcard</span><span class="sub">say anything you want</span></span></button>
      </div>
      ${ui.customTopic ? `<form class="card inner stack gap8 mt12" data-form="custom-topic"><label class="field"><span class="mono">Your topic</span><input class="input" name="topic" maxlength="40" placeholder="e.g. Group projects" required autofocus></label><button class="btn dark">Use this topic</button></form>` : ''}
      ${TOPIC_GROUPS.map(g => `
        <section class="mt20" aria-label="${esc(g.name)}">
          <div class="row"><span class="glabel" style="background:${g.label};color:${g.labelText}">${esc(g.name)}</span><span class="hand muted grow" style="font-size:17px">${esc(g.sub)}</span><span class="mono sm muted">${g.topics.length} →</span></div>
          <div class="shelf mt8">
            ${g.topics.map(t => { n++; const on = st.topic === t.name; return `
              <button class="folder ${g.color === '#FFFFFF' ? 'white' : ''} ${on ? 'on' : ''}" style="--c:${g.color}" data-a="pick-topic" data-group="${esc(g.name)}" data-topic="${esc(t.name)}" aria-pressed="${on}">
                <div class="ftab"></div>
                <div class="fbody">
                  <div class="between"><span class="mono sm">Exhibit ${String(n).padStart(2, '0')}</span>${t.live ? '<span class="mono sm" style="color:var(--red)">● live</span>' : ''}${t.adult ? '<span class="mono sm" style="background:var(--ink);color:#fff;padding:0 4px">18+</span>' : ''}</div>
                  <div class="ftitle" style="${Math.max(...t.name.split(' ').map(w => w.length)) >= 9 || t.name.length > 14 ? 'font-size:19px' : ''}">${esc(t.name)}</div>
                  <div class="fblurb">${esc(t.blurb)}</div>
                </div>
              </button>`; }).join('')}
          </div>
        </section>`).join('')}
      <div class="spacer"></div>`;
  }

  function findTopic(name) { for (const g of TOPIC_GROUPS) for (const t of g.topics) if (t.name === name) return t; return null; }

  function setup() {
    const st = S.settings;
    const t = findTopic(st.topic);
    const subs = t ? t.subs : [];
    const chips = [`<button class="chip dark" data-a="custom-sub">+ Custom</button>`,
      `<button class="chip ${!st.sub ? 'on' : ''}" data-a="pick-sub" data-sub="">${!st.sub ? '✓ ' : ''}No sub-topic</button>`,
      ...subs.map(s => `<button class="chip ${st.sub === s ? 'on' : ''}" data-a="pick-sub" data-sub="${esc(s)}">${st.sub === s ? '✓ ' : ''}${esc(s)}</button>`)];
    if (st.sub && !subs.includes(st.sub)) chips.splice(2, 0, `<button class="chip on" data-a="pick-sub" data-sub="${esc(st.sub)}">✓ ${esc(st.sub)}</button>`);
    const seg = (key, opts, fmt) => `<div class="seg" role="group">${opts.map(o => `<button data-a="set" data-key="${key}" data-val="${o}" class="${String(st[key]) === String(o) ? 'on' : ''}" aria-pressed="${String(st[key]) === String(o)}">${fmt ? fmt(o) : o}</button>`).join('')}</div>`;
    return `
      <div class="topbar">${back('Topics', 'to-topics')}<span class="tag" style="transform:rotate(3deg)">NEW CASE</span></div>
      <div class="row gap12 mt8" style="align-items:flex-start">
        <div class="card soft" style="padding:8px 8px 0;width:168px;flex:none;transform:rotate(-3deg)">
          <span class="tape" style="left:55px;top:-9px"></span>
          <div style="height:112px;display:grid;place-items:center;background-color:var(--chart);background-image:repeating-linear-gradient(to bottom,transparent 0 17px,rgba(255,255,255,.14) 17px 18px);position:relative">
            <span class="mono sm" style="position:absolute;left:6px;top:6px;color:var(--tab)">Exhibit A</span>
            <span class="pixel" style="color:#fff;border:2px solid var(--red);padding:2px 10px;font-size:${(st.topic || '').length > 8 ? 26 : 42}px;text-align:center;max-width:140px;overflow-wrap:anywhere">${esc((st.topic || '').toUpperCase())}</span>
          </div>
          <div class="hand center" style="font-size:17px;padding:4px 0 6px">fig. 1 — the topic on trial</div>
        </div>
        <div class="stack gap8" style="padding-top:12px"><div class="hand" style="font-size:21px;line-height:1.05">Charge:<br><b>${esc(st.topic)} blasphemy</b></div></div>
      </div>
      <div class="mono mt20">Narrow the charges</div>
      <div class="hand muted" style="font-size:16px">optional · swipe for more</div>
      <div class="chips mt8">${chips.join('')}</div>
      ${ui.customSub ? `<form class="card inner stack gap8 mt8" data-form="custom-sub"><label class="field"><span class="mono">Custom sub-topic</span><input class="input" name="sub" maxlength="60" placeholder="e.g. Pineapple on pizza" required autofocus></label><button class="btn dark">Use it</button></form>` : ''}
      <div class="mono mt16">Choose proceedings</div>
      <div class="tabs mt8" role="tablist">
        <button class="${st.mode === 'accusations' ? 'on' : ''}" role="tab" aria-selected="${st.mode === 'accusations'}" data-a="set-mode" data-mode="accusations" style="background:var(--blue);color:#fff">Accusations</button>
        <button class="${st.mode === 'confession' ? 'on' : ''}" role="tab" aria-selected="${st.mode === 'confession'}" data-a="set-mode" data-mode="confession" style="background:var(--yellow)">Confession</button>
        <button role="tab" aria-selected="false" disabled style="background:var(--green)">Testimony<br><span style="font-size:8px">soon</span></button>
      </div>
      ${st.mode === 'confession' ? `
      <div class="panel yellow">
        <div class="between"><span class="mono sm">● Proceeding 02</span></div>
        <div style="font-weight:700;font-size:26px;letter-spacing:-.02em;margin-top:6px">Confession</div>
        <p style="font-size:14px;line-height:1.45;margin:6px 0 0">Everyone confesses an unpopular opinion or story — anonymously. Argue it out loud, vote agree or disagree in public, then secretly guess who confessed and who's the devil's advocate secretly defending it.</p>
        <div class="settings">
          <span class="mono sm">Settings</span>
          <div class="setting"><span><span class="mono">Round timer</span><br><span class="hand" style="font-size:15px">keeps deliberations moving</span></span>${seg('timerOn', [false, true], v => v ? 'On' : 'Off')}</div>
          ${st.timerOn ? `
          <div class="stack gap8"><span class="mono">Time to write</span>${seg('writeSeconds', [60, 90, 120, 180], v => v < 120 ? v + 's' : (v / 60) + 'm')}</div>
          <div class="stack gap8"><span class="mono">Time to argue + vote</span>${seg('voteSeconds', [30, 60, 90, 120], v => v < 120 ? v + 's' : '2m')}</div>` : ''}
          <div class="setting"><span><span class="mono">Reveal randomizer</span><br><span class="hand" style="font-size:15px">a wheel decides who gets unmasked</span></span>${seg('revealOn', [false, true], v => v ? 'On' : 'Off')}</div>
          ${st.revealOn ? `<div class="stack gap8"><span class="mono">Spin the wheel</span>${seg('revealWhen', ['round', 'end'], v => v === 'round' ? 'After each round' : 'End of game')}</div>
          <span class="hand" style="font-size:15px">${st.revealWhen === 'round' ? '6 slots, reveal · seal alternating, spun after every confession' : 'one spin decides for everyone — and the winner adds 2 slots their way'}</span>` : '<span class="hand" style="font-size:15px">off: everyone is unmasked at the end of the game</span>'}
        </div>
      </div>` : `
      <div class="panel blue">
        <div class="between"><span class="mono sm" style="color:#fff">● Proceeding 01</span></div>
        <div style="font-weight:700;font-size:26px;letter-spacing:-.02em;margin-top:6px">Accusations</div>
        <p style="font-size:14px;line-height:1.45;margin:6px 0 0">Everyone secretly files a hot take. One by one they take the stand — point a finger at who wrote it. Catch them for points, or slip past the jury for double.</p>
        <div class="settings">
          <span class="mono sm" style="color:#fff">Settings</span>
          <div class="setting"><span><span class="mono" style="color:#fff">Round timer</span><br><span class="hand" style="font-size:15px">keeps deliberations moving</span></span>${seg('timerOn', [false, true], v => v ? 'On' : 'Off')}</div>
          ${st.timerOn ? `
          <div class="stack gap8"><span class="mono" style="color:#fff">Time to write</span>${seg('writeSeconds', [60, 90, 120, 180], v => v < 120 ? v + 's' : (v / 60) + 'm')}</div>
          <div class="stack gap8"><span class="mono" style="color:#fff">Time per exhibit</span>${seg('voteSeconds', [30, 60, 90, 120], v => v < 120 ? v + 's' : '2m')}</div>` : ''}
        </div>
      </div>`}
      <div class="hand mt16" style="text-align:right">share the docket no. with your jury ↓</div>
      ${cta('Open court', 'open-court', { meta: S.code })}`;
  }

  function lobby() {
    const n = S.players.filter(p => p.connected).length;
    const open = Math.max(0, S.minPlayers - S.players.length);
    const link = `${location.origin}/?code=${S.code}`;
    return `
      <div class="topbar">${isHost() ? back('Case', 'edit-case') : `<span></span>`}<span class="row mono"><span class="dot" style="background:var(--red)"></span>Court assembling</span></div>
      <div class="pad mt8" style="transform:rotate(1deg)">
        <span class="tape" style="left:40%;top:-9px"></span>
        <div class="mono">Docket no.</div>
        <div class="pixel" style="font-size:64px;letter-spacing:.12em">${esc(S.code)}</div>
        <div class="hand">jurors enter this code to join</div>
        <div class="row mt8"><button class="btn small" data-a="copy" data-link="${esc(link)}">Copy link</button>${navigator.share ? `<button class="btn small dark" data-a="share" data-link="${esc(link)}">Send link</button>` : ''}</div>
      </div>
      <div class="row mt16" style="flex-wrap:wrap"><span class="box-tag">${esc(S.settings.topic)}</span>${S.settings.sub ? `<span class="box-tag">${esc(S.settings.sub)}</span>` : ''}${modeBox()}${S.settings.timerOn ? `<span class="box-tag">⏱ timer on</span>` : ''}</div>
      <div class="between mt20"><span class="mono">The lineup</span><span><span class="pixel" style="font-size:22px">${n}/${S.maxPlayers}</span> <span class="mono sm">jurors</span></span></div>
      <div class="grid3 mt12">${S.players.map((p, i) => mug(p, { judge: p.id === S.hostId, rot: rot(i), off: !p.connected })).join('')}${Array.from({ length: open }, () => '<div class="seat">seat open</div>').join('')}</div>
      <div class="spacer"></div>
      ${isHost()
        ? `<div class="hand center">${n < S.minPlayers ? `need ${S.minPlayers - n} more juror${S.minPlayers - n > 1 ? 's' : ''} to begin` : "all rise when you're ready"}</div>${cta('Begin proceedings', 'start', { box: 'red', ic: icon.gavel, disabled: n < S.minPlayers })}`
        : `<div class="hand center">waiting for ${esc(P(S.hostId).name)} to begin…</div>`}
      <button class="linkbtn center" data-a="leave">Leave court</button>`;
  }

  function writing() {
    const filed = !!S.myOpinion && !ui.editing;
    const n = S.players.filter(p => p.connected).length;
    return `
      <div class="topbar"><span class="mono">File your take</span>${timerEl()}</div>
      <div class="row mt8">${modeBox()}<span class="mono sm">${esc(topicLine())}</span></div>
      ${filed ? `
        <div class="pad mt20"><span class="tape" style="left:-10px;top:-4px;transform:rotate(28deg)"></span>
          <div class="mono">Filed under seal</div>
          <p style="font-weight:700;font-size:24px;line-height:1.15;margin:8px 0 0">“${esc(S.myOpinion)}”</p>
          <div class="hand mt8">— that's yours. don't tell anyone.</div></div>
        <button class="linkbtn mt8" data-a="edit-take">Edit my take</button>
        <div class="stack center mt24" style="align-items:center"><div class="pixel" style="font-size:48px">${S.submittedCount}/${n}</div><div class="mono">takes filed</div>
        <div class="heads mt12">${S.players.filter(p => p.connected).map(p => `<span style="opacity:${p.submitted ? 1 : .35}">${head(p)}</span>`).join('')}</div></div>
        <div class="spacer"></div>
        ${isHost() && S.submittedCount >= 2 ? cta('Close filing early', 'advance', { box: 'red', meta: `${S.submittedCount}/${n}` }) : '<div class="hand center muted">waiting for the rest of the jury…</div>'}`
      : `
        <h2 class="h1 mt20">${S.settings.mode === 'confession' ? 'What do you need to confess?' : "What's your unpopular opinion?"}</h2>
        <p class="hand muted" style="margin:4px 0 0">about <b>${esc(topicLine() || 'anything')}</b> — it's anonymous… for now.</p>
        <form class="stack gap8 mt16" data-form="opinion">
          <label class="sr" for="op">Your opinion</label>
          <textarea id="op" class="input" name="text" maxlength="200" placeholder="Grapes are better frozen than fresh." required>${esc(ui.draft || S.myOpinion || '')}</textarea>
          <div class="between"><span class="hand muted" style="font-size:16px">${S.settings.mode === 'confession' ? 'an unpopular opinion or a story time — stays anonymous' : 'the jury will try to guess it was you'}</span><span class="mono sm" data-count>${(ui.draft || S.myOpinion || '').length}/200</span></div>
          <div class="spacer"></div>
          ${cta(S.myOpinion ? 'Re-file my take' : 'File my take', 'opinion-submit', { box: 'red', ic: icon.gavel })}
        </form>`}`;
  }

  function voting() {
    const r = S.round;
    const suspects = S.players.filter(p => p.id !== S.you);
    const total = S.players.filter(p => p.connected).length;
    return `
      <div class="topbar">${counter('Exhibit', r.index + 1, r.total)}${timerEl()}</div>
      <div class="row mt8">${modeBox()}<span class="mono sm">${esc(topicLine())}</span></div>
      <div class="pad mt16" style="transform:rotate(1deg)">
        <span class="tape" style="left:-12px;top:-2px;transform:rotate(28deg)"></span><span class="tape" style="right:-12px;top:-2px;transform:rotate(-28deg)"></span>
        <div class="mono">The take on trial</div>
        <p style="font-weight:700;font-size:28px;line-height:1.1;letter-spacing:-.02em;margin:8px 0 0">“${esc(r.text)}”</p>
        <div class="hand mt8">— filed anonymously</div>
      </div>
      ${r.yours ? `<div class="sticky mt16" style="background:var(--yellow);transform:rotate(-2deg);align-self:flex-start">this one's yours — act natural & accuse someone else</div>` : ''}
      <h2 class="h2 mt20">Who in this courtroom actually believes this?</h2>
      <div class="hand muted" style="font-size:18px">discuss out loud, then point your finger.</div>
      <div class="grid2 mt12">${suspects.map(p => {
        const on = S.myVote === p.id;
        return `<div style="position:relative">${mug(p, { button: 'vote', on })}${on ? '<span class="stamp sm" style="position:absolute;left:50%;top:34px;transform:translateX(-50%) rotate(-12deg)">ACCUSED</span>' : ''}</div>`;
      }).join('')}</div>
      <div class="spacer"></div>
      <div class="between mt16"><span class="mono">${S.votedCount}/${total} votes in</span>${S.myVote ? `<span class="mono" style="color:var(--red)">you accused ${esc(P(S.myVote).name)}</span>` : ''}</div>
      ${isHost() ? `<div class="mt8">${cta('Close voting', 'advance', { box: 'red', meta: `${S.votedCount}/${total}` })}</div>` : ''}`;
  }

  function decision() {
    const d = S.decision; const max = Math.max(1, ...d.tally.map(t => t.voters.length));
    const tie = d.top.length > 1;
    return `
      <div class="topbar"><span class="mono">The jury has decided</span>${counter('Exhibit', S.round.index + 1, S.round.total)}</div>
      <p class="hand" style="font-weight:700;font-size:26px;line-height:1.05;margin:8px 0 0">“${esc(S.round.text)}”</p>
      <div class="between mt20"><span class="mono">The votes</span>${d.top.length ? `<span class="stamp sm ${tie ? 'blue' : ''}" style="transform:rotate(-4deg)">${tie ? 'IT’S A TIE' : 'MOST ACCUSED: ' + esc(P(d.top[0]).name.toUpperCase())}</span>` : ''}</div>
      <div class="list mt8">${d.tally.length ? d.tally.map(t => `
        <div class="stack gap4">
          <div class="row">${head(P(t.id))}<span class="hand" style="font-weight:700;font-size:20px;width:80px;overflow:hidden;text-overflow:ellipsis">${esc(P(t.id).name)}</span><div class="bar ${d.top.includes(t.id) ? 'hot' : ''}"><i style="width:${t.voters.length / max * 100}%"></i></div><span class="pixel" style="font-size:24px;width:20px;text-align:right">${t.voters.length}</span></div>
          <div class="row" style="flex-wrap:wrap;gap:4px;padding-left:38px"><span class="mono sm muted">accused by</span>${t.voters.map(v => `<span class="person" style="font-size:15px">${head(P(v), true)}${esc(P(v).name)}</span>`).join('')}</div>
        </div>`).join('') : '<div class="hand muted">nobody voted. bold.</div>'}</div>
      <div class="spacer"></div>
      ${isHost() ? cta(tie ? "Reveal the verdict" : `${P(d.top[0] || '').name}'s verdict`, 'advance', { box: 'red', ic: icon.gavel }) : '<div class="hand center">the judge will reveal the verdict…</div>'}`;
  }

  function verdict() {
    const v = S.verdict; const r = S.round;
    const tie = v.top.length !== 1;
    const subject = v.caught ? P(v.authorId) : (!tie ? P(v.top[0]) : null);
    const lastRound = r.index + 1 >= r.total;
    const awards = v.awards.map(a => a.id ? `<div class="row">${head(P(a.id))}<span class="hand" style="font-weight:700;font-size:20px">${esc(P(a.id).name)}</span><span class="mono sm muted grow">${esc(a.why)}</span><span class="pixel" style="font-size:26px">+${a.pts}</span></div>`
      : `<div class="row"><span class="chip-head" style="background:var(--tab)">?</span><span class="hand" style="font-weight:700;font-size:20px">???</span><span class="mono sm muted grow">${esc(a.why)}</span><span class="pixel" style="font-size:26px">+${a.pts}</span></div>`).join('');
    return `
      <div class="topbar"><span class="mono">The suspect verdict</span>${counter('Exhibit', r.index + 1, r.total)}</div>
      <div style="position:relative;min-height:${subject ? 220 : 120}px;margin-top:8px">
        ${subject ? `<div style="width:170px;margin-left:16px">${mug(subject, { rot: -3 })}</div>` : ''}
        <div style="position:absolute;right:0;top:${subject ? 40 : 10}px;transform:rotate(${v.caught ? 12 : -10}deg)">
          ${v.caught ? '<span class="stamp">GUILTY<small>OF BLASPHEMY</small></span>' : tie ? '<span class="stamp blue">HUNG JURY<small>NOBODY CONVICTED</small></span>' : '<span class="stamp blue" style="font-size:44px">NOT GUILTY<small>BLASPHEMER AT LARGE</small></span>'}
        </div>
      </div>
      <h2 class="h2 mt8">${v.caught ? `${esc(subject.name)} wrote it. Guilty as charged.` : tie ? 'The jury couldn’t agree.' : `${esc(subject.name)} didn’t write this one.`}</h2>
      <p class="hand" style="font-weight:700;font-size:24px;line-height:1.05;margin:4px 0 0">“${esc(r.text)}”</p>
      ${!v.caught ? `<div class="card inner row gap12 mt16" style="background:var(--pad);border-style:dashed"><span class="chip-head" style="width:44px;height:44px;background:var(--red);color:#fff;font-size:26px">?</span><span><b>Identity sealed.</b><br><span style="font-size:13px">The real blasphemer slipped past the jury. Revealed at the end of the game.</span></span></div>` : ''}
      <div class="mono mt20">Points awarded</div>
      <div class="list mt8">${awards || '<div class="hand muted">no points this round</div>'}</div>
      <div class="spacer"></div>
      ${isHost() ? cta(lastRound ? 'See the truth' : 'Next exhibit', 'advance', { meta: lastRound ? '' : `${r.index + 2}/${r.total}` }) : '<div class="hand center">waiting for the judge…</div>'}`;
  }

  function results() {
    const sorted = S.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted.length ? sorted[0].score : 0;
    const winners = sorted.filter(p => p.score === top);
    let rank = 0, prev = null;
    return `
      <div class="topbar"><span class="row mono"><span class="dot"></span>Case closed</span><span class="mono"><span class="pixel" style="font-size:22px">${S.results.reveal.length}</span> exhibits</span></div>
      <div class="hand">the court is adjourned…</div>
      <h1 class="h1" style="font-size:34px">The truth, revealed.</h1>
      <div class="mt16" style="background:var(--ink);padding:16px;position:relative">
        <div class="mono sm center" style="color:var(--yellow)">${winners.length > 1 ? 'Winners · tie for first' : 'Winner'}</div>
        <div class="row mt12" style="justify-content:center;gap:16px">${winners.slice(0, 3).map((p, i) => `<div class="stack gap8" style="width:110px;align-items:center">${mug(p, { rot: i % 2 ? 3 : -3 })}<span class="pixel" style="color:#fff;font-size:30px">${p.score} PTS</span></div>`).join('')}</div>
      </div>
      <div class="mono mt20">Final standings</div>
      <div class="list mt8">${sorted.map((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; } return `<div class="row" style="${p.score === top ? 'background:rgba(242,194,48,.25)' : ''}"><span class="pixel" style="font-size:26px;width:18px">${rank}</span>${head(p)}<span class="hand grow" style="font-weight:700;font-size:20px">${esc(p.name)}${p.id === S.you ? ' (you)' : ''}</span><span class="pixel" style="font-size:26px">${p.score}</span></div>`; }).join('')}</div>
      <div class="mono mt20">Who said what</div>
      <div class="hand muted" style="font-size:16px">all ${S.results.reveal.length} exhibits · swipe for more</div>
      <div class="hscroll mt8">${S.results.reveal.map(x => `
        <div class="exhibit"><div class="between"><span class="mono sm">Exhibit ${String(x.n).padStart(2, '0')}</span><span class="box-tag" style="background:${x.caught ? 'var(--red)' : 'var(--mint)'};color:${x.caught ? '#fff' : 'var(--ink)'}">${x.caught ? 'Caught' : 'Escaped'}</span></div>
        <b style="font-size:15px;line-height:1.25">“${esc(x.text)}”</b><div class="spacer" style="min-height:4px"></div><span class="hand" style="font-weight:700">— ${esc(P(x.authorId).name)}</span></div>`).join('')}</div>
      <div class="spacer"></div>
      <div class="hand center muted">the court stays in session — same lobby, same jury</div>
      ${isHost() ? cta('New case', 'new-game', { ic: icon.gavel, box: 'red' }) : `<div class="hand center">waiting for ${esc(P(S.hostId).name)} to open a new case…</div>`}
      <button class="linkbtn center" data-a="leave">Leave court</button>`;
  }

  // ---------- Confession mode ----------
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
  // index null = idle wheel; otherwise it spins once and lands that slot under the pointer (3 o'clock)
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
  const chipList = (ids, empty = 'nobody') => ids.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${ids.map(id => person(P(id))).join('')}</div>` : `<span class="hand muted" style="font-size:16px">${empty}</span>`;
  const daPill = id => `<span class="person" style="background:var(--ink);color:#fff;border-color:var(--red)">${icon.mask}${head(P(id), true)}${esc(P(id).name)}</span>`;
  const step = (n, title, note) => `<div class="row gap12"><span class="chip-head" style="background:var(--ink);color:#fff">${n}</span><span><span class="mono">${title}</span><br><span class="hand muted" style="font-size:16px">${note}</span></span></div>`;

  function cDeliberate() {
    const r = S.round;
    return `
      <div class="topbar">${counter('Confession', r.index + 1, r.total)}${timerEl()}</div>
      <div class="row mt8">${modeBox()}<span class="mono sm">${esc(topicLine())}</span></div>
      <div class="card shadow mt16">
        <div class="between" style="background:var(--ink);color:#fff;padding:8px 14px"><span class="mono sm">Anonymous confession</span><span class="mono sm" style="color:var(--yellow)">╳╳╳╳</span></div>
        <div class="inner" style="padding:18px 16px">
          <p style="font-weight:700;font-size:28px;line-height:1.1;letter-spacing:-.02em;margin:0">“${esc(r.text)}”</p>
          <div class="hand muted mt8">— someone in this room</div>
        </div>
      </div>
      ${r.yours ? `<div class="sticky mt12" style="background:var(--yellow);transform:rotate(-2deg);align-self:flex-start">this one's yours — act natural</div>` : ''}
      ${r.youAreDA ? `
        <div class="mt16" style="background:var(--ink);color:#fff;padding:18px 16px;box-shadow:5px 5px 0 var(--red);position:relative">
          <span class="stamp sm" style="position:absolute;right:10px;top:-14px;transform:rotate(-8deg);background:var(--ink)">TOP SECRET</span>
          <div class="mono sm" style="color:var(--yellow)">Only you can see this</div>
          <div style="font-weight:700;font-size:24px;letter-spacing:-.02em;margin-top:6px">You're the devil's advocate.</div>
          <p style="font-size:14px;line-height:1.45;margin:6px 0 0;color:var(--tab)">Defend this confession like your life depends on it — even if you think it's ridiculous. +1 for every juror who votes agree. Don't tell anyone${r.yours ? ' — and yes, it might be yours' : ''}.</p>
        </div>` : `
        <div class="card inner mt16" style="border:1.5px dashed var(--red);background:transparent">
          <span class="box-tag" style="background:var(--ink);color:#fff;border-color:var(--red)">${icon.mask} Devil's advocate</span>
          <div style="font-weight:700;font-size:16px;margin-top:8px">One of you was secretly told to defend this.</div>
          <div class="hand muted" style="font-size:17px">they could even be the confessor. stay suspicious.</div>
        </div>`}
      <div class="mono mt20">Deliberate out loud</div>
      <div class="hand" style="font-size:21px">agree? disagree? argue it out irl.</div>
      <div class="heads mt8">${S.players.filter(p => p.connected).map(p => head(p)).join('')}</div>
      <div class="spacer"></div>
      ${isHost() ? cta('Open voting', 'advance', { meta: 'HOST' }) : '<div class="hand center">voting opens when the judge says so…</div>'}`;
  }

  function cVote() {
    const r = S.round, v = S.myCVote || {};
    const others = S.players.filter(p => p.id !== S.you);
    const total = S.players.filter(p => p.connected).length;
    const picks = key => `<div class="grid4 mt8">${others.map(p => `<button class="pick ${v[key] === p.id ? 'on' : ''}" data-a="cvote" data-key="${key}" data-val="${p.id}" aria-pressed="${v[key] === p.id}">${head(p)}<span>${esc(p.name)}</span></button>`).join('')}</div>`;
    const done = v.stance && v.confessor && (v.da || r.youAreDA);
    return `
      <div class="topbar">${counter('Confession', r.index + 1, r.total)}${timerEl()}</div>
      <div class="pad mt8"><div class="mono sm">On trial</div><b style="font-size:19px;line-height:1.2;display:block;margin-top:4px">“${esc(r.text)}”</b></div>
      <div class="mt20">${step(1, 'Public vote', 'everyone sees this')}</div>
      <div class="row mt8 gap12">
        <button class="vote-btn agree ${v.stance === 'agree' ? 'on' : ''}" data-a="cvote" data-key="stance" data-val="agree" aria-pressed="${v.stance === 'agree'}"><span class="pixel" style="font-size:30px">AGREE</span></button>
        <button class="vote-btn disagree ${v.stance === 'disagree' ? 'on' : ''}" data-a="cvote" data-key="stance" data-val="disagree" aria-pressed="${v.stance === 'disagree'}"><span class="pixel" style="font-size:30px">DISAGREE</span></button>
      </div>
      <div class="mt20">${step(2, 'Secret guess', 'who confessed? only you see this · +1 if right')}</div>
      ${picks('confessor')}
      ${r.youAreDA ? `<div class="card inner mt20" style="border-style:dashed"><span class="hand" style="font-size:17px">you're the devil's advocate — no third vote for you.</span></div>`
        : `<div class="mt20">${step(3, "Spot the devil's advocate", 'anonymous · +1 if right')}</div>${picks('da')}`}
      <div class="spacer"></div>
      <div class="between mt16"><span class="mono">${S.doneCount}/${total} jurors locked in</span>${done ? '<span class="mono" style="color:var(--green)">✓ you\'re done</span>' : ''}</div>
      ${isHost() ? `<div class="mt8">${cta('Close voting', 'advance', { box: 'red', meta: `${S.doneCount}/${total}` })}</div>` : ''}`;
  }

  function cResults() {
    const r = S.cresult, rd = S.round, n = r.agree.length + r.disagree.length || 1;
    const verdict = r.agree.length > r.disagree.length ? 'THE JURY AGREES' : r.agree.length < r.disagree.length ? 'THE JURY DISAGREES' : 'SPLIT DECISION';
    const key = `round-${rd.index}-${rd.text.length}`;
    const last = rd.index + 1 >= rd.total;
    const spun = r.spin && !spinning(key);
    let reveal = '';
    if (r.spin && spun && r.revealed) reveal = `
      <div class="card inner stack gap12 mt16">
        <span class="mono sm" style="color:var(--red)">Unmasked</span>
        <div class="row">${head(P(r.authorId))}<b style="font-size:18px">${esc(P(r.authorId).name)} confessed.</b></div>
        <div class="stack gap4"><span class="mono sm muted">Guessed right</span>${chipList(r.confRight)}</div>
        <div class="stack gap4"><span class="mono sm" style="color:var(--red)">Devil's advocate</span>${daPill(r.daId)}</div>
        <div class="stack gap4"><span class="mono sm muted">Spotted the devil's advocate</span>${chipList(r.daRight)}</div>
      </div>
      <div class="mono mt16">Points this round</div>
      <div class="list mt8">${r.awards.length ? r.awards.map(a => `<div class="row">${head(P(a.id))}<span class="hand" style="font-weight:700;font-size:19px">${esc(P(a.id).name)}</span><span class="mono sm muted grow">${esc(a.why)}</span><span class="pixel" style="font-size:24px">+${a.pts}</span></div>`).join('') : '<div class="hand muted">no points this round</div>'}</div>`;
    else if (r.spin && spun) reveal = `<div class="card inner row gap12 mt16" style="background:var(--pad);border-style:dashed"><span class="chip-head" style="width:44px;height:44px;background:var(--red);color:#fff;font-size:24px">?</span><span><b>The confessor stays anonymous.</b><br><span style="font-size:13px">Secret guesses and the devil's advocate stay locked. Points still count — you just won't know who earned them.</span></span></div>`;
    else if (!r.spin) reveal = `<div class="card inner mt16" style="background:var(--pad);border-style:dashed"><b>Identities stay hidden for now.</b><br><span style="font-size:13px">${S.settings.revealOn ? 'At the end of the game the winner tips the wheel — one spin decides if everyone gets unmasked.' : 'Everyone gets unmasked at the end of the game.'}</span></div>`;
    return `
      <div class="topbar"><span class="mono">The jury has spoken</span>${counter('Confession', rd.index + 1, rd.total)}</div>
      <p class="hand" style="font-weight:700;font-size:26px;line-height:1.05;margin:8px 0 0">“${esc(rd.text)}”</p>
      <div class="between mt16"><span class="mono">Public vote</span><span class="tag" style="background:var(--yellow);transform:rotate(3deg)">${verdict}</span></div>
      <div class="split-bar mt8">
        <div style="flex:${Math.max(r.agree.length, .001)};background:var(--mint)"><span class="pixel" style="font-size:40px">${r.agree.length}</span> <span class="mono sm">Agree</span><div class="heads mt4">${r.agree.map(id => head(P(id), true)).join('')}</div></div>
        <div style="flex:${Math.max(r.disagree.length, .001)};background:var(--pink)"><span class="pixel" style="font-size:40px">${r.disagree.length}</span> <span class="mono sm">Disagree</span><div class="heads mt4">${r.disagree.map(id => head(P(id), true)).join('')}</div></div>
      </div>
      ${r.spin ? `
        <div class="mono mt20">Reveal randomizer · 6 slots</div>
        <div class="row gap16 mt8">${wheel(r.spin.slots, r.spin.index, key)}<div class="stack"><span class="hand muted">the wheel says…</span><span class="pixel" style="font-size:48px;color:${spun ? (r.revealed ? 'var(--red)' : 'var(--ink)') : 'var(--tab)'}">${spun ? (r.revealed ? 'REVEAL' : 'SEALED') : '…'}</span></div></div>` : ''}
      ${reveal}
      <div class="spacer"></div>
      ${isHost() ? cta(last ? (S.settings.revealOn && S.settings.revealWhen === 'end' ? 'Final spin' : 'See the results') : 'Next confession', 'advance', { meta: last ? '' : `${rd.index + 2}/${rd.total}` }) : '<div class="hand center">waiting for the judge…</div>'}`;
  }

  function cTip() {
    const w = P(S.tip.winnerId), amWinner = S.you === S.tip.winnerId, canTip = amWinner || (isHost() && !w.connected);
    return `
      <div class="topbar"><span class="row mono"><span class="dot"></span>All confessions heard</span></div>
      <div class="hand">one last thing…</div>
      <h1 class="h1">The final spin</h1>
      <div class="mt16" style="background:var(--ink);color:#fff;padding:16px">
        <div class="row gap16"><div style="width:110px">${mug(w, { rot: -3 })}</div><div class="stack"><span class="mono sm" style="color:var(--yellow)">Winning so far</span><span class="pixel" style="font-size:44px">${S.tip.score} PTS</span><span class="hand" style="color:var(--tab);font-size:17px">${esc(w.name)} gets to tip the wheel</span></div></div>
      </div>
      <div class="row gap16 mt20" style="justify-content:center">${wheel(['R', 'S', 'R', 'S', 'R', 'S'], null, null, 170)}</div>
      <p class="center" style="font-size:15px;line-height:1.45">${amWinner ? 'Pick a side — 2 slots get added your way, then the wheel decides whether every confessor gets unmasked.' : canTip ? `${esc(w.name)} left — as judge, you tip it for them.` : `Waiting for ${esc(w.name)} to tip the wheel…`}</p>
      <div class="spacer"></div>
      ${canTip ? `<div class="row gap12"><button class="btn grow" data-a="tip" data-choice="seal" style="min-height:64px;flex-direction:column;gap:0">Keep them hidden<span class="hand" style="text-transform:none;letter-spacing:0;font-size:16px">+2 seal slots</span></button><button class="btn yellow grow" data-a="tip" data-choice="reveal" style="min-height:64px;flex-direction:column;gap:0;font-size:15px">Reveal everything<span class="hand" style="font-size:16px">+2 reveal slots</span></button></div>` : ''}`;
  }

  function standings() {
    const sorted = S.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted.length ? sorted[0].score : 0; let rank = 0, prev = null;
    const winners = sorted.filter(p => p.score === top);
    return `
      <div class="mt16" style="background:var(--ink);padding:16px">
        <div class="mono sm center" style="color:var(--yellow)">${winners.length > 1 ? 'Winners · tie for first' : 'Winner'}</div>
        <div class="row mt12" style="justify-content:center;gap:16px">${winners.slice(0, 3).map((p, i) => `<div class="stack gap8" style="width:110px;align-items:center">${mug(p, { rot: i % 2 ? 3 : -3 })}<span class="pixel" style="color:#fff;font-size:30px">${p.score} PTS</span></div>`).join('')}</div>
      </div>
      <div class="mono mt20">Final standings</div>
      <div class="list mt8">${sorted.map((p, i) => { if (p.score !== prev) { rank = i + 1; prev = p.score; } return `<div class="row" style="${p.score === top ? 'background:rgba(242,194,48,.25)' : ''}"><span class="pixel" style="font-size:26px;width:18px">${rank}</span>${head(p)}<span class="hand grow" style="font-weight:700;font-size:20px">${esc(p.name)}${p.id === S.you ? ' (you)' : ''}</span><span class="pixel" style="font-size:26px">${p.score}</span></div>`; }).join('')}</div>`;
  }

  function cFinal() {
    const res = S.results, fs = res.finalSpin;
    const spun = !fs || !spinning('final');
    return `
      <div class="topbar"><span class="row mono"><span class="dot"></span>Case closed</span><span class="mono"><span class="pixel" style="font-size:22px">${res.reveal.length}</span> confessions</span></div>
      <div class="hand">the court is adjourned…</div>
      <h1 class="h1" style="font-size:32px">The confessions, revealed?</h1>
      ${fs ? `<div class="mt16" style="background:var(--ink);color:#fff;padding:16px">
        <div class="mono sm" style="color:var(--yellow)">${esc(P(fs.by).name)} tipped it toward ${fs.choice === 'reveal' ? 'reveal' : 'seal'} · 8 slots</div>
        <div class="row gap16 mt12">${wheel(fs.slots, fs.index, 'final', 130)}<div class="stack"><span class="hand" style="color:var(--tab)">the wheel says…</span><span class="pixel" style="font-size:46px;color:${spun ? (fs.revealed ? 'var(--red)' : 'var(--yellow)') : 'var(--muted)'}">${spun ? (fs.revealed ? 'REVEAL' : 'SEALED') : '…'}</span></div></div>
      </div>` : ''}
      ${spun ? `
      ${standings()}
      <div class="mono mt20">The confessions</div>
      <div class="hand muted" style="font-size:16px">who confessed, who called it, and the devil's advocate · swipe</div>
      <div class="hscroll wide mt8">${res.reveal.map(x => `
        <div class="exhibit gap8">
          <span class="mono sm">Confession ${String(x.n).padStart(2, '0')}</span>
          <b style="font-size:15px;line-height:1.25">“${esc(x.text)}”</b>
          ${x.revealed ? `
            <div class="row">${head(P(x.authorId))}<span class="hand" style="font-weight:700">confessed by ${esc(P(x.authorId).name)}</span></div>
            <div class="stack gap4"><span class="mono sm muted">Guessed right</span>${chipList(x.confRight)}</div>
            <hr style="border:0;border-top:1.5px solid rgba(0,0,0,.15);width:100%;margin:2px 0">
            <div class="stack gap4"><span class="mono sm" style="color:var(--red)">Devil's advocate</span>${daPill(x.daId)}</div>
            <div class="stack gap4"><span class="mono sm muted">Spotted by</span>${chipList(x.daRight)}</div>`
          : `<div class="card inner" style="background:transparent;border-style:dashed"><b>Sealed.</b> <span class="hand">this one stays anonymous forever.</span></div>`}
          <span class="mono sm muted">${x.agree} agreed · ${x.disagree} disagreed</span>
        </div>`).join('')}</div>
      <div class="spacer"></div>
      <div class="hand center muted">the court stays in session — same lobby, same jury</div>
      ${isHost() ? cta('New case', 'new-game', { ic: icon.gavel, box: 'red' }) : `<div class="hand center">waiting for ${esc(P(S.hostId).name)} to open a new case…</div>`}
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
      case 'setup': html = isHost() ? (ui.hostStep === 'setup' && S.settings.topic ? setup() : topics()) : waitingForJudge(); break;
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
    if (a === 'pick-topic') { socket.emit('settings', { group: b.dataset.group, topic: b.dataset.topic, sub: null }); ui.hostStep = 'setup'; window.scrollTo(0, 0); return; }
    if (a === 'wildcard') { socket.emit('settings', { group: 'Wildcard', topic: 'Wildcard', sub: null }); ui.hostStep = 'setup'; return; }
    if (a === 'custom-topic') { ui.customTopic = !ui.customTopic; return render(); }
    if (a === 'to-topics') { ui.hostStep = 'topics'; return render(); }
    if (a === 'pick-sub') return socket.emit('settings', { sub: b.dataset.sub || null });
    if (a === 'custom-sub') { ui.customSub = !ui.customSub; return render(); }
    if (a === 'set') { const v = b.dataset.val; return socket.emit('settings', { [b.dataset.key]: v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v }); }
    if (a === 'set-mode') return socket.emit('settings', { mode: b.dataset.mode });
    if (a === 'cvote') { const r = await emit('cvote', { [b.dataset.key]: b.dataset.val }); if (r.error) toast(r.error); return; }
    if (a === 'tip') return socket.emit('tip', { choice: b.dataset.choice });
    if (a === 'open-court') return socket.emit('openCourt');
    if (a === 'edit-case') { ui.hostStep = 'setup'; return socket.emit('editCase'); }
    if (a === 'start') { const r = await emit('start'); if (r && r.error) toast(r.error); return; }
    if (a === 'edit-take') { ui.editing = true; ui.draft = S.myOpinion || ''; return render(); }
    if (a === 'vote') { const r = await emit('vote', { suspectId: b.dataset.id }); if (r.error) toast(r.error); return; }
    if (a === 'advance') return socket.emit('advance');
    if (a === 'new-game') { ui.hostStep = 'topics'; return socket.emit('newGame'); }
    if (a === 'copy') { try { await navigator.clipboard.writeText(b.dataset.link); toast('Invite link copied'); } catch { toast(b.dataset.link); } return; }
    if (a === 'share') { try { await navigator.share({ title: 'Join my Blasphemy court', text: `Docket no. ${S.code}`, url: b.dataset.link }); } catch {} return; }
    if (a === 'leave-confirm' || a === 'leave') { socket.emit('leave'); save(null); S = null; ui.hostStep = 'topics'; return render(); }
  });

  // ---------- socket ----------
  socket.on('state', st => {
    const prevPhase = S && S.phase;
    S = st; offset = st.serverNow - Date.now();
    if (st.phase !== prevPhase) { ui.editing = false; ui.customSub = false; ui.customTopic = false; if (prevPhase) window.scrollTo(0, 0); }
    if (st.phase === 'setup' && prevPhase && prevPhase !== 'setup') ui.hostStep = 'topics';
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
