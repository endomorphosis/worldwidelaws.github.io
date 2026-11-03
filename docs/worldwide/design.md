# Worldwide visual system

This is the visual and interaction contract for worldwide legal search. The canonical tokens, states, labels, and keyboard flows are also in `docs/worldwide/interaction-states.json`. The stylesheet that implements them is `src/styles/worldwide.css`. Later shell, results, reader, coverage, and locale tasks use this contract. They do not invent a second visual system.

Search is the primary act. Place, as-of date, and language stay visible with it. Desktop layout keeps that header, then a compact jurisdiction stack, the result list, and collapsed filters. Mobile layout keeps search and place on screen and opens filters in a sheet. A map is not required to choose a place or read a result. The map is optional. A model download is optional, and ordinary search works without it. Nothing in this system decides that a law applies.

The target is WCAG 2.2 AA: text contrast, non-text contrast, keyboard operation, visible focus, names and roles, reduced motion, 200% zoom, and reflow at 320 CSS pixels. RTL layout mirrors reading order with logical properties. Keyboard place selection and search never depend on a pointer.

## Search-first hierarchy

The meaningful sequence is the keyboard sequence. Visual placement on Desktop must not send focus through a different sequence.

1. Skip links: search, results, filters.
2. Product name.
3. Place, its origin, and Change place.
4. As-of date.
5. Language. This changes the interface locale only. It does not choose a jurisdiction.
6. The search field. This is the largest control.
7. Query suggestions, when the visitor has typed.
8. Scope: This place, or Search worldwide.
9. Searched and remaining counts.
10. The status line for the current interaction state, including its next action.
11. The jurisdiction stack, headed "Laws and sources for this place".
12. Results.
13. Filters, collapsed until opened.
14. The reader or the optional preview.
15. Coverage.
16. The optional map, closed unless the visitor opens it.
17. The optional model offer, absent unless the visitor asks or the model is unavailable.

The game fonts Upheaval Pro and VCR OSD Mono are not used on this surface. The surface paints its own paper background so the surrounding site theme does not invert legal text.

Routes stay on the hash contract: `/#/search`, `/#/place/<id>`, `/#/law/<record-id>`, `/#/coverage`, `/#/sources/<source-id>`, and `/#/compare`. Shared links omit a street address and exact coordinates unless the visitor explicitly opts in. Compare, when opened later, is two stacked columns on Mobile and two side-by-side columns on Desktop. It does not merge two places into one answer.

## Wireframes

Desktop means a viewport of at least 64rem (1024px at the default 16px root). Mobile means every viewport below that, including 320 CSS pixels. A short viewport, under 480 CSS pixels tall, does not pin the header, so enlarged text can scroll.

### Desktop

```text
+------------------------------------------------------------------+
| Skip to search · Skip to results · Skip to filters               |
| Worldwide laws                                                   |
| Amsterdam · North Holland · Netherlands                          |
| manually selected                              [ Change place ]  |
| As of  26 Oct 2026          Language  English                    |
| [ Search laws and sources .................................. ]   |
| ( ) This place    ( ) Search worldwide                           |
| Searched 2 · Remaining 1                                         |
| Status and the one next action for this state                    |
+------------------------------+-----------------------------------+
| Laws and sources for this    | Result                            |
| place                        | Original title                    |
| Amsterdam                    | Labelled translation, if any     |
| North Holland                | Issuer · level · status · date    |
| Netherlands                  | Included because …                |
| Coverage by level            | Source · revision                 |
| [ Filters ] collapsed        |                                   |
+------------------------------+-----------------------------------+
| Reader or preview keeps the result list on screen.               |
| Map is optional and closed. Model download is optional.          |
+------------------------------------------------------------------+
```

The result list is one ranked list with authority badges. Group by level is an optional toggle inside Filters, off by default. A city-only filter must not hide national law. The preview is a document, not a map.

### Mobile

```text
+-------------------------------+
| Skip to search                |
| Worldwide laws                |
| Amsterdam                     |
| manually selected             |
| [ Change place ]              |
| As of 26 Oct 2026   Language  |
| [ Search laws and sources ]   |
| This place | Search worldwide |
| Searched 2 · Remaining 1      |
| Status and next action        |
+-------------------------------+
| Laws and sources for this     |
| place (compact, wraps)        |
| Result                        |
| Result                        |
| [ Filters ] opens a sheet     |
+-------------------------------+
| After a result:               |
| [ Back to results ]           |
| Reader                        |
| The list returns to the same  |
| scroll position.              |
+-------------------------------+
```

