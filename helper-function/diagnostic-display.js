/**
 * Tampilan hasil diagnostik kiosk yang panjang: teks sensor 0x78 dipecah per sensor,
 * hasil berisi banyak bagian dipecah per bagian. Tanpa database.
 *
 * Singkatan sensor berasal dari pinyin firmware mesin XY (lihat SENSOR_GLOSSARY).
 */

/** Urutan tampilan glosarium juga urutan ini. */
const SENSOR_GLOSSARY = [
  {
    code: "SJT TG",
    name: "Pendorong lift",
    origin: "升降台推杆 · shēng jiàng tái tuī gǎn",
    meaning: "Batang yang mendorong kotak dari lift masuk ke microwave. go = maju (mendorong), back = mundur.",
  },
  {
    code: "JHK",
    name: "Pintu masuk microwave (belakang)",
    origin: "进货口 · jìn huò kǒu",
    meaning:
      "Pintu tempat lift memasukkan kotak ke microwave. Error 0x11 / E11 \"inlet door closing error\" menunjuk pintu ini.",
  },
  {
    code: "CHK",
    name: "Pintu ambil microwave (depan)",
    origin: "出货口 · chū huò kǒu",
    meaning: "Pintu tempat pembeli mengambil kotak yang sudah dipanaskan.",
  },
  {
    code: "WBL TG",
    name: "Pendorong dalam microwave",
    origin: "微波炉内推杆 · wēi bō lú tuī gǎn",
    meaning: "Batang di dalam microwave yang mendorong kotak ke pintu ambil.",
  },
  {
    code: "SJT bottom",
    name: "Lift di posisi bawah",
    origin: "升降台 · shēng jiàng tái",
    meaning: "Sakelar batas bawah lift.",
  },
  {
    code: "SJT left",
    name: "Sensor kiri lift",
    origin: "升降台 · shēng jiàng tái",
    meaning: "Sakelar posisi sisi kiri lift. Dokumentasi tidak menjelaskan lebih rinci.",
  },
  {
    code: "SJT right",
    name: "Sensor kanan lift",
    origin: "升降台 · shēng jiàng tái",
    meaning: "Sakelar posisi sisi kanan lift. Dokumentasi tidak menjelaskan lebih rinci.",
  },
  {
    code: "SJT Ir",
    name: "Sensor inframerah lift",
    origin: "升降台红外 · IR",
    meaning: "Sensor cahaya di lift, untuk mendeteksi ada kotak atau tidak.",
  },
  {
    code: "FJS",
    name: "Sensor anti-jepit (dugaan)",
    origin: "防夹手 · fáng jiā shǒu (dugaan, tidak disebut dokumentasi)",
    meaning: "Kemungkinan sensor pengaman tangan di pintu. 0 berarti tidak ada yang terhalang.",
  },
  {
    code: "FJS AD",
    name: "Nilai mentah sensor anti-jepit",
    origin: "AD = analog-digital",
    meaning: "Angka mentah dari beberapa titik sensor. Yang penting angkanya mirip satu sama lain.",
  },
  {
    code: "Ver",
    name: "Versi firmware papan lunch box",
    origin: "",
    meaning: "Versi program di papan pengontrol lunch box.",
  },
];

const GLOSSARY_BY_CODE = new Map(SENSOR_GLOSSARY.map((g) => [g.code.toLowerCase(), g]));

const LEGEND = /switch\s+ON/i;

function bitText(bit) {
  if (bit === "1") return "ON (1)";
  if (bit === "0") return "OFF (0)";
  return bit;
}

/** "open-0,close-1" → { open: "0", close: "1" }; null bila bukan pasangan key-bit. */
function parsePairs(body) {
  const out = {};
  for (const part of String(body).split(",")) {
    const m = part.trim().match(/^([A-Za-z]+)-(\d+)$/);
    if (!m) return null;
    out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function pairState(pairs) {
  if (pairs.open !== undefined && pairs.close !== undefined) {
    if (pairs.close === "1" && pairs.open === "0") return { text: "Tertutup", tone: "ok" };
    if (pairs.open === "1" && pairs.close === "0") return { text: "Terbuka", tone: "warn" };
    return { text: "Posisi tidak jelas", tone: "warn" };
  }
  if (pairs.go !== undefined && pairs.back !== undefined) {
    if (pairs.back === "1" && pairs.go === "0") return { text: "Mundur", tone: "ok" };
    if (pairs.go === "1" && pairs.back === "0") return { text: "Maju", tone: "warn" };
    return { text: "Di tengah", tone: "warn" };
  }
  return null;
}

function sensorRow(code, raw, value) {
  const g = GLOSSARY_BY_CODE.get(code.toLowerCase());
  return {
    code,
    name: g ? g.name : code,
    raw,
    value,
    tone: "plain",
    known: Boolean(g),
  };
}

/** Satu bagian teks sensor, misalnya "JHK open-0,close-1" atau "FJS AD:250,249". */
function parseSensorField(field) {
  const raw = String(field || "").trim();
  if (!raw || LEGEND.test(raw)) return null;

  const colon = raw.indexOf(":");
  if (colon > 0) {
    const code = raw.slice(0, colon).trim();
    const val = raw.slice(colon + 1).trim();
    return sensorRow(code, raw, /^[01]$/.test(val) ? bitText(val) : val);
  }

  const m = raw.match(/^(.*?)\s*((?:[A-Za-z]+-\d+)(?:\s*,\s*[A-Za-z]+-\d+)*)$/);
  if (!m) return sensorRow(raw, raw, "");

  const head = m[1].trim();
  const pairs = parsePairs(m[2]);
  const keys = pairs ? Object.keys(pairs) : [];

  if (pairs && keys.length === 1) {
    const code = head ? `${head} ${keys[0]}` : keys[0];
    return sensorRow(code, raw, bitText(pairs[keys[0]]));
  }

  const row = sensorRow(head || raw, raw, m[2]);
  const state = pairs ? pairState(pairs) : null;
  if (state) {
    row.value = state.text;
    row.tone = state.tone;
  }
  return row;
}

/** Teks sensor dari kiosk (values.fields, atau detail yang dipisah " · "). */
function sensorRows(diag) {
  if (!diag || typeof diag !== "object") return [];
  const values = diag.values && typeof diag.values === "object" ? diag.values : {};
  const fields = Array.isArray(values.fields)
    ? values.fields
    : String(diag.detail || "").split(/\s+·\s+|;/);
  return fields.map(parseSensorField).filter(Boolean);
}

/** Hasil berisi 3 bagian atau lebih ("a · b · c") dipecah supaya tidak jadi satu baris panjang. */
function noteParts(note) {
  const parts = String(note || "")
    .split(/\s+·\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length >= 3 ? parts : [];
}

module.exports = { SENSOR_GLOSSARY, sensorRows, noteParts, parseSensorField };
