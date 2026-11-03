/**
 * Language-aware legal tokenization pinned to country_laws_ir/tokenize.py.
 *
 * The default strategy, fts5-unicode61, is the selected index-parity path:
 * NFKD, drop characters whose Unicode combining class is non-zero in
 * Unicode 15.0.0 (the pinned CPython unicodedata), lowercase, then keep
 * ASCII [0-9A-Za-z] runs. Letters that do not fold into ASCII are deleted.
 * Call tokenize(text) or pass strategy "fts5-unicode61" for that behavior.
 *
 * Passing a language, or any other strategy, keeps native letters and
 * diacritics. Those paths do not stem, lemmatize, translate, or segment
 * with a dictionary. Unsupported behavior is on each strategy and in
 * UNSUPPORTED_LINGUISTIC_BEHAVIOR.
 */

export const TOKENIZER_ID = "country-laws-ir-fts5-unicode61/v1";

export const TOKENIZER_UPSTREAM = {
  repository: "/home/barberb/lift_coding/external/ipfs_datasets",
  commit: "2ea4ca6804b3c4cc44e43d0539f4c3fcae011747",
  unicode: "15.0.0",
  license: "AGPL-3.0-only",
  files: {
    tokenize: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/tokenize.py",
      sha256: "c15b8373cce6de282c9240f24a89caa374fc6ac2df2c1b9ced605c44f4878f56",
    },
  },
} as const;

export const SCRIPT_STRATEGY_IDS = [
  "fts5-unicode61",
  "latin-preserve",
  "cyrillic",
  "greek",
  "hebrew",
  "arabic",
  "indic",
  "cjk-unigram",
  "hangul",
  "kana",
  "southeast-asian-run",
  "identifier",
  "auto",
] as const;

export type ScriptStrategyId = (typeof SCRIPT_STRATEGY_IDS)[number];

export interface ScriptStrategySpec {
  id: ScriptStrategyId;
  matchesPinnedUpstream: boolean;
  preservesDiacritics: boolean;
  preservesNativeLetters: boolean;
  preservesCase: boolean;
  behavior: string;
  unsupported: readonly string[];
}

export const UNSUPPORTED_LINGUISTIC_BEHAVIOR = [
  "stemming",
  "lemmatization",
  "stopword removal",
  "synonym expansion",
  "cross-language recall",
  "transliteration",
  "turkish locale casing",
  "german eszett expansion",
  "dictionary segmentation for chinese, japanese, thai, lao, khmer, and myanmar",
  "japanese morphological analysis",
  "arabic, hebrew, and persian orthographic folding",
  "indic virama splitting",
  "icu word boundaries",
  "fts5 retention of letters that do not fold into ascii",
  "diacritic folding inside cite keys",
  "retrieval term cap (query.py MAX_QUERY_TERMS is not applied here)",
] as const;

const NO_ANALYSIS = [
  "no stemming, lemmatization, stopword list, synonym list, or transliteration",
] as const;

