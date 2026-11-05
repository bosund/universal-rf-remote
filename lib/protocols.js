'use strict';

const { err, msg } = require('./i18n');

// Encodere for Flippers faste (ikke-rullende) Sub-GHz-protokoller.
// Porteret fra flipperzero-firmware lib/subghz/protocols/*.c (_get_upload), branch dev.
// Original: Copyright (C) Flipper Devices Inc. og flipperzero-firmware contributors,
// GPL-3.0 – https://github.com/flipperdevices/flipperzero-firmware. Denne fil er ligeledes GPL-3.0.
// Doorbell32 og Telcoma/Cardin EDGE er porteret fra Unleashed-firmwaren (DarkFlippers, GPL-3.0) –
// https://github.com/DarkFlippers/unleashed-firmware.
// Hver encoder giver ét frame som signerede µs (+ = sender, - = pause) og evt. `inner`:
// antal kopier Flipper lægger i ét upload (vi sender i stedet frame'et inner × flere gange).

class Wave {
  constructor() { this.p = []; }
  on(us) { return this.add(us); }
  off(us) { return this.add(-us); }
  add(v) {
    v = Math.round(v);
    const last = this.p[this.p.length - 1];
    if (last !== undefined && Math.sign(last) === Math.sign(v)) this.p[this.p.length - 1] += v;
    else this.p.push(v);
    return this;
  }
}

// Bits MSB først (som Flipper: i = Bit..1, bit_read(data, i-1)).
function bitsOf(key, n) {
  const data = BigInt(`0x${key}`);
  const out = [];
  for (let i = n; i > 0; i--) out.push(Number((data >> BigInt(i - 1)) & 1n));
  return out;
}

// toolbox/manchester_encoder.c. Resultat: 0 ShortLow, 1 LongLow, 2 LongHigh, 3 ShortHigh.
function manchester(w, bits, short, long, { header } = {}) {
  const emit = (r) => (r === 0 ? w.off(short) : r === 1 ? w.off(long) : r === 2 ? w.on(long) : w.on(short));
  let step = 0;
  let prev = 0;
  const advance = (curr) => {
    if (step === 0) { prev = curr; step = 1; return [true, curr ? 0 : 3]; }
    if (step === 1) {
      const r = (prev << 1) + curr;
      if (curr === prev) { step = 2; return [false, r]; }
      prev = curr; return [true, r];
    }
    prev = curr; step = 1; return [true, curr ? 0 : 3];
  };
  bits.forEach((b, idx) => {
    let [ok, r] = advance(b);
    if (!ok) { emit(r); [, r] = advance(b); }
    emit(r);
    if (idx === 0 && header) header(w);
  });
  const fin = (prev << 1) + prev;
  if (fin === 2 || fin === 3) emit(fin); // kun hvis høj (som Flipper)
}

// Fælles form: header-pause, startbit, derefter pause+puls pr. bit.
function offOnStyle({ header, start, b1, b0 }) {
  return (bits) => {
    const w = new Wave().off(header).on(start);
    for (const b of bits) (b ? b1 : b0).forEach(([l, d]) => (l ? w.on(d) : w.off(d)));
    return w.p;
  };
}

// Fælles form: puls+pause pr. bit, sidste bits pause erstattes af et gap.
function lastGapStyle({ b1, b0, gap1, gap0 }) {
  return (bits) => {
    const w = new Wave();
    bits.forEach((b, i) => {
      const last = i === bits.length - 1;
      w.on(b ? b1[0] : b0[0]).off(last ? (b ? gap1 : gap0) : (b ? b1[1] : b0[1]));
    });
    return w.p;
  };
}

const P = {};
const def = (name, spec) => { P[name] = { name, ...spec }; };

// --- Protokoller hvor TE står i filen --------------------------------------
def('Princeton', {
  bits: [24], teFromFile: true, teDefault: 400, teRange: [100, 1200],
  encode(bits, { te, guardTime }) {
    const g = guardTime >= 15 && guardTime <= 72 ? guardTime : 30;
    const w = new Wave();
    for (const b of bits) (b ? w.on(3 * te).off(te) : w.on(te).off(3 * te));
    return w.on(te).off(g * te).p;
  },
});
def('Holtek_HT12X', {
  bits: [12], teFromFile: true, teDefault: 320, teRange: [100, 1200],
  encode(bits, { te }) {
    return offOnStyle({ header: 36 * te, start: te, b1: [[0, 2 * te], [1, te]], b0: [[0, te], [1, 2 * te]] })(bits);
  },
});
def('SMC5326', {
  bits: [25], teFromFile: true, teDefault: 300, teRange: [100, 1200],
  encode(bits, { te }) {
    const w = new Wave();
    for (const b of bits) (b ? w.on(3 * te).off(te) : w.on(te).off(3 * te));
    return w.on(te).off(25 * te).p;
  },
});
def('Legrand', {
  bits: [18], teFromFile: true, teDefault: 375, teRange: [100, 1200], inner: 5,
  encode(bits, { te }) {
    const w = new Wave().off(16 * te);
    bits.forEach((b, i) => {
      if (i === 0) w.on(b ? 3 * te : te);
      else if (b) w.off(te).on(3 * te);
      else w.off(3 * te).on(te);
    });
    return w.p;
  },
});

