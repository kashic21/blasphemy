# Blasphemy ⚖️

A Jackbox-style unpopular-opinion party game. Players join from their phones with a 5-letter docket code — no app install.

**This version:** Accusations and Confession modes, fully playable end to end.
Testimony is designed in Figma and comes next.

## How a game works
1. **Join the court:** someone taps *Open a new case* (they become the judge/host). Everyone else enters their name + the docket code.
2. **Topics → Case setup:** the judge picks a topic, an optional sub-topic (or a custom one), and whether to use a timer.
3. **Lobby:** jurors gather (minimum 3). The judge taps *Begin proceedings*.
4. **File your take:** everyone secretly writes an unpopular opinion.
5. **Exhibits:** each take is shown anonymously. Everyone (including the author, who has to act natural) votes on who wrote it.
6. **Jury decisions → Verdict:** votes are revealed. If the most-accused player wrote it → **GUILTY**. If not (or it's a tie), the blasphemer stays hidden until the end.
7. **The truth revealed:** who said what, final standings. The judge can open a new case with the same lobby.

**Scoring:** +1 to every accuser who guessed right · +2 to the blasphemer if they escape (they weren't the single most-accused player).
Change these at the top of `server.js` (`POINTS_CORRECT_GUESS`, `POINTS_EVADED`).

## Run it on your computer
You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To test multiplayer alone, open a few browser windows (or one normal + one private window per player).
To play with friends on the same Wi-Fi, have them open `http://YOUR-COMPUTER-IP:3000` on their phones.

Run the automated full-game test with `npm test`.

## Put it online (free) — Render
1. Put this folder in a GitHub repo.
2. On [render.com](https://render.com), choose **New → Blueprint** and pick the repo. It reads `render.yaml` and sets everything up.
   (Or **New → Web Service**: build command `npm install`, start command `npm start`.)
3. Share the URL. Done. Every push to `main` deploys automatically (the Render GitHub app is installed on this repo).

Note: games are kept in memory, so a server restart ends any games in progress. That's fine for playtesting. Add a database (e.g. Supabase or Redis) before a big launch.

## Where things live
| File | What it does |
|---|---|
| `server.js` | Rooms, phases, votes, scoring. All the secrets stay here. |
| `public/app.js` | Every screen (home, topics, setup, lobby, writing, voting, decision, verdict, results) |
| `public/styles.css` | The look from the Figma file: paper lines, legal pads, mugshots, stamps |
| `public/topics.js` | Topic groups + suggested sub-topics. Edit freely. |
| `test/sim.js` | Bot players that play a full game to check nothing's broken |

## Next up

- Testimony mode (slide uploads as PDF/images, Convince-O-Meter)
- 18+ topic toggle and a report/skip button
- Accounts + saved testimonies (profile)
- Sound + motion polish

## Confession mode
Everyone anonymously confesses an unpopular opinion or story. Each round a random juror is secretly made the **devil's advocate** (it can even be the confessor) and must defend it. After arguing out loud, everyone casts 3 votes: **agree/disagree** (public), **who confessed** (secret) and **who's the devil's advocate** (secret).
Scoring: +1 for guessing the confessor · +1 for spotting the devil's advocate · devil's advocate gets +1 per other juror who votes agree. Scores stay hidden until the end.
**Reveal randomizer** (host setting): a 6-slot wheel, reveal/seal alternating. *After each round*: spun after every confession. *End of game*: the leader tips it (+2 slots their way) and one spin decides for everyone. *Off*: everyone is unmasked at the end.
