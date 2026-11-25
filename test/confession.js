// Plays two full Confession games with 4 bots: one with the wheel after each round, one at the end (winner tips it).
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('../server');

const wait = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, ev, data) => new Promise(r => s.emit(ev, data, r));

async function game(url, revealWhen, agreeOn = true) {
  const bots = ['Maya', 'Dev', 'Jordan', 'Sam'].map(n => ({ name: n, s: io(url, { forceNew: true }), state: null }));
  bots.forEach(b => b.s.on('state', st => { b.state = st; }));
  await Promise.all(bots.map(b => new Promise(r => b.s.on('connect', r))));
  const host = bots[0];
  const { code, playerId } = await emit(host.s, 'create', { name: host.name }); host.id = playerId;
  for (const b of bots.slice(1)) b.id = (await emit(b.s, 'join', { code, name: b.name })).playerId;
  host.s.emit('settings', { mode: 'confession', topic: 'Food', revealOn: true, revealWhen, agreeOn });
  host.s.emit('openCourt'); await wait(40);
  assert.ok((await emit(host.s, 'start')).ok);
  const texts = ['Fruit in a salad is a crime.', 'Cereal is better dry.', 'Ranch goes on everything.', 'Cold pizza beats hot pizza.'];
  for (let i = 0; i < 4; i++) await emit(bots[i].s, 'submitOpinion', { text: texts[i] });
  await wait(60);
  const byText = Object.fromEntries(texts.map((t, i) => [t, bots[i]]));
  let expected = Object.fromEntries(bots.map(b => [b.id, 0]));

  for (let r = 0; r < 4; r++) {
    assert.strictEqual(host.state.phase, 'c-deliberate');
    const author = byText[host.state.round.text];
    const das = bots.filter(b => b.state.round.youAreDA);
    assert.strictEqual(das.length, 1, 'exactly one player is told they are the devil’s advocate');
    const da = das[0];
    for (const b of bots) assert.strictEqual(b.state.round.yours, b === author);
    assert.ok(bots.every(b => b.state.players.every(p => p.score === null)), 'scores hidden during the game');
    host.s.emit('advance'); await wait(40);
    assert.strictEqual(host.state.phase, 'c-vote');
    assert.ok((await emit(da.s, 'cvote', { da: bots.find(b => b !== da).id })).error, 'DA cannot guess the DA');
    for (const b of bots) {
      const others = bots.filter(x => x !== b);
      // bots[3] gets fooled into accusing the devil's advocate of confessing
      const confessor = (b === bots[3] && da !== b && da !== author) ? da : author !== b ? author : others[0];
      const daPick = b === da ? undefined : (da !== b ? da : others[0]);
      const stance = b === bots[1] ? 'disagree' : 'agree';
      const patch = { confessor: confessor.id, ...(daPick ? { da: daPick.id } : {}), ...(agreeOn ? { stance } : {}) };
      if (agreeOn) assert.ok((await emit(b.s, 'cvote', { ...patch, stance: undefined, lock: true })).error, 'cannot lock without the public vote');
      assert.ok((await emit(b.s, 'cvote', { ...patch, lock: true })).ok);
      if (b === bots[0]) { host.s.emit('advance'); await wait(30); assert.strictEqual(host.state.phase, 'c-vote', 'host cannot skip voting'); }
      // expected points: right confessor guess, right DA spot, DA +1 per juror who accused them of confessing
      if (confessor === author) expected[b.id] += 1;
      if (daPick === da) expected[b.id] += 1;
      if (confessor === da && da !== author) expected[da.id] += 1;
    }
    await wait(60);
    assert.strictEqual(host.state.phase, 'c-results');
    const cr = bots[2].state.cresult;
    if (agreeOn) { assert.strictEqual(cr.agree.length, 3); assert.strictEqual(cr.disagree.length, 1); }
    else assert.strictEqual(cr.agree.length + cr.disagree.length, 0, 'no public vote when it is off');
    if (revealWhen === 'round') {
      assert.ok(cr.spin && cr.spin.slots.length === 6, '6-slot wheel');
      assert.deepStrictEqual(cr.spin.slots, ['R', 'S', 'R', 'S', 'R', 'S'], 'slots alternate');
      if (cr.revealed) assert.strictEqual(cr.authorId, author.id); else assert.strictEqual(cr.authorId, undefined, 'sealed round hides the confessor');
    } else {
      assert.strictEqual(cr.spin, null); assert.strictEqual(cr.authorId, undefined, 'nothing revealed until the end');
    }
    host.s.emit('advance'); await wait(60);
  }
  if (revealWhen === 'end') {
    assert.strictEqual(host.state.phase, 'c-tip');
    const winner = bots.find(b => b.id === host.state.tip.winnerId);
    const top = Math.max(...Object.values(expected));
    assert.strictEqual(expected[winner.id], top, 'the leader tips the wheel');
    const loser = bots.find(b => b !== winner);
    loser.s.emit('tip', { choice: 'seal' }); await wait(40);
    assert.strictEqual(host.state.phase, 'c-tip', 'only the winner may tip');
    winner.s.emit('tip', { choice: 'reveal' }); await wait(60);
  }
  assert.strictEqual(host.state.phase, 'results');
  const res = host.state.results;
  for (const p of host.state.players) assert.strictEqual(p.score, expected[p.id], `score for ${p.name}`);
  if (revealWhen === 'end') {
    assert.strictEqual(res.finalSpin.slots.length, 8, 'tipped wheel has 8 slots');
    assert.strictEqual(res.finalSpin.slots.filter(x => x === 'R').length, 5, 'tipping toward reveal adds 2 reveal slots');
    assert.ok(res.reveal.every(x => x.revealed === res.finalSpin.revealed));
  }
  const shown = res.reveal.filter(x => x.revealed);
  for (const x of shown) assert.ok(x.authorId && x.daId);
  for (const x of res.reveal.filter(x => !x.revealed)) assert.strictEqual(x.authorId, undefined);
  bots.forEach(b => b.s.close());
  return { shown: shown.length, total: res.reveal.length };
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const a = await game(url, 'round');
  const b = await game(url, 'end');
  await game(url, 'round', false);
  console.log(`✓ Confession simulated twice: wheel after each round (${a.shown}/${a.total} revealed) and end-of-game tip (${b.shown}/${b.total} revealed), plus a run with the agree/disagree vote off; roles stay secret, scores add up`);
  server.close(); process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
