/**
 * Privacy controls for optional device location.
 *
 * Nothing in this component requests browser permission until the visitor
 * activates Use device location. Approximate network location is a second,
 * separate action and is withheld in no-third-party mode. Coordinates are
 * not shown and are not kept. Nothing here decides that a law applies.
 */

import { useId, useRef, useState } from 'react';
import type { PlaceIndex } from '../../lib/worldwide/jurisdiction/resolve';
import {
  DEVICE_COPY,
  createDeviceLocationClient,
  type DeviceGeolocation,
  type DeviceLocationClient,
  type KeyValueStorage,
  type ThirdPartyLocationClient,
} from '../../lib/worldwide/location/device';
import { selectPlace, type PlaceState } from '../../lib/worldwide/location/state';

const STYLES = `
.location-privacy { color: #17202a; background: #fff; max-width: 40rem; }
.location-privacy * { box-sizing: border-box; }
.location-privacy h2, .location-privacy p { margin: 0 0 0.75rem; }
.location-privacy-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0 0 0.75rem; }
.location-privacy-candidates { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0 0 0.75rem; padding: 0; list-style: none; }
.location-privacy button, .location-privacy-choice { min-height: 44px; font: inherit; }
.location-privacy button { padding: 0.5rem 0.8rem; background: #0b3a5b; color: #fff; border: 0; }
.location-privacy button:disabled { background: #5c6b78; }
.location-privacy-choice { display: flex; gap: 0.75rem; align-items: center; }
.location-privacy-choice input { width: 1.25rem; height: 1.25rem; }
.location-privacy :focus-visible { outline: 3px solid #0b3a5b; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .location-privacy * { scroll-behavior: auto; }
}
`;

export interface LocationPrivacyProps {
  state: PlaceState;
  onState: (state: PlaceState) => void;
  asOf?: string | null;
  index?: PlaceIndex | null;
  viewIds?: readonly string[];
  geolocation?: DeviceGeolocation | null;
  geoIp?: ThirdPartyLocationClient | null;
  storage?: KeyValueStorage | null;
  onChoosePlace?: () => void;
}

export default function LocationPrivacy({
  state,
  onState,
  asOf = null,
  index = null,
  viewIds,
  geolocation,
  geoIp = null,
  storage,
  onChoosePlace,
}: LocationPrivacyProps) {
  const headingId = useId();
  const explanationId = useId();
  const clientRef = useRef<DeviceLocationClient | null>(null);
  const stateRef = useRef(state);
  const tokenRef = useRef(0);
  stateRef.current = state;
  if (clientRef.current === null) {
    clientRef.current = createDeviceLocationClient({
      storage: storage === undefined ? undefined : storage,
      useBrowserStorage: storage === undefined,
    });
  }
  const client = clientRef.current;
  const [mode, setMode] = useState(() => {
    if (geoIp?.optedOut() === true && !client.noThirdParty()) client.setNoThirdParty(true);
    return client.noThirdParty();
  });
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState<string>(DEVICE_COPY.idle);

  function publish(next: PlaceState, message: string, advanceToken: boolean) {
    if (advanceToken) tokenRef.current += 1;
    setAnnouncement(message);
    onState(next);
  }

  function onUseDevice() {
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setBusy(true);
    return client.request({
      state: () => stateRef.current,
      userAction: true,
      asOf: asOf ?? stateRef.current.asOf?.value ?? null,
      index,
      viewIds,
      geolocation,
    }).then((result) => {
      setBusy(false);
      if (token !== tokenRef.current) return;
      setAnnouncement(result.nextAction);
      onState(result.state);
    }).catch(() => {
      setBusy(false);
      if (token !== tokenRef.current) return;
      setAnnouncement(DEVICE_COPY.unavailable);
    });
  }

  function onClear() {
    const result = client.clear(stateRef.current);
    setMode(client.noThirdParty());
    publish(result.state, result.nextAction, true);
  }

  function onReset() {
    const result = client.reset(stateRef.current, geoIp);
    setMode(client.noThirdParty());
    publish(result.state, result.nextAction, true);
  }

  function onMode(enabled: boolean) {
    client.setNoThirdParty(enabled);
    if (geoIp) {
      try {
        geoIp.setOptOut(client.noThirdParty());
      } catch {
        client.setNoThirdParty(true);
      }
    }
    const next = client.noThirdParty();
    setMode(next);
    setAnnouncement(next ? DEVICE_COPY.thirdPartyOff : DEVICE_COPY.thirdPartyOn);
  }

  function onSuggest() {
    if (!geoIp) return Promise.resolve();
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    return client.suggestApproximate({
      state: () => stateRef.current,
      userAction: true,
      geoIp,
    }).then((result) => {
      if (token !== tokenRef.current) return;
      setAnnouncement(result.nextAction);
      onState(result.state);
    }).catch(() => {
      if (token !== tokenRef.current) return;
      setAnnouncement(DEVICE_COPY.unavailable);
    });
  }

  function onCandidate(placeId: string, label: string | null) {
    const next = selectPlace(stateRef.current, {
      placeId,
      label,
      uncertainty: [DEVICE_COPY.applicability, 'The visitor chose this place. Device coordinates were not saved.'],
    });
    publish(next, next.nextAction, true);
  }

  const placeLabel = state.label ?? state.placeId ?? 'None yet';
  const offerApproximate = !mode && geoIp !== null;

  return (
    <section className="location-privacy" aria-labelledby={headingId} data-location-privacy="device" data-no-third-party={mode ? 'true' : 'false'}>
      <style>{STYLES}</style>
      <h2 id={headingId}>{DEVICE_COPY.heading}</h2>
      <p id={explanationId}>{DEVICE_COPY.explanation}</p>
      <p>{DEVICE_COPY.applicability}</p>
      <p data-channel={state.channel} data-origin={state.origin}>
        Current place: {placeLabel}. {state.originLabel}.
      </p>
      <p role="status" aria-live="polite">{announcement}</p>
      <div className="location-privacy-actions">
        <button type="button" aria-describedby={explanationId} disabled={busy} onClick={() => onUseDevice()}>
          {DEVICE_COPY.useLabel}
        </button>
        <button type="button" onClick={onClear}>{DEVICE_COPY.clearLabel}</button>
        <button type="button" onClick={onReset}>{DEVICE_COPY.resetLabel}</button>
      </div>
      <label className="location-privacy-choice">
        <input
          type="checkbox"
          checked={mode}
          onChange={(event) => onMode(event.target.checked)}
        />
        {DEVICE_COPY.thirdPartyLabel}
      </label>
      {offerApproximate ? (
        <div className="location-privacy-actions">
          <button type="button" onClick={() => onSuggest()}>{DEVICE_COPY.suggestLabel}</button>
        </div>
      ) : (
        <p>{mode ? DEVICE_COPY.thirdPartyOff : DEVICE_COPY.thirdPartyUnavailable}</p>
      )}
      {state.candidates.length > 0 ? (
        <ul className="location-privacy-candidates" aria-label="Places that match this device reading. Choose one. Coordinates are not shown.">
          {state.candidates.map((candidate) => (
            <li key={candidate.placeId}>
              <button type="button" onClick={() => onCandidate(candidate.placeId, candidate.label)}>
                {candidate.label ?? candidate.placeId}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={() => onChoosePlace?.()}>{DEVICE_COPY.chooseLabel}</button>
    </section>
  );
}
