// Blasphemy — game server (Accusations + Confession modes)
// All game logic lives here so secrets (who wrote what, who voted for whom
// before the reveal) never reach players' phones early.

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const OPINION_MAX = 200;
const NAME_MAX = 16;
const POINTS_CORRECT_GUESS = 1; // accuser guessed the blasphemer
const POINTS_EVADED = 2;        // blasphemer slipped past the jury
// Confession mode
const POINTS_GUESS_CONFESSOR = 1;  // secretly guessed who confessed
const POINTS_SPOT_DA = 1;          // secretly spotted the devil's advocate
const POINTS_DA_PER_FOOLED = 1;    // devil's advocate, per juror who accused THEM of being the confessor
const WHEEL_BASE = ['R', 'S', 'R', 'S', 'R', 'S'];            // 6 alternating slots
const WHEEL_TIPPED = { reveal: ['R', 'S', 'R', 'R', 'S', 'R', 'S', 'R'], seal: ['S', 'R', 'S', 'S', 'R', 'S', 'R', 'S'] };
const ROOM_IDLE_MS = 30 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const COLORS = ['#F2C230', '#FF8FB8', '#A8DDC6', '#B9C6F5', '#F7A35C', '#C9A7F2', '#8FD3F4', '#E8E07A', '#F2A7A7', '#9BE3B5', '#D9D6CC', '#FFC4E1'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const newId = () => crypto.randomBytes(8).toString('hex');
function makeCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join(''); }
  while (rooms.has(c));
  return c;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function createRoom(hostName) {
  const code = makeCode();
  const room = {
    code,
    hostId: null,
    players: new Map(), // id -> {id,name,color,score,connected,socketId}
    phase: 'setup',     // setup | lobby | writing | voting | decision | verdict | results
    settings: { mode: 'accusations', group: null, topic: null, sub: null, timerOn: false, voteSeconds: 120, agreeOn: true, revealOn: true, revealWhen: 'end' },
    timeUp: false,      // the round timer ran out — players still have to vote, it just says so
    cvotes: new Map(),  // confession: voterId -> {stance, confessor, da}
    daId: null,         // confession: this round's devil's advocate
    tip: null,          // confession: {winnerId} while the winner tips the wheel
    finalSpin: null,    // confession: {slots, index, choice, revealed}
    opinions: [],       // {id, authorId, text}
    order: [],          // shuffled opinion ids for this game
    roundIndex: 0,
    votes: new Map(),   // voterId -> suspectId (current round)
    history: [],        // per round: {opinionId, authorId, tally, caught, accused, awards}
    deadline: null,
    timer: null,
    lastActive: Date.now(),
  };
  rooms.set(code, room);
  const host = addPlayer(room, hostName);
  room.hostId = host.id;
  return { room, host };
}

function addPlayer(room, name) {
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = COLORS.find(c => !used.has(c)) || COLORS[room.players.size % COLORS.length];
  const p = { id: newId(), name, color, score: 0, connected: true, socketId: null };
  room.players.set(p.id, p);
  return p;
}

const connected = room => [...room.players.values()].filter(p => p.connected);

function clearTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; room.deadline = null; }
function setTimer(room, seconds, fn) {
  clearTimer(room);
  if (!room.settings.timerOn) return;
  room.deadline = Date.now() + seconds * 1000;
  room.timer = setTimeout(() => { room.timer = null; fn(); broadcast(room); }, seconds * 1000);
}

// ---------- phase transitions ----------
function startWriting(room) {
  room.phase = 'writing';
  room.opinions = [];
  room.history = [];
  room.order = [];
  room.tip = null; room.finalSpin = null; room.daId = null;
  for (const p of room.players.values()) p.score = 0;
  clearTimer(room); // writing is never timed
}

function beginVoting(room) {
  if (room.phase !== 'writing') return;
  if (room.opinions.length === 0) { room.phase = 'lobby'; clearTimer(room); return; }
  room.order = shuffle(room.opinions.map(o => o.id));
  room.roundIndex = 0;
  if (room.settings.mode === 'confession') startConfRound(room); else startRound(room);
}

