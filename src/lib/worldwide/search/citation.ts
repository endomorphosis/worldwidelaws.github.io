/**
 * Exact citation assignment and lookup pinned to country_laws_ir/citations.py
 * and duckdb_store.cite_search.
 *
 * officialCitation and nativeIdentifier keep the source identifier, including
 * diacritics and non-Latin text. Bluebook text is emitted only for a pinned
 * T2 row with emit "bluebook" whose required fields are present. Unknown
 * jurisdictions are never given an invented Bluebook form.
 *
 * citeKey matches normalize_cite_key: NFKC, lowercase, section-sign and
 * article/section word folding, then ASCII [^a-z0-9] deletion. That key
 * deletes ó rather than folding it to o. Exact native lookup does not use it.
 *
 * cite_search matches lower(bluebook), lower(official), or cite_key for
 * formats any, bluebook, and official. The cite_key comparison is included
 * for every format. Results are ordered by law id, then official citation.
 */

export const CITATION_UPSTREAM = {
  repository: "/home/barberb/lift_coding/external/ipfs_datasets",
  commit: "2ea4ca6804b3c4cc44e43d0539f4c3fcae011747",
  license: "AGPL-3.0-only",
  files: {
    citations: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/citations.py",
      sha256: "5b0b0d8d4083ddf9a186b8f27a1d8ad48b85cbe2584ec07119274455a7ea63d3",
    },
    bluebook: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/data/bluebook_t2.json",
      sha256: "3ebb330f51d4c235d7e1a0168fddabfd236212335d466f955f790122be1cbba8",
    },
  },
} as const;

export const CITATION_LIMITATIONS = [
  "Bluebook text is emitted only when the pinned table says emit bluebook. In this table that is the United States row. Other known countries stay official_only.",
  "An unknown jurisdiction never receives an invented Bluebook abbreviation.",
  "The United States Bluebook form does not include the title number. Title is only a required field. The official citation carries the identifier.",
  "Pinpoint suppression is a case-insensitive substring test, so art. 1 is treated as already present inside art. 12.",
  "citeKey deletes every non-ASCII character. Código becomes c digo, not codigo. Diacritics survive on officialCitation and nativeIdentifier.",
  "ORS 1.010 and Or. Rev. Stat. § 1.010 do not share a citeKey. The upstream note describes a later alias, not current equality.",
  "Slug is consulted before country and jurisdiction, so a usa slug selects U.S.C. even when the jurisdiction string differs.",
  "Non-Latin official text collapses to its ASCII pinpoint on citeKey, so unrelated instruments can share art 1. Native lookup does not use that key.",
  "A pinpoint alone is not a citation. With no eli, official identifier, identifier, or title, the status is unknown.",
  "Lookup is exact. It is not BM25, not stemmed, and not cross-lingual.",
  "Formats bluebook and official also match citeKey, matching duckdb cite_search.",
  "Year is the caller year, or the first four digits of snapshotDate when year is empty, matching the normalize.py call site.",
] as const;

export type CitationStatus = "bluebook" | "official_only" | "unknown";
export type CitationLookupFormat = "any" | "bluebook" | "official" | "native";

interface BluebookRow {
  abbrev: string;
  emit: "bluebook" | "official_only";
  required: readonly string[];
}

