# Attribution and redistribution

This audit binds redistribution rights to the pinned dataset revision in `data/worldwide/source-inventory.json` (`0b6db3b679d8b9042c97ca5a48e3625892804ca14e2edf3badde368941665326`). The companion dispositions are `bd713600b9931ddc081059cb53162d5ee4be30f603134ab08697ff6386f1cd9a`. A README was accepted only when its SHA-256 matched the inventory card hash. Nine datasets have no pinned card.

Organization membership in `justicedao` or `endomorphosis` is not a license. A record is resolved only when that dataset's own card states one dataset-wide grant and the attribution that grant requires. Every other record is `unresolved` and carries a `rights` blocker. The blocker covers every artifact kind listed on the record.

## Artifact kinds

Text, official translations, embeddings, and search indexes are bound on the dataset that publishes them. They do not inherit a license from a sibling corpus or from the organization. Administrative boundary polygons and municipality geometry are not in the pinned inventory. That gap is an explicit blocker in `data/worldwide/rights.json`. OpenStreetMap courthouse locations are the only boundary-location rows, and only the card of those datasets can license them.

| Kind | Records | Resolved | Unresolved |
| --- | ---: | ---: | ---: |
| text | 597 | 34 | 563 |
| translation | 11 | 1 | 10 |
| embedding | 291 | 1 | 290 |
| index | 291 | 3 | 288 |
| boundary | 2 | 1 | 1 |
| code | 2 | 2 | 0 |
| dataset | 28 | 5 | 23 |

Resolved records: 44. Unresolved records: 598. Datasets: 642.

## How to attribute a resolved revision

Use the `attribution` string on that record together with the restrictions. Do not shorten a share-alike or exception into a general permission.

- `CC0-1.0`: the card dedicates the pinned revision. Pass the dedication through. Name the source the card names when it names one.
- `CC-BY-4.0`: credit the party named on the card and retain the license. A card that carves part of the revision out of CC BY is unresolved instead.
- `etalab-2.0`: credit the publisher named on the card, in these records DILA / Légifrance where the card says so.
- `OGL-UK-3.0`: include the Open Government Licence v3.0 attribution the card states, including the publisher it names.
- `ODbL-1.0`: attribute OpenStreetMap contributors when the card does, and keep share-alike on the derived database.
- `EU-Decision-2011/833`: legal acts follow Commission Decision 2011/833/EU. Attribute © European Union. Metadata CC0 and editorial CC BY on EUR-Lex are not a license for this corpus. Special conditions and the Publications Office logo stay excluded.
- `public-domain` and `copyright-exempt-official-texts`: use only the statute or public-domain statement quoted on that card. The official text still prevails, and the statement is not legal advice.
- `AGPL-3.0`: the card's statement covers the scripts it names. It is not a license for law text in another repository.

## Resolved records