On Mobile the header that contains place and search is sticky until the viewport is shorter than 480 CSS pixels. The Filters control is outside the sheet. Opening the sheet moves focus to the sheet heading. Escape or Close filters returns focus to the Filters control. Search and place stay reachable through the skip link.

Selecting a result opens the reader and hides the list only on Mobile. Desktop keeps the list on screen and opens the reader below it. Back to results restores the result that was opened and the scroll position.

## Tokens

The spacing unit is 4 pixels, expressed as `0.25rem` so 200% text zoom scales the rhythm. Type sizes are rem. Colors below were computed against the stated partner. Body text must reach 4.5:1. UI boundaries that convey state must reach 3:1. Disabled text is still above 4.5:1, and a disabled control is never the only carrier of a state.

### Type

| Token | Value | Use |
| --- | --- | --- |
| ui | Source Sans 3, Noto Sans, Noto Sans Arabic, Noto Sans Hebrew, Noto Sans JP, Noto Sans SC, Noto Sans KR, system-ui, sans-serif | Chrome, labels, controls |
| body | Source Serif 4, Noto Naskh Arabic, Noto Serif Hebrew, Noto Serif JP, Noto Serif SC, Noto Serif KR, Georgia, serif | Original titles, law text, translations |
| mono | ui-monospace, Source Code Pro, Noto Sans Mono, monospace | Citations and record ids |
| caption | 0.875rem / 1.4 | Origin, counts, revision |
| body size | 1rem / 1.5 | Interface prose |
| search | 1.25rem, 1.125rem below 64rem | The search field |
| title | 1.5rem / 1.3 | Page and reader title |
| product | 1.125rem / 1.3 | Product name |
| weight | 400 regular, 600 semibold | Semibold for the current place, result titles, and the next action |

No font files are added by this contract. Named families fall back to system fonts that cover Latin, Arabic, Hebrew, and CJK. A later task may ship a font only if the shell stays inside the 350 KiB gzip JavaScript budget. The budget is not a font budget, and this stylesheet does not spend it.

### Spacing

| Token | px | rem |
| --- | ---: | --- |
| unit | 4 | 0.25rem |
| 1 | 4 | 0.25rem |
| 2 | 8 | 0.5rem |
| 3 | 12 | 0.75rem |
| 4 | 16 | 1rem |
| 5 | 24 | 1.5rem |
| 6 | 32 | 2rem |
| 7 | 48 | 3rem |
| 8 | 64 | 4rem |

Controls and result links have a minimum size of 2.75rem (44px) in both axes when the control is icon-sized, and a minimum block size of 2.75rem when it is a text button, input, or result link. Inline prose links inside a law paragraph are underlined and keep the line height of the text. They are not stretched into 44px blocks.

The gap inside a wrapping toolbar is space 2. The page padding is space 4, and space 3 at 320 CSS pixels. Sections stack with space 5 between them.

### Color

| Token | Hex | On | Ratio |
| --- | --- | --- | ---: |
| text | #172026 | background #f7f4ef | 15.06 |
| text | #172026 | surface #fffdf8 | 16.25 |
| link, focus | #0b3a5b | background #f7f4ef | 10.81 |
| inverse text | #ffffff | accent #0b3a5b | 11.86 |
| pressed accent | #07283f | with #ffffff | 15.17 |
| secondary text | #3e4a52 | background #f7f4ef | 8.30 |
| placeholder | #4e463f | background #f7f4ef | 8.43 |
| border | #6e675e | background #f7f4ef | 5.08 |
| visited | #3d2463 | background #f7f4ef | 11.74 |
| known text | #0c4a32 | known surface #e5f4ec | 9.06 |
| partial text | #5c3b00 | partial surface #fff3d6 | 9.15 |
| missing text | #6e1220 | missing surface #fde8ea | 10.11 |
| unknown text | #1e3348 | unknown surface #e7eef3 | 11.05 |
| unavailable text | #3f2a12 | unavailable surface #f3ebe1 | 11.46 |
| mark | #172026 | #fff3d6 | 15.06 |
| disabled text | #3a342e | disabled surface #d9d3cb | 8.26 |