/** Pinned data/bluebook_t2.json. Keys are already lowercase with spaces. */
export const BLUEBOOK_T2: Readonly<Record<string, BluebookRow>> = {
  usa: { abbrev: "U.S.C.", emit: "bluebook", required: ["title", "section"] },
  "united states": { abbrev: "U.S.C.", emit: "bluebook", required: ["title", "section"] },
  uk: { abbrev: "U.K.", emit: "official_only", required: [] },
  "united kingdom": { abbrev: "U.K.", emit: "official_only", required: [] },
  australia: { abbrev: "Cth", emit: "official_only", required: ["year"] },
  canada: { abbrev: "S.C.", emit: "official_only", required: ["year"] },
  germany: { abbrev: "BGBl.", emit: "official_only", required: [] },
  france: { abbrev: "J.O.", emit: "official_only", required: [] },
  malta: { abbrev: "Laws of Malta", emit: "official_only", required: [] },
  ireland: { abbrev: "Ir.", emit: "official_only", required: [] },
  newzealand: { abbrev: "N.Z.", emit: "official_only", required: [] },
  "new zealand": { abbrev: "N.Z.", emit: "official_only", required: [] },
  southafrica: { abbrev: "S. Afr.", emit: "official_only", required: [] },
  "south africa": { abbrev: "S. Afr.", emit: "official_only", required: [] },
  india: { abbrev: "India", emit: "official_only", required: [] },
  japan: { abbrev: "Japan", emit: "official_only", required: [] },
  china: { abbrev: "P.R.C.", emit: "official_only", required: [] },
  netherlands: { abbrev: "Stb.", emit: "official_only", required: [] },
  austria: { abbrev: "BGBl.", emit: "official_only", required: [] },
  switzerland: { abbrev: "AS", emit: "official_only", required: [] },
  sweden: { abbrev: "SFS", emit: "official_only", required: [] },
  norway: { abbrev: "Norsk Lovtidend", emit: "official_only", required: [] },
  denmark: { abbrev: "Lovtidende", emit: "official_only", required: [] },
  finland: { abbrev: "Finlex", emit: "official_only", required: [] },
  eu: { abbrev: "O.J.", emit: "official_only", required: [] },
};

export interface CitationInput {
  eli?: string | null;
  officialIdentifier?: string | null;
  identifier?: string | null;
  instrumentTitle?: string | null;
  articleNumber?: string | null;
  sectionNumber?: string | null;
  recordType?: string | null;
  jurisdiction?: string | null;
  country?: string | null;
  slug?: string | null;
  year?: string | null;
  snapshotDate?: string | null;
  lawId?: string | null;
  entryCid?: string | null;
  sourceRevision?: string | null;
  title?: string | null;
  language?: string | null;
}

export interface CitationRecord {
  officialCitation: string;
  bluebookCitation: string;
  citeKey: string;
  citationStatus: CitationStatus;
  pinpoint: string;
  nativeIdentifier: string;
  lawId: string;
  entryCid: string;
  sourceRevision: string;
  snapshotDate: string;
  recordType: string;
  jurisdiction: string;
  country: string;
  slug: string;
  year: string;
  instrumentTitle: string;
  articleNumber: string;
  sectionNumber: string;
  title: string;
  language: string;
}

export interface CitationFields {
  officialCitation: string;
  bluebookCitation: string;
  citeKey: string;
  citationStatus: CitationStatus;
  pinpoint: string;
  nativeIdentifier: string;
}

export interface CitationLookupOptions {
  format?: CitationLookupFormat | string | null;
  limit?: number;
  sourceRevision?: string | null;
  jurisdiction?: string | null;
}

const WORD = /[\p{L}\p{N}]/u;

function isPySpace(ch: string): boolean {
  const codePoint = ch.codePointAt(0) ?? 0;
  return /\s/u.test(ch) || codePoint === 0x85 || (codePoint >= 0x1c && codePoint <= 0x1f);
}

