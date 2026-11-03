/**
 * Country-law identity, canonical CIDs, and article inheritance.
 *
 * The hash and CID bytes follow country_laws_ir/cidutil.py: UTF-8 of
 * json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":")),
 * then CIDv1 raw (0x55) sha2-256, multibase base32 (bafkrei…).
 * Law and entry identities follow normalize.py. Article titles and empty
 * hierarchy fields follow instrument_inherit.py and are not written into
 * the entry CID, the body, or the body hash.
 */

export const CORPUS_SCHEMA_VERSION = 'country-laws-ir-graphrag/v1';
export const ENTRY_IDENTITY_SCHEMA = 'country-laws-entry/v1';
export const LAW_IDENTITY_SCHEMA = 'country-laws-law/v1';
export const INHERIT_VERSION = 'instrument-inherit/v1';

export const HEADING_KEYS = ['book', 'title', 'chapter', 'part', 'section'] as const;
export type HeadingKey = (typeof HEADING_KEYS)[number];

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const CID_PREFIX = new Uint8Array([0x01, 0x55, 0x12, 0x20]);
const HEADING_KIND: Record<string, HeadingKey> = {
  partie: 'part',
  part: 'part',
  livre: 'book',
  titre: 'title',
  titulo: 'title',
  título: 'title',
  chapitre: 'chapter',
  chapter: 'chapter',
  section: 'section',
};