Focus is a 3px solid `#0b3a5b` ring, offset 2px, with a 2px paper gap so the ring stays visible on an accent button. In forced colors the ring is `Highlight` and control borders are `ButtonText`. The paper surface sets `color-scheme: light` so native controls match it. Forced colors revert that.

Query highlights use the mark pair and also a semibold weight. Coverage, status, and translation are words, not color alone.

## Scope and coverage wording

English interface copy for scope and inclusion is fixed, because the place machine and the authority stack already use these sentences. Locales translate them. They do not change the enums.

| Situation | Wording |
| --- | --- |
| Stack heading | Laws and sources for this place |
| Why a row is present | Included because … |
| Applicability | This choice does not decide that a law applies. |
| Stack limit | This authority stack does not decide what binds conduct at this place. |
| Place scope | This place |
| Worldwide scope | Search worldwide |
| Unselected origin | unselected worldwide |
| URL origin | shared URL |
| Manual origin | manually selected |
| Saved origin | saved selection |
| Device origin | device location |
| GeoIP origin | approximate IP location |
| Counts | Searched N · Remaining N |
| Capped worldwide | These are the results retrieved so far. This is not all worldwide results. |
| Known | Known collection |
| Partial | Partial collection |
| Missing | No collection in the catalog |
| Unknown | Coverage unknown |
| Unavailable | Collection unavailable |
| Municipal gap | No municipal collection is in the catalog for this place. That is a coverage gap, not a finding that no local law exists. |
| No matches | No matches in the collections that were searched. |
| Unsearched | This collection was not searched. |
| Empty query | Enter a question, citation, or identifier. An empty search is not a result about the law. |

Origin text is the machine vocabulary from the place state: shared URL, manually selected, saved selection, device location, approximate IP location, or unselected worldwide. A country-only suggestion does not name a city. Duplicate names stay unselected until the visitor picks a row that shows the full parent chain and native names. A border or overlapping reading lists candidate jurisdictions and keeps the uncertainty. Late approximate responses do not replace a shared URL, a manual choice, or a saved choice.

Search worldwide searches the eligible corpus progressively. The counts name searched collections and remaining collections. A partial count is not a complete corpus. Ranking is relevance. It is not a ruling about conflicts of law.

Historical text, future commencement, and unknown status are separate labels. A translation is labelled machine translation or official translation, and the original title remains. An unknown source or status is shown as unknown. It is not filled in.

## Translated labels

The locale is the interface language. It is separate from the language of a law and from the place being searched. English (`en`), Dutch (`nl`), Arabic (`ar`, RTL), and Japanese (`ja`, CJK) are the labelled sets. The runtime catalog is a later task. This contract is the copy that catalog must carry.

`included_because` is a prefix in English, Dutch, and Arabic, followed by the reason. Japanese uses the label 「収録した理由：」 and then the reason. The reason itself is source evidence, not a new legal conclusion.

