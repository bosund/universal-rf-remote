'use strict';

// Selvtest uden Homey: node test/selftest.js
const assert = require('assert');
const { parseSub, binRawToPulses } = require('../lib/subfile');
const { encode, PROTOCOLS } = require('../lib/protocols');
const { extractRepetition } = require('../lib/raw');
const { buildCatalog, plan, toPairs } = require('../lib/radio');
const { prepareCode, describe } = require('../lib/codes');
const { setLanguage } = require('../lib/i18n');

setLanguage('da');

const MARKISE_UD = `Filetype: Flipper SubGhz Key File
Version: 1
Frequency: 433920000
Preset: FuriHalSubGhzPresetOok270Async
Protocol: Princeton
Bit: 24
Key: 00 00 00 00 00 5A 3C 98
TE: 211
Repeat: 200
`;

// .sub-fil
const c = parseSub(MARKISE_UD);
assert.deepStrictEqual(
  { f: c.frequency, p: c.protocol, b: c.bits, k: c.key, te: c.te, r: c.repeat },
  { f: 433920000, p: 'Princeton', b: 24, k: '5A3C98', te: 211, r: 200 },
);
assert.throws(() => parseSub('hej'), /Flipper/);

// Princeton: 1 = 3TE/1TE, 0 = 1TE/3TE, stopbit TE, pause 30 TE
const pr = encode({ protocol: 'Princeton', bits: 24, key: '5A3C98', te: 100 }).frame;
assert.strictEqual(pr.length, 50);
assert.deepStrictEqual(pr.slice(0, 4), [100, -300, 300, -100]); // 5 = 0101
assert.deepStrictEqual(pr.slice(4, 6), [100, -300]);
assert.deepStrictEqual(pr.slice(-2), [100, -3000]);

// CAME 12 bit: pause 47*320, startbit, 1 = pause 640/puls 320
const came = encode({ protocol: 'CAME', bits: 12, key: '800' }).frame;
assert.deepStrictEqual(came.slice(0, 4), [-47 * 320, 320, -640, 320]);

// Dooya: header afhænger af LSB, start 13*366 / 2*733
const dooya = encode({ protocol: 'Dooya', bits: 40, key: '1' }).frame;
assert.deepStrictEqual(dooya.slice(0, 3), [-(12 * 733 + 733), 13 * 366, -2 * 733]);

// Doorbell32 (Unleashed): som Princeton, men 32 bit og pause 14 TE
const door = encode({ protocol: 'Doorbell32', bits: 32, key: '5A3C91E7', te: 500 }).frame;
assert.strictEqual(door.length, 66);
assert.deepStrictEqual(door.slice(0, 4), [500, -1500, 1500, -500]); // 5 = 0101
assert.deepStrictEqual(door.slice(-2), [500, -7000]);

// Telcoma/Cardin EDGE (Unleashed): Manchester, halvbit 1270, 1 = høj+lav. Kanal 0 (porten):
// 32 bit + høj stop-halvbit; andre kanaler: 33 bit (nøgle << 1) uden stop. Pause 4 TE.
const tel = encode({ protocol: 'Telcoma/Cardin EDGE', bits: 32, key: 'FF309FC0' }).frame;
assert.deepStrictEqual(tel.slice(0, 2), [1270, -1270]);
assert.deepStrictEqual(tel.slice(-3), [-1270, 2540, -5080]); // ...0 0 + stop + pause
const telCh = encode({ protocol: 'Telcoma/Cardin EDGE', bits: 32, key: 'FF309FC2' }).frame;
assert.deepStrictEqual(telCh.slice(-3), [-1270, 1270, -5080]); // ...0 + ekstra 0, ingen stop
assert.strictEqual(tel.reduce((a, v) => a + Math.abs(v), 0), (65 + 4) * 1270);
assert.strictEqual(telCh.reduce((a, v) => a + Math.abs(v), 0), (66 + 4) * 1270);
const telSub = parseSub(MARKISE_UD.replace('Princeton', 'Telcoma/Cardin EDGE').replace('Bit: 24', 'Bit: 32')
  .replace('00 00 00 00 00 5A 3C 98', '00 00 00 00 FF 30 9F C0').replace('TE: 211\n', ''));