export const SCRIPT_STRATEGIES: readonly ScriptStrategySpec[] = [
  {
    id: "fts5-unicode61",
    matchesPinnedUpstream: true,
    preservesDiacritics: false,
    preservesNativeLetters: false,
    preservesCase: false,
    behavior: "Pinned FTS5 unicode61 tokenizer: NFKD, strip combining class, lowercase, ASCII letter and digit runs.",
    unsupported: [
      "keeps only ASCII letters and digits after folding",
      "deletes ø æ ł ð þ đ ß and every non-Latin letter",
      "decomposes Hangul syllables and strips kana dakuten and Thai tone marks before that deletion",
      "no Turkish locale casing and no ß to ss expansion",
      ...NO_ANALYSIS,
    ],
  },
  {
    id: "latin-preserve",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Lowercased Latin letter and digit runs with diacritics kept; other scripts are dropped.",
    unsupported: ["not the pinned index tokenizer", "no Turkish I/ı locale casing", ...NO_ANALYSIS],
  },
  {
    id: "cyrillic",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Lowercased Cyrillic runs with marks kept, plus adjacent digits.",
    unsupported: ["no transliteration to Latin", ...NO_ANALYSIS],
  },
  {
    id: "greek",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Lowercased Greek runs with polytonic marks kept, plus adjacent digits.",
    unsupported: ["no transliteration to Latin", ...NO_ANALYSIS],
  },
  {
    id: "hebrew",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Hebrew runs with niqqud kept, plus adjacent digits.",
    unsupported: ["no final-form folding", ...NO_ANALYSIS],
  },
  {
    id: "arabic",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Arabic runs with harakat and tatweel kept, plus Arabic-Indic and ASCII digits.",
    unsupported: ["no alef, yeh, kaf, or ta-marbuta folding", "tatweel is not removed", ...NO_ANALYSIS],
  },
  {
    id: "indic",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "One run per Indic word, including virama and vowel signs, plus adjacent digits.",
    unsupported: ["no virama splitting and no Indic stemming", ...NO_ANALYSIS],
  },
  {
    id: "cjk-unigram",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "One token per Han character, and a separate token for each ASCII digit run.",
    unsupported: ["no dictionary word segmentation", "Latin words in the same string are dropped", ...NO_ANALYSIS],
  },
  {
    id: "hangul",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Hangul syllable and jamo runs, without NFKD jamo explosion, plus adjacent digits.",
    unsupported: ["no morphological analysis", "Hanja is not segmented; use cjk-unigram or auto", ...NO_ANALYSIS],
  },
  {
    id: "kana",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Hiragana and katakana runs with dakuten kept, plus adjacent digits.",
    unsupported: ["no morphological analysis", "Han in the same string is dropped", ...NO_ANALYSIS],
  },
  {
    id: "southeast-asian-run",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Maximal Thai, Lao, Khmer, or Myanmar runs with tone marks kept, plus adjacent digits.",
    unsupported: ["no dictionary segmentation", ...NO_ANALYSIS],
  },
  {
    id: "identifier",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: true,
    behavior: "Case-sensitive identifier atoms with diacritics, internal citation punctuation, and Han runs left whole.",
    unsupported: [
      "not a search-term tokenizer and not the pinned FTS5 tokenizer",
      "no dictionary segmentation of Han or Southeast Asian runs",
      ...NO_ANALYSIS,
    ],
  },
  {
    id: "auto",
    matchesPinnedUpstream: false,
    preservesDiacritics: true,
    preservesNativeLetters: true,
    preservesCase: false,
    behavior: "Splits the string by script: preserve strategies for each script, Han as unigrams, digits attached to the current run.",
    unsupported: [
      "not the pinned index tokenizer",
      "no dictionary segmentation where a script has no spaces",
      ...NO_ANALYSIS,
    ],
  },
];

const LANGUAGE_STRATEGY: Readonly<Record<string, ScriptStrategyId>> = {
  en: "latin-preserve",
  de: "latin-preserve",
  fr: "latin-preserve",
  es: "latin-preserve",
  pt: "latin-preserve",
  nl: "latin-preserve",
  it: "latin-preserve",
  pl: "latin-preserve",
  sv: "latin-preserve",
  da: "latin-preserve",
  nb: "latin-preserve",
  nn: "latin-preserve",
  no: "latin-preserve",
  fi: "latin-preserve",
  ro: "latin-preserve",
  hu: "latin-preserve",
  cs: "latin-preserve",
  sk: "latin-preserve",
  sl: "latin-preserve",
  hr: "latin-preserve",
  et: "latin-preserve",
  lv: "latin-preserve",
  lt: "latin-preserve",
  ga: "latin-preserve",
  sq: "latin-preserve",
  ca: "latin-preserve",
  eu: "latin-preserve",
  gl: "latin-preserve",
  af: "latin-preserve",
  is: "latin-preserve",
  vi: "latin-preserve",
  id: "latin-preserve",
  ms: "latin-preserve",
  tr: "latin-preserve",
  az: "latin-preserve",
  sw: "latin-preserve",
  ru: "cyrillic",
  uk: "cyrillic",
  bg: "cyrillic",
  be: "cyrillic",
  sr: "cyrillic",
  mk: "cyrillic",
  kk: "cyrillic",
  ky: "cyrillic",
  mn: "cyrillic",
  tg: "cyrillic",
  el: "greek",
  ar: "arabic",
  fa: "arabic",
  ur: "arabic",
  ps: "arabic",
  he: "hebrew",
  yi: "hebrew",
  hi: "indic",
  mr: "indic",
  ne: "indic",
  sa: "indic",
  bn: "indic",
  as: "indic",
  gu: "indic",
  pa: "indic",
  ta: "indic",
  te: "indic",
  kn: "indic",
  ml: "indic",
  or: "indic",
  si: "indic",
  zh: "cjk-unigram",
  ko: "hangul",
  ja: "auto",
  th: "southeast-asian-run",
  lo: "southeast-asian-run",
  km: "southeast-asian-run",
  my: "southeast-asian-run",
};

