import {
  SCRIPT_STRATEGIES,
  SCRIPT_STRATEGY_IDS,
  TOKENIZER_UPSTREAM,
  UNSUPPORTED_LINGUISTIC_BEHAVIOR,
  foldDiacritics,
  strategyForLanguage,
  tokenize,
} from "../../src/lib/worldwide/search/tokenize";
import {
  BLUEBOOK_T2,
  CITATION_LIMITATIONS,
  CITATION_UPSTREAM,
  assignCitation,
  lookupCitations,
  normalizeCiteKey,
  type CitationInput,
  type CitationRecord,
} from "../../src/lib/worldwide/search/citation";

const HANGUL_FOLD = String.fromCodePoint(
  0x1112, 0x1165, 0x11ab, 0x1107, 0x1165, 0x11b8, 0x20, 0x110c, 0x1166, 0x31, 0x110c, 0x1169,
);

/** Inputs and outputs captured from country_laws_ir tokenize.py at the pinned commit. */
const PINNED_TOKENS: Array<[string, string, string[]]> = [
  ["", "", []],
  ["   ", "   ", []],
  ["A", "a", ["a"]],
  ["0", "0", ["0"]],
  ["Art. 6:162 BW", "art. 6:162 bw", ["art", "6", "162", "bw"]],
  ["café", "cafe", ["cafe"]],
  ["Café", "cafe", ["cafe"]],
  ["naïve", "naive", ["naive"]],
  ["São Paulo", "sao paulo", ["sao", "paulo"]],
  ["Ångström", "angstrom", ["angstrom"]],
  ["Straße", "straße", ["stra", "e"]],
  ["İstanbul", "istanbul", ["istanbul"]],
  ["øre", "øre", ["re"]],
  ["æble", "æble", ["ble"]],
  ["œufs", "œufs", ["ufs"]],
  ["łódź", "łodz", ["odz"]],
  ["đồng", "đong", ["ong"]],
  ["þing", "þing", ["ing"]],
  ["ð", "ð", []],
  ["ﬁle", "file", ["file"]],
  ["①②", "12", ["12"]],
  ["don't", "don't", ["don", "t"]],
  ["a_b", "a_b", ["a", "b"]],
  ["Νόμος", "\u03bd\u03bf\u03bc\u03bf\u03c2", []],
  ["Москва", "\u043c\u043e\u0441\u043a\u0432\u0430", []],
  ["قانون", "قانون", []],
  ["قانون رقم 12 لسنة 2020", "قانون رقم 12 لسنة 2020", ["12", "2020"]],
  ["民法第1条", "民法第1条", ["1"]],
  ["中华人民共和国宪法", "中华人民共和国宪法", []],
  ["ひらがな", "ひらかな", []],
  ["บทที่ 1", "บทที 1", ["1"]],
  ["BWBR0001854", "bwbr0001854", ["bwbr0001854"]],
  ["Código Civil", "codigo civil", ["codigo", "civil"]],
  ["１２３ＡＢＣ", "123abc", ["123abc"]],
  ["\u00a0café\u00a0", " cafe ", ["cafe"]],
  ["µ", "μ", []],
  ["№ 5", "no 5", ["no", "5"]],
  ["Artículo 5", "articulo 5", ["articulo", "5"]],
  ["\u0401\u043b\u043a\u0430", "\u0435\u043b\u043a\u0430", []],
  ["헌법 제1조", HANGUL_FOLD, ["1"]],
];

