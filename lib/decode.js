'use strict';

// Dekoder modtagne 433 MHz-signaler til en fast protokol (lyt-funktionen).
// Homey modtager via rx-signalerne i app.json: hvert frame er en liste af [puls, pause]-ord fra en
// generisk tabel, dvs. tider afrundet til tabellens trin. Lange pauser (over GAP_US) deler frames,
// så hverken header-pausen eller den sidste puls før den er med.
// Metode: for hver protokol og bitantal laves en skabelon med encoderne i lib/protocols.js.
// Hver bit påvirker faste positioner i skabelonen. De modtagne tider sammenlignes med 0- og
// 1-udgaven pr. bit, og resultatet godkendes kun, hvis hele den genkodede skabelon passer.
// Protokoller hvor bits ikke er uafhængige (Manchester, MegaCode) kan ikke dekodes, og heller
// ikke dem, hvor en bit kun ligger i pulsen lige før den lange pause (Linear, Roger m.fl.) –
// decodable() giver listen. Flere frames stemmer om resultatet.

const { PROTOCOLS, encode } = require('./protocols');
const { normalizeKey } = require('./subfile');

const GAP_US = 4500; // længere pulser/pauser kan ikke modtages; de deler frames
const ELEMENT_TOL = Math.log(1.5); // største afvigelse på ét element
const MEAN_TOL = Math.log(1.15); // største gennemsnitlige afvigelse
const MAX_MISSING = 2; // elementer i skabelonen, der må mangle i enderne af et frame
const MAX_MISSING_START = 1; // heraf i starten: Homey starter et frame lige efter pausen (kun en indledende pause kan mangle)
const MAX_UNEXPLAINED = 4; // modtagne elementer, koden ikke forklarer (støj i enderne)
const MAX_DATA_LIKE = 2; // heraf med samme varighed som kodens egne (ellers er koden for kort)
const UNEXPLAINED_WEIGHT = 0.5; // straf pr. andel uforklarede elementer
const TE_PENALTY = 0.03; // ved lige godt match vinder protokoller med faste tider
const MIN_VOTES = 3; // så mange frames skal give samme kode
const RX_FREQUENCY = 433920000; // Homey modtager 433,76–434,08 MHz

const lg = (v) => Math.log(Math.abs(v));

// Frames gentages, så de er cykliske: start lige efter den længste pause og tag det længste
// stykke uden elementer over GAP_US. Fjernbetjeninger holder pause mellem gentagelserne, så en
// afsluttende pause smelter sammen med den og kan ikke ses.
function core(raw) {
  const frame = raw[raw.length - 1] < 0 ? [...raw.slice(0, -1), raw[raw.length - 1] - 10 * GAP_US] : [...raw, -10 * GAP_US];
  let start = 0;
  let max = 0;
  frame.forEach((v, i) => {
    if (Math.abs(v) > GAP_US && Math.abs(v) > max) { max = Math.abs(v); start = i + 1; }
  });
  const rot = frame.slice(start).concat(frame.slice(0, start));
  let best = [];
  let cur = [];
  for (const v of rot) {
    if (Math.abs(v) > GAP_US) {
      if (cur.length > best.length) best = cur;
      cur = [];
    } else cur.push(v);
  }
  return cur.length > best.length ? cur : best;
}

const keyOf = (bits) => bits.reduce((a, b) => (a << 1n) | BigInt(b), 0n).toString(16);

