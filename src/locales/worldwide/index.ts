/**
 * Labelled interface catalogs: English, Dutch, Arabic, and Japanese.
 */

import { arCatalog } from './ar';
import { enCatalog } from './en';
import { jaCatalog } from './ja';
import { nlCatalog } from './nl';
import type { LocaleCatalog, UiLocale } from './types';

export const CATALOGS: { readonly [K in UiLocale]: LocaleCatalog } = {
  en: enCatalog,
  nl: nlCatalog,
  ar: arCatalog,
  ja: jaCatalog,
};

export { MESSAGE_KEYS, UI_LOCALES } from './types';
export type { LocaleCatalog, MessageKey, UiDirection, UiLocale, UiScript } from './types';
