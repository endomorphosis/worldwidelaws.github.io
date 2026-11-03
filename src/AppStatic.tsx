import WorldwideLegalSearchApp from './components/worldwide/WorldwideLegalSearchApp';

/**
 * Static entry. The worldwide shell is the screen that loads.
 * The Netherlands research workspace stays behind a dynamic import so
 * ordinary search does not warm a model, open a proxy, or require login.
 */
export function loadLegacyNlResearchApp() {
  return import('./components/WetWijzerLegalResearchApp');
}

export default function AppStatic() {
  return <WorldwideLegalSearchApp loadLegacyNl={loadLegacyNlResearchApp} />;
}