const PINNED_KEYS: Array<[string, string]> = [
  ["ORS 1.010", "ors 1 010"],
  ["Or. Rev. Stat. § 1.010", "or rev stat s 1 010"],
  ["U.S.C. § 1983 (2020)", "u s c s 1983 2020"],
  ["42 U.S.C., § 1983", "42 u s c s 1983"],
  ["Código Civil, art. 1", "c digo civil art 1"],
  ["Código", "c digo"],
  ["codigo", "codigo"],
  ["BWBR0001854, art. 6:162", "bwbr0001854 art 6 162"],
  ["§ 1.010", "s 1 010"],
  ["article 3", "art 3"],
  ["Article 3", "art 3"],
  ["ARTICLE 3", "art 3"],
  ["art. 3", "art 3"],
  ["art 3", "art 3"],
  ["art.1", "art1"],
  ["Artikel 3", "artikel 3"],
  ["articles", "articles"],
  ["artistic", "artistic"],
  ["article section", "art s"],
  ["articles of section 1", "articles of s 1"],
  ["Section 12", "s 12"],
  ["sec. 12", "s 12"],
  ["sec.", "s"],
  ["sec.1", "s1"],
  ["¶ 4", "4"],
  ["Artículo 5", "art culo 5"],
  ["中华人民共和国宪法, art. 1", "art 1"],
  ["قانون رقم 12 لسنة 2020, art. 3", "12 2020 art 3"],
  ["  ORS  1.010  ", "ors 1 010"],
  ["  ", ""],
  ["L. 121-1", "l 121 1"],
  ["don't", "don t"],
];

function cited(input: CitationInput): CitationRecord {
  return assignCitation(input);
}

describe("pinned upstream tokenization", () => {
  test("records the tokenize.py pin", () => {
    expect(TOKENIZER_UPSTREAM.commit).toBe("2ea4ca6804b3c4cc44e43d0539f4c3fcae011747");
    expect(TOKENIZER_UPSTREAM.unicode).toBe("15.0.0");
    expect(TOKENIZER_UPSTREAM.files.tokenize.sha256).toBe(
      "c15b8373cce6de282c9240f24a89caa374fc6ac2df2c1b9ced605c44f4878f56",
    );
    expect(SCRIPT_STRATEGIES.filter((item) => item.matchesPinnedUpstream).map((item) => item.id)).toEqual([
      "fts5-unicode61",
    ]);
  });

  test.each(PINNED_TOKENS)("fold and tokens match tokenize.py for %j", (input, fold, tokens) => {
    expect(foldDiacritics(input)).toBe(fold);
    expect(tokenize(input)).toEqual(tokens);
    expect(tokenize(input, { strategy: "fts5-unicode61" })).toEqual(tokens);
  });

  test("empty and null inputs stay empty", () => {
    expect(tokenize(null)).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(foldDiacritics(null)).toBe("");
    expect(foldDiacritics("")).toBe("");
  });

  test("combining class zero is kept and a real combining mark is stripped", () => {
    expect(foldDiacritics("a\u034fb")).toBe("a\u034fb");
    expect(foldDiacritics("a\u0301")).toBe("a");
    expect(tokenize("a\u034fb")).toEqual(["a", "b"]);
  });

  test("greek final sigma follows the pinned lowercase after the fold", () => {
    expect(foldDiacritics("\u039d\u03cc\u03bc\u03bf\u03c2")).toBe("\u03bd\u03bf\u03bc\u03bf\u03c2");
    expect(tokenize("\u039d\u03cc\u03bc\u03bf\u03c2")).toEqual([]);
  });

  test("an explicit strategy wins over a language, and the default stays pinned", () => {
    expect(tokenize("Café", { language: "fr" })).toEqual(["café"]);
    expect(tokenize("Café", { language: "fr", strategy: "fts5-unicode61" })).toEqual(["cafe"]);
    expect(tokenize("Café")).toEqual(["cafe"]);
  });

  test("the pinned tokenizer does not stem, drop stopwords, expand ß, or cap terms", () => {
    expect(tokenize("running")).toEqual(["running"]);
    expect(tokenize("the law")).toEqual(["the", "law"]);
    expect(tokenize("Straße")).toEqual(["stra", "e"]);
    expect(tokenize("Straße")).not.toEqual(["strasse"]);
    expect(tokenize("straße")).not.toEqual(["strasse"]);
    const many = Array.from({ length: 70 }, () => "a").join(" ");
    expect(tokenize(many)).toHaveLength(70);
  });
});