function pyStrip(value: string): string {
  const chars = Array.from(value);
  let start = 0;
  let end = chars.length;
  while (start < end && isPySpace(chars[start])) start += 1;
  while (end > start && isPySpace(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join("");
}

function text(value: string | null | undefined): string {
  return pyStrip(value ?? "");
}

export function citationJurisdictionKey(value: string | null | undefined): string {
  return text(value).toLowerCase().replace(/_/g, " ");
}

function isWord(ch: string | undefined): boolean {
  if (!ch) return false;
  return ch === "_" || WORD.test(ch);
}

function isBoundary(chars: string[], index: number): boolean {
  const left = index > 0 && isWord(chars[index - 1]);
  const right = index < chars.length && isWord(chars[index]);
  return left !== right;
}

function startsWith(chars: string[], index: number, literal: string): boolean {
  const lit = Array.from(literal);
  if (index + lit.length > chars.length) return false;
  for (let k = 0; k < lit.length; k += 1) {
    if (chars[index + k] !== lit[k]) return false;
  }
  return true;
}

function replaceBounded(value: string, stem: string, longer: string, replacement: string): string {
  const chars = Array.from(value);
  let out = "";
  let i = 0;
  while (i < chars.length) {
    if (isBoundary(chars, i) && startsWith(chars, i, stem)) {
      const stemEnd = i + Array.from(stem).length;
      const longEnd = stemEnd + Array.from(longer).length;
      if (startsWith(chars, stemEnd, longer) && isBoundary(chars, longEnd)) {
        out += replacement;
        i = longEnd;
        continue;
      }
      if (chars[stemEnd] === "." && isBoundary(chars, stemEnd + 1)) {
        out += replacement;
        i = stemEnd + 1;
        continue;
      }
      if (isBoundary(chars, stemEnd)) {
        out += replacement;
        i = stemEnd;
        continue;
      }
    }
    out += chars[i];
    i += 1;
  }
  return out;
}

/** Pinned normalize_cite_key. Falsy input returns "". */
export function normalizeCiteKey(value: string | null | undefined): string {
  if (!value) return "";
  let folded = value.normalize("NFKC").toLowerCase();
  folded = folded.replaceAll("§", " s ").replaceAll("¶", " ");
  folded = replaceBounded(folded, "art", "icle", "art");
  folded = replaceBounded(folded, "sec", "tion", "s");
  return folded.replace(/[^a-z0-9]+/g, " ").trim();
}

function inferYear(year: string, snapshotDate: string): string {
  if (year) return year;
  if (snapshotDate.length >= 4 && /^[0-9]{4}$/.test(snapshotDate.slice(0, 4))) {
    return snapshotDate.slice(0, 4);
  }
  return "";
}

function pinpointFor(articleNumber: string, sectionNumber: string, recordType: string): string {
  if (recordType === "section" && sectionNumber) return `§ ${sectionNumber}`;
  if (articleNumber) return `art. ${articleNumber}`;
  if (sectionNumber) return `§ ${sectionNumber}`;
  return "";
}

function t2Row(slug: string, country: string, jurisdiction: string): BluebookRow | undefined {
  for (const key of [slug, country, jurisdiction]) {
    const norm = citationJurisdictionKey(key);
    const hit = norm ? BLUEBOOK_T2[norm] : undefined;
    if (hit) return hit;
  }
  return undefined;
}

export function citationFields(record: CitationFields): CitationFields {
  return {
    officialCitation: record.officialCitation,
    bluebookCitation: record.bluebookCitation,
    citeKey: record.citeKey,
    citationStatus: record.citationStatus,
    pinpoint: record.pinpoint,
    nativeIdentifier: record.nativeIdentifier,
  };
}

export function assignCitation(input: CitationInput = {}): CitationRecord {
  const eli = text(input.eli);
  const officialIdentifier = text(input.officialIdentifier);
  const identifier = text(input.identifier);
  const instrumentTitle = text(input.instrumentTitle);
  const articleNumber = text(input.articleNumber);
  const sectionNumber = text(input.sectionNumber);
  const recordType = text(input.recordType) || "law";
  const jurisdiction = text(input.jurisdiction);
  const country = text(input.country);
  const slug = text(input.slug);
  const snapshotDate = text(input.snapshotDate);
  const year = inferYear(text(input.year), snapshotDate);
  const nativeIdentifier = eli || officialIdentifier || identifier || instrumentTitle;
  const pinpoint = pinpointFor(articleNumber, sectionNumber, recordType);
  let officialCitation = nativeIdentifier;
  if (officialCitation && pinpoint && !officialCitation.toLowerCase().includes(pinpoint.toLowerCase())) {
    officialCitation = `${officialCitation}, ${pinpoint}`;
  }

  const row = t2Row(slug, country, jurisdiction);
  const abbrev = row?.abbrev ?? "";
  const emit = row?.emit ?? "official_only";
  const required = row?.required ?? [];
  const have: Readonly<Record<string, boolean>> = {
    year: Boolean(year),
    section: Boolean(sectionNumber || (recordType === "section" && articleNumber)),
    article: Boolean(articleNumber),
    title: Boolean(instrumentTitle),
  };
  const missing = required.filter((key) => !have[key]);
  let bluebookCitation = "";
  if (emit === "bluebook" && abbrev && missing.length === 0) {
    const suffix = year ? ` (${year})` : "";
    if (pinpoint) bluebookCitation = `${abbrev} ${pinpoint}${suffix}`;
    else if (have.section) bluebookCitation = `${abbrev} § ${sectionNumber}${suffix}`;
  }

  let citationStatus: CitationStatus;
  if (bluebookCitation) citationStatus = "bluebook";
  else if (officialCitation) citationStatus = "official_only";
  else citationStatus = "unknown";

  return {
    officialCitation,
    bluebookCitation,
    citeKey: normalizeCiteKey(bluebookCitation || officialCitation),
    citationStatus,
    pinpoint,
    nativeIdentifier,
    lawId: text(input.lawId),
    entryCid: text(input.entryCid),
    sourceRevision: text(input.sourceRevision),
    snapshotDate,
    recordType,
    jurisdiction,
    country,
    slug,
    year,
    instrumentTitle,
    articleNumber,
    sectionNumber,
    title: text(input.title),
    language: text(input.language),
  };
}

function sameLower(left: string, right: string): boolean {
  return left !== "" && left.toLowerCase() === right;
}

/**
 * Exact citation lookup over caller-supplied records.
 * format native matches the preserved identifier or official citation and
 * does not consult citeKey. Other formats follow cite_search.
 */
export function lookupCitations(
  records: readonly CitationRecord[],
  citation: string | null | undefined,
  options: CitationLookupOptions = {},
): CitationRecord[] {
  const format = text(options.format ?? "any").toLowerCase();
  const needle = text(citation);
  if (!needle) return [];
  if (format !== "any" && format !== "bluebook" && format !== "official" && format !== "native") {
    throw new TypeError(`unsupported citation format: ${format}`);
  }
  const limit = options.limit ?? 25;
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const key = normalizeCiteKey(needle);
  const needleLower = needle.toLowerCase();
  const revision = options.sourceRevision == null ? null : text(options.sourceRevision);
  const jurisdiction = options.jurisdiction == null || options.jurisdiction === ""
    ? null
    : citationJurisdictionKey(options.jurisdiction);

  const hits = records.filter((record) => {
    if (revision != null && record.sourceRevision !== revision) return false;
    if (jurisdiction != null && citationJurisdictionKey(record.jurisdiction) !== jurisdiction) return false;
    if (format === "native") {
      return record.nativeIdentifier === needle
        || record.officialCitation === needle
        || sameLower(record.nativeIdentifier, needleLower)
        || sameLower(record.officialCitation, needleLower);
    }
    if ((format === "any" || format === "bluebook") && sameLower(record.bluebookCitation, needleLower)) return true;
    if ((format === "any" || format === "official") && sameLower(record.officialCitation, needleLower)) return true;
    return Boolean(key) && record.citeKey === key;
  });

  hits.sort((a, b) => {
    if (a.lawId < b.lawId) return -1;
    if (a.lawId > b.lawId) return 1;
    if (a.officialCitation < b.officialCitation) return -1;
    if (a.officialCitation > b.officialCitation) return 1;
    return 0;
  });
  return hits.slice(0, Math.floor(limit));
}