| Key | English | Dutch | Arabic | Japanese |
| --- | --- | --- | --- | --- |
| product | Worldwide laws | Wereldwijde wetten | قوانين العالم | 世界の法令 |
| search_label | Search laws and sources | Zoek in wetten en bronnen | البحث في القوانين والمصادر | 法令と情報源を検索 |
| search_placeholder | Question, citation, or identifier | Vraag, vindplaats of kenmerk | سؤال أو استشهاد أو معرّف | 質問、引用、または識別子 |
| skip_to_search | Skip to search | Naar zoeken | انتقال إلى البحث | 検索へ移動 |
| skip_to_results | Skip to results | Naar resultaten | انتقال إلى النتائج | 結果へ移動 |
| skip_to_filters | Skip to filters | Naar filters | انتقال إلى عوامل التصفية | 絞り込みへ移動 |
| change_place | Change place | Plaats wijzigen | تغيير المكان | 場所を変更 |
| choose_place | Choose a place | Kies een plaats | اختر مكانًا | 場所を選ぶ |
| this_place | This place | Deze plaats | هذا المكان | この場所 |
| search_worldwide | Search worldwide | Zoek wereldwijd | بحث على مستوى العالم | 世界全体を検索 |
| as_of | As of | Per | اعتبارًا من | 時点 |
| language | Language | Taal | اللغة | 言語 |
| filters | Filters | Filters | عوامل التصفية | 絞り込み |
| close_filters | Close filters | Filters sluiten | إغلاق عوامل التصفية | 絞り込みを閉じる |
| coverage | Coverage | Dekking | التغطية | 収録範囲 |
| laws_and_sources | Laws and sources for this place | Wetten en bronnen voor deze plaats | القوانين والمصادر لهذا المكان | この場所の法令と情報源 |
| included_because | Included because | Opgenomen omdat | مُدرج لأن | 収録した理由 |
| original_title | Original title | Oorspronkelijke titel | العنوان الأصلي | 原題 |
| translation | Translation | Vertaling | ترجمة | 翻訳 |
| machine_translation | Machine translation | Machinevertaling | ترجمة آلية | 機械翻訳 |
| official_translation | Official translation | Officiële vertaling | ترجمة رسمية | 公式訳 |
| map_optional | Map (optional) | Kaart (optioneel) | خريطة (اختيارية) | 地図（任意） |
| model_optional | Download a model (optional) | Model downloaden (optioneel) | تنزيل نموذج (اختياري) | モデルのダウンロード（任意） |
| back_to_results | Back to results | Terug naar resultaten | العودة إلى النتائج | 結果に戻る |
| applicability | This choice does not decide that a law applies. | Deze keuze bepaalt niet dat een wet van toepassing is. | هذا الاختيار لا يقرر أن قانونًا ينطبق. | この選択は、法令が適用されることを決めるものではありません。 |
| continue_search | Continue | Ga verder | متابعة البحث | 検索を続ける |
| retry | Retry | Opnieuw proberen | إعادة المحاولة | 再試行 |
| unselected_worldwide | unselected worldwide | wereldwijd, nog niet gekozen | النطاق العالمي دون اختيار مكان | 場所未選択の全世界 |
| origin_url | shared URL | gedeelde URL | رابط مشترك | 共有URL |
| origin_manual | manually selected | handmatig gekozen | اختيار يدوي | 手入力で選択 |
| origin_saved | saved selection | opgeslagen keuze | اختيار محفوظ | 保存した選択 |
| origin_device | device location | apparaatlocatie | موقع الجهاز | 端末の位置情報 |
| origin_ip | approximate IP location | benaderde IP-locatie | موقع تقريبي من عنوان IP | IPアドレスによる概算位置 |
| coverage_known | Known collection | Bekende verzameling | مجموعة معروفة | 収録済みのコレクション |
| coverage_partial | Partial collection | Gedeeltelijke verzameling | مجموعة جزئية | 一部のみ収録 |
| coverage_missing | No collection in the catalog | Geen verzameling in de catalogus | لا مجموعة في الفهرس | カタログにコレクションがない |
| coverage_unknown | Coverage unknown | Dekking onbekend | التغطية غير معروفة | 収録範囲は不明 |
| coverage_unavailable | Collection unavailable | Verzameling niet beschikbaar | المجموعة غير متاحة | コレクションを利用できない |
| no_law_not_implied | That is a coverage gap, not a finding that no local law exists. | Dit is een dekkingsgat, geen vaststelling dat er geen lokale wet bestaat. | هذه فجوة في التغطية، وليست نتيجة بأن لا قانون محليًا. | これは収録の欠落であり、現地に法令がないという結論ではありません。 |
| searched | Searched | Doorzocht | ما بُحث | 検索済み |
| remaining | Remaining | Resterend | المتبقي | 未検索 |
| historical | Historical text | Historische tekst | نص تاريخي | 過去の条文 |
| future | Future commencement | Toekomstige inwerkingtreding | نفاذ مستقبلي | 将来の施行 |
| unknown_status | Status unknown | Status onbekend | الحالة غير معروفة | 状態不明 |
| not_all_results | This is not all worldwide results. | Dit zijn niet alle wereldwijde resultaten. | هذه ليست كل النتائج العالمية. | これは世界全体の結果ではありません。 |