describe("script and language strategies", () => {
  test("every declared strategy is explicit and documents unsupported behavior", () => {
    expect(SCRIPT_STRATEGIES.map((item) => item.id)).toEqual([...SCRIPT_STRATEGY_IDS]);
    for (const spec of SCRIPT_STRATEGIES) {
      expect(spec.behavior.length).toBeGreaterThan(20);
      expect(spec.unsupported.length).toBeGreaterThan(0);
    }
    expect(UNSUPPORTED_LINGUISTIC_BEHAVIOR).toEqual(expect.arrayContaining([
      "stemming",
      "lemmatization",
      "stopword removal",
      "cross-language recall",
      "transliteration",
      "turkish locale casing",
      "german eszett expansion",
      "dictionary segmentation for chinese, japanese, thai, lao, khmer, and myanmar",
      "fts5 retention of letters that do not fold into ascii",
    ]));
  });

  test("language tags select a strategy, and a script subtag overrides the primary language", () => {
    expect(strategyForLanguage("fr")).toBe("latin-preserve");
    expect(strategyForLanguage("nl-NL")).toBe("latin-preserve");
    expect(strategyForLanguage("de")).toBe("latin-preserve");
    expect(strategyForLanguage("tr")).toBe("latin-preserve");
    expect(strategyForLanguage("ru")).toBe("cyrillic");
    expect(strategyForLanguage("el")).toBe("greek");
    expect(strategyForLanguage("ar")).toBe("arabic");
    expect(strategyForLanguage("fa")).toBe("arabic");
    expect(strategyForLanguage("he")).toBe("hebrew");
    expect(strategyForLanguage("hi")).toBe("indic");
    expect(strategyForLanguage("zh")).toBe("cjk-unigram");
    expect(strategyForLanguage("zh-Hant-TW")).toBe("cjk-unigram");
    expect(strategyForLanguage("ko")).toBe("hangul");
    expect(strategyForLanguage("ja")).toBe("auto");
    expect(strategyForLanguage("th")).toBe("southeast-asian-run");
    expect(strategyForLanguage("sr")).toBe("cyrillic");
    expect(strategyForLanguage("sr-Latn")).toBe("latin-preserve");
    expect(strategyForLanguage("und")).toBe("auto");
    expect(strategyForLanguage("")).toBe("auto");
    expect(strategyForLanguage(null)).toBe("auto");
  });

  test("preserving strategies keep diacritics and native letters the pinned tokenizer deletes", () => {
    expect(tokenize("São Paulo", { strategy: "latin-preserve" })).toEqual(["são", "paulo"]);
    expect(tokenize("Straße", { strategy: "latin-preserve" })).toEqual(["straße"]);
    expect(tokenize("øre", { language: "da" })).toEqual(["øre"]);
    expect(tokenize("æble", { language: "da" })).toEqual(["æble"]);
    expect(tokenize("łódź", { language: "pl" })).toEqual(["łódź"]);
    expect(tokenize("đồng", { language: "vi" })).toEqual(["đồng"]);
    expect(tokenize("Москва", { language: "ru" })).toEqual(["москва"]);
    expect(tokenize("Мо\u0301сква", { strategy: "cyrillic" })[0]).toContain("\u0301");
    expect(tokenize("Νόμος", { language: "el" })).toEqual(["\u03bd\u03cc\u03bc\u03bf\u03c2"]);
    expect(tokenize("قانون", { language: "ar" })).toEqual(["قانون"]);
    expect(tokenize("قَانُون", { strategy: "arabic" })).toEqual(["قَانُون"]);
    expect(tokenize("חוק", { language: "he" })).toEqual(["חוק"]);
    expect(tokenize("धारा", { language: "hi" })).toEqual(["धारा"]);
    expect(tokenize("ひらがな", { strategy: "kana" })).toEqual(["ひらがな"]);
    expect(tokenize("コーヒー", { strategy: "kana" })).toEqual(["コーヒー"]);
    expect(tokenize("บทที่ 1", { language: "th" })).toEqual(["บทที่", "1"]);
    expect(tokenize("헌법 제1조", { language: "ko" })).toEqual(["헌법", "제1조"]);
    expect(tokenize("民法第1条", { language: "zh" })).toEqual(["民", "法", "第", "1", "条"]);
    expect(tokenize("法律", { strategy: "latin-preserve" })).toEqual([]);
    expect(tokenize("法律 12", { strategy: "latin-preserve" })).toEqual(["12"]);
  });

  test("auto keeps each script and does not pretend to be the pinned index tokenizer", () => {
    expect(tokenize("café 民法 article 6", { strategy: "auto" })).toEqual(["café", "民", "法", "article", "6"]);
    expect(tokenize("民法第1条ひらがな", { language: "ja" })).toEqual(["民", "法", "第", "1", "条", "ひらがな"]);
    expect(tokenize("١٢٣", { strategy: "auto" })).toEqual(["١٢٣"]);
    expect(tokenize("١٢٣")).toEqual([]);
  });

  test("identifier strategy preserves case, diacritics, and native identifier atoms", () => {
    expect(tokenize("BWBR0001854", { strategy: "identifier" })).toEqual(["BWBR0001854"]);
    expect(tokenize("Código Civil, art. 1", { strategy: "identifier" })).toEqual(["Código", "Civil", "art.", "1"]);
    expect(tokenize("42 U.S.C. § 1983", { strategy: "identifier" })).toEqual(["42", "U.S.C.", "§", "1983"]);
    expect(tokenize("6:162", { strategy: "identifier" })).toEqual(["6:162"]);
    expect(tokenize("L. 121-1", { strategy: "identifier" })).toEqual(["L.", "121-1"]);
    expect(tokenize("Don't", { strategy: "identifier" })).toEqual(["Don't"]);
    expect(tokenize("中华人民共和国宪法", { strategy: "identifier" })).toEqual(["中华人民共和国宪法"]);
    expect(tokenize("قانون رقم 12", { strategy: "identifier" })).toEqual(["قانون", "رقم", "12"]);
    expect(tokenize("№ 5", { strategy: "identifier" })).toEqual(["№", "5"]);
    expect(tokenize("\uFB01le", { strategy: "identifier" })).toEqual(["\uFB01le"]);
    expect(tokenize("\uFB01le")).toEqual(["file"]);
  });

  test("an unknown strategy is rejected", () => {
    expect(() => tokenize("law", { strategy: "porter" as "auto" })).toThrow(/unsupported tokenizer strategy/);
  });
});

