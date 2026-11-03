/**
 * Interface copy for worldwide legal search.
 *
 * These strings are the interface language. They are not the language of a
 * law and they are not a search jurisdiction. The four labelled sets are the
 * contract in docs/worldwide/interaction-states.json. Extra keys name date
 * precision, the law language, and the rule that a browser language does not
 * choose a jurisdiction.
 */

export const UI_LOCALES = ['en', 'nl', 'ar', 'ja'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export type UiDirection = 'ltr' | 'rtl';
export type UiScript = 'Latn' | 'Arab' | 'CJK';

export const MESSAGE_KEYS = [
  "product",
  "search_label",
  "search_placeholder",
  "skip_to_search",
  "skip_to_results",
  "skip_to_filters",
  "change_place",
  "choose_place",
  "this_place",
  "search_worldwide",
  "as_of",
  "language",
  "filters",
  "close_filters",
  "coverage",
  "laws_and_sources",
  "included_because",
  "original_title",
  "translation",
  "machine_translation",
  "official_translation",
  "map_optional",
  "model_optional",
  "back_to_results",
  "applicability",
  "continue_search",
  "retry",
  "unselected_worldwide",
  "origin_url",
  "origin_manual",
  "origin_saved",
  "origin_device",
  "origin_ip",
  "coverage_known",
  "coverage_partial",
  "coverage_missing",
  "coverage_unknown",
  "coverage_unavailable",
  "no_law_not_implied",
  "searched",
  "remaining",
  "historical",
  "future",
  "unknown_status",
  "not_all_results",
  "date_unknown",
  "precision_day",
  "precision_month",
  "precision_year",
  "precision_unknown",
  "law_language",
  "interface_language",
  "search_jurisdiction",
  "browser_not_jurisdiction",
  "not_a_revision"
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

export interface LocaleCatalog {
  locale: UiLocale;
  lang: UiLocale;
  dir: UiDirection;
  script: UiScript;
  months: readonly string[];
  messages: { readonly [K in MessageKey]: string };
}