// ---------- Confession mode ----------
function startConfRound(room) {
  room.phase = 'c-deliberate';
  room.cvotes = new Map();
  const pool = connected(room);
  room.daId = pool[crypto.randomInt(pool.length)].id; // can be anyone — even the confessor
  room.timeUp = false;
  setTimer(room, room.settings.voteSeconds, () => openConfVoting(room));
}
function openConfVoting(room) {
  if (room.phase !== 'c-deliberate') return;
  room.phase = 'c-vote';
  clearTimer(room); // no skipping: results only come once every juror has voted
}
const cvoteDone = (room, id) => { const v = room.cvotes.get(id); return !!(v && v.locked && (v.stance || !room.settings.agreeOn) && v.confessor && (v.da || id === room.daId)); };
function maybeAdvanceConf(room) {
  const need = connected(room).map(p => p.id);
  if (need.length && need.every(id => cvoteDone(room, id))) toConfResults(room);
}
function spin(slots) { const index = crypto.randomInt(slots.length); return { slots, index, revealed: slots[index] === 'R' }; }
function toConfResults(room) {
  if (room.phase !== 'c-vote' && room.phase !== 'c-deliberate') return;
  clearTimer(room);
  const op = currentOpinion(room);
  const agree = [], disagree = [], confGuess = [], daGuess = [], awards = [];
  for (const [id, v] of room.cvotes) {
    if (v.stance === 'agree') agree.push(id); else if (v.stance === 'disagree') disagree.push(id);
    if (v.confessor) confGuess.push({ id, guess: v.confessor, ok: v.confessor === op.authorId });
    if (v.da && id !== room.daId) daGuess.push({ id, guess: v.da, ok: v.da === room.daId });
  }
  for (const g of confGuess) if (g.ok) awards.push({ id: g.id, pts: POINTS_GUESS_CONFESSOR, why: 'guessed the confessor' });
  for (const g of daGuess) if (g.ok) awards.push({ id: g.id, pts: POINTS_SPOT_DA, why: "spotted the devil's advocate" });
  // the devil's advocate scores for every juror who was fooled into accusing THEM of confessing
  const fooled = room.daId !== op.authorId ? confGuess.filter(g => g.guess === room.daId).map(g => g.id) : [];
  if (fooled.length) awards.push({ id: room.daId, pts: fooled.length * POINTS_DA_PER_FOOLED, why: `devil's advocate · fooled ${fooled.length}` });
  for (const a of awards) { const p = room.players.get(a.id); if (p) p.score += a.pts; }
  const st = room.settings;
  const roundSpin = st.revealOn && st.revealWhen === 'round' ? spin(WHEEL_BASE) : null;
  room.history[room.roundIndex] = {
    opinionId: op.id, authorId: op.authorId, text: op.text, daId: room.daId, fooled,
    agree, disagree, confGuess, daGuess, awards, spin: roundSpin,
    revealed: roundSpin ? roundSpin.revealed : null, // null = decided at the end of the game
  };
  room.phase = 'c-results';
}
function nextConf(room) {
  if (room.phase !== 'c-results') return;
  room.roundIndex += 1;
  if (room.roundIndex < room.order.length) return startConfRound(room);
  clearTimer(room);
  const st = room.settings;
  if (st.revealOn && st.revealWhen === 'end') {
    const players = [...room.players.values()];
    const top = Math.max(...players.map(p => p.score));
    const leaders = players.filter(p => p.score === top);
    room.tip = { winnerId: leaders[crypto.randomInt(leaders.length)].id };
    room.phase = 'c-tip';
  } else room.phase = 'results';
}
function tipWheel(room, choice) {
  if (room.phase !== 'c-tip' || !WHEEL_TIPPED[choice]) return;
  room.finalSpin = { ...spin(WHEEL_TIPPED[choice]), choice, by: room.tip.winnerId };
  room.phase = 'results';
}
// was this round's identity revealed in the end?
function roundRevealed(room, h) {
  const st = room.settings;
  if (!st.revealOn) return true;
  if (st.revealWhen === 'round') return !!h.revealed;
  return !!(room.finalSpin && room.finalSpin.revealed);
}

function currentOpinion(room) {
  const id = room.order[room.roundIndex];
  return room.opinions.find(o => o.id === id) || null;
}

function startRound(room) {
  room.phase = 'voting';
  room.votes = new Map();
  room.timeUp = false;
  setTimer(room, room.settings.voteSeconds, () => { room.timeUp = true; }); // deliberation clock only — never skips anyone's vote
}