// Skabelon: { zero, bits: [{ pos, one }] } eller null, hvis bits ikke er uafhængige.
function template(p, n, te) {
  const enc = (key) => core(encode({ protocol: p.name, bits: n, key, te }).frame);
  let zero;
  try { zero = enc('0'); } catch (e) { return null; }
  if (zero.length < 8) return null;
  const bits = [];
  for (let i = 0; i < n; i++) {
    const one = enc((1n << BigInt(n - 1 - i)).toString(16));
    if (one.length !== zero.length) return null;
    const pos = [];
    one.forEach((v, j) => {
      if (Math.sign(v) !== Math.sign(zero[j])) pos.push(-1);
      else if (v !== zero[j]) pos.push(j);
    });
    if (pos.includes(-1)) return null;
    // Homey ser ikke en indledende pause eller den sidste puls før den lange pause.
    if (pos.length && pos.every((j) => (j === 0 && zero[0] < 0) || (j === zero.length - 1 && zero[j] > 0))) return null;
    bits.push({ pos, one: pos.map((j) => one[j]) });
  }
  const t = { p, n, te, zero, bits };
  // Kontrol: skabelonen skal kunne genskabe vilkårlige koder (ellers afhænger bits af hinanden).
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const tests = [Array(n).fill(1), Array.from({ length: n }, (_, i) => i % 2)];
  for (let r = 0; r < 8; r++) tests.push(Array.from({ length: n }, () => (rnd() < 0.5 ? 1 : 0)));
  for (const test of tests) {
    const want = enc(keyOf(test));
    const got = build(t, test);
    if (want.length !== got.length || want.some((v, j) => v !== got[j])) return null;
  }
  return t;
}

function build(t, bits) {
  const out = t.zero.slice();
  t.bits.forEach((b, i) => { if (bits[i]) b.pos.forEach((j, k) => { out[j] = b.one[k]; }); });
  return out;
}

// Skabeloner for protokoller med faste tider laves én gang.
let fixedTemplates = null;
function fixed() {
  if (!fixedTemplates) {
    fixedTemplates = [];
    for (const p of Object.values(PROTOCOLS).filter((x) => !x.teFromFile)) {
      const counts = p.bitsMin ? Array.from({ length: p.bitsMax - p.bitsMin + 1 }, (_, i) => p.bitsMin + i) : p.bits;
      for (const n of counts) {
        const t = template(p, n);
        if (t) fixedTemplates.push(t);
      }
    }
  }
  return fixedTemplates;
}

// Bedste placering af skabelonen i det modtagne frame S (signerede µs).
function match(S, t) {
  const Z = t.zero;
  const L = Z.length;
  let best = null;
  for (let k = -MAX_MISSING_START; k <= S.length - L + MAX_MISSING; k++) {
    const from = Math.max(0, -k);
    const to = Math.min(L, S.length - k);
    if (L - (to - from) > MAX_MISSING) continue;
    if (Math.sign(S[from + k]) !== Math.sign(Z[from])) continue;
    const inside = (j) => j >= from && j < to;
    const bits = [];
    let ok = true;
    for (const b of t.bits) {
      const pos = b.pos.map((j, i) => [j, i]).filter(([j]) => inside(j));
      if (b.pos.length && !pos.length) { ok = false; break; }
      let e0 = 0;
      let e1 = 0;
      for (const [j, i] of pos) {
        const s = lg(S[j + k]);
        e0 += Math.abs(s - lg(Z[j]));
        e1 += Math.abs(s - lg(b.one[i]));
      }
      bits.push(e1 < e0 ? 1 : 0);
    }
    if (!ok) continue;
    const T = build(t, bits);
    let sum = 0;
    let maxE = 0;
    let logRatio = 0;
    for (let j = from; j < to; j++) {
      const d = lg(S[j + k]) - lg(T[j]);
      sum += Math.abs(d);
      logRatio += d;
      maxE = Math.max(maxE, Math.abs(d));
    }
    const n = to - from;
    const mean = sum / n;
    if (maxE > ELEMENT_TOL || mean > MEAN_TOL) continue;
    // Den placering, der dækker mest af frame'et, vinder (ellers kan koden læses en bit forskudt).
    const rank = mean + UNEXPLAINED_WEIGHT * ((S.length - n) / S.length);
    if (!best || rank < best.rank) best = { rank, score: mean, bits, T, k, scale: Math.exp(logRatio / n) };
  }
  return best;
}