| Dataset | Revision | Rights | Artifacts | Attribution |
| --- | --- | --- | --- | --- |
| `endomorphosis/Caselaw_Access_Project_JSON` | `5939772ef2a1f69391f86f4841925f2df580b8d3` | CC0-1.0 | dataset | The Caselaw Access Project dataset is licensed under the [CC0 License](https://creativecommons.org/public-domain/cc0/). |
| `endomorphosis/ipfs_austria_laws` | `4d9b6c4ec33e589576da7894c57cc67c19d15cc1` | copyright-exempt-official-texts | text | Austrian official legal texts are official works (amtliche Werke) and not protected by copyright (UrhG § 2 Abs. 1 Z 8 / § 7). RIS is Open Government Data (data.bka.gv.at / data.gv.at). Consolidations are informational. Authentic RIS / Bundesgesetzblatt text prevails. |
| `endomorphosis/ipfs_austria_municipal_laws` | `75d8dd6e3c0c35eddb0a77f5baacbf3f5733a724` | copyright-exempt-official-texts | text | Texts are free works under § 7 UrhG (Austrian Copyright Act): laws, ordinances, official decrees, announcements and decisions are not protected by copyright. Text is as shown in RIS; the authentic version is the one kundgemacht by the municipality. Not legal advice. |
| `endomorphosis/ipfs_belgium_regional_laws` | `8a556383e2d29cc1efac683a142c6e7458ed7c90` | copyright-exempt-official-texts | text | government. In addition, Belgian copyright law (Code of Economic Law, art. XI.172 s.2) gives no copyright protection to official |
| `endomorphosis/ipfs_brazil_caselaw` | `5951bdc55b368c7bdde05171c0edc840febda0fc` | CC-BY-4.0 | dataset | Row label: `Creative Commons Atribuição` (as published on the dataset page). Quoted from https://dadosabertos.web.stj.jus.br/dataset/integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica (fetched 2026-10-29), section "Licença": "Creative Commons Atribuição", linked to http://www.opendefinition.org/licenses/cc-by. The same page states: "Não estão… |
| `endomorphosis/ipfs_cameroon_laws` | `11437a0e37ba364035b327abe812a3ade8fbf5cc` | copyright-exempt-official-texts | text, translation | Présidence de la République du Cameroun (prc.cm) / Services du Premier Ministre (spm.gov.cm). Authentic official text prevails. Official legislative texts (laws, decrees and other official acts and their official translations) are excluded from copyright protection under Law No. 2000/011 of 19 December 2000 (Cameroon copyright and neighbouring rights), Sect… |
| `endomorphosis/ipfs_czech_municipal_laws` | `91b06ba1a65b3aeb275c6113244dab56d2234db7` | copyright-exempt-official-texts | text | - Zákon č. 35/2021 Sb. (o Sbírce právních předpisů územních samosprávných celků a některých správních úřadů), § 1 odst. 3: the Sbírka is made available to the public remotely, free of charge and without restriction ("bezplatně a neomezeně"). |
| `endomorphosis/ipfs_estonia_municipal_laws` | `9658c335b560148c7d0188b997ddb1b64adb1a7b` | copyright-exempt-official-texts | text | - Autoriõiguse seadus § 5 (p 3): legislation and administrative documents (õigusaktid ja haldusdokumendid) are not protected by copyright. |
| `endomorphosis/ipfs_eu_caselaw` | `736d4755850be68fda350d3f90bd952fcaf3b671` | EU-Decision-2011/833 | dataset | `EU reuse (2011/833/EU; CURIA statement)`. Basis, quoted verbatim: |
| `endomorphosis/ipfs_eu_laws` | `9d5021ed3f4329ba551fd8dfa4c250b65bbd73be` | EU-Decision-2011/833 | text | Reuse of EUR-Lex legal documents per Commission Decision 2011/833/EU |
| `endomorphosis/ipfs_finland_municipal_laws` | `53b7cd423d6e988656033e809646a6adcdadc1e3` | copyright-exempt-official-texts | text | Label used in every row: "Municipal regulations/decisions: not protected by copyright under Section 9 of the Finnish Copyright Act (404/1961); attribution to source retained". |
| `endomorphosis/ipfs_france_laws` | `2302d85c4edc6b31793e64858c8d306540a94a45` | etalab-2.0 | text | Attribution to DILA / Légifrance is expected. |
| `endomorphosis/ipfs_french_polynesia_laws` | `5a4e9931ed78a3b9fc41c5bef5034b814e47c7fc` | etalab-2.0 | text | Source: DILA (Direction de l'information légale et administrative), LEGI database, https://echanges.dila.gouv.fr/OPENDATA/LEGI/ (dataset: https://www.data.gouv.fr/fr/datasets/legi-codes-lois-et-reglements-consolides/). Reused under the Licence Ouverte / Open Licence version 2.0 (Etalab), https://www.etalab.gouv.fr/licence-ouverte-open-licence/. Credit: DILA… |
| `endomorphosis/ipfs_greece_municipal_laws` | `2b7b37b0b02df3c9b580e39a91f4840438e27dfa` | copyright-exempt-official-texts | text | Greek municipal regulatory acts are official texts excluded from copyright protection (Law 2121/1993, art. 2(5)); published as open public data on Diavgeia (Law 4727/2020, art. 76 ff.; formerly Law 3861/2010) and reusable under Law 4305/2014 (open data). |
| `endomorphosis/ipfs_greece_regional_laws` | `1617112b89fb76369105cd4bc003443f27a4d8ea` | copyright-exempt-official-texts | text | Greek regional regulatory acts are official texts excluded from copyright protection (Law 2121/1993, art. 2(5)); they are |
| `endomorphosis/ipfs_guam_laws` | `f78536f96f4e552c64fb99d66f57283e24a5f93e` | public-domain | text | Public domain. These are enacted public law texts, works of the government of Guam, an unincorporated territory of the United States. Enacted law is not subject to copyright (government edicts doctrine). Source: the Guam Legislature, https://guamlegislature.gov/public-laws/ - credit: I Liheslaturan Guåhan. Official contact emails that appear in the law text… |
| `endomorphosis/ipfs_ireland_laws` | `888c3cea15ef69b1e5e558e8d10f688dd2f24c5e` | CC-BY-4.0 | text | Oireachtas (Open Data) PSI Licence incorporating CC BY 4.0 International, as stated at https://www.irishstatutebook.ie/eli/open-data.html. Authentic eISB / Iris Oifigiúil text prevails. Not legal advice.. |
| `endomorphosis/ipfs_luxembourg_laws` | `ffc59f665caabfb682ee8380e0ea3550266e1b5d` | CC-BY-4.0 | text | data.legilux.public.lu texts and metadata: CC BY 4.0 as stated on the portal. |
| `endomorphosis/ipfs_luxembourg_municipal_laws` | `d9925146e7498cd5252728102ea02bde8f221785` | copyright-exempt-official-texts | text | Communal regulations are official acts published under art. 82 of the *loi communale modifiée du 13 décembre 1988*; official texts are |
| `endomorphosis/ipfs_netherlands_caselaw` | `9328201b46973c33bfe46837a249fc41c857a6b0` | CC0-1.0 | dataset | `license: cc0-1.0` (public domain). Basis, quoted verbatim: |
| `endomorphosis/ipfs_netherlands_laws` | `58982353b51d0b5d8896f29ce0fb2925c6c00c90` | CC0-1.0 | text | BWB data is published by KOOP under CC0-1.0. |
| `endomorphosis/ipfs_new_caledonia_laws` | `2ebd9d96df6f9c545be7de982eea44a320e2c403` | etalab-2.0 | text | Source: DILA (Direction de l'information légale et administrative), LEGI database, https://echanges.dila.gouv.fr/OPENDATA/LEGI/ (dataset: https://www.data.gouv.fr/fr/datasets/legi-codes-lois-et-reglements-consolides/). Reused under the Licence Ouverte / Open Licence version 2.0 (Etalab), https://www.etalab.gouv.fr/licence-ouverte-open-licence/. Credit: DILA… |
| `endomorphosis/ipfs_newzealand_courts` | `622b9419a7cc7c84af2d9afe41dd201d12374018` | CC-BY-4.0 | dataset | Attribution: Source: New Zealand Ministry of Justice, justice.govt.nz |
| `endomorphosis/ipfs_norfolk_island_laws` | `0656dd9dc920d20201a4ad20026e8c0dfc94ddac` | CC-BY-4.0 | text | Source: Federal Register of Legislation, https://www.legislation.gov.au (Australian Government, Office of Parliamentary Counsel). Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ . Attribution: "Based on content from the Federal Register of Legislation at [snapshot date]. For the latest… |
| `endomorphosis/ipfs_slovakia_municipal_laws` | `ffbf56b9d86ddf87c6b233024bc2cdecacf1db35` | copyright-exempt-official-texts | text | "Slovak municipal generally binding regulations (VZN) are official documents excluded from copyright protection (Act 185/2015 Coll., § 5 (a)); texts as published by the municipality." |
| `endomorphosis/ipfs_slovakia_regional_laws` | `19f7618fae373eff9079e256979e69d949ac13ff` | copyright-exempt-official-texts | text | VZN are generally binding legal acts of regional self-government. Under the Slovak Copyright Act (185/2015 Coll., |
| `endomorphosis/ipfs_sweden_laws` | `0a1e752cb178b83a779996f0e60e6f8d305a857e` | CC0-1.0 | text | Riksdagens öppna data: CC0 1.0 (public domain dedication) as stated at https://www.riksdagen.se/sv/dokument-och-lagar/riksdagens-oppna-data/ and https://www.riksdagen.se/sv/dokument-och-lagar/riksdagens-oppna-data/anvandarstod/villkor-for-anvandning/. Authentic SFS / Riksdagen text prevails. Not legal advice.. |
| `endomorphosis/ipfs_switzerland_laws` | `7f9da5c8665870636242b176cea65e29d4f7ef0b` | copyright-exempt-official-texts | text | Official legislative texts not protected by copyright (URG Art. 5); PublV Art. 48–49 reuse conditions. |
| `endomorphosis/ipfs_switzerland_municipal_laws` | `5165f4d4cbb61e968bc9e8c548951cbfd895c994` | copyright-exempt-official-texts | text | Label used in every row: "Official enactments, not protected by copyright under Art. 5 para. 1 lit. a Swiss Copyright Act (URG); attribution to source retained". |
| `endomorphosis/ipfs_uk_laws` | `ef0cc003db30a0c80d48d221072819af3838ecb2` | OGL-UK-3.0 | text | Open Government Licence v3.0 (The National Archives / legislation.gov.uk); official legislation.gov.uk text prevails; not legal advice. |
| `endomorphosis/ipfs_uk_local_acts` | `f1137461b62e4ec335e5ad39696c5792e5d70c3f` | OGL-UK-3.0 | text | Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). UK Local Acts are Crown copyright (Acts of Parliament, Copyright, Designs and Patents Act 1988 s.164). This dataset is not the official version. |
| `endomorphosis/ipfs_united_kingdom_county_laws` | `6641c235cbf9df3690f801b97e9242339f007443` | OGL-UK-3.0 | text | Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). |
| `endomorphosis/ipfs_wallis_futuna_laws` | `eff428b7ce17c1a960a63dce2c897635e5f0567e` | etalab-2.0 | text | Source: DILA (Direction de l'information légale et administrative), LEGI database, https://echanges.dila.gouv.fr/OPENDATA/LEGI/ (dataset: https://www.data.gouv.fr/fr/datasets/legi-codes-lois-et-reglements-consolides/). Reused under the Licence Ouverte / Open Licence version 2.0 (Etalab), https://www.etalab.gouv.fr/licence-ouverte-open-licence/. Credit: DILA… |
| `endomorphosis/legal_scrapers` | `aa31679410730b2480683c2a467a862fd9162fe3` | AGPL-3.0 | code | AGPL-3.0 for the collector scripts in this repository. |
| `endomorphosis/world_courts` | `a98bce37ed58356fcf64e533326c2c159a31e1e5` | ODbL-1.0 | text, boundary | - Base courthouse locations come from OpenStreetMap `amenity=courthouse` (© OpenStreetMap contributors, ODbL 1.0), so this dataset is released under ODbL. Rows from OSM have `site_policy = open_license:ODbL`. |
| `justicedao/ipfs_estonia_municipal_laws` | `4c305593078ee63139ec24b831ac8d767cd434ec` | copyright-exempt-official-texts | text | - Autoriõiguse seadus § 5 (p 3): legislation and administrative documents (õigusaktid ja haldusdokumendid) are not protected by copyright. |
| `justicedao/ipfs_france_local_laws` | `e5d0f70bc55c2a4610c6d5abab0e6b1b21663c36` | etalab-2.0 | text | Per row: `lov2` (Licence Ouverte / Open Licence 2.0, Etalab) or `fr-lo` (Licence Ouverte v1). Both permit reuse with attribution. The `attribution` JSON gives the publisher, dataset page and resource. |
| `justicedao/ipfs_netherlands_municipal_laws` | `75e74c605f698927ee386d9abecb14d31ed3214e` | CC0-1.0 | text | * License: CC0-1.0, as stated by KOOP on data.overheid.nl dataset "Lokale regelingen" (https://data.overheid.nl/dataset/lokale-regelingen). Each CVDR XML states dcterms:rights "De tekst in dit document is vrij van auteursrecht en databankrecht". |
| `justicedao/ipfs_ukraine_laws_supplement` | `4cb5fb461e558f3602287fccdbf17c73dca298c3` | CC-BY | text | Source: «Єдиний державний реєстр нормативно-правових актів» (Unified State Register of Normative Legal Acts), publisher Міністерство юстиції України (Ministry of Justice of Ukraine), data.gov.ua dataset b22d184c-4826-4e1d-8577-972effc5700c, snapshot 2026-10-18. Licence on dataset page: Creative Commons Attribution (cc-by). Derived/filtered by justicedao (de… |
| `justicedao/patent-legal-bm25` | `a839198eed7cd51860ed7a837f225b23f8e54c0b` | CC0-1.0 | index | The pinned card declares CC0-1.0 and does not name a further attribution party. The license section names the upstream text as public-domain-US-government. |
| `justicedao/patent-legal-corpus` | `df29893bb82fe3694b7f355548ae36a6fb3d5f23` | CC0-1.0 | text | The pinned card declares CC0-1.0 and does not name a further attribution party. The license section names the upstream text as public-domain-US-government. |
| `justicedao/patent-legal-knowledge-graph` | `3b6ff39dc24c622038e6a0c34f92c721b1d6c433` | CC0-1.0 | index | The pinned card declares CC0-1.0 and does not name a further attribution party. The license section names the upstream text as public-domain-US-government. |
| `justicedao/patent-legal-vectors` | `0109a3a992a47403df3189419692f8cf03f57246` | CC0-1.0 | embedding, index | The pinned card declares CC0-1.0 and does not name a further attribution party. The license section names the upstream text as public-domain-US-government. |
| `justicedao/world_law_scrapers` | `9e70127b0d66f285da64af7c990fd6a57a62c318` | AGPL-3.0 | code | AGPL-3.0, the same licence as ipfs_datasets_py (see `LICENSE`). Law texts themselves are not in this repo; |

## Unresolved records

Unresolved rights are blockers. Do not publish, mirror, embed, translate, or draw boundaries from those revisions on the strength of the organization name.

| Reason class | Records |
| --- | ---: |
| `no-grant` | 552 |
| `portal-terms-unquoted` | 19 |
| `pinned-card-split` | 14 |
| `card-absent` | 9 |
| `structured-tag-without-notice` | 3 |
| `hedged-grant` | 1 |

A `portal-terms-unquoted` card says reuse follows the source portal's public-sector terms and does not quote a grant. A structured `license: other` or a custom portal code is recorded in the blocker and is not upgraded to an open license. A `pinned-card-split` card gives different terms for different states, configs, or slices. A `card-absent` revision has no pinned README, so no terms were invented.

## Restrictions that travel with a grant

`not-legal-advice` and `official-source-prevails` mean the pinned text is not the authentic legal source. `share-alike` follows ODbL, AGPL, or CC BY-SA. `stated-exceptions` means the card itself excludes arms, logos, or documents under special conditions. `code-only-not-law-text` means the revision is code and cannot be admitted as law text. `upstream-us-government-work` means the card also names a US government source for the upstream text.

The machine-readable binding is `data/worldwide/rights.json`.