// --- Protokoller med faste tider ------------------------------------------
def('CAME', {
  bits: [12, 18, 24, 25, 42], bitsMax: 42,
  encode(bits) {
    const n = bits.length;
    const h = n === 24 || n === 42 ? 76 : n === 12 || n === 18 ? 47 : n === 25 ? 36 : 16;
    return offOnStyle({ header: h * 320, start: 320, b1: [[0, 640], [1, 320]], b0: [[0, 320], [1, 640]] })(bits);
  },
});
def('Nice FLO', {
  bits: [12, 24], bitsMin: 12, bitsMax: 24,
  encode: offOnStyle({ header: 36 * 700, start: 700, b1: [[0, 1400], [1, 700]], b0: [[0, 700], [1, 1400]] }),
});
def('Holtek', {
  bits: [40],
  encode: offOnStyle({ header: 36 * 430, start: 430, b1: [[0, 870], [1, 430]], b0: [[0, 430], [1, 870]] }),
});
def('Linear', {
  bits: [10],
  encode: lastGapStyle({ b1: [1500, 500], b0: [500, 1500], gap1: 42 * 500, gap0: 44 * 500 }),
});
def('LinearDelta3', {
  bits: [8],
  encode: lastGapStyle({ b1: [500, 3500], b0: [2000, 2000], gap1: 73 * 500, gap0: 70 * 500 }),
});
def('GateTX', {
  bits: [24],
  encode: offOnStyle({ header: 49 * 350, start: 700, b1: [[0, 700], [1, 350]], b0: [[0, 350], [1, 700]] }),
});
def('Cham_Code', {
  bits: [7, 8, 9],
  encode(bits) {
    let code = 0n;
    for (const b of bits) code = (code << 4n) | (b ? 0b0011n : 0b0111n);
    let data;
    let chips;
    if (bits.length === 7) { data = ((code >> 4n) << 16n) | ((code & 0xFn) << 4n) | 0x10000001101n; chips = 44; }
    else if (bits.length === 8) { data = ((code >> 12n) << 16n) | ((code & 0xFFn) << 4n) | 0x1000001001n; chips = 40; }
    else { data = (code << 4n) | 0x10000000001n; chips = 44; }
    const w = new Wave().off(36 * 1000);
    for (let i = chips; i > 0; i--) (((data >> BigInt(i - 1)) & 1n) ? w.on(1000) : w.off(1000));
    return w.p;
  },
});
def('MegaCode', {
  bits: [24],
  encode(bits) {
    // Flipper bygger baglæns fra LSB; her samme logik, vendt til sidst.
    const te = 1000;
    const lsbFirst = bits.slice().reverse();
    const rev = [te]; // sidste puls
    let prev = lsbFirst[0];
    for (let i = 1; i < lsbFirst.length; i++) {
      const cur = lsbFirst[i];
      rev.push(-(cur ? (prev ? 5 : 2) : (prev ? 8 : 5)) * te, te);
      prev = cur;
    }
    rev.push(-(lsbFirst[0] ? 11 : 14) * te);
    const w = new Wave();
    for (let i = rev.length - 1; i >= 0; i--) w.add(rev[i]);
    return w.p;
  },
});
def('Ansonic', {
  bits: [12],
  encode: offOnStyle({ header: 35 * 555, start: 555, b1: [[0, 555], [1, 1111]], b0: [[0, 1111], [1, 555]] }),
});
def('Phoenix_V2', {
  bits: [52],
  encode: offOnStyle({ header: 60 * 427, start: 6 * 427, b1: [[0, 427], [1, 853]], b0: [[0, 853], [1, 427]] }),
});
def('Power Smart', {
  bits: [64], inner: 8,
  encode(bits) {
    const w = new Wave();
    manchester(w, bits.map((b) => 1 - b), 225, 450);
    return w.off(32767).p; // Flipper: 1111*TEl ≈ 0,5 s – begrænset af Homey
  },
});
def('BETT', {
  bits: [18],
  encode: lastGapStyle({ b1: [2000, 340], b0: [340, 2000], gap1: 340 + 7 * 2000, gap0: 2000 + 7 * 2000 }),
});
def('Doitrand', {
  bits: [37],
  encode: offOnStyle({ header: 62 * 400, start: 700, b1: [[0, 1100], [1, 400]], b0: [[0, 400], [1, 1100]] }),
});
def('Intertechno_V3', {
  bits: [32, 36],
  encode(bits) {
    const s = 275;
    const l = 1375;
    const w = new Wave().on(s).off(38 * s).on(s).off(10 * s);
    bits.forEach((b, idx) => {
      const i = bits.length - idx; // Flippers tæller
      if (bits.length === 36 && i === 9) w.on(s).off(s).on(s).off(s);
      else if (b) w.on(s).off(l).on(s).off(s);
      else w.on(s).off(s).on(s).off(l);
    });
    return w.p;
  },
});
def('Clemsa', {
  bits: [18],
  encode: lastGapStyle({ b1: [2695, 385], b0: [385, 2695], gap1: 385 + 7 * 2695, gap0: 2695 + 7 * 2695 }),
});
def('Dooya', {
  bits: [40],
  encode(bits) {
    const s = 366;
    const l = 733;
    const w = new Wave().off(12 * l + (bits[bits.length - 1] ? l : s)).on(13 * s).off(2 * l);
    for (const b of bits) (b ? w.on(l).off(s) : w.on(s).off(l));
    return w.p;
  },
});
def('Hormann HSM', {
  bits: [44], inner: 20,
  encode(bits) {
    const w = new Wave().on(24 * 500).off(500);
    for (const b of bits) (b ? w.on(1000).off(500) : w.on(500).off(1000));
    return w.p;
  },
});
def('Marantec', {
  bits: [49],
  encode(bits) {
    const w = new Wave();
    manchester(w, bits, 1000, 2000, { header: (x) => x.off(5 * 2000) });
    return w.p;
  },
});
def('Marantec24', {
  bits: [24], inner: 4,
  encode(bits) {
    const s = 800;
    const l = 1600;
    const w = new Wave().off(9 * l);
    bits.forEach((b, i) => {
      const last = i === bits.length - 1;
      w.on(b ? s : l).off(last ? 9 * l + s : (b ? 2 * l : 3 * s));
    });
    return w.p;
  },
});
def('Mastercode', {
  bits: [36],
  encode: lastGapStyle({ b1: [2145, 1072], b0: [1072, 2145], gap1: 1072 + 13 * 1072, gap0: 2145 + 13 * 1072 }),
});
def('Dickert_MAHS', {
  bits: [36],
  encode: offOnStyle({ header: 112 * 400, start: 400, b1: [[0, 800], [1, 400]], b0: [[0, 400], [1, 800]] }),
});
def('Magellan', {
  bits: [32],
  encode(bits) {
    const s = 200;
    const l = 400;
    const w = new Wave().on(4 * s).off(s);
    for (let i = 0; i < 12; i++) w.on(s).off(s);
    w.on(s).off(l).on(3 * l).off(l);
    for (const b of bits) (b ? w.on(s).off(l) : w.on(l).off(s));
    return w.on(s).off(100 * l).p;
  },
});
def('Feron', {
  bits: [32],
  encode(bits) {
    const s = 350;
    const l = 750;
    const w = new Wave();
    bits.forEach((b, i) => {
      w.on(b ? l : s);
      if (i === bits.length - 1) w.off(s + 150).on(s + 150).off(6 * l);
      else w.off(b ? s : l);
    });
    return w.p;
  },
});
def('Nero Radio', {
  bits: [56],
  encode(bits) {
    const s = 200;
    const l = 400;
    const w = new Wave();
    for (let i = 0; i < 49; i++) w.on(s).off(s);
    w.on(4 * s).off(s);
    bits.forEach((b, i) => {
      const last = i === bits.length - 1;
      w.on(b ? l : s).off(last ? 37 * s : (b ? s : l));
    });
    return w.p;
  },
});
def('Nero Sketch', {
  bits: [40],
  encode(bits) {
    const s = 330;
    const l = 660;
    const w = new Wave();
    for (let i = 0; i < 47; i++) w.on(s).off(s);
    w.on(4 * s).off(s);
    for (const b of bits) (b ? w.on(l).off(s) : w.on(s).off(l));
    return w.on(3 * s).off(s).p;
  },
});
def('Honeywell', {
  bits: [48],
  encode(bits) {
    const w = new Wave().off(3 * 160);
    for (const b of bits) (b ? w.on(320).off(160) : w.on(160).off(320));
    return w.on(3 * 160).p;
  },
});
def('Elplast', {
  bits: [18],
  encode: lastGapStyle({ b1: [1550, 230], b0: [230, 1550], gap1: 8 * 1550, gap0: 8 * 1550 }),
});
def('Roger', {
  bits: [28],
  encode: lastGapStyle({ b1: [1000, 500], b0: [500, 1000], gap1: 19 * 500, gap0: 19 * 500 }),
});