Placeholders are examples, not accessible names. Every input has a visible label. The Arabic set is rendered with `dir="rtl"` and `lang="ar"`. The Japanese set uses `lang="ja"`. Dutch uses `lang="nl"`. English uses `lang="en"` and `dir="ltr"`.

## RTL

RTL layout applies when the interface locale is Arabic or another right-to-left locale. The `dir` attribute is set on the worldwide root. Logical properties (`margin-inline`, `padding-inline`, `inset-inline`, `text-align: start`, `border-inline-start`) mirror the columns, the status accent, and the sticky header. Physical `left` and `right` are not used for layout.

The DOM order follows the translated reading order, so keyboard order matches it. A back icon that points along the inline axis is mirrored. Citations, record ids, civil dates, and Latin identifiers are `unicode-bidi: isolate` so they keep their internal order inside an Arabic sentence. Original law text keeps the direction of that text, which may differ from the interface. A Japanese title in an Arabic interface stays in its own embed. Mixed lines do not reorder the surrounding translation label.

The search field aligns to the start of the line. Suggestions show the parent place chain in the active locale, with native names kept in their own direction. The map, if opened, does not become the only place control in either direction.

## Keyboard flows

Every state sets `keyboard` true. A pointer is never required. Focus is visible on the worldwide root and is not removed by this stylesheet.

### Place, date, and search

1. The first Tab stop inside the surface is Skip to search. Enter moves focus to the search field.
2. Shift+Tab from the search field reaches Language, As of, Change place, and the place combobox, in that reverse order.
3. The place combobox is a labelled input. ArrowDown opens the list. ArrowUp and ArrowDown move. Enter selects. Escape closes the list and leaves the current place unchanged.
4. Each row shows the place, its native and alternate names, and the parent chain. Duplicate names are separate rows. Choosing none leaves the scope unchanged.
5. A country row does not select a city. A region row does not invent a municipality.
6. Change place is available before any search.
7. As of is a labelled date control. Typing a civil date or using the platform date keys updates the date only. The place stays.
8. Language is a labelled listbox or select. It updates the interface locale and the live announcement. It does not update the place.
9. Enter in the search field submits. An empty query stays on the no-query state.
10. This place and Search worldwide are radio buttons. Arrow keys move between them. Search worldwide does not require a place.

### Suggestions, ambiguity, and borders

1. Suggestions appear under the field that produced them and do not cover the search field.
2. Arrow keys move within the listbox. Enter accepts the active row. Escape dismisses the list.
3. If the typed query names a different place, the page proposes a scope change. The current place stays until the visitor activates Change place on that proposal or keeps the current place.
4. Ambiguous names and border candidates use the same listbox. The status line asks for a choice. No row is pre-selected when more than one jurisdiction matches.

### Filters

1. Skip to filters focuses the Filters summary.
2. Enter or Space opens it. On Desktop the controls expand in the side column. On Mobile they open the sheet.
3. Tab moves through jurisdiction level, place, topic, instrument type, language, source, and date/status.
4. On Mobile, Tab cycles inside the sheet. Escape or Close filters restores focus to the Filters control.
5. Applying a filter announces the new counts. It does not move focus away from the control that was used.

### Results, reader, and announcements

1. Skip to results focuses the result list.
2. Result titles are links. Tab and Enter are enough. Arrow keys are optional and do not trap focus.
3. Enter opens the reader at the matched article. On Mobile, Back to results is the first control in the reader and returns focus and scroll to the same result. On Desktop the list remains.
4. Copy citation and copy link, when the reader provides them, are buttons with text names. They copy the displayed revision.
5. After a place, date, or scope change, one polite live region announcement states the place label, origin, as-of date, scope, and coverage. The same facts are visible in the header. Focus moves only when the visitor opened a list, a sheet, or a dialog.
6. A cancelled or stale response does not move focus and does not rewrite the list.

Reduced motion removes sheet movement, smooth scrolling, and any other transition. There is no globe animation. At 320 CSS pixels the page is one column, with wrapping toolbars and no required horizontal scroll. At 200% zoom the same column rules apply because the type and spacing use rem and the sticky header releases on a short viewport.

## Interaction states

Each state has one visible next action. The action is a real control in the keyboard order, not a tooltip. Status copy and coverage copy for the same state live in the JSON.