function eligibleVoters(room) {
  // every connected player votes — including the author, who votes for someone else to stay hidden
  return connected(room);
}

function toDecision(room) {
  if (room.phase !== 'voting') return;
  clearTimer(room);
  room.phase = 'decision';
}

function scoreRound(room) {
  const op = currentOpinion(room);
  const tally = new Map();
  for (const [voter, suspect] of room.votes) {
    if (!tally.has(suspect)) tally.set(suspect, []);
    tally.get(suspect).push(voter);
  }
  let max = 0;
  for (const voters of tally.values()) max = Math.max(max, voters.length);
  const top = max > 0 ? [...tally.entries()].filter(([, v]) => v.length === max).map(([s]) => s) : [];
  const caught = top.length === 1 && top[0] === op.authorId;
  const awards = [];
  for (const [voter, suspect] of room.votes) {
    if (suspect === op.authorId) awards.push({ id: voter, pts: POINTS_CORRECT_GUESS, why: 'called it' });
  }
  if (!caught) awards.push({ id: op.authorId, pts: POINTS_EVADED, why: 'evaded detection', secret: true });
  for (const a of awards) { const p = room.players.get(a.id); if (p) p.score += a.pts; }
  const rec = {
    opinionId: op.id, authorId: op.authorId, text: op.text,
    tally: [...tally.entries()].map(([id, voters]) => ({ id, voters })),
    top, caught, awards,
  };
  room.history[room.roundIndex] = rec;
  return rec;
}

function toVerdict(room) {
  if (room.phase !== 'decision') return;
  if (!room.history[room.roundIndex]) scoreRound(room);
  room.phase = 'verdict';
}

function nextRound(room) {
  if (room.phase !== 'verdict') return;
  room.roundIndex += 1;
  if (room.roundIndex < room.order.length) startRound(room);
  else { clearTimer(room); room.phase = 'results'; }
}

function maybeAdvanceWriting(room) {
  const need = connected(room).map(p => p.id);
  if (need.length && need.every(id => room.opinions.some(o => o.authorId === id))) beginVoting(room);
}
function maybeAdvanceVoting(room) {
  const need = eligibleVoters(room).map(p => p.id);
  if (need.length && need.every(id => room.votes.has(id))) toDecision(room);
}

