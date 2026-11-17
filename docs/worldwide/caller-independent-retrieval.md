# Caller-independent retrieval

The package is in this tree. `src/lib/worldwide/search/caller-independent.ts` exports `CALLER_INDEPENDENT_SCHEMA` `worldwide-legal-search.caller-independent-filter@1`. `worldwideJurisdictionIds` is the jurisdiction allow-list for a worldwide query.

## Place

A worldwide query of the endomorphosis and justicedao datasets is not narrowed by a `suggestion`, `geoip`, or `device` place. A `url`, `manual`, or `saved` place still narrows.

Caller IP is not a retrieval input. Closed routes and pins stay closed.
