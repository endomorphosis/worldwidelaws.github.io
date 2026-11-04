# Location privacy and untrusted content

This is the external-request record for the static worldwide legal search shell (WWL-083). It names every host the browser may contact, the data that stays on the device, and how untrusted corpus text is handled. It is not a deployment privacy notice, and it does not decide that a law applies.

Search and reading work without an account, a GPU, a model download, an API key, a chat service, or a Python server. A generated answer is optional and comes after retrieval.

## What is not sent

- Search text, a street address, and coordinates are not query parameters of the approximate-location request.
- The approximate-location response may contain an IP. The client keeps a country code and drops the IP. The country code is not a place id and does not select a city.
- Device coordinates are resolved on the local boundary pack. The third-party geocoder argument is not called. Outcomes record `thirdPartyRequested: false` and `deviceCoordinatesStored: false`.
- The public artifact cache does not store a query, a place, a location history, or coordinates.
- Default shared links omit latitude, longitude, and address. `shareLink` adds them only when `includePreciseCoordinates` is set.
- No `Authorization` header and no Hub, model, or GeoIP secret is sent. `SELECTED_GEOIP.requiresSecret` is false.
- Secrets, model-provider keys, supervisor policy, checkpoint directories, and developer home paths are not public build artifacts.

## External requests

| When | Method and URL | What leaves the browser | Bound |
| --- | --- | --- | --- |
| Shell and bundled sample | Same-origin GET of `/corpus/netherlands/current/artifacts.manifest.json` and `generated/sections.json` | Nothing personal. `cache: 'no-store'`. | Pages origins `https://worldwidelaws.github.io` and `https://wetwijzer.github.io`. Not a third party. |
| Optional approximate country | `GET https://api.country.is/` with an empty query and no hash | No search text, address, coordinates, or secret. The provider sees the browser address, which Pages itself cannot. | `credentials: 'omit'`, `mode: 'cors'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`, `Accept: application/json`. Timeout 2500 ms. Body cap 2048 bytes. One request per session. No retry. A redirect is not followed. |
| Pinned public artifact or manifest | `GET https://huggingface.co/datasets/<org>/<name>/resolve/<40-hex-revision>/<path>` | Dataset id, pinned revision, and artifact path. No search text and no token. | `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`. Byte budget at most 10 MiB. A country Parquet file is not fetched whole. |
| Dataset Viewer | `GET https://datasets-server.huggingface.co/{splits,rows,search,filter}` | Dataset, config, split, offset, and length. Search and filter are separate. A revision pin is not sent. | Page length at most 100. A query or `where` that contains a join, a semicolon, or a newline is refused. |
| Hub dataset API constant | `https://huggingface.co/api/datasets` | Used as the Netherlands hub origin constant. The transport client does not attach a token. | Same host rule as other Hub URLs. |
| Optional embedding pack | Hugging Face files for `Xenova/multilingual-e5-small` | Planned only after measured gain, WebGPU, network, heap, and the exact consent `allow-optional-semantic-download`. | Without that consent `requestModelDownload` does not call its transport. `thenlper/gte-small` is not an offered download. Query text over 2048 code points is not sent to an embedder. |
| Publisher page | Visitor click, for example `https://wetten.overheid.nl/<BWB-id>` | The visitor's own navigation. The shell does not fetch the publisher to answer a search. | `target="_blank"` and `rel="noreferrer"` on reader and research links. |

`https://www.maxmind.com` appears only in the GeoIP attribution sentence. The client does not request it.

`https://cache.worldwide-legal-search.invalid` is the Cache Storage key origin. It is not a network host and is not contacted.

Redirects of an artifact or manifest are followed only while the final URL is `https` with no user info and the host is `huggingface.co`, `datasets-server.huggingface.co`, a host ending in `.huggingface.co` (including `https://cdn-lfs.huggingface.co`), a host ending in `.hf.co`, or the single admitted mirror host for that mirror call. Any other final host is `unsafe-url` and the body is not used. A final URL whose `/resolve/<revision>/` segment is a different 40-hex commit than the pin is a revision mismatch. GeoIP uses `redirect: 'error'`, so a redirecting country endpoint is not followed and no second host is requested.