// Elementer i S, som koden T placeret ved k0 ikke forklarer: { n, data }. Homey deler frames ved den
// lange pause, så et frame rummer én gentagelse – kopier af en kort kode må ikke "forklare" resten
// (fx tre kopier af Holtek_HT12X i et ensartet Mastercode-frame). data = de uforklarede elementer,
// der har samme varighed som kodens egne; flere af dem betyder, at koden er for kort (Roger læst
// som SMC5326), mens støj i enderne sjældent rammer kodens varigheder.
function unexplained(S, T, k0) {
  const idx = [];
  for (let i = 0; i < S.length; i++) if (i < k0 || i >= k0 + T.length) idx.push(i);
  const like = (v) => T.some((t) => Math.sign(t) === Math.sign(v) && Math.abs(lg(v) - lg(t)) <= ELEMENT_TOL);
  return { n: idx.length, data: idx.filter((i) => like(S[i])).length };
}

// TE-gæt: gennemsnittet af de korte elementer (under midten mellem korteste og længste).
function guessTe(S) {
  const logs = S.map(lg);
  const mid = (Math.min(...logs) + Math.max(...logs)) / 2;
  const short = logs.filter((v) => v < mid);
  return Math.exp(short.reduce((a, b) => a + b, 0) / short.length);
}

// Ét frame ([puls, pause]-par i µs) -> { protocol, bits, key, te?, score } eller null
function decodeFrame(pairs) {
  const S = [];
  for (const [h, l] of pairs) S.push(h, -l);
  if (S.length < 10) return null;
  const found = [];
  for (const t of fixed()) {
    const m = match(S, t);
    if (m) found.push({ t, m, score: m.rank });
  }
  const te0 = guessTe(S);
  for (const p of Object.values(PROTOCOLS).filter((x) => x.teFromFile)) {
    for (const n of p.bits) {
      // To runder: gæt TE, find koden, og ret TE ud fra hele frame'et.
      let te = Math.round(te0);
      let hit = null;
      for (let round = 0; round < 2; round++) {
        if (te < p.teRange[0] || te > p.teRange[1]) break;
        const t = template(p, n, te);
        const m = t && match(S, t);
        if (!m) break;
        hit = { t, m, score: m.rank + TE_PENALTY };
        te = Math.round(te * m.scale);
      }
      if (hit) found.push({ ...hit, te: Math.min(p.teRange[1], Math.max(p.teRange[0], te)) });
    }
  }
  // Koden skal forklare hele frame'et (ellers passer fx en kort skabelon på et stykke af en lang).
  const ok = found.filter((f) => {
    const u = unexplained(S, f.m.T, f.m.k);
    return u.n <= MAX_UNEXPLAINED && u.data <= MAX_DATA_LIKE;
  });
  if (!ok.length) return null;
  ok.sort((a, b) => a.score - b.score);
  const { t, m, te, score } = ok[0];
  const out = { protocol: t.p.name, bits: t.n, key: normalizeKey(keyOf(m.bits)), score };
  if (te) out.te = te;
  return out;
}

// Resultater fra decodeFrame -> { code, votes } når mindst MIN_VOTES frames giver samme kode
function vote(results) {
  const groups = new Map();
  for (const r of results) {
    if (!r) continue;
    const id = `${r.protocol}|${r.bits}|${r.key}`;
    const g = groups.get(id) || { r, votes: 0, te: [] };
    g.votes++;
    if (r.te) g.te.push(Math.log(r.te));
    groups.set(id, g);
  }
  const best = [...groups.values()].sort((a, b) => b.votes - a.votes)[0];
  if (!best || best.votes < MIN_VOTES) return null;
  const { protocol, bits, key } = best.r;
  const code = { protocol, bits, key, frequency: RX_FREQUENCY };
  if (best.te.length) code.te = Math.round(Math.exp(best.te.reduce((a, b) => a + b, 0) / best.te.length));
  return { code, votes: best.votes };
}

const decodeFrames = (frames) => vote(frames.map(decodeFrame));

// Protokoller lyt-funktionen kan dekode (til test og dokumentation).
function decodable() {
  const names = new Set(fixed().map((t) => t.p.name));
  for (const p of Object.values(PROTOCOLS).filter((x) => x.teFromFile)) {
    if (template(p, p.bits[0], p.teDefault)) names.add(p.name);
  }
  return [...names].sort();
}

module.exports = {
  decodeFrame, decodeFrames, vote, decodable, core, GAP_US, MIN_VOTES, RX_FREQUENCY,
};