assert.strictEqual(telSub.protocol, 'Telcoma/Cardin EDGE');
assert.ok(plan(telSub, buildCatalog()).exact);

// Rullende og ukendte protokoller afvises forståeligt
assert.throws(() => encode({ protocol: 'KeeLoq', bits: 64, key: '1' }), /rullende/);
assert.throws(() => encode({ protocol: 'Princeton', bits: 12, key: '1', te: 300 }), /24/);

// Alle encodere kan køre og giver vekslende niveauer
for (const p of Object.values(PROTOCOLS)) {
  const bits = p.bitsMin ? p.bitsMax : p.bits[0];
  const { frame } = encode({ protocol: p.name, bits, key: 'A5', te: p.teDefault });
  for (let i = 1; i < frame.length; i++) assert.notStrictEqual(Math.sign(frame[i]), Math.sign(frame[i - 1]), p.name);
  assert.ok(toPairs(frame).length * 2 <= 256, `${p.name} for lang`);
}

// MegaCode (bygges baglæns i Flipper): 2*Bit elementer, slutter med puls
const mega = encode({ protocol: 'MegaCode', bits: 24, key: '1' }).frame;
assert.strictEqual(mega.length, 48);
assert.strictEqual(mega[0], -11000);
assert.strictEqual(mega[47], 1000);

// BinRAW-eksemplet fra Flippers dokumentation: TE 100, 0x37 = 00110111
assert.deepStrictEqual(binRawToPulses([{ bits: 8, hex: '37' }], 100), [-200, 200, -100, 300]);

// RAW: støj + 3 gentagelser -> én gentagelse med median-tider
const rep = [350, -1050, 1050, -350, 350, -1050, 1050, -350, 350, -10800];
// Første gentagelse har støj foran og tæller ikke med.
const noisy = [80, -40, ...rep, ...rep, ...rep.map((v) => Math.round(v * 1.04)), ...rep, 120];
const ex = extractRepetition(noisy);
assert.strictEqual(ex.copies, 3);
assert.deepStrictEqual(ex.frame, rep);

// Plan: markisen giver præcist Princeton-signal ved TE 210
const catalog = buildCatalog();
const p1 = plan(prepareCode({ sub: MARKISE_UD }), catalog);
assert.strictEqual(p1.signalId, 'te210_433920');
assert.ok(p1.exact);
assert.strictEqual(p1.frame.length, 25);
for (const [i, w] of p1.frame.entries()) assert.deepStrictEqual(catalog[p1.signalId].words[w], p1.pairs[i]);

// Faste protokoller giver præcise signaler; tvunget tabel giver ord-numre over 255
assert.ok(plan({ protocol: 'Dooya', bits: 40, key: '123456789A', frequency: 433920000 }, catalog).exact);
const g = plan(prepareCode({ sub: MARKISE_UD }), catalog, { forceGrid: true });
assert.strictEqual(g.signalId, 'grid_433920');
assert.ok(Math.max(...g.frame) > 255);

// Frekvens: nærmeste bærebølge, uden for 433,00–433,99 afvises
assert.strictEqual(plan({ ...c, frequency: 433420000 }, catalog).signalId, 'te210_433420');
assert.throws(() => plan({ ...c, frequency: 868350000 }, catalog), /433,00/);
assert.throws(() => prepareCode({ sub: MARKISE_UD.replace('Ook270', '2FSKDev476') }), /FSK/);

