// Plays a full Accusations game with 4 bot players against a real server instance.
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('../server');

const wait = ms => new Promise(r => setTimeout(r, ms));
const emit = (s, ev, data) => new Promise(r => s.emit(ev, data, r));

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const names = ['Maya', 'Dev', 'Jordan', 'Sam'];
  const bots = names.map(n => ({ name: n, s: io(url, { forceNew: true }), state: null }));
  bots.forEach(b => b.s.on('state', st => { b.state = st; }));
  await Promise.all(bots.map(b => new Promise(r => b.s.on('connect', r))));

  // errors are reported
  assert.ok((await emit(bots[1].s, 'join', { code: 'ZZZZZ', name: 'x' })).error);

  const host = bots[0];
  const { code, playerId } = await emit(host.s, 'create', { name: 'Maya' });
  host.id = playerId;
  for (const b of bots.slice(1)) { const r = await emit(b.s, 'join', { code, name: b.name }); assert.ok(!r.error, r.error); b.id = r.playerId; }
  assert.ok((await emit(bots[1].s, 'join', { code, name: 'maya' })).error, 'duplicate names rejected');
  await wait(50);
  assert.strictEqual(host.state.players.length, 4);

  host.s.emit('settings', { group: 'Food', topic: 'Food', sub: 'The best fruit is…', timerOn: false });
  host.s.emit('openCourt');
  await wait(50);
  assert.strictEqual(bots[2].state.phase, 'lobby');
  assert.ok((await emit(bots[1].s, 'start')).error, 'non-host cannot start');
  assert.ok((await emit(host.s, 'start')).ok);
  await wait(50);
  assert.strictEqual(host.state.phase, 'writing');

  host.s.emit('advance'); await wait(30);
  assert.strictEqual(host.state.phase, 'writing', 'host cannot skip writing');
  assert.strictEqual(host.state.deadline, null, 'writing is never timed');
  const opinions = ['Grapes are better frozen.', 'Bananas are overrated.', 'Watermelon is crunchy water.', 'Pineapple goes on everything.'];
  for (let i = 0; i < 4; i++) assert.ok((await emit(bots[i].s, 'submitOpinion', { text: opinions[i] })).ok);
  await wait(50);
  assert.strictEqual(host.state.phase, 'voting');
  assert.strictEqual(host.state.round.total, 4);

  const byText = Object.fromEntries(opinions.map((t, i) => [t, bots[i]]));
  for (let r = 0; r < 4; r++) {
    const text = host.state.round.text;
    const author = byText[text];
    // only the author is told the opinion is theirs
    for (const b of bots) assert.strictEqual(b.state.round.yours, b === author);
    assert.ok((await emit(author.s, 'vote', { suspectId: author.id })).error, 'no self-votes');
    // round 1 & 3: everyone else nails the author; round 2 & 4: they all accuse someone innocent
    const others = bots.filter(b => b !== author);
    const innocent = others[0];
    for (const b of bots) {
      const target = r % 2 === 0 ? (b === author ? innocent : author) : (b === innocent ? others[1] : innocent);
      assert.ok((await emit(b.s, 'vote', { suspectId: target.id })).ok);
      if (b === bots[0]) { host.s.emit('advance'); await wait(30); assert.strictEqual(host.state.phase, 'voting', 'host cannot skip voting'); }
    }
    await wait(50);
    assert.strictEqual(host.state.phase, 'decision');
    host.s.emit('advance'); await wait(50);
    assert.strictEqual(host.state.phase, 'verdict');
    const v = bots[1].state.verdict;
    if (r % 2 === 0) { assert.strictEqual(v.caught, true); assert.strictEqual(v.authorId, author.id); assert.strictEqual(v.calls.length, 4); assert.strictEqual(v.calls.filter(c => c.ok).length, 3); }
    else { assert.strictEqual(v.caught, false); assert.strictEqual(v.authorId, null, 'blasphemer stays hidden'); assert.ok(v.awards.some(a => a.id === null && a.pts === 2)); }
    host.s.emit('advance'); await wait(50);
  }
  assert.strictEqual(host.state.phase, 'results');
  assert.strictEqual(host.state.results.reveal.length, 4);
  const total = host.state.players.reduce((n, p) => n + p.score, 0);
  // 2 caught rounds x 3 correct guessers + 2 escaped rounds x 2 points
  assert.strictEqual(total, 2 * 3 + 2 * 2);

  // disconnect → host hand-off, then new game resets
  host.s.disconnect(); await wait(80);
  assert.strictEqual(bots[1].state.hostId, bots[1].id);
  bots[1].s.emit('newGame'); await wait(50);
  assert.strictEqual(bots[2].state.phase, 'setup');
  assert.ok(bots[2].state.players.every(p => p.score === 0));

  console.log('✓ full Accusations game simulated: join, setup, lobby, writing, 4 rounds of voting/verdicts, results, host hand-off, new game');
  bots.forEach(b => b.s.close());
  server.close();
  process.exit(0);
})().catch(e => { console.error('✗', e.message); process.exit(1); });