const CODE_LINE = /^CODE [A-ZÀÂÉÈÊËÎÏÔÙÛÜÇŒ][A-ZÀÂÉÈÊËÎÏÔÙÛÜÇŒ '&-]{4,}$/;
const HEADING_LINE = /^(partie|livre|titre|titulo|título|chapitre|chapter|section|part)\s*-\s*(?:partie|livre|titre|chapitre|chapter|section|part(?:ie)?)?\s*([0-9]{1,4}|[IVXLCDM]{1,12})\b/i;
const ROMAN = /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/i;
const CODE_CAPTION = /^(code\b(?:[^\n>]{0,160}?))\s*>\s*article\b/i;
const CAPTION_TITLE = /^(?:article|art\.?|section|sec\.?|livre|titre|titulo|título|chapitre|chapter|partie|part|title)(?:[ \t]*[-–—.]?[ \t]*(?:[0-9]{1,4}(?:[.\-][0-9]{1,4})?[A-Za-z]?|[IVXLCDM]{1,12}|1er))?[ \t]*(?:[.:\-–—]+)?[ \t]*$/i;
const TITLE_LOI = /^article\s+([0-9]{1,4})\b(?:\s*,\s*[^,\n]{1,16})*\s+de\s+(?:la\s+|l['’])?((?:loi|ordonnance)\b.+?)\.?\s*$/i;
const HYPHEN_BREAK = /(?<=[^\W\d_])-[ \t]*\n+[ \t]*([^\W\d_])/gu;
/** Whole-line gazette chrome that country_laws_ir strips before hashing. */
const CHROME_LINE = /^(?:https?:\/\/\S+|www\.\S+(?:\s+\d+)?|\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s*$/i;

export interface LawIdentityInput {
  sourceDataset: string;
  instrumentId: string;
  instrumentTitle: string;
  jurisdiction: string;
  language: string;
}

export interface EntryIdentityInput {
  recordType: string;
  sourceDataset: string;
  instrumentId: string;
  articleNumber?: string | null;
  articleTitle?: string | null;
  bodySha256: string;
  language?: string | null;
  jurisdiction?: string | null;
  sourceUrl?: string | null;
}

export interface InheritancePlan {
  code: string;
  headings: Partial<Record<HeadingKey, string>>;
}

export interface InheritanceRow {
  law_id?: unknown;
  lawId?: unknown;
  text?: unknown;
  body?: unknown;
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(data);
  buffer[data.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const packed = new DataView(digest.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, index) => packed.setUint32(index * 4, word));
  return digest;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function sha256HexUtf8(text: string): string {
  return hex(sha256Bytes(utf8Bytes(text)));
}

function encodeString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function encodeJson(value: unknown, spaced: boolean): string {
  const comma = spaced ? ', ' : ',';
  const colon = spaced ? ': ' : ':';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON rejects non-finite numbers.');
    if (Object.is(value, -0)) return '0';
    if (Number.isInteger(value)) return String(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value)) return `[${value.map((item) => encodeJson(item, spaced)).join(comma)}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${encodeString(key)}${colon}${encodeJson(record[key], spaced)}`).join(comma)}}`;
  }
  throw new Error('Canonical JSON rejects this value.');
}

/** Compact canonical JSON. Same bytes as cidutil.canonical_json_bytes. */
export function canonicalJson(value: unknown): string {
  return encodeJson(value, false);
}

/** Python json.dumps(sort_keys=True, ensure_ascii=False) with default spacing. */
export function pythonJsonDumps(value: unknown): string {
  return encodeJson(value, true);
}

function base32Encode(data: Uint8Array): string {
  let value = 0n;
  let bits = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8n) | BigInt(byte);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[Number((value >> BigInt(bits)) & 31n)];
    }
  }
  if (bits) out += BASE32[Number((value << BigInt(5 - bits)) & 31n)];
  return out;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export function cidV1RawSha256(data: Uint8Array): string {
  return `b${base32Encode(concatBytes(CID_PREFIX, sha256Bytes(data)))}`;
}

export function cidOfJson(value: unknown): string {
  return cidV1RawSha256(utf8Bytes(canonicalJson(value)));
}

export function cidOfText(...parts: Array<string | null | undefined>): string {
  const blob = parts.map((part) => (part === undefined || part === null ? '' : String(part))).join('\n');
  return cidV1RawSha256(utf8Bytes(blob));
}

export function sha256KeyToCidV1(value: string): string {
  const text = String(value ?? '').trim();
  if (text.startsWith('bafkrei')) return text;
  const prefixed = text.toLowerCase().startsWith('sha256:');
  const hexPart = prefixed ? text.slice(7, 71) : text.slice(0, 64);
  const rest = prefixed ? text.slice(71) : text.slice(64);
  if (hexPart.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hexPart)) return text;
  const digest = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) digest[index] = Number.parseInt(hexPart.slice(index * 2, index * 2 + 2), 16);
  return `b${base32Encode(concatBytes(CID_PREFIX, digest))}${rest}`;
}

export function lawCid(input: LawIdentityInput): string {
  return cidOfJson({
    schema: LAW_IDENTITY_SCHEMA,
    source_dataset: input.sourceDataset,
    instrument_id: input.instrumentId,
    instrument_title: input.instrumentTitle,
    jurisdiction: input.jurisdiction,
    language: input.language,
  });
}

export function entryCid(input: EntryIdentityInput): string {
  return cidOfJson({
    schema: ENTRY_IDENTITY_SCHEMA,
    record_type: input.recordType,
    source_dataset: input.sourceDataset,
    instrument_id: input.instrumentId,
    article_number: input.articleNumber || '',
    article_title: input.articleTitle || '',
    body_sha256: input.bodySha256,
    language: input.language || '',
    jurisdiction: input.jurisdiction || '',
    source_url: input.sourceUrl || '',
  });
}

function isUpperLetter(value: string): boolean {
  return value.toUpperCase() === value && value.toLowerCase() !== value;
}

function joinHyphenBreaks(text: string): string {
  return text.replace(HYPHEN_BREAK, (full, next: string) => (isUpperLetter(next) ? full : next));
}

function stripIdentityChrome(text: string): string {
  return text.split('\n').filter((line) => !CHROME_LINE.test(line.trim())).join('\n');
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hexDigits: string) => String.fromCodePoint(Number.parseInt(hexDigits, 16)))
    .replace(/&#([0-9]+);/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripHtml(raw: string): string {
  if (!raw || !/<[A-Za-z/!]/.test(raw)) return raw;
  const stripped = raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeBasicEntities(stripped)
    .replaceAll('\u00a0', ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Null, NaN, and blank cells become empty. Plain fixture text is NFKC-stable.
 * HTML tags and common entities are removed. A whole line that is only a URL
 * or a numeric date is dropped, matching country_laws_ir chrome removal.
 * Other gazette chrome, latin1 repair, and learned line patterns stay out.
 */
export function normalizeLegalText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  let text = String(value).normalize('NFKC').replaceAll('\u0000', '');
  text = text.replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, ' ');
  text = text.replaceAll('\ufffd', ' ');
  text = text.replace(/[\ue000-\uf8ff]/g, '');
  text = text.replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, '-');
  text = text.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ');
  text = text.replaceAll('\u2028', '\n').replaceAll('\u2029', '\n').replaceAll('\f', '\n');
  text = joinHyphenBreaks(text);
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = stripHtml(text);
  text = decodeBasicEntities(text).replaceAll('\u00a0', ' ');
  text = text.replace(/_{3,}/g, ' ').replace(/\.{4,}/g, ' ');
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  text = stripIdentityChrome(text);
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = joinHyphenBreaks(text);
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

export function foldIdentity(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

function sourceText(row: InheritanceRow): string {
  if (typeof row.body === 'string' && row.body) return row.body;
  return typeof row.text === 'string' ? row.text : '';
}

function lawIdOf(row: InheritanceRow): string {
  if (typeof row.law_id === 'string') return row.law_id;
  if (typeof row.lawId === 'string') return row.lawId;
  return '';
}

export function inheritancePlan(rows: readonly InheritanceRow[]): Record<string, InheritancePlan> {
  const codes = new Map<string, Set<string>>();
  const headings = new Map<string, Map<HeadingKey, Set<string>>>();
  for (const row of rows) {
    const law = lawIdOf(row);
    if (!law.trim()) continue;
    const text = sourceText(row);
    const names = codes.get(law) ?? new Set<string>();
    codes.set(law, names);
    for (const line of text.split('\n')) {
      if (CODE_LINE.test(line)) names.add(line);
    }
    const bucket = headings.get(law) ?? new Map<HeadingKey, Set<string>>();
    headings.set(law, bucket);
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 80);
    for (const line of lines) {
      const heading = HEADING_LINE.exec(line);
      if (!heading) continue;
      const kind = HEADING_KIND[heading[1].toLowerCase()];
      if (!kind) continue;
      const rawNumber = heading[2];
      const number = /^\d+$/.test(rawNumber) ? rawNumber : rawNumber.toUpperCase();
      if (!/^\d+$/.test(number) && !ROMAN.test(number)) continue;
      const values = bucket.get(kind) ?? new Set<string>();
      values.add(number);
      bucket.set(kind, values);
    }
  }
  const plan: Record<string, InheritancePlan> = {};
  for (const [law, names] of codes) {
    if (names.size !== 1) continue;
    const sole: Partial<Record<HeadingKey, string>> = {};
    for (const [kind, values] of headings.get(law) ?? []) {
      if (values.size === 1 && HEADING_KEYS.includes(kind)) sole[kind] = [...values][0];
    }
    plan[law] = { code: [...names][0], headings: sole };
  }
  return plan;
}

function namesOtherInstrument(title: string, text: string): boolean {
  if (TITLE_LOI.test(title)) return true;
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (stripped) return TITLE_LOI.test(stripped);
  }
  return false;
}

export function replacementTitle(title: string, text: string, lawCode: string | null): string | null {
  if (!lawCode) return null;
  const label = title.trim();
  if (namesOtherInstrument(label, text)) return null;
  if (!label || CAPTION_TITLE.test(label)) return lawCode;
  const caption = CODE_CAPTION.exec(label);
  if (caption && foldIdentity(caption[1]) === foldIdentity(lawCode)) return lawCode;
  return null;
}

function acceptsHierarchy(title: string, text: string, lawCode: string | null): boolean {
  if (!lawCode) return false;
  if (foldIdentity(title) === foldIdentity(lawCode)) return true;
  return replacementTitle(title, text, lawCode) !== null;
}

function copyProvenance(value: unknown): { provenance: Record<string, unknown> | null; encoded: boolean } {
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const loaded = JSON.parse(value) as unknown;
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        return { provenance: loaded as Record<string, unknown>, encoded: true };
      }
    } catch {
      return { provenance: null, encoded: true };
    }
    return { provenance: null, encoded: true };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const loaded = JSON.parse(pythonJsonDumps(value)) as unknown;
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      return { provenance: loaded as Record<string, unknown>, encoded: false };
    }
  }
  return { provenance: null, encoded: false };
}

function storeProvenance(provenance: Record<string, unknown>, encoded: boolean): string | Record<string, unknown> {
  const dumped = pythonJsonDumps(provenance);
  if (encoded) return dumped;
  const loaded = JSON.parse(dumped) as unknown;
  return loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded as Record<string, unknown> : {};
}

function noteJsonLd(provenance: Record<string, unknown>, name: string | null, added: Record<string, string>): void {
  const document = provenance.jsonld;
  if (!document || typeof document !== 'object' || Array.isArray(document)) return;
  const doc = document as Record<string, unknown>;
  const before = doc.text;
  if (name) doc.name = name;
  const keys = Object.keys(added);
  if (keys.length) {
    const properties = Array.isArray(doc.additionalProperty) ? doc.additionalProperty : [];
    if (!Array.isArray(doc.additionalProperty)) doc.additionalProperty = properties;
    const present = new Set(
      properties
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map((item) => item.propertyID)
        .filter((item): item is string => typeof item === 'string'),
    );
    for (const key of keys) {
      if (present.has(key)) continue;
      properties.push({ '@type': 'PropertyValue', propertyID: key, value: added[key] });
    }
  }
  if (doc.text !== before) throw new Error('text');
}

export function refineAtom(
  record: Record<string, unknown>,
  lawCode: string | null,
  headings: Partial<Record<HeadingKey, string>>,
): Record<string, unknown> {
  const updated: Record<string, unknown> = { ...record };
  const text = typeof updated.text === 'string' ? updated.text : '';
  const current = typeof updated.title === 'string' ? updated.title : '';
  let newTitle = replacementTitle(current, text, lawCode);
  if (newTitle === current) newTitle = null;
  const copied = copyProvenance(updated.provenance);
  const added: Record<string, string> = {};
  if (copied.provenance && acceptsHierarchy(current, text, lawCode)) {
    for (const key of HEADING_KEYS) {
      const value = headings[key] ?? '';
      if (!value) continue;
      const already = copied.provenance[key];
      if (typeof already === 'string' && already.trim()) continue;
      copied.provenance[key] = value;
      added[key] = value;
    }
    noteJsonLd(copied.provenance, newTitle, added);
  } else if (copied.provenance && newTitle) {
    noteJsonLd(copied.provenance, newTitle, {});
  }
  if (newTitle) updated.title = newTitle;
  if (copied.provenance && (newTitle || Object.keys(added).length)) {
    updated.provenance = storeProvenance(copied.provenance, copied.encoded);
  }
  if (updated.text !== record.text) throw new Error('text');
  return updated;
}

export function gainedHeadings(before: unknown, after: unknown): HeadingKey[] {
  const oldCopy = copyProvenance(before);
  const newCopy = copyProvenance(after);
  if (!oldCopy.provenance || !newCopy.provenance) return [];
  const gained: HeadingKey[] = [];
  for (const key of HEADING_KEYS) {
    const previous = oldCopy.provenance[key];
    const current = newCopy.provenance[key];
    if ((typeof previous !== 'string' || !previous.trim()) && typeof current === 'string' && current.trim()) gained.push(key);
  }
  return gained;
}