const SCRIPT_SUBTAG: Readonly<Record<string, ScriptStrategyId>> = {
  latn: "latin-preserve",
  cyrl: "cyrillic",
  grek: "greek",
  arab: "arabic",
  hebr: "hebrew",
  hani: "cjk-unigram",
  hans: "cjk-unigram",
  hant: "cjk-unigram",
  hang: "hangul",
  kana: "kana",
  hira: "kana",
  thai: "southeast-asian-run",
  laoo: "southeast-asian-run",
  khmr: "southeast-asian-run",
  mymr: "southeast-asian-run",
  deva: "indic",
  beng: "indic",
  guru: "indic",
  gujr: "indic",
  taml: "indic",
  telu: "indic",
  knda: "indic",
  mlym: "indic",
  orya: "indic",
  sinh: "indic",
};

/** Unicode 15.0.0 code points whose canonical combining class is non-zero. */
const COMBINING_RANGES: readonly (readonly [number, number])[] = [
  [768,846],[848,879],[1155,1159],[1425,1469],[1471,1471],[1473,1474],[1476,1477],[1479,1479],
  [1552,1562],[1611,1631],[1648,1648],[1750,1756],[1759,1764],[1767,1768],[1770,1773],[1809,1809],
  [1840,1866],[2027,2035],[2045,2045],[2070,2073],[2075,2083],[2085,2087],[2089,2093],[2137,2139],
  [2200,2207],[2250,2273],[2275,2303],[2364,2364],[2381,2381],[2385,2388],[2492,2492],[2509,2509],
  [2558,2558],[2620,2620],[2637,2637],[2748,2748],[2765,2765],[2876,2876],[2893,2893],[3021,3021],
  [3132,3132],[3149,3149],[3157,3158],[3260,3260],[3277,3277],[3387,3388],[3405,3405],[3530,3530],
  [3640,3642],[3656,3659],[3768,3770],[3784,3787],[3864,3865],[3893,3893],[3895,3895],[3897,3897],
  [3953,3954],[3956,3956],[3962,3965],[3968,3968],[3970,3972],[3974,3975],[4038,4038],[4151,4151],
  [4153,4154],[4237,4237],[4957,4959],[5908,5909],[5940,5940],[6098,6098],[6109,6109],[6313,6313],
  [6457,6459],[6679,6680],[6752,6752],[6773,6780],[6783,6783],[6832,6845],[6847,6862],[6964,6964],
  [6980,6980],[7019,7027],[7082,7083],[7142,7142],[7154,7155],[7223,7223],[7376,7378],[7380,7392],
  [7394,7400],[7405,7405],[7412,7412],[7416,7417],[7616,7679],[8400,8412],[8417,8417],[8421,8432],
  [11503,11505],[11647,11647],[11744,11775],[12330,12335],[12441,12442],[42607,42607],[42612,42621],[42654,42655],
  [42736,42737],[43014,43014],[43052,43052],[43204,43204],[43232,43249],[43307,43309],[43347,43347],[43443,43443],
  [43456,43456],[43696,43696],[43698,43700],[43703,43704],[43710,43711],[43713,43713],[43766,43766],[44013,44013],
  [64286,64286],[65056,65071],[66045,66045],[66272,66272],[66422,66426],[68109,68109],[68111,68111],[68152,68154],
  [68159,68159],[68325,68326],[68900,68903],[69291,69292],[69373,69375],[69446,69456],[69506,69509],[69702,69702],
  [69744,69744],[69759,69759],[69817,69818],[69888,69890],[69939,69940],[70003,70003],[70080,70080],[70090,70090],
  [70197,70198],[70377,70378],[70459,70460],[70477,70477],[70502,70508],[70512,70516],[70722,70722],[70726,70726],
  [70750,70750],[70850,70851],[71103,71104],[71231,71231],[71350,71351],[71467,71467],[71737,71738],[71997,71998],
  [72003,72003],[72160,72160],[72244,72244],[72263,72263],[72345,72345],[72767,72767],[73026,73026],[73028,73029],
  [73111,73111],[73537,73538],[92912,92916],[92976,92982],[94192,94193],[113822,113822],[119141,119145],[119149,119154],
  [119163,119170],[119173,119179],[119210,119213],[119362,119364],[122880,122886],[122888,122904],[122907,122913],[122915,122916],
  [122918,122922],[123023,123023],[123184,123190],[123566,123566],[123628,123631],[124140,124143],[125136,125142],[125252,125258],
];

const MARK = /\p{M}/u;
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const GREEK = /\p{Script=Greek}/u;
const HEBREW = /\p{Script=Hebrew}/u;
const ARABIC = /\p{Script=Arabic}/u;
const HAN = /\p{Script=Han}/u;
const HANGUL = /\p{Script=Hangul}/u;
const KANA_SCRIPT = /\p{Script=Hiragana}|\p{Script=Katakana}/u;
const INDIC = /\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Oriya}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Sinhala}/u;
const SEA = /\p{Script=Thai}|\p{Script=Lao}|\p{Script=Khmer}|\p{Script=Myanmar}/u;

