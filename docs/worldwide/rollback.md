# Public release rollback

WWL-113 compared the sealed Pages candidate for commit `019562a750b35c6ad817e6acfc78f2f075d760a1` with the public site that is already published, exercised the candidate in a local preview, rolled that preview back to the prior bytes, and left the live prior release in place.

The configured public URL is `https://worldwidelaws.github.io/`. On 2026-11-06 it returned HTTP 404 from GitHub Pages, 9115 bytes, sha256 `70d613e3acfba24fd2876fcbacaf639e1e111ef4d54baf70761c47673f37d6a3`, title "Site not found · GitHub Pages". `https://endomorphosis.github.io/worldwidelaws.github.io/` returned the same 404 document. GitHub reports `has_pages: false` for `endomorphosis/worldwidelaws.github.io`. Actions run [42170095879](https://github.com/endomorphosis/worldwidelaws.github.io/actions/runs/42170095879) failed before a runner started, uploaded no Pages artifact, and skipped Deploy to GitHub Pages. There is no published candidate to roll back on that host.

## Artifact identity

The candidate is the Vite 4.5.14 production build of this worktree, sealed the same way as `.github/workflows/deploy.yml`: `404.html` rewrites the current path to a hash route, `.nojekyll` is present, and `preview-commit.txt` contains only `019562a750b35c6ad817e6acfc78f2f075d760a1`. The build environment was `VITE_WETWIJZER_DATA_PROVIDER=huggingface` and `VITE_OPENROUTER_ENABLED=false`. The shell gzip of `assets/index-2f252348.js` and `assets/shell-vendor-b17b141a.js` is 66139 bytes. The shell contains `#/search`, `/#/law/`, and `hashchange`. The index document sha256 is `b488a7a383e3fa97221763bcfd5afca314f4f10a1a152ce15a9372bd2e593a6a`.

The candidate digest is sha256 `203619207298707affc0e342f2078560c9fc7c479413da4bab4ba807245488e9`. It is the SHA-256 of a UTF-8 manifest of all 46 sealed files. Each line is the sorted relative path, one space, and the SHA-256 of that file, and the manifest ends with a newline.

The prior release digest is sha256 `807c4c0fe6d7085530dfeb90dc6c9537ade3a3c439ef48e52d5432708f86cf65`. It uses the same manifest method over five files fetched from `https://wetwijzer.github.io/` before the rollback:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| index.html | 1629 | `103e707efbbf2c3f48174551ec15000feffa724f1bfa7621079dcd2919e3527f` |
| src/main.tsx | 1423 | `a85ea5cd51fe085490a29f1496c18d4fca260772a0243b27e4d0e0d5df4688bd` |
| public/corpus/netherlands/current/artifacts.manifest.json | 3352 | `3c7643fe74b325be548aa42ddfc7a11b8b6430c1471d7ad79c4fe59a46bea497` |
| public/corpus/netherlands/current/generated/sections.json | 4243 | `2a1a09dc5806bcd99ca280819f0954fb4d54061ee13bfef879e0e4884bc51e1a` |
| public/corpus/netherlands/current/README.md | 358 | `c190773bdc43b00144ee648c232ed77cedfd392063bf950368e410efc9098d1f` |

The live prior index and the candidate index are different files. The shell vendor chunk sha256 `492c59b7ea42e21842d0252799b9bd6bb865ba0d9c35563ed66bf59e23eaea53` matches the WWL-111 vendor chunk. The application chunk does not: `assets/index-2f252348.js` is sha256 `c7d14970a47869bd30c577849cc7dc2c86b703b33f092c1e27b33a59912b2222`.

`WetWijzer/WetWijzer.github.io` still publishes branch `main` from the repository root. Its latest Pages build was updated `2026-06-27T23:24:56Z`. This check did not push to that repository and did not change its Pages source.

## Preview rollback

A local preview served one directory pointer. The pointer started on the sealed candidate. Chrome 143.0.7499.169 exercised place search, source reading, manual override, direct deep links, no-backend mode, and coverage there. The public Pages host was opened in the same browser and returned the 404 above. The preserved public corpus file was read directly:

`https://wetwijzer.github.io/public/corpus/netherlands/current/generated/sections.json`

That file's first record is BWBR0001854 Artikel 1 of the Wetboek van Strafrecht, with `source_url` `https://wetten.overheid.nl/BWBR0001854`. The preview law route showed the same record id. Coverage stayed explicit: the preview said `Coverage: Coverage unknown`, and the public manifest says the corpus is a quality-audited partial collection, not full Dutch coverage.

The pointer was then renamed onto the prior snapshot. The preview returned HTTP 200 with `x-wwl-preview-root: wwl-113-prior-snapshot` and body sha256 `103e707efbbf2c3f48174551ec15000feffa724f1bfa7621079dcd2919e3527f`, the live prior index. Chrome showed title `WetWijzer | Nederlandse wetzoeker` and module `/src/main.tsx`, and `.wwl-shell` was absent. The candidate index file was still on disk with sha256 `b488a7a383e3fa97221763bcfd5afca314f4f10a1a152ce15a9372bd2e593a6a`. A second pointer rename restored the candidate. Chrome reloaded it and showed title `Worldwide laws`, `data-wwl-shell="worldwide"`, and data-state `first-visit`. The preview response sha256 again matched the candidate index.

The live prior release was fetched again after that swap. `https://wetwijzer.github.io/` was still HTTP 200, etag `W/"6a405bc7-65d"`, last-modified `Sat, 27 Jun 2026 23:24:55 GMT`, and the same index sha256. The sections file sha256 was unchanged. `https://worldwidelaws.github.io/` was still HTTP 404. No deployment was created, replaced, or deleted.

## Operator rollback after a real Pages deploy

When a later Actions run does publish this workflow, roll back by redeploying the previous Pages artifact. Keep that artifact and the prior WetWijzer site.

1. Confirm the bad deployment in the `github-pages` environment and record its artifact digest and page URL.
2. Redeploy the previous successful Pages artifact with the repository's existing `deploy-pages` authority. Do not delete the previous artifact first, and do not force-push `WetWijzer/WetWijzer.github.io`.
3. Fetch the restored URL and compare it with the stored prior digest. A mismatch stops the rollback. Do not invent a target when the previous artifact is missing.
4. Fetch `https://wetwijzer.github.io/` and require index sha256 `103e707efbbf2c3f48174551ec15000feffa724f1bfa7621079dcd2919e3527f` until that site is intentionally republished by its own repository.
5. Leave `preview-commit.txt` bound to the commit that produced the restored artifact.

The source-refresh pointer in `scripts/worldwide/refresh.ts` is a separate rollback. It restores `previous.json` onto `current.json` for the data snapshot outside the site. It does not publish or replace a GitHub Pages deployment.

## Current limit

This candidate is not the document served at `https://worldwidelaws.github.io/`. The UI scenarios passed on the sealed preview of commit `019562a750b35c6ad817e6acfc78f2f075d760a1`. The public host was opened and is still absent. Publishing it requires the existing Deploy Vite App to Pages workflow to start and to pass its required job. Run 42170095879 did not start because the GitHub account was locked for a billing issue. This rollback check did not rerun that workflow, did not change branch protection, and did not replace the June 2026 WetWijzer release.