describe("pinned citation keys and assignment", () => {
  test("records the citations.py and bluebook table pin", () => {
    expect(CITATION_UPSTREAM.commit).toBe(TOKENIZER_UPSTREAM.commit);
    expect(CITATION_UPSTREAM.files.citations.sha256).toBe(
      "5b0b0d8d4083ddf9a186b8f27a1d8ad48b85cbe2584ec07119274455a7ea63d3",
    );
    expect(CITATION_UPSTREAM.files.bluebook.sha256).toBe(
      "3ebb330f51d4c235d7e1a0168fddabfd236212335d466f955f790122be1cbba8",
    );
    const bluebookRows = Object.values(BLUEBOOK_T2).filter((row) => row.emit === "bluebook");
    expect(bluebookRows).toHaveLength(2);
    expect(BLUEBOOK_T2.usa.abbrev).toBe("U.S.C.");
    expect(BLUEBOOK_T2["united states"].required).toEqual(["title", "section"]);
    expect(CITATION_LIMITATIONS.length).toBeGreaterThan(5);
  });

  test.each(PINNED_KEYS)("cite key %j", (input, expected) => {
    expect(normalizeCiteKey(input)).toBe(expected);
  });

  test("empty cite keys stay empty", () => {
    expect(normalizeCiteKey("")).toBe("");
    expect(normalizeCiteKey(null)).toBe("");
    expect(normalizeCiteKey(undefined)).toBe("");
  });

  test("assignment fixtures match citations.py and keep native identifiers", () => {
    expect(cited({ officialIdentifier: "ORS 1.010", jurisdiction: "Oregon" })).toMatchObject({
      officialCitation: "ORS 1.010",
      bluebookCitation: "",
      citeKey: "ors 1 010",
      citationStatus: "official_only",
      pinpoint: "",
      nativeIdentifier: "ORS 1.010",
    });

    expect(cited({
      officialIdentifier: "42 U.S.C.",
      instrumentTitle: "Civil Rights",
      sectionNumber: "1983",
      recordType: "section",
      jurisdiction: "United States",
      year: "2020",
    })).toMatchObject({
      officialCitation: "42 U.S.C., § 1983",
      bluebookCitation: "U.S.C. § 1983 (2020)",
      citeKey: "u s c s 1983 2020",
      citationStatus: "bluebook",
      pinpoint: "§ 1983",
      nativeIdentifier: "42 U.S.C.",
    });

    expect(cited({
      officialIdentifier: "42 U.S.C.",
      instrumentTitle: "Civil Rights",
      recordType: "law",
      jurisdiction: "usa",
      year: "2020",
    })).toMatchObject({
      officialCitation: "42 U.S.C.",
      bluebookCitation: "",
      citeKey: "42 u s c",
      citationStatus: "official_only",
      pinpoint: "",
    });

    expect(cited({
      eli: "http://data.europa.eu/eli/reg/2016/679/oj",
      officialIdentifier: "GDPR",
      articleNumber: "5",
      recordType: "article",
      jurisdiction: "eu",
      year: "2016",
    })).toMatchObject({
      officialCitation: "http://data.europa.eu/eli/reg/2016/679/oj, art. 5",
      bluebookCitation: "",
      citeKey: "http data europa eu eli reg 2016 679 oj art 5",
      citationStatus: "official_only",
      nativeIdentifier: "http://data.europa.eu/eli/reg/2016/679/oj",
      pinpoint: "art. 5",
    });

    expect(cited({
      officialIdentifier: "BWBR0001854",
      instrumentTitle: "Burgerlijk Wetboek",
      articleNumber: "6:162",
      jurisdiction: "Netherlands",
      country: "netherlands",
      slug: "netherlands",
    })).toMatchObject({
      officialCitation: "BWBR0001854, art. 6:162",
      bluebookCitation: "",
      citeKey: "bwbr0001854 art 6 162",
      citationStatus: "official_only",
      pinpoint: "art. 6:162",
      nativeIdentifier: "BWBR0001854",
    });

    const codigo = cited({
      officialIdentifier: "Código Civil",
      instrumentTitle: "Código Civil",
      articleNumber: "1",
      jurisdiction: "España",
    });
    expect(codigo).toMatchObject({
      officialCitation: "Código Civil, art. 1",
      bluebookCitation: "",
      citeKey: "c digo civil art 1",
      citationStatus: "official_only",
      nativeIdentifier: "Código Civil",
    });
    expect(tokenize(codigo.nativeIdentifier)).toEqual(["codigo", "civil"]);
    expect(tokenize(codigo.nativeIdentifier, { strategy: "latin-preserve" })).toEqual(["código", "civil"]);

    expect(cited({
      officialIdentifier: "قانون رقم 12 لسنة 2020",
      articleNumber: "3",
      jurisdiction: "Egypt",
    })).toMatchObject({
      officialCitation: "قانون رقم 12 لسنة 2020, art. 3",
      citeKey: "12 2020 art 3",
      nativeIdentifier: "قانون رقم 12 لسنة 2020",
      citationStatus: "official_only",
    });

    expect(cited({
      officialIdentifier: "中华人民共和国宪法",
      articleNumber: "1",
      jurisdiction: "China",
      country: "china",
      slug: "china",
      year: "1982",
    })).toMatchObject({
      officialCitation: "中华人民共和国宪法, art. 1",
      bluebookCitation: "",
      citeKey: "art 1",
      citationStatus: "official_only",
      nativeIdentifier: "中华人民共和国宪法",
      year: "1982",
    });

    expect(cited({
      officialIdentifier: "BWBR0001854, art. 1",
      articleNumber: "1",
      jurisdiction: "Netherlands",
    })).toMatchObject({
      officialCitation: "BWBR0001854, art. 1",
      pinpoint: "art. 1",
      citeKey: "bwbr0001854 art 1",
    });

    expect(cited({ identifier: "only-id" })).toMatchObject({
      officialCitation: "only-id",
      citeKey: "only id",
      nativeIdentifier: "only-id",
      citationStatus: "official_only",
    });

    expect(cited({ instrumentTitle: "Bare Title", jurisdiction: "unknown-land" })).toMatchObject({
      officialCitation: "Bare Title",
      citeKey: "bare title",
      citationStatus: "official_only",
      bluebookCitation: "",
    });

    expect(cited({})).toMatchObject({
      officialCitation: "",
      bluebookCitation: "",
      citeKey: "",
      citationStatus: "unknown",
      pinpoint: "",
      nativeIdentifier: "",
    });

    expect(cited({
      officialIdentifier: "Code civil",
      articleNumber: "1240",
      jurisdiction: "France",
      year: "1804",
    })).toMatchObject({
      officialCitation: "Code civil, art. 1240",
      bluebookCitation: "",
      citeKey: "code civil art 1240",
      citationStatus: "official_only",
    });

    expect(cited({
      sectionNumber: "12",
      recordType: "section",
      jurisdiction: "United States",
      instrumentTitle: "Title 42",
      year: "1996",
    })).toMatchObject({
      officialCitation: "Title 42, § 12",
      bluebookCitation: "U.S.C. § 12 (1996)",
      citeKey: "u s c s 12 1996",
      citationStatus: "bluebook",
      nativeIdentifier: "Title 42",
      pinpoint: "§ 12",
    });

    expect(cited({
      articleNumber: "9",
      sectionNumber: "2",
      jurisdiction: "Germany",
    })).toMatchObject({
      officialCitation: "",
      bluebookCitation: "",
      citeKey: "",
      citationStatus: "unknown",
      pinpoint: "art. 9",
    });

    expect(cited({
      slug: "usa",
      jurisdiction: "Oregon",
      officialIdentifier: "42 USC",
      sectionNumber: "1983",
      recordType: "section",
      instrumentTitle: "T",
      year: "2020",
    })).toMatchObject({
      officialCitation: "42 USC, § 1983",
      bluebookCitation: "U.S.C. § 1983 (2020)",
      citeKey: "u s c s 1983 2020",
      citationStatus: "bluebook",
    });

    expect(cited({
      slug: "new_zealand",
      officialIdentifier: "Public Act 1",
      year: "2024",
    })).toMatchObject({
      officialCitation: "Public Act 1",
      bluebookCitation: "",
      citeKey: "public act 1",
      citationStatus: "official_only",
    });

    expect(cited({
      officialIdentifier: "Art. 1 already",
      articleNumber: "1",
      jurisdiction: "France",
    })).toMatchObject({
      officialCitation: "Art. 1 already",
      pinpoint: "art. 1",
      citeKey: "art 1 already",
    });

    expect(cited({
      officialIdentifier: "art. 12",
      articleNumber: "1",
      jurisdiction: "France",
    })).toMatchObject({
      officialCitation: "art. 12",
      pinpoint: "art. 1",
      citeKey: "art 12",
    });

    expect(cited({
      eli: "  ELI-1  ",
      officialIdentifier: "OTHER",
      articleNumber: "2",
      recordType: "section",
      sectionNumber: "9",
    })).toMatchObject({
      nativeIdentifier: "ELI-1",
      officialCitation: "ELI-1, § 9",
      pinpoint: "§ 9",
      citeKey: "eli 1 s 9",
      citationStatus: "official_only",
    });

    expect(cited({
      officialIdentifier: "42 USC",
      sectionNumber: "1",
      recordType: "section",
      jurisdiction: "United States",
      year: "2020",
    })).toMatchObject({
      officialCitation: "42 USC, § 1",
      bluebookCitation: "",
      citeKey: "42 usc s 1",
      citationStatus: "official_only",
    });

    expect(cited({
      officialIdentifier: "Fair Work Act",
      jurisdiction: "Australia",
      articleNumber: "1",
    })).toMatchObject({
      officialCitation: "Fair Work Act, art. 1",
      bluebookCitation: "",
      citeKey: "fair work act art 1",
      citationStatus: "official_only",
    });
  });

  test("snapshotDate supplies a missing year and an explicit year wins", () => {
    expect(cited({
      officialIdentifier: "42 U.S.C.",
      instrumentTitle: "Civil Rights",
      sectionNumber: "1983",
      recordType: "section",
      jurisdiction: "United States",
      snapshotDate: "2020-06-01",
    })).toMatchObject({
      year: "2020",
      bluebookCitation: "U.S.C. § 1983 (2020)",
    });
    expect(cited({
      officialIdentifier: "42 U.S.C.",
      instrumentTitle: "Civil Rights",
      sectionNumber: "1983",
      recordType: "section",
      jurisdiction: "United States",
      year: "1999",
      snapshotDate: "2020-06-01",
    }).year).toBe("1999");
  });

  test("a section record with only an article number still uses the article pinpoint", () => {
    expect(cited({
      officialIdentifier: "42 U.S.C.",
      instrumentTitle: "Title 42",
      articleNumber: "9",
      recordType: "section",
      jurisdiction: "United States",
      year: "2020",
    })).toMatchObject({
      pinpoint: "art. 9",
      bluebookCitation: "U.S.C. art. 9 (2020)",
      officialCitation: "42 U.S.C., art. 9",
      citationStatus: "bluebook",
    });
  });
});

