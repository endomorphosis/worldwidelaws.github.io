import {
  ARTICLE_FIELD_MAP,
  LAW_FIELD_MAP,
  LAW_SECTION_SCHEMA,
  LAW_SOURCE_SCHEMA,
  OPTIONAL_ARTICLE_COLUMNS,
  OPTIONAL_LAW_COLUMNS,
  QUARANTINE_SCHEMA,
  REQUIRED_ARTICLE_COLUMNS,
  REQUIRED_LAW_COLUMNS,
  SCHEMA_VERSION,
  SchemaError,
  admitCorpus,
  sha256Hex,
  type AdmissionResult,
} from '../../src/lib/worldwide/data/schema';

const REVISION = 'a'.repeat(40);
const OTHER_REVISION = 'b'.repeat(40);

function source(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'endomorphosis/ipfs_example_laws',
    publisherId: 'publisher:example',
    sourceRevision: REVISION,
    ...overrides,
  };
}

function reasons(result: AdmissionResult): string[] {
  return result.quarantined.map((item) => item.reason);
}

describe('versioned law section and source schema', () => {
  test('pins schema ids and the country-law column contract', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(LAW_SECTION_SCHEMA).toBe('worldwide-legal-search.law-section@1');
    expect(QUARANTINE_SCHEMA).toBe('worldwide-legal-search.quarantine@1');
    expect([...REQUIRED_LAW_COLUMNS]).toEqual(['id', 'title', 'text']);
    expect([...REQUIRED_ARTICLE_COLUMNS]).toEqual(['id', 'law_id', 'title', 'text']);
    expect([...OPTIONAL_LAW_COLUMNS]).toEqual([
      'source_url',
      'source_type',
      'jurisdiction',
      'country',
      'language',
      'eli',
      'date',
      'date_issued',
      'retrieved_at',
      'license',
      'law_status',
      'identifier',
      'official_identifier',
      'article_count',
      'json_path',
      'metadata_json',
    ]);
    expect([...OPTIONAL_ARTICLE_COLUMNS]).toEqual([
      'source_url',
      'document_number',
      'article_number',
      'record_type',
      'metadata_json',
    ]);
    expect(LAW_FIELD_MAP).toMatchObject({ source_id: 'id', body: 'text', license_expression: 'license' });
    expect(ARTICLE_FIELD_MAP).toMatchObject({ source_id: 'id', law_id: 'law_id', body: 'text' });
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('admits a pinned source, parent law, and child article without collapsing version identity', () => {
    const result = admitCorpus({
      source: source({
        sourceUrl: 'https://example.test/laws',
        instrumentKind: 'statute',
        issuerIds: ['issuer:example'],
        territorialIds: ['place:example'],
        nativeLanguages: ['en', 'mt'],
        license: { expression: 'CC0-1.0', attribution: 'Example Publisher', knowledge: 'known' },
        retrievedAt: { knowledge: 'known', value: '2024-03', precision: 'month', source: 'inventory' },
      }),
      laws: [{
        id: 'law-1',
        title: 'Example Act',
        text: 'The whole act.',
        source_url: 'https://example.test/laws/1',
        source_type: 'html',
        jurisdiction: 'Malta',
        country: 'MT',
        language: 'mt',
        eli: 'eli://example/law-1',
        date: '2020-05-01',
        date_issued: '2020-04',
        license: 'CC0-1.0',
        article_count: 1,
      }],
      articles: [{
        id: 'art-1',
        law_id: 'law-1',
        title: 'Article 1',
        text: 'A rule.',
        article_number: '1',
        source_url: 'https://example.test/laws/1/1',
      }],
    });

    expect(result.quarantined).toEqual([]);
    expect(result.source).toMatchObject({
      schema: LAW_SOURCE_SCHEMA,
      schemaVersion: 1,
      sourceId: 'endomorphosis/ipfs_example_laws',
      publisherId: 'publisher:example',
      sourceRevision: REVISION,
      instrumentKind: 'statute',
      scope: {
        issuerIds: ['issuer:example'],
        territorialIds: ['place:example'],
        knowledge: 'known',
      },
      license: { expression: 'CC0-1.0', attribution: 'Example Publisher', knowledge: 'known' },
      retrievedAt: { knowledge: 'known', value: '2024-03', precision: 'month', source: 'inventory' },
    });
    expect(result.source?.nativeLanguages.map((item) => item.tag)).toEqual(['en', 'mt']);

    const law = result.sections.find((item) => item.recordType === 'law');
    const article = result.sections.find((item) => item.recordType === 'article');
    expect(law).toMatchObject({
      schema: LAW_SECTION_SCHEMA,
      sectionId: 'law-1',
      instrumentId: 'law-1',
      textVersionDerived: true,
      sourceType: 'html',
      instrumentKind: 'unknown',
      language: { tag: 'mt', knowledge: 'known', source: 'laws.language' },
      status: 'unknown',
      statusKnowledge: 'unknown',
      officialCitation: 'eli://example/law-1',
      eli: 'eli://example/law-1',
      articleCount: 1,
      bodySha256: sha256Hex('The whole act.'),
      textVersionId: `tv1:${REVISION}:${sha256Hex('The whole act.')}`,
      dates: {
        publication: { knowledge: 'known', value: '2020-05-01', precision: 'day', source: 'laws.date' },
        enactment: { knowledge: 'known', value: '2020-04', precision: 'month', source: 'laws.date_issued' },
        commencement: { knowledge: 'unknown', value: null, precision: null, source: null },
        repeal: { knowledge: 'unknown', value: null, precision: null, source: null },
      },
      scope: {
        issuerIds: [],
        territorialLabels: ['Malta', 'MT'],
        knowledge: 'known',
      },
      license: { expression: 'CC0-1.0', knowledge: 'known' },
    });
    expect(law?.textVersionId).not.toBe(law?.instrumentId);
    expect(law?.provenance.unknownFields).toEqual(expect.arrayContaining(['status', 'repeal', 'commencement', 'instrumentKind']));
    expect(law?.provenance.inferredFields).toContain('textVersionId');
    expect(law?.provenance.inferenceNotes.textVersionId).toMatch(/not an official citation/);
    expect(article).toMatchObject({
      sectionId: 'art-1',
      instrumentId: 'law-1',
      parentInstrumentId: 'law-1',
      language: { tag: null, knowledge: 'unknown' },
      officialCitation: null,
      license: { expression: null, knowledge: 'unknown' },
      hierarchy: { number: '1' },
    });
    expect(article?.associations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'parent-instrument', targetInstrumentId: 'law-1' }),
    ]));
    expect(article?.textVersionId).not.toBe(article?.instrumentId);
    expect(article?.language.tag).not.toBe(law?.language.tag);
    expect(article?.license).not.toEqual(result.source?.license);
  });

  test('rejects a non-object corpus without inventing identifiers', () => {
    expect(() => admitCorpus(null as never)).toThrow(SchemaError);
  });

  test('quarantines missing source identity, publisher, and unpinned revisions', () => {
    const missing = admitCorpus({});
    expect(missing.source).toBeNull();
    expect(missing.sections).toEqual([]);
    expect(reasons(missing)).toContain('missing-source-id');
    expect(missing.quarantined[0].officialCitation).toBeNull();
    expect(missing.quarantined[0].message).toMatch(/No source identity was invented/);

    const publisher = admitCorpus({ source: source({ publisherId: '  ' }) });
    expect(reasons(publisher)).toContain('missing-publisher-id');
    expect(publisher.sections).toEqual([]);

    for (const sourceRevision of ['main', 'HEAD', 'latest', 'refs/heads/main']) {
      const result = admitCorpus({ source: source({ sourceRevision }) });
      expect(result.source).toBeNull();
      expect(result.sections).toEqual([]);
      expect(reasons(result)).toContain('unpinned-source-revision');
    }

    const malformed = admitCorpus({ source: source({ sourceRevision: 'abc' }) });
    expect(reasons(malformed)).toContain('invalid-source-revision');
    const javascriptUrl = admitCorpus({ source: source({ sourceUrl: 'javascript:alert(1)' }) });
    expect(reasons(javascriptUrl)).toContain('invalid-source-url');
    const selfParent = admitCorpus({ source: source({ parentSourceId: 'endomorphosis/ipfs_example_laws' }) });
    expect(reasons(selfParent)).toContain('parent-is-self');
    expect(selfParent.sections).toEqual([]);
  });

  test('quarantines missing required columns and blank ids without inventing citations', () => {
    const columns = admitCorpus({
      source: source(),
      laws: [{ name: 'Nope', body: 'text' }],
    });
    expect(columns.sections).toEqual([]);
    expect(reasons(columns)).toContain('required-column-missing');
    expect(columns.quarantined[0].detail).toMatch(/No identifiers were invented/);
    expect(columns.quarantined[0].officialCitation).toBeNull();
    expect(columns.quarantined[0].ingestionKey).toMatch(/^qk1_[0-9a-f]{64}$/);
    expect(JSON.stringify(columns.sections)).not.toContain('qk1_');

    const rows = admitCorpus({
      source: source(),
      laws: [
        { id: '   ', title: 'No', text: 'x' },
        { id: 'keep', title: 'Yes', text: 'y', language: 'en' },
      ],
    });
    expect(rows.sections.map((item) => item.sectionId)).toEqual(['keep']);
    expect(reasons(rows)).toEqual(expect.arrayContaining(['missing-section-id', 'missing-instrument-id']));
    const missing = rows.quarantined.find((item) => item.reason === 'missing-section-id');
    expect(missing?.message).toMatch(/No official identifier was invented/);
    expect(missing?.officialCitation).toBeNull();
    const again = admitCorpus({
      source: source(),
      laws: [
        { id: '   ', title: 'No', text: 'x' },
        { id: 'keep', title: 'Yes', text: 'y', language: 'en' },
      ],
    });
    expect(again.quarantined.map((item) => item.ingestionKey)).toEqual(rows.quarantined.map((item) => item.ingestionKey));
    expect(rows.sections.every((item) => item.sectionId !== missing?.ingestionKey)).toBe(true);
    expect(rows.sections.every((item) => item.officialCitation !== missing?.ingestionKey)).toBe(true);

    const articleColumns = admitCorpus({
      source: source(),
      articles: [{ id: 'art-1', title: 'Article', text: 'body' }],
    });
    expect(articleColumns.sections).toEqual([]);
    expect(reasons(articleColumns)).toContain('required-column-missing');
    expect(articleColumns.quarantined[0].detail).toMatch(/law_id/);

    const article = admitCorpus({
      source: source(),
      articles: [{ id: 'art-1', law_id: '  ', title: 'Article', text: 'body' }],
    });
    expect(article.sections).toEqual([]);
    expect(reasons(article)).toContain('missing-instrument-id');

    const blankText = admitCorpus({
      source: source(),
      laws: [
        { id: 'blank', title: 'Blank', text: null },
        { id: 'full', title: 'Full', text: 'hello', language: 'en' },
      ],
    });
    expect(blankText.sections.map((item) => item.sectionId)).toEqual(['full']);
    expect(reasons(blankText)).toContain('missing-text-version-id');
  });

  test('quarantines invalid parent links and keeps a fully qualified external parent', () => {
    const selfParent = admitCorpus({
      source: source(),
      sections: [{ sectionId: 's', instrumentId: 's', text: 'body', language: 'en', parentSectionId: 's' }],
    });
    expect(selfParent.sections).toEqual([]);
    expect(reasons(selfParent)).toContain('parent-is-self');

    const cycle = admitCorpus({
      source: source(),
      sections: [
        { sectionId: 'a', instrumentId: 'a', text: 'alpha', language: 'en', parentSectionId: 'b' },
        { sectionId: 'b', instrumentId: 'b', text: 'beta', language: 'en', parentSectionId: 'a' },
      ],
    });
    expect(cycle.sections).toEqual([]);
    expect(reasons(cycle)).toEqual(['cyclic-parent', 'cyclic-parent']);

    const dangling = admitCorpus({
      source: source(),
      laws: [{ id: 'law-1', title: 'Act', text: 'body', language: 'en' }],
      articles: [{ id: 'art-9', law_id: 'missing-law', title: 'Article', text: 'rule' }],
    });
    expect(dangling.sections.map((item) => item.sectionId)).toEqual(['law-1']);
    expect(reasons(dangling)).toContain('dangling-parent');

    const mismatch = admitCorpus({
      source: source(),
      laws: [
        { id: 'law-1', title: 'One', text: 'one', language: 'en' },
        { id: 'law-2', title: 'Two', text: 'two', language: 'en' },
      ],
      sections: [{
        sectionId: 'art-2',
        instrumentId: 'law-1',
        text: 'child',
        language: 'en',
        parentSectionId: 'law-2',
      }],
    });
    expect(mismatch.sections.map((item) => item.sectionId).sort()).toEqual(['law-1', 'law-2']);
    expect(reasons(mismatch)).toContain('parent-instrument-mismatch');

    const cross = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 'child',
        instrumentId: 'child',
        text: 'body',
        language: 'de',
        parentSectionId: 'parent-1',
        parentSourceId: 'other/source',
      }],
    });
    expect(cross.sections).toEqual([]);
    expect(reasons(cross)).toContain('cross-source-parent');

    const external = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 'child',
        instrumentId: 'child',
        text: 'body',
        language: 'de',
        parentSectionId: 'parent-1',
        parentSourceId: 'other/source',
        parentSourceRevision: OTHER_REVISION,
      }],
    });
    expect(external.quarantined).toEqual([]);
    expect(external.sections[0].associations).toEqual([
      expect.objectContaining({
        kind: 'parent-section',
        targetSectionId: 'parent-1',
        targetSourceId: 'other/source',
        targetSourceRevision: OTHER_REVISION,
      }),
    ]);
  });

  test('keeps date precision, unknown dates, and inferred dates explicit', () => {
    const badPrecision = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        dates: { publication: { knowledge: 'known', value: '2020-01', precision: 'day', source: 'row' } },
      }],
    });
    expect(reasons(badPrecision)).toContain('date-precision-mismatch');

    const impossible = admitCorpus({
      source: source(),
      sections: [{ sectionId: 's', instrumentId: 's', text: 'body', language: 'en', dates: { publication: '2020-02-31' } }],
    });
    expect(reasons(impossible)).toContain('date-precision-mismatch');

    const unknownValue = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        dates: { repeal: { knowledge: 'unknown', value: '2020' } },
      }],
    });
    expect(reasons(unknownValue)).toContain('unknown-date-has-value');

    const missingKnowledge = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        dates: { publication: { value: '2020-01-01', precision: 'day' } },
      }],
    });
    expect(reasons(missingKnowledge)).toContain('date-knowledge-missing');

    const inferredMissing = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        dates: { commencement: { knowledge: 'inferred', value: '2020-01', precision: 'month' } },
      }],
    });
    expect(reasons(inferredMissing)).toContain('inferred-date-without-source');

    const inferred = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        status: 'current',
        dates: {
          commencement: { knowledge: 'inferred', value: '2020-01', precision: 'month', source: 'gazette printed the month only' },
        },
      }],
    });
    expect(inferred.quarantined).toEqual([]);
    expect(inferred.sections[0].dates.commencement).toEqual({
      knowledge: 'inferred',
      value: '2020-01',
      precision: 'month',
      source: 'gazette printed the month only',
    });
    expect(inferred.sections[0].provenance.inferenceNotes.commencement).toBe('gazette printed the month only');
    expect(inferred.sections[0].status).toBe('current');
    expect(inferred.sections[0].provenance.unknownFields).toEqual(expect.arrayContaining(['publication', 'enactment', 'repeal']));

    const order = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        dates: { enactment: '2020-05-01', repeal: '2019' },
      }],
    });
    expect(reasons(order)).toContain('repeal-before-enactment');

    const sameYear = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        dates: { enactment: '2020-06-01', repeal: '2020' },
      }],
    });
    expect(sameYear.quarantined).toEqual([]);
    expect(sameYear.sections[0].dates.repeal.precision).toBe('year');

    const conflict = admitCorpus({
      source: source(),
      laws: [{
        id: 'law-1',
        title: 'Act',
        text: 'body',
        language: 'en',
        date: '2020-01-01',
        metadata_json: JSON.stringify({ publication_date: '2021-01-01' }),
      }],
    });
    expect(conflict.sections).toEqual([]);
    expect(reasons(conflict)).toContain('conflicting-date');

    const brokenMeta = admitCorpus({
      source: source(),
      laws: [{ id: 'law-1', title: 'Act', text: 'body', metadata_json: '{oops' }],
    });
    expect(brokenMeta.sections).toEqual([]);
    expect(reasons(brokenMeta)).toContain('unreadable-provenance');
  });

  test('represents unknown language and status and rejects invalid values', () => {
    const omitted = admitCorpus({
      source: source(),
      sections: [{ sectionId: 's', instrumentId: 's', text: 'body' }],
    });
    expect(omitted.quarantined).toEqual([]);
    expect(omitted.sections[0].language).toEqual({ tag: null, knowledge: 'unknown', source: null });
    expect(omitted.sections[0].status).toBe('unknown');
    expect(omitted.sections[0].statusKnowledge).toBe('unknown');

    const tags = admitCorpus({
      source: source(),
      sections: [
        { sectionId: 'nl', instrumentId: 'nl', text: 'een', language: 'nl-NL' },
        { sectionId: 'zh', instrumentId: 'zh', text: '文', language: 'zh-Hant' },
      ],
    });
    expect(tags.quarantined).toEqual([]);
    expect(tags.sections.map((item) => item.language.tag)).toEqual(['nl-NL', 'zh-Hant']);

    const english = admitCorpus({
      source: source(),
      sections: [{ sectionId: 's', instrumentId: 's', text: 'body', language: 'english' }],
    });
    expect(reasons(english)).toContain('invalid-language-tag');

    const unmarked = admitCorpus({
      source: source(),
      sections: [{ sectionId: 's', instrumentId: 's', text: 'body', language: {} }],
    });
    expect(reasons(unmarked)).toContain('language-unspecified');

    const unknownTag = admitCorpus({
      source: source(),
      sections: [{ sectionId: 's', instrumentId: 's', text: 'body', language: { knowledge: 'unknown', tag: 'en' } }],
    });
    expect(reasons(unknownTag)).toContain('unknown-language-has-tag');

    const status = admitCorpus({
      source: source(),
      laws: [{ id: 'law-1', title: 'Act', text: 'body', language: 'en', law_status: 'in_force' }],
    });
    expect(status.sections).toEqual([]);
    expect(reasons(status)).toContain('invalid-status');
    expect(status.quarantined[0].message).toMatch(/not current, historical, repealed, superseded, or unknown/);
  });

  test('rejects invalid scope, collapsed versions, ingestion-key citations, and unexplained inferences', () => {
    const emptyKnown = admitCorpus({
      source: source({ scopeKnowledge: 'known' }),
    });
    expect(emptyKnown.source).toBeNull();
    expect(reasons(emptyKnown)).toContain('issuer-scope-empty-unmarked');

    const unknownWithId = admitCorpus({
      source: source({ scopeKnowledge: 'unknown', issuerIds: ['issuer:example'] }),
    });
    expect(reasons(unknownWithId)).toContain('unknown-scope-has-ids');

    const explicitUnknown = admitCorpus({ source: source({ scopeKnowledge: 'unknown' }) });
    expect(explicitUnknown.quarantined).toEqual([]);
    expect(explicitUnknown.source?.scope).toMatchObject({
      knowledge: 'unknown',
      issuerIds: [],
      territorialIds: [],
      territorialLabels: [],
    });

    const collapsed = admitCorpus({
      source: source(),
      sections: [{ sectionId: 'same', instrumentId: 'same', textVersionId: 'same', text: 'body', language: 'en' }],
    });
    expect(collapsed.sections).toEqual([]);
    expect(reasons(collapsed)).toContain('text-version-collapsed-into-instrument');
    expect(collapsed.quarantined[0].message).toMatch(/Version identity stays separate/);

    const citedKey = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        officialCitation: `qk1_${'ab'.repeat(32)}`,
      }],
    });
    expect(citedKey.sections).toEqual([]);
    expect(reasons(citedKey)).toContain('ingestion-key-used-as-citation');
    expect(citedKey.quarantined[0].officialCitation).toBeNull();
    expect(citedKey.quarantined[0].message).toMatch(/not citations/);

    const inferred = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        provenance: { inferredFields: ['title'], inferenceNotes: {} },
      }],
    });
    expect(reasons(inferred)).toContain('inferred-field-without-reason');

    const duplicate = admitCorpus({
      source: source(),
      laws: [
        { id: 'law-1', title: 'First', text: 'one', language: 'en' },
        { id: 'law-1', title: 'Second', text: 'two', language: 'en' },
      ],
    });
    expect(duplicate.sections).toHaveLength(1);
    expect(duplicate.sections[0].title).toBe('First');
    expect(reasons(duplicate)).toContain('duplicate-section-identity');
  });

  test('preserves conflicting mirror versions and rejects false equivalence, self-amendment, and same-language translation', () => {
    const otherHash = sha256Hex('beta');
    const conflict = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'alpha',
        language: 'en',
        mirrors: [{
          kind: 'mirror-of',
          relation: 'conflicting-version',
          targetSourceId: 'other/source',
          targetSourceRevision: OTHER_REVISION,
          targetSectionId: 's2',
          targetTextVersionId: 'tv-other',
          targetBodySha256: otherHash,
        }],
      }],
    });
    expect(conflict.quarantined).toEqual([]);
    expect(conflict.sections[0].textVersionId).not.toBe('tv-other');
    expect(conflict.sections[0].textVersionId).not.toBe(conflict.sections[0].instrumentId);
    expect(conflict.sections[0].associations).toEqual([
      expect.objectContaining({
        kind: 'mirror-of',
        relation: 'conflicting-version',
        targetSourceId: 'other/source',
        targetSourceRevision: OTHER_REVISION,
        targetTextVersionId: 'tv-other',
        targetBodySha256: otherHash,
      }),
    ]);

    const equivalent = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'alpha',
        language: 'en',
        mirrors: [{
          kind: 'equivalent-text',
          targetSourceId: 'other/source',
          targetSourceRevision: OTHER_REVISION,
          targetSectionId: 's2',
          targetTextVersionId: 'tv-other',
          targetBodySha256: otherHash,
        }],
      }],
    });
    expect(equivalent.sections).toEqual([]);
    expect(reasons(equivalent)).toContain('equivalent-text-hash-mismatch');

    const amendment = admitCorpus({
      source: source(),
      sections: [{
        sectionId: 's',
        instrumentId: 's',
        text: 'body',
        language: 'en',
        amendments: [{ kind: 'amendment-of', targetSectionId: 's' }],
      }],
    });
    expect(reasons(amendment)).toContain('amendment-targets-self');

    const translated = admitCorpus({
      source: source(),
      sections: [
        { sectionId: 's-nl', instrumentId: 's-nl', text: 'nl text', language: 'nl' },
        { sectionId: 's-en', instrumentId: 's-en', text: 'en text', language: 'en' },
      ],
      associations: [{
        kind: 'translation-of',
        fromSectionId: 's-en',
        targetSectionId: 's-nl',
        targetLanguage: 'nl',
      }],
    });
    expect(translated.quarantined).toEqual([]);
    const english = translated.sections.find((item) => item.sectionId === 's-en');
    expect(english?.associations).toEqual([
      expect.objectContaining({ kind: 'translation-of', targetSectionId: 's-nl', targetLanguage: 'nl' }),
    ]);

    const sameLanguage = admitCorpus({
      source: source(),
      sections: [
        { sectionId: 's-nl', instrumentId: 's-nl', text: 'nl text', language: 'nl' },
        { sectionId: 's-en', instrumentId: 's-en', text: 'en text', language: 'en' },
      ],
      associations: [{
        kind: 'translation-of',
        fromSectionId: 's-en',
        targetSectionId: 's-nl',
        targetLanguage: 'en',
      }],
    });
    expect(sameLanguage.sections.map((item) => item.sectionId)).toEqual(['s-nl']);
    expect(reasons(sameLanguage)).toContain('translation-language-unchanged');
  });
});