// ---------- what each player is allowed to see ----------
function viewFor(room, pid) {
  // in Confession, a score jump would give away secret roles — scores stay hidden until the end
  const hideScores = room.settings.mode === 'confession' && room.phase !== 'results';
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, score: hideScores ? null : p.score, connected: p.connected,
    done: room.phase === 'c-vote' ? cvoteDone(room, p.id) : undefined,
    submitted: room.phase === 'writing' ? room.opinions.some(o => o.authorId === p.id) : undefined,
    voted: room.phase === 'voting' ? room.votes.has(p.id) : undefined,
  }));
  const v = {
    code: room.code, phase: room.phase, hostId: room.hostId, you: pid, players,
    settings: room.settings, deadline: room.deadline, serverNow: Date.now(), timeUp: room.timeUp,
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
  };
  if (room.phase === 'writing') {
    const mine = room.opinions.find(o => o.authorId === pid);
    v.myOpinion = mine ? mine.text : null;
    v.submittedCount = room.opinions.length;
  }
  if (['voting', 'decision', 'verdict'].includes(room.phase)) {
    const op = currentOpinion(room);
    v.round = { index: room.roundIndex, total: room.order.length, text: op.text, yours: op.authorId === pid };
    v.myVote = room.votes.get(pid) || null;
    v.votedCount = room.votes.size;
  }
  if (room.phase === 'decision' || room.phase === 'verdict') {
    const tally = new Map();
    for (const [voter, suspect] of room.votes) { if (!tally.has(suspect)) tally.set(suspect, []); tally.get(suspect).push(voter); }
    v.decision = { tally: [...tally.entries()].map(([id, voters]) => ({ id, voters })).sort((a, b) => b.voters.length - a.voters.length) };
    let max = 0; for (const t of v.decision.tally) max = Math.max(max, t.voters.length);
    v.decision.top = max > 0 ? v.decision.tally.filter(t => t.voters.length === max).map(t => t.id) : [];
  }
  if (room.phase === 'verdict') {
    const rec = room.history[room.roundIndex];
    v.verdict = {
      caught: rec.caught,
      top: rec.top,
      authorId: rec.caught ? rec.authorId : null, // the blasphemer is only named if caught
      totalVotes: rec.tally.reduce((n, t) => n + t.voters.length, 0),
      votesFor: Object.fromEntries(rec.tally.map(t => [t.id, t.voters.length])),
      // when caught, everyone's call is shown (called it / wrong call / caught)
      calls: rec.caught ? [...room.players.keys()].map(id => {
        const t = rec.tally.find(x => x.voters.includes(id));
        return { id, ok: !!(t && t.id === rec.authorId), voted: !!t, author: id === rec.authorId };
      }) : null,
      awards: rec.awards.map(a => a.secret ? { id: null, pts: a.pts, why: a.why } : { id: a.id, pts: a.pts, why: a.why }),
    };
  }
  if (['c-deliberate', 'c-vote', 'c-results'].includes(room.phase)) {
    const op = currentOpinion(room);
    v.round = { index: room.roundIndex, total: room.order.length, text: op.text, yours: op.authorId === pid, youAreDA: room.daId === pid };
    if (room.phase === 'c-vote') {
      v.myCVote = room.cvotes.get(pid) || {};
      v.doneCount = connected(room).filter(p => cvoteDone(room, p.id)).length;
      // the agree/disagree vote is public — everyone sees who locked in which way
      v.publicStances = room.settings.agreeOn ? [...room.cvotes.entries()].filter(([, x]) => x.locked && x.stance).map(([id, x]) => ({ id, stance: x.stance })) : [];
    }
  }
  if (room.phase === 'c-results') {
    const h = room.history[room.roundIndex];
    const r = { agree: h.agree, disagree: h.disagree, spin: h.spin, revealed: h.spin ? h.revealed : null };
    if (h.spin && h.revealed) Object.assign(r, {
      authorId: h.authorId, daId: h.daId, awards: h.awards, fooled: h.fooled,
      confRight: h.confGuess.filter(g => g.ok).map(g => g.id), daRight: h.daGuess.filter(g => g.ok).map(g => g.id),
      confGuess: h.confGuess, daGuess: h.daGuess,
      daPts: h.awards.filter(a => a.id === h.daId && a.why.startsWith("devil's")).reduce((n, a) => n + a.pts, 0),
    });
    v.cresult = r;
  }
  if (room.phase === 'c-tip') v.tip = { winnerId: room.tip.winnerId, score: room.players.get(room.tip.winnerId)?.score ?? 0 };
  if (room.phase === 'results') {
    const stats = {};
    for (const id of room.players.keys()) stats[id] = { calls: 0, escapes: 0, caught: 0, confRight: 0, daSpotted: 0, daPts: 0 };
    for (const h of room.history) {
      if (room.settings.mode === 'confession') {
        for (const g of h.confGuess) if (g.ok && stats[g.id]) stats[g.id].confRight++;
        for (const g of h.daGuess) if (g.ok && stats[g.id]) stats[g.id].daSpotted++;
        if (stats[h.daId]) stats[h.daId].daPts += h.fooled.length * POINTS_DA_PER_FOOLED;
      } else {
        for (const t of h.tally) if (t.id === h.authorId) for (const id of t.voters) if (stats[id]) stats[id].calls++;
        if (stats[h.authorId]) { if (h.caught) stats[h.authorId].caught++; else stats[h.authorId].escapes++; }
      }
    }
    v.stats = stats;
    if (room.settings.mode === 'confession') {
      v.results = {
        mode: 'confession', finalSpin: room.finalSpin,
        reveal: room.history.map((h, i) => {
          const shown = roundRevealed(room, h);
          return shown
            ? { n: i + 1, text: h.text, revealed: true, authorId: h.authorId, daId: h.daId, agree: h.agree.length, disagree: h.disagree.length,
                confRight: h.confGuess.filter(g => g.ok).map(g => g.id), daRight: h.daGuess.filter(g => g.ok).map(g => g.id) }
            : { n: i + 1, text: h.text, revealed: false, agree: h.agree.length, disagree: h.disagree.length };
        }),
      };
    } else {
      v.results = {
        mode: 'accusations',
        reveal: room.history.map((h, i) => ({ n: i + 1, text: h.text, authorId: h.authorId, caught: h.caught })),
      };
    }
  }
  return v;
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players.values()) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