type Kind =
  | "mark"
  | "digit"
  | "latin"
  | "cyrillic"
  | "greek"
  | "hebrew"
  | "arabic"
  | "indic"
  | "han"
  | "hangul"
  | "kana"
  | "sea"
  | "other";

type LetterKind = "latin" | "cyrillic" | "greek" | "hebrew" | "arabic" | "indic" | "hangul" | "kana" | "sea";

const STRATEGY_SET = new Set<string>(SCRIPT_STRATEGY_IDS);

export interface TokenizeOptions {
  strategy?: ScriptStrategyId;
  language?: string | null;
}

function combiningClassNonZero(codePoint: number): boolean {
  let lo = 0;
  let hi = COMBINING_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = COMBINING_RANGES[mid];
    if (codePoint < range[0]) hi = mid - 1;
    else if (codePoint > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

function scriptKind(ch: string): Kind {
  const codePoint = ch.codePointAt(0) ?? 0;
  if (codePoint === 0x30fc || codePoint === 0xff70 || codePoint === 0x309d || codePoint === 0x309e || codePoint === 0x30fd || codePoint === 0x30fe) {
    return "kana";
  }
  if (codePoint === 0x0640) return "arabic";
  if (combiningClassNonZero(codePoint) || MARK.test(ch)) return "mark";
  if ((codePoint >= 0x30 && codePoint <= 0x39) || (codePoint >= 0xff10 && codePoint <= 0xff19)) return "digit";
  if (LATIN.test(ch)) return "latin";
  if (CYRILLIC.test(ch)) return "cyrillic";
  if (GREEK.test(ch)) return "greek";
  if (HEBREW.test(ch)) return "hebrew";
  if (ARABIC.test(ch)) return "arabic";
  if (INDIC.test(ch)) return "indic";
  if (HAN.test(ch)) return "han";
  if (HANGUL.test(ch)) return "hangul";
  if (KANA_SCRIPT.test(ch)) return "kana";
  if (SEA.test(ch)) return "sea";
  return "other";
}

function isLetterKind(kind: Kind): kind is LetterKind {
  return kind !== "mark" && kind !== "digit" && kind !== "han" && kind !== "other";
}

/** Pinned fold_diacritics from tokenize.py. Empty input returns "". */
export function foldDiacritics(text: string | null | undefined): string {
  if (!text) return "";
  let folded = "";
  for (const ch of text.normalize("NFKD")) {
    const codePoint = ch.codePointAt(0) ?? 0;
    if (!combiningClassNonZero(codePoint)) folded += ch;
  }
  return folded.toLowerCase();
}

function pinnedTokens(text: string): string[] {
  return foldDiacritics(text).match(/[0-9A-Za-z]+/g) ?? [];
}

function tokenizeRuns(text: string, accept: ReadonlySet<LetterKind>): string[] {
  const value = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  let buf = "";
  let mode: Kind | null = null;
  const flush = () => {
    if (buf) tokens.push(buf);
    buf = "";
    mode = null;
  };
  for (const ch of value) {
    const kind = scriptKind(ch);
    if (kind === "mark") {
      if (buf) buf += ch;
      continue;
    }
    if (kind === "digit") {
      if (!buf) mode = "digit";
      buf += ch;
      continue;
    }
    if (!isLetterKind(kind) || !accept.has(kind)) {
      flush();
      continue;
    }
    if (mode === null || mode === "digit" || mode === kind) {
      buf += ch;
      mode = kind;
      continue;
    }
    flush();
    buf = ch;
    mode = kind;
  }
  flush();
  return tokens;
}

function cjkUnigrams(text: string): string[] {
  const value = text.normalize("NFKC");
  const tokens: string[] = [];
  let digits = "";
  const flush = () => {
    if (digits) tokens.push(digits);
    digits = "";
  };
  for (const ch of value) {
    const kind = scriptKind(ch);
    if (kind === "han") {
      flush();
      tokens.push(ch);
    } else if (kind === "digit") {
      digits += ch;
    } else {
      flush();
    }
  }
  flush();
  return tokens;
}

function tokenizeAuto(text: string): string[] {
  const value = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  let buf = "";
  let mode: Kind | null = null;
  const flush = () => {
    if (buf) tokens.push(buf);
    buf = "";
    mode = null;
  };
  for (const ch of value) {
    const kind = scriptKind(ch);
    if (kind === "mark") {
      if (buf) buf += ch;
      continue;
    }
    if (kind === "han") {
      flush();
      tokens.push(ch);
      continue;
    }
    if (kind === "other") {
      flush();
      continue;
    }
    if (kind === "digit") {
      if (!buf) mode = "digit";
      buf += ch;
      continue;
    }
    if (mode === null || mode === "digit" || mode === kind) {
      buf += ch;
      mode = kind;
      continue;
    }
    flush();
    buf = ch;
    mode = kind;
  }
  flush();
  return tokens;
}

const IDENT_CONNECTORS = new Set([".", ":", "/", "\\", "-", "_", "'", "’"]);
const IDENT_SINGLETONS = new Set(["§", "¶", "№"]);

function tokenizeIdentifier(text: string): string[] {
  const chars = Array.from(text);
  const tokens: string[] = [];
  let i = 0;
  const starts = (ch: string) => {
    const kind = scriptKind(ch);
    return kind !== "other" && kind !== "mark";
  };
  const continues = (ch: string) => scriptKind(ch) !== "other";
  while (i < chars.length) {
    const ch = chars[i];
    if (IDENT_SINGLETONS.has(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (!starts(ch)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let kind = scriptKind(ch);
    while (j < chars.length) {
      const next = chars[j];
      const nextKind = scriptKind(next);
      const sameScript = nextKind === kind && nextKind !== "other" && nextKind !== "mark";
      const digitBridge = nextKind === "digit" || kind === "digit";
      if (nextKind === "mark" || (digitBridge && nextKind !== "other" && nextKind !== "mark") || sameScript) {
        if (nextKind !== "mark" && nextKind !== "digit") kind = nextKind;
        j += 1;
        continue;
      }
      if (IDENT_CONNECTORS.has(next) && j + 1 < chars.length && starts(chars[j + 1])) {
        j += 1;
        continue;
      }
      if (next === "." && starts(chars[j - 1])) {
        j += 1;
        break;
      }
      break;
    }
    tokens.push(chars.slice(i, j).join(""));
    i = j;
  }
  return tokens;
}

export function strategyForLanguage(language: string | null | undefined): ScriptStrategyId {
  const raw = (language ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return "auto";
  const parts = raw.split("-").filter(Boolean);
  for (const part of parts) {
    if (part.length === 4 && SCRIPT_SUBTAG[part]) return SCRIPT_SUBTAG[part];
  }
  return LANGUAGE_STRATEGY[parts[0] ?? ""] ?? "auto";
}

export function describeStrategy(id: ScriptStrategyId): ScriptStrategySpec {
  const spec = SCRIPT_STRATEGIES.find((item) => item.id === id);
  if (!spec) throw new TypeError(`unsupported tokenizer strategy: ${id}`);
  return spec;
}

function resolveStrategy(options?: TokenizeOptions): ScriptStrategyId {
  if (options?.strategy) {
    if (!STRATEGY_SET.has(options.strategy)) {
      throw new TypeError(`unsupported tokenizer strategy: ${options.strategy}`);
    }
    return options.strategy;
  }
  const language = options?.language?.trim();
  if (language) return strategyForLanguage(language);
  return "fts5-unicode61";
}

/**
 * Tokenize legal text. With no options this matches country_laws_ir tokenize().
 * A language or strategy selects a preserving tokenizer instead of that pin.
 */
export function tokenize(text: string | null | undefined, options?: TokenizeOptions): string[] {
  if (!text) return [];
  switch (resolveStrategy(options)) {
    case "fts5-unicode61":
      return pinnedTokens(text);
    case "latin-preserve":
      return tokenizeRuns(text, new Set(["latin"]));
    case "cyrillic":
      return tokenizeRuns(text, new Set(["cyrillic"]));
    case "greek":
      return tokenizeRuns(text, new Set(["greek"]));
    case "hebrew":
      return tokenizeRuns(text, new Set(["hebrew"]));
    case "arabic":
      return tokenizeRuns(text, new Set(["arabic"]));
    case "indic":
      return tokenizeRuns(text, new Set(["indic"]));
    case "hangul":
      return tokenizeRuns(text, new Set(["hangul"]));
    case "kana":
      return tokenizeRuns(text, new Set(["kana"]));
    case "southeast-asian-run":
      return tokenizeRuns(text, new Set(["sea"]));
    case "cjk-unigram":
      return cjkUnigrams(text);
    case "identifier":
      return tokenizeIdentifier(text);
    case "auto":
      return tokenizeAuto(text);
    default:
      throw new TypeError("unsupported tokenizer strategy");
  }
}