// --- Fra Unleashed (DarkFlippers/unleashed-firmware, dev, GPL-3.0) --------------------
// Doorbell32 (doorbell32.c, 2026-10-14): som Princeton, men 32 bit og pause 14 TE. TE står i filen.
def('Doorbell32', {
  bits: [32], teFromFile: true, teDefault: 515, teRange: [100, 1200],
  encode(bits, { te }) {
    const w = new Wave();
    for (const b of bits) (b ? w.on(3 * te).off(te) : w.on(te).off(3 * te));
    return w.on(te).off(14 * te).p;
  },
});
// Telcoma/Cardin EDGE (telcoma_edge.c, 2026-08-31): Manchester, halvbit 1270 µs, 1 = høj+lav.
// De nederste 3 bit er kanalen: kanal 0 (porten) = 32 bit + en høj stop-halvbit,
// andre kanaler = 33 bit (nøgle << 1) uden stop. Pause 4 TE mellem frames.
def('Telcoma/Cardin EDGE', {
  bits: [32],
  encode(bits) {
    const te = 1270;
    const gate = !bits[29] && !bits[30] && !bits[31];
    const w = new Wave();
    for (const b of gate ? bits : [...bits, 0]) (b ? w.on(te).off(te) : w.off(te).on(te));
    if (gate) w.on(te);
    return w.off(4 * te).p;
  },
});