// Manuel indtastning som Flipper viser den
const manual = prepareCode({ protocol: 'princeton', key: '00 00 00 00 00 5A 3C 94', bits: 24, te: 211, frequency: '433,92' });
assert.strictEqual(describe(manual), 'Princeton · 24 bit · 5A3C94 · TE 211 µs · 433,92 MHz');
const raw = prepareCode({ protocol: 'RAW', raw: `RAW_Data: ${noisy.join(' ')}`, frequency: 433.92 });
assert.deepStrictEqual(raw.pulses, rep);
assert.deepStrictEqual(prepareCode({ pulses: raw.pulses, frequency: raw.frequency }).pulses, rep);
assert.ok(!plan(raw, catalog).exact);

// Engelske tekster
setLanguage('en');
assert.throws(() => encode({ protocol: 'KeeLoq', bits: 64, key: '1' }), /rolling codes/);
assert.throws(() => plan({ ...c, frequency: 868350000 }, catalog), /433.00–433.99 MHz/);
setLanguage('da');

// Lyt: simuleret modtagelse (Homey matcher [puls, pause] til nærmeste ord i rx-tabellerne, deler
// frames ved pauser over 5 ms og taber parret før pausen) skal dekodes til den samme kode.
{
  const { decodeFrame, decodeFrames, decodable } = require('../lib/decode');
  const { rxSignals, RX_IDS } = require('../lib/radio');
  const rx = rxSignals();
  assert.deepStrictEqual(Object.keys(rx), RX_IDS);
  for (const id of RX_IDS) {
    assert.ok(!catalog[id].txOnly, `${id} skal kunne modtage`);
    assert.ok(catalog[id].words.length <= 400, `${id} har for mange ord`);
  }
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  // Homeys modtagelse simuleres med lib/match.js (samme kode, som appen bruger til knapperne) + støj.
  const { matchIds, Matcher, onAir } = require('../lib/match');
  const receive = (frame, words, jitter = 0.1) => onAir(frame, words, () => 1 + (rnd() * 2 - 1) * jitter);
  const listen = (code) => {
    const { frame } = encode(code);
    return decodeFrames(RX_IDS.flatMap((id) => receive(frame, rx[id].words)));
  };
  const cases = [
    { protocol: 'Princeton', bits: 24, key: '5A3C91', te: 211 },
    { protocol: 'Princeton', bits: 24, key: '5A3C91', te: 420 },
    { protocol: 'CAME', bits: 12, key: 'A5C' },
    { protocol: 'CAME', bits: 24, key: '5A3C91' },
    { protocol: 'Nice FLO', bits: 24, key: '5A3C91' },
    { protocol: 'GateTX', bits: 24, key: '5A3C91' },
    { protocol: 'Intertechno_V3', bits: 32, key: '5A3C9100' },
    { protocol: 'SMC5326', bits: 25, key: '15A3C91', te: 300 },
    { protocol: 'Doorbell32', bits: 32, key: '5A3C91E7', te: 515 },
  ];
  for (const want of cases) {
    const r = listen(want);
    assert.ok(r, `${want.protocol} ikke dekodet`);
    assert.deepStrictEqual([r.code.protocol, r.code.bits, r.code.key], [want.protocol, want.bits, want.key], want.protocol);
    assert.strictEqual(r.code.frequency, 433920000);
    if (want.te) assert.ok(Math.abs(r.code.te - want.te) / want.te < 0.05, `${want.protocol} TE ${r.code.te} ≠ ${want.te}`);
    assert.ok(r.votes >= 3);
  }
  // Koden kan bruges direkte: prepareCode accepterer den, og den planlægges til et præcist signal.
  const heard = listen(cases[0]).code;
  assert.ok(plan(prepareCode(heard), catalog).exact);

  // Protokoller, hvor en bit går tabt i Homeys modtagelse, må ikke blive til en (forkert) kode.
  assert.ok(!decodable().includes('Roger') && !decodable().includes('Power Smart'));
  assert.ok(decodable().includes('Princeton') && decodable().includes('CAME'));
  assert.strictEqual(listen({ protocol: 'Roger', bits: 28, key: '5A3C910' }), null);
  assert.strictEqual(listen({ protocol: 'Mastercode', bits: 36, key: '5A3C910AB' }), null);
  // Støj giver ingen kode, og ét frame er ikke nok.
  const noise = Array.from({ length: 10 }, () => Array.from({ length: 30 }, () => rx.rx_a.words[Math.floor(rnd() * rx.rx_a.words.length)]));
  assert.strictEqual(decodeFrames(noise), null);
  const one = receive(encode(cases[0]).frame, rx.rx_a.words)[0];
  assert.ok(decodeFrame(one));
  assert.strictEqual(decodeFrames([one]), null);

  // Lyt efter den rigtige fjernbetjening: knappernes koder -> id'er, og modtagne frames -> tryk.
  const tables = RX_IDS.map((id) => rx[id].words);
  const prince = { protocol: 'Princeton', bits: 24, key: '5A3C91', te: 211, frequency: 433920000 };
  assert.deepStrictEqual(matchIds(prince, tables), ['Princeton|24|5A3C91']);
  // Holtek_HT12X høres som CAME; begge id'er tæller.
  assert.ok(matchIds({ protocol: 'Holtek_HT12X', bits: 12, key: 'A5C', te: 320, frequency: 433920000 }, tables).includes('CAME|12|A5C'));
  // RAW-optagelser genkendes, hvis signalet kan dekodes.
  const rawPrince = { protocol: 'RAW', pulses: encode(prince).frame.map((v) => Math.round(v * 1.05)), frequency: 433920000 };
  assert.deepStrictEqual(matchIds(rawPrince, tables), ['Princeton|24|5A3C91']);
  // Uden for Homeys modtageområde eller ukendt: ingen id'er.
  assert.deepStrictEqual(matchIds({ ...prince, frequency: 433420000 }, tables), []);
  assert.deepStrictEqual(matchIds({ protocol: 'Mastercode', bits: 36, key: '5A3C910AB', frequency: 433920000 }, tables), []);
  // Protokoller, der ikke kan dekodes, må heller ikke blive til en anden (kortere) protokol – fx kopier
  // af Holtek_HT12X i et ensartet Mastercode-frame, eller Roger (2:1) læst som SMC5326 (3:1) med frit TE.
  for (const [protocol, bits] of [['Mastercode', 36], ['Roger', 28], ['Dooya', 40], ['Hormann HSM', 44], ['MegaCode', 24], ['Marantec24', 24]]) {
    for (const key of ['0', ((1n << BigInt(bits)) - 1n).toString(16), '5A3C910AB5A'.slice(0, Math.ceil(bits / 4))]) {
      assert.deepStrictEqual(matchIds({ protocol, bits, key, frequency: 433920000 }, tables), [], `${protocol} ${key}`);
    }
  }
  // Hvert frame giver den rigtige kode – også i rx_b, hvor GateTX før blev læst som CAME en bit forskudt.
  for (const want of [{ protocol: 'GateTX', bits: 24, key: '5A3C91' }, { protocol: 'Holtek', bits: 40, key: '5A3C9100AB' }]) {
    for (const id of RX_IDS) {
      for (const f of receive(encode(want).frame, rx[id].words)) {
        const r = decodeFrame(f);
        assert.deepStrictEqual(r && [r.protocol, r.key], [want.protocol, want.key], `${want.protocol} i ${id}`);
      }
    }
  }

  const m = new Matcher();
  const target = { device: 'markise', id: 'b1' };
  m.setTargets([{ ids: matchIds(prince, tables), target }]);
  const heardFrames = receive(encode(prince).frame, rx.rx_a.words).map(decodeFrame);
  let t = 0;
  const fired = heardFrames.map((r) => m.frame(r, t += 50, 'rx_a')).filter((x) => x.length);
  assert.deepStrictEqual(fired, [[target]], 'ét tryk udløser én gang, selv med mange frames');
  assert.deepStrictEqual(m.frame(heardFrames[0], t += 2000, 'rx_a'), [], 'første frame af et nyt tryk er ikke nok');
  assert.deepStrictEqual(m.frame(heardFrames[0], t, 'rx_b'), [], 'samme frame i den anden tabel tæller ikke som nr. 2');
  assert.deepStrictEqual(m.frame(heardFrames[1], t += 50, 'rx_a'), [target], 'nyt tryk efter en pause');
  assert.deepStrictEqual(matchIds({ protocol: 'RAW', pulses: [-500, -300], frequency: 433920000 }, tables), [], 'kun pauser: ingen løkke');
  assert.deepStrictEqual(m.frame({ protocol: 'Princeton', bits: 24, key: '000001' }, t += 50), []);
  assert.deepStrictEqual(m.frame(null, t), []);
  m.setTargets([]);
  assert.strictEqual(m.size, 0);
}