// ---------- sockets ----------
io.on('connection', socket => {
  const ctx = () => {
    const room = rooms.get(socket.data.code);
    const me = room && room.players.get(socket.data.playerId);
    return { room, me, isHost: room && me && room.hostId === me.id };
  };
  const bind = (room, p) => {
    socket.data.code = room.code; socket.data.playerId = p.id;
    p.socketId = socket.id; p.connected = true;
    socket.join(room.code);
  };

  socket.on('create', ({ name } = {}, ack = () => {}) => {
    name = clean(name, NAME_MAX);
    if (!name) return ack({ error: 'Enter a name for the record.' });
    const { room, host } = createRoom(name);
    bind(room, host);
    ack({ code: room.code, playerId: host.id });
    broadcast(room);
  });

  socket.on('join', ({ code, name } = {}, ack = () => {}) => {
    code = clean(code, 8).toUpperCase(); name = clean(name, NAME_MAX);
    const room = rooms.get(code);
    if (!room) return ack({ error: 'No court with that docket number.' });
    if (!name) return ack({ error: 'Enter a name for the record.' });
    if (!['setup', 'lobby'].includes(room.phase)) return ack({ error: 'That case is already in session.' });
    if (room.players.size >= MAX_PLAYERS) return ack({ error: 'The jury box is full.' });
    if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return ack({ error: 'Someone already took that name.' });
    const p = addPlayer(room, name);
    bind(room, p);
    ack({ code: room.code, playerId: p.id });
    broadcast(room);
  });

  socket.on('rejoin', ({ code, playerId } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const p = room && room.players.get(playerId);
    if (!p) return ack({ error: 'gone' });
    bind(room, p);
    if (!room.players.get(room.hostId)?.connected) room.hostId = p.id;
    ack({ code: room.code, playerId: p.id });
    broadcast(room);
  });

  socket.on('leave', () => {
    const { room, me } = ctx();
    if (!room || !me) return;
    room.players.delete(me.id);
    socket.leave(room.code);
    socket.data = {};
    if (room.players.size === 0) { clearTimer(room); rooms.delete(room.code); return; }
    if (room.hostId === me.id) room.hostId = (connected(room)[0] || [...room.players.values()][0]).id;
    if (room.phase === 'writing') maybeAdvanceWriting(room);
    if (room.phase === 'voting') maybeAdvanceVoting(room);
    if (room.phase === 'c-vote') maybeAdvanceConf(room);
    broadcast(room);
  });

  socket.on('settings', (s = {}) => {
    const { room, isHost } = ctx();
    if (!isHost || !['setup', 'lobby'].includes(room.phase)) return;
    const st = room.settings;
    if ('mode' in s && ['accusations', 'confession'].includes(s.mode)) st.mode = s.mode;
    if ('revealOn' in s) st.revealOn = !!s.revealOn;
    if ('revealWhen' in s && ['round', 'end'].includes(s.revealWhen)) st.revealWhen = s.revealWhen;
    if ('group' in s) st.group = s.group ? clean(s.group, 30) : null;
    if ('topic' in s) st.topic = s.topic ? clean(s.topic, 40) : null;
    if ('sub' in s) st.sub = s.sub ? clean(s.sub, 60) : null;
    if ('timerOn' in s) st.timerOn = !!s.timerOn;
    if ('voteSeconds' in s && [60, 120, 300, 600].includes(+s.voteSeconds)) st.voteSeconds = +s.voteSeconds;
    if ('agreeOn' in s) st.agreeOn = !!s.agreeOn;
    broadcast(room);
  });

  socket.on('openCourt', () => { const { room, isHost } = ctx(); if (isHost && room.phase === 'setup' && room.settings.topic) { room.phase = 'lobby'; broadcast(room); } });
  socket.on('editCase', () => { const { room, isHost } = ctx(); if (isHost && room.phase === 'lobby') { room.phase = 'setup'; broadcast(room); } });

  socket.on('start', (_ = {}, ack = () => {}) => {
    const { room, isHost } = ctx();
    if (!isHost || room.phase !== 'lobby') return ack({ error: 'Only the host can start.' });
    if (connected(room).length < MIN_PLAYERS) return ack({ error: `Need at least ${MIN_PLAYERS} jurors.` });
    startWriting(room); ack({ ok: true }); broadcast(room);
  });

  socket.on('submitOpinion', ({ text } = {}, ack = () => {}) => {
    const { room, me } = ctx();
    if (!room || room.phase !== 'writing') return ack({ error: 'Not taking opinions right now.' });
    text = clean(text, OPINION_MAX);
    if (text.length < 3) return ack({ error: 'Say a little more.' });
    const mine = room.opinions.find(o => o.authorId === me.id);
    if (mine) mine.text = text; else room.opinions.push({ id: newId(), authorId: me.id, text });
    ack({ ok: true });
    maybeAdvanceWriting(room);
    broadcast(room);
  });

  socket.on('vote', ({ suspectId } = {}, ack = () => {}) => {
    const { room, me } = ctx();
    if (!room || room.phase !== 'voting') return ack({ error: 'Voting is closed.' });
    if (suspectId === me.id) return ack({ error: "You can't accuse yourself." });
    if (!room.players.has(suspectId)) return ack({ error: 'Unknown suspect.' });
    room.votes.set(me.id, suspectId);
    ack({ ok: true });
    maybeAdvanceVoting(room);
    broadcast(room);
  });

  socket.on('cvote', (patch = {}, ack = () => {}) => {
    const { room, me } = ctx();
    if (!room || room.phase !== 'c-vote') return ack({ error: 'Voting is closed.' });
    const v = { ...(room.cvotes.get(me.id) || {}) };
    if ('stance' in patch) { if (!['agree', 'disagree'].includes(patch.stance)) return ack({ error: 'Pick agree or disagree.' }); v.stance = patch.stance; }
    for (const key of ['confessor', 'da']) {
      if (!(key in patch)) continue;
      const id = patch[key];
      if (id === me.id) return ack({ error: "You can't pick yourself." });
      if (!room.players.has(id)) return ack({ error: 'Unknown juror.' });
      if (key === 'da' && me.id === room.daId) return ack({ error: "You already know who the devil's advocate is." });
      v[key] = id;
    }
    if (patch.lock) {
      if ((room.settings.agreeOn && !v.stance) || !v.confessor || (!v.da && me.id !== room.daId)) return ack({ error: 'Finish every vote first.' });
      v.locked = true;
    }
    room.cvotes.set(me.id, v);
    ack({ ok: true });
    maybeAdvanceConf(room);
    broadcast(room);
  });

  socket.on('tip', ({ choice } = {}) => {
    const { room, me, isHost } = ctx();
    if (!room || room.phase !== 'c-tip') return;
    const winner = room.players.get(room.tip.winnerId);
    // the winner tips the wheel; if they've dropped out, the host does it for them
    if (me.id === room.tip.winnerId || (isHost && !winner?.connected)) { tipWheel(room, choice); broadcast(room); }
  });

  socket.on('advance', () => {
    const { room, isHost } = ctx();
    if (!isHost) return;
    if (room.phase === 'c-deliberate') openConfVoting(room);
    else if (room.phase === 'c-results') nextConf(room);

    else if (room.phase === 'decision') toVerdict(room);
    else if (room.phase === 'verdict') nextRound(room);
    broadcast(room);
  });

  socket.on('newGame', ({ keepTopic } = {}) => {
    const { room, isHost } = ctx();
    if (!isHost || room.phase !== 'results') return;
    clearTimer(room);
    room.phase = 'setup';
    if (!keepTopic) { room.settings.topic = null; room.settings.sub = null; room.settings.group = null; }
    room.opinions = []; room.order = []; room.history = []; room.votes = new Map();
    room.cvotes = new Map(); room.tip = null; room.finalSpin = null; room.daId = null;
    for (const p of room.players.values()) p.score = 0;
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const { room, me } = ctx();
    if (!room || !me || me.socketId !== socket.id) return;
    me.connected = false; me.socketId = null;
    if (room.hostId === me.id) { const next = connected(room)[0]; if (next) room.hostId = next.id; }
    if (room.phase === 'writing') maybeAdvanceWriting(room);
    if (room.phase === 'voting') maybeAdvanceVoting(room);
    if (room.phase === 'c-vote') maybeAdvanceConf(room);
    broadcast(room);
  });
});

// forget rooms nobody has touched in a while
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (connected(room).length === 0 && now - room.lastActive > ROOM_IDLE_MS) { clearTimer(room); rooms.delete(code); }
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Blasphemy court is in session on http://localhost:${PORT}`));
}

module.exports = { server, rooms };