| State | What is on screen | Next action |
| --- | --- | --- |
| first-visit | Unselected worldwide. Search is focused. No result is invented. | Choose a place or search worldwide. |
| approximate-suggestion | Origin reads approximate IP location, or the suggestion waits for Suggest my approximate location when consent is required. Search text is not sent to that provider. | Change place if this approximate suggestion is wrong, or search this place. |
| ip-unavailable | The approximate lookup failed, timed out, or was opted out. The place is unchanged. | Choose a country, region, or municipality. |
| location-denied | Device permission was denied or was never requested. Coordinates are not shown. | Location permission was denied. Choose a country, region, or municipality. |
| ambiguous-place | Rows share a name and show different parent chains. None is selected yet. | Choose one place. Duplicate names stay unselected until you do. |
| changed-manual-location | Origin reads manually selected. A late suggestion cannot replace it. | Search this place, or change it. |
| border-uncertainty | Candidate jurisdictions stay listed with the uncertainty. No city is invented. | Choose the jurisdiction that matches your question. |
| no-query | The query is empty. Coverage is unchanged. | Enter a question, citation, or identifier, then search. |
| no-matches | The searched collections returned no rows. Other collections may be unsearched. | Revise the query, clear a filter, or open coverage for this place. |
| unsearched-collection | A collection is named and marked not searched, with the remaining count. | Continue the search, or open the unsearched collection on the coverage page. |
| missing-municipal-coverage | National and regional rows can still appear. The municipal cell says there is no collection in the catalog. | Read the national and regional sources, and open the municipal coverage gap. |
| partially-loaded | Results already retrieved stay visible, with searched and remaining counts. | Read the results already shown, or continue loading the remaining shards. |
| cancelled-query | The list is the previous settled search, or empty if none settled. The cancelled response is discarded. | Start a new search. The cancelled results stay off the page. |
| throttling-or-outage | The source delay or failure is named. Saved copies stay labelled with their revision. | Retry the source, or read saved material when a copy is on this device. |
| stale-cache | The cached revision differs from the catalog revision. Both revisions are visible. | Refresh this source, or keep reading the saved copy with its revision visible. |
| offline-saved | Only material already on the device is offered. Live search is not implied. | Read the saved material, or reconnect to search sources that are not on this device. |
| model-unavailable | Ordinary search stays usable. No download starts. | Continue with ordinary search. A model download stays optional. |
| source-or-status-unknown | Issuer, date, or status that the source did not give is labelled unknown. | Open the source record, or search a source whose status is known. |
| translated-text | The original title and text remain. The translation is labelled machine or official. | Read the original text, or keep the labelled translation beside it. |
| historical-or-future-law | The version is labelled historical text or future commencement, with the date precision. | Set the as-of date, or open the version that matches it. |
| malformed-url | The bad parameter is named. The place and date already on the page stay. | Correct the link, or continue with the place and date already on the page. |
| screen-reader-scope-change | The header shows the new place, origin, date, scope, and coverage, and the live region speaks that sentence once. | Review the announced place, date, and coverage, then search or change place. |

## Stylesheet contract

`src/styles/worldwide.css` scopes every rule under `.wwl`. The root carries `lang`, `dir`, and `data-state` set to one required state id. Optional attributes are `data-scope` (`place`, `worldwide`, or `unselected`), `data-map` (`closed` or `open`), `data-model` (`idle`, `offered`, or `unavailable`), `data-reader` (`closed` or `open`), and `data-compare` (`closed` or `open`).

The map block is not displayed unless `data-map` is `open`. The model block is not displayed unless the model is offered or the state is `model-unavailable`. Opening either block does not remove the search field or the place combobox. Coverage cells use `data-coverage` of `known`, `partial`, `missing`, `unknown`, or `unavailable` and always include the text label.

Landmarks: `header` for the banner, a `search` form for the query, `main` for results and the reader, a complementary region for the jurisdiction stack, and a dialog for the Mobile filters sheet while it is open. The live region is visually hidden, polite, and atomic. It is not `display: none`.

## Out of scope for this contract

This document and stylesheet do not implement the React shell, retrieval, the reader, coverage pages, the locale loader, or a browser audit. Those remain later tasks. Contrast ratios are computed from the token hex values. They are not a screenshot audit. No provider, account, GPU, or model is contacted.