// Knapfunktioner -> Homeys egne kontroller
{
  const { rolesFor, roleMap, roleCapabilities } = require('../lib/roles');
  const btn = (id, role) => ({ id, label: id, role });
  const cover = [btn('b1', 'up'), btn('b2', 'stop'), btn('b3', 'down')];
  assert.deepStrictEqual(rolesFor('remote'), []);
  assert.ok(rolesFor('sunshade').includes('stop') && rolesFor('socket').includes('toggle'));
  assert.deepStrictEqual(roleMap('sunshade', cover), { up: 'b1', stop: 'b2', down: 'b3' });
  assert.deepStrictEqual(roleMap('socket', cover), {}); // funktioner, der ikke passer til typen, tæller ikke
  assert.deepStrictEqual(roleCapabilities('sunshade', cover), ['windowcoverings_state']);
  assert.deepStrictEqual(roleCapabilities('blinds', cover, 20), ['windowcoverings_state', 'windowcoverings_set']);
  assert.deepStrictEqual(roleCapabilities('blinds', cover.slice(0, 1).concat(cover[2]), 20), ['windowcoverings_state']); // ingen Stop -> ingen position
  assert.deepStrictEqual(roleCapabilities('garagedoor', [btn('b1', 'toggle')]), ['garagedoor_closed']);
  assert.deepStrictEqual(roleCapabilities('light', [btn('b1', 'on'), btn('b2', 'off')]), ['onoff']);
  assert.deepStrictEqual(roleCapabilities('remote', cover, 20), []);
  assert.deepStrictEqual(roleCapabilities('socket', [btn('b1')]), []);
}