describe("exact citation lookup", () => {
  const current = cited({
    officialIdentifier: "42 U.S.C.",
    instrumentTitle: "Civil Rights",
    sectionNumber: "1983",
    recordType: "section",
    jurisdiction: "United States",
    year: "2020",
    lawId: "us-1983-2020",
    entryCid: "cid-current",
    sourceRevision: "rev-2020",
  });
  const previous = cited({
    officialIdentifier: "42 U.S.C.",
    instrumentTitle: "Civil Rights",
    sectionNumber: "1983",
    recordType: "section",
    jurisdiction: "United States",
    year: "1996",
    lawId: "us-1983-1996",
    entryCid: "cid-previous",
    sourceRevision: "rev-1996",
  });
  const oregon = cited({
    officialIdentifier: "ORS 1.010",
    jurisdiction: "Oregon",
    lawId: "or-1",
    entryCid: "cid-ors",
    sourceRevision: "rev-ors",
  });
  const codigo = cited({
    officialIdentifier: "Código Civil",
    articleNumber: "1",
    jurisdiction: "España",
    lawId: "es-cc",
    entryCid: "cid-codigo",
    sourceRevision: "rev-es",
  });
  const constitution = cited({
    officialIdentifier: "中华人民共和国宪法",
    articleNumber: "1",
    jurisdiction: "China",
    slug: "china",
    year: "1982",
    lawId: "cn-const",
    entryCid: "cid-cn",
    sourceRevision: "rev-cn",
  });
  const dutch = cited({
    officialIdentifier: "BWBR0001854",
    instrumentTitle: "Burgerlijk Wetboek",
    articleNumber: "6:162",
    jurisdiction: "Netherlands",
    lawId: "nl-bw",
    entryCid: "cid-nl",
    sourceRevision: "rev-nl",
  });
  const belgiumCopy = cited({
    officialIdentifier: "BWBR0001854",
    instrumentTitle: "Burgerlijk Wetboek",
    articleNumber: "6:162",
    jurisdiction: "Belgium",
    lawId: "be-copy",
    entryCid: "cid-be",
    sourceRevision: "rev-be",
  });
  const records = [current, previous, oregon, codigo, constitution, belgiumCopy, dutch];

  test("official, bluebook, and cite key forms hit the expected version", () => {
    expect(lookupCitations(records, "42 U.S.C., § 1983").map((hit) => hit.entryCid)).toEqual([
      "cid-previous",
      "cid-current",
    ]);
    expect(lookupCitations(records, "U.S.C. § 1983 (2020)").map((hit) => hit.entryCid)).toEqual(["cid-current"]);
    expect(lookupCitations(records, "42 U.S.C., § 1983", { sourceRevision: "rev-2020" })).toEqual([current]);
    expect(lookupCitations(records, "u s c s 1983 2020", { format: "bluebook" })).toEqual([current]);
    expect(lookupCitations(records, "u s c s 1983 1996", { format: "official" })).toEqual([previous]);
    expect(lookupCitations(records, "ORS 1.010")).toEqual([oregon]);
    expect(lookupCitations(records, "ors 1 010")).toEqual([oregon]);
    expect(lookupCitations(records, "Or. Rev. Stat. § 1.010")).toEqual([]);
  });

  test("native lookup keeps diacritics and does not use the destructive cite key", () => {
    expect(lookupCitations(records, "Código Civil", { format: "native" })).toEqual([codigo]);
    expect(lookupCitations(records, "código civil, art. 1", { format: "native" })).toEqual([codigo]);
    expect(lookupCitations(records, "codigo civil", { format: "native" })).toEqual([]);
    expect(lookupCitations(records, "c digo civil art 1", { format: "native" })).toEqual([]);
    expect(lookupCitations(records, "Código Civil, art. 1")).toEqual([codigo]);
    expect(lookupCitations(records, "中华人民共和国宪法", { format: "native" })).toEqual([constitution]);
    expect(lookupCitations(records, "article 1", { format: "native" })).toEqual([]);
    expect(lookupCitations(records, "article 1").map((hit) => hit.entryCid)).toEqual(["cid-cn"]);
  });

  test("jurisdiction and revision filters exclude other scopes", () => {
    expect(lookupCitations(records, "BWBR0001854, art. 6:162").map((hit) => hit.lawId)).toEqual([
      "be-copy",
      "nl-bw",
    ]);
    expect(lookupCitations(records, "BWBR0001854, art. 6:162", { jurisdiction: "netherlands" })).toEqual([dutch]);
    expect(lookupCitations(records, "BWBR0001854, art. 6:162", { jurisdiction: "united_states" })).toEqual([]);
    expect(lookupCitations(records, "U.S.C. § 1983 (1996)", { sourceRevision: "rev-1996" })[0]).toBe(previous);
  });

  test("order is law id then official citation, and limit is applied after that order", () => {
    const hits = lookupCitations(records, "42 U.S.C., § 1983");
    expect(hits.map((hit) => hit.lawId)).toEqual(["us-1983-1996", "us-1983-2020"]);
    expect(lookupCitations(records, "42 U.S.C., § 1983", { limit: 1 })).toEqual([previous]);
    expect(lookupCitations(records, "   ")).toEqual([]);
    expect(lookupCitations(records, null)).toEqual([]);
  });

  test("a pinpoint without an identifier is not findable", () => {
    const bare = cited({ articleNumber: "9", sectionNumber: "2", jurisdiction: "Germany", lawId: "de-bare" });
    expect(lookupCitations([bare], "art. 9")).toEqual([]);
    expect(bare.citationStatus).toBe("unknown");
  });

  test("an unknown lookup format is rejected", () => {
    expect(() => lookupCitations(records, "ORS 1.010", { format: "fuzzy" })).toThrow(/unsupported citation format/);
  });
});