// Rullende koder – kan ikke genudsendes.
const ROLLING = [
  'KeeLoq', 'Nice FloR-S', 'CAME Atomo', 'Faac SLH', 'Alutech AT-4N', 'Somfy Telis', 'Somfy Keytis',
  'Star Line', 'Scher-Khan', 'KIA Seed', 'Hay21', 'iDo 117/111', 'KingGates Stylo4k',
  'Security+ 1.0', 'Security+ 2.0',
];
// Faste, men ikke implementeret (de genberegner tjeksum/pakker) – brug en RAW-optagelse.
const UNSUPPORTED = ['CAME TWEE', 'GangQi', 'Hollarm', 'Revers_RB2'];

function findProtocol(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return Object.values(P).find((p) => p.name.toLowerCase() === n) || null;
}

// Kode-objekt -> { frame: signerede µs, inner, te }
function encode(code, { te: teOverride } = {}) {
  const p = findProtocol(code.protocol);
  if (!p) {
    if (ROLLING.some((r) => r.toLowerCase() === String(code.protocol).toLowerCase())) {
      throw err('rolling', { protocol: code.protocol });
    }
    if (UNSUPPORTED.some((r) => r.toLowerCase() === String(code.protocol).toLowerCase())) {
      throw err('unsupported', { protocol: code.protocol });
    }
    throw err('unknown_protocol', { protocol: code.protocol });
  }
  const n = Number(code.bits);
  const okBits = p.bitsMin ? n >= p.bitsMin && n <= p.bitsMax : p.bits.includes(n);
  if (!okBits) throw err('bits', { protocol: p.name, bits: p.bits.join(` ${msg('or')} `), got: code.bits });
  // Som Flipper: kun de nederste Bit bits af nøglen bruges.
  let te;
  if (p.teFromFile) {
    te = teOverride || Number(code.te) || p.teDefault;
    if (te < p.teRange[0] || te > p.teRange[1]) throw err('te_range', { te, min: p.teRange[0], max: p.teRange[1] });
  }
  const frame = p.encode(bitsOf(code.key, n), { te, guardTime: Number(code.guardTime) || 30 });
  return { frame, inner: p.inner || 1, te };
}

module.exports = {
  PROTOCOLS: P, ROLLING, UNSUPPORTED, findProtocol, encode, bitsOf, Wave, manchester,
};