// Position ud fra køretid (20 s): 1 = oppe/inde, 0 = nede/ude
{
  const { CoverModel } = require('../lib/cover');
  const m = new CoverModel(20000, 1);
  assert.deepStrictEqual(m.plan(1, 0), null);
  assert.deepStrictEqual(m.plan(0.5, 0), { dir: -1, ms: 10000 });
  m.start(-1, 0);
  assert.strictEqual(m.at(5000), 0.75);
  m.stop(5000);
  assert.strictEqual(m.at(60000), 0.75); // står stille efter Stop
  assert.deepStrictEqual(m.plan(1, 60000), { dir: 1, ms: null }); // helt op: ingen Stop
  assert.deepStrictEqual(m.plan(0.995, 60000), { dir: 1, ms: null });
  assert.deepStrictEqual(m.plan(0.25, 60000), { dir: -1, ms: 10000 });
  assert.deepStrictEqual(m.plan(0.76, 60000), null); // allerede der
  m.start(-1, 60000);
  assert.strictEqual(m.at(200000), 0); // stopper i bunden
  m.settle(200000);
  assert.strictEqual(m.motion, null);
  assert.deepStrictEqual(m.plan(0, 200000), null);
  // Gem/fortryd og ny køretid undervejs
  const k = new CoverModel(20000, 1);
  const saved = k.snapshot();
  k.start(-1, 0);
  k.restore(saved); // udsendelsen fejlede
  assert.strictEqual(k.motion, null);
  assert.strictEqual(k.at(10000), 1);
  k.start(-1, 0);
  const json = JSON.parse(JSON.stringify(k.snapshot())); // overlever en genstart
  const r = new CoverModel(20000);
  r.restore(json);
  assert.strictEqual(r.at(5000), 0.75);
  r.retime(10000, 5000); // køretiden ændres til 10 s midt i bevægelsen
  assert.strictEqual(r.at(5000), 0.75);
  assert.strictEqual(r.at(7500), 0.5);
  assert.strictEqual(r.motion.dir, -1);
  // Markise: 100 % på skyderen = helt ude (intern 0); persienne: 100 % = helt oppe
  const { slider } = require('../lib/cover');
  assert.strictEqual(slider('sunshade', 1), 0);
  assert.strictEqual(slider('sunshade', 0.25), 0.75);
  assert.strictEqual(slider('blinds', 0.25), 0.25);
}