## Cache and location on the device

IndexedDB `worldwide-legal-search.public-cache@1` holds the LRU catalog. Cache Storage `worldwide-legal-search.public-artifacts@1` holds bytes. The key is the dataset id, the pinned revision, the relative path, and the SHA-256 of the bytes. Paths with `?`, `#`, `..`, or a leading slash are refused.

These field names are refused as `personal-data` before a database open. Underscores and hyphens are removed before the name is compared, so `search_query` matches `searchquery`: `query`, `search`, `searchquery`, `queries`, `location`, `geolocation`, `history`, `placehistory`, `latitude`, `longitude`, `lat`, `lng`, `lon`, `coordinates`, `address`, `altitude`, `accuracy`, `heading`, `speed`, `position`. A joined name such as `location_history` becomes `locationhistory`, which is not that list. It is still refused before a database open, as an unexpected field (`invalid`). Nested objects are walked, so a `note.query` is `personal-data`. A query string is not a cache key. Saved rows are public artifacts. Stale and offline states name the revision; they do not hide it.

The GeoIP opt-out record is `{ schema: "worldwide-legal-search.geoip-opt-out@1", optedOut: true }`. The session record is `{ schema: "worldwide-legal-search.geoip-session@1", requests: 1 }`. Neither stores a place or an IP. The third-party location flag is `{ schema: "worldwide-legal-search.location.no-third-party@1", enabled: true }` and is refused if the payload contains `latitude`, `longitude`, or `coordinate`.

A shared URL keeps the stable place id, the civil date, and the search text. Precise coordinates in an incoming link are marked `precise-location-not-shared` and are omitted from `shareLink` unless the caller sets `includePreciseCoordinates`.

## Untrusted corpus text

Law text, titles, translations, proof formulas, JSON-LD, dataset metadata, and a supplied answer are data. They are not instructions.

- The reader renders section text with React text nodes. A `<script>`, `<iframe>`, `<img onerror>`, or `<a href="javascript:">` inside the law text does not become an element.
- `normalizeLegalText` strips tags and script or style bodies before identity text is stored. The remaining words are text.
- The research panel keeps an official link only for `http:` or `https:` with no username or password. `javascript:` and `data:text/html` are not links. Instruction-shaped text, including zero-width breaks inside the phrase, does not change the pinned revision, the citation, or applicability. Applicability stays `not-asserted`. Simulated, unknown, and incomplete proof output cannot establish current law.
- A supplied answer is shown only when it repeats the retrieved content id and revision and does not assert applicability. An instruction or an oversized answer is rejected. Passing a model, backend, `fetch`, or search function does not call it.
- Strict filters are allow-lists (`bands`, `placeIds`, `topics`, `instrumentKinds`, `languages`, `sourceIds`, `statuses`). Unknown keys such as `$where` or `latitude` are ignored. Control characters make a query unusable. A value is not parsed as SQL. Dataset Viewer search and filter cannot be joined, and neither URL carries `revision=`.

## Build artifacts

The files a Pages deploy publishes are `index.html`, `public/`, and `dist/` when a production build is present. `tests/worldwide/security.test.ts` reads those trees. It fails if a text artifact contains a private key block, an `AKIA`, `ghp_`, `github_pat_`, `hf_`, `sk-`, or `xai-` token, `IPFS_ACCELERATE_AGENT`, `implementation_checkpoints`, a `/home/barberb/` path, or a validation-home directory. It also fails on a `.env`, `.pem`, key, or `supervisor.json` file in those trees. Supervisor policy and host configuration stay outside the site bundle.

## Limits

- The law reader assigns a trimmed `source_url` or `download_url` to `href`. Ingested rows have to already be `http:` or `https:`. The research panel is the allowlist for untrusted document links. `downloadHref` appends a `revision` parameter and does not itself reject `javascript:`.
- Artifact transport uses `redirect: 'follow'` and then rejects a final URL on a host outside the list above. GeoIP does not follow redirects at all.
- This note does not record a fresh live probe of those hosts. A later response that leaves the admitted hosts is still refused.