// Sprog: alle 13 sprog har samme nøgler og pladsholdere som engelsk – i locales/, app.json og changelog
{
  const fs = require('fs');
  const path = require('path');
  const i18n = require('../lib/i18n');
  const root = path.join(__dirname, '..');
  const LANGS = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];
  const holders = (s) => (String(s).match(/\{\w+\}|\[\[\w+\]\]/g) || []).sort().join(' ');
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));

  assert.deepStrictEqual(i18n.broken, [], 'ødelagte sprogfiler');
  const en = new Map(flat(JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'))));
  for (const l of LANGS) {
    const loc = new Map(flat(JSON.parse(fs.readFileSync(path.join(root, `locales/${l}.json`), 'utf8'))));
    assert.deepStrictEqual([...loc.keys()].sort(), [...en.keys()].sort(), `locales/${l}.json har andre nøgler end en`);
    for (const [k, v] of en) {
      if (k === 'lang') continue;
      assert.ok(String(loc.get(k)).trim(), `locales/${l}.json: ${k} er tom`);
      assert.strictEqual(holders(loc.get(k)), holders(v), `locales/${l}.json: ${k} har andre pladsholdere`);
    }
    assert.ok([',', '.'].includes(loc.get('lib.decimal')), `locales/${l}.json: decimal skal være , eller .`);
    assert.ok(fs.existsSync(path.join(root, l === 'en' ? 'README.txt' : `README.${l}.txt`)), `README for ${l} mangler`);
  }

  const texts = [];
  const walk = (o, p) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.en === 'string') { texts.push([p, o]); return; }
    for (const k of Object.keys(o)) walk(o[k], `${p}.${k}`);
  };
  const { signals, ...app } = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  walk(app, 'app.json');
  walk(JSON.parse(fs.readFileSync(path.join(root, '.homeychangelog.json'), 'utf8')), 'changelog');
  for (const [p, o] of texts) {
    assert.deepStrictEqual(Object.keys(o).sort(), [...LANGS].sort(), `${p} mangler sprog`);
    for (const l of LANGS) assert.strictEqual(holders(o[l]), holders(o.en), `${p}.${l} har andre pladsholdere`);
  }

  // Ukendt sprog → engelsk; sprogkilden (Homeys aktuelle sprog) vinder over setLanguage; komma pr. sprog
  setLanguage('xx');
  assert.strictEqual(i18n.msg('or'), 'or');
  let homeyLang = 'de';
  i18n.setLanguageSource(() => homeyLang);
  assert.strictEqual(i18n.msg('or'), 'oder');
  assert.strictEqual(i18n.num('433.92'), '433,92');
  homeyLang = 'ko';
  assert.strictEqual(i18n.num('433.92'), '433.92');
  homeyLang = 'zz';
  assert.strictEqual(i18n.msg('or'), 'or');
  i18n.setLanguageSource(null);
  setLanguage('da');
}

console.log('OK – alle selvtest bestået');
