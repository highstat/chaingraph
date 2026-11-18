# Contributing to ChainGraph

Thanks for helping. ChainGraph is a client-side app: everything runs in the browser and talks directly to public APIs.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run build
```

## Guidelines

- **Keyless first.** New data sources should work without API keys, or make the key optional (Settings → Data sources). Check that the API sends CORS headers.
- **Be polite to free APIs.** Route requests through `getJSON()` in `src/chains/http.ts` and add a per-host spacing entry when the provider has a rate limit.
- **Leads, not verdicts.** Heuristics and detectors must explain their reasoning (see `src/obfuscation.ts` and `src/analysis.ts`). Show confidence where it applies.
- **Verified attribution only.** Built-in labels (`KNOWN` in `src/entities.ts`) must be confirmed against an explorer. Do not add unverified addresses.
- **No personal-data brokers or breach dumps.** The OSINT toolkit uses public sources only. Pull requests that integrate people-search brokers, leaked databases or stalkerware-style tracking will not be accepted.
- Keep the UI in English and consistent with the Obsidian-style design (CSS variables in `src/index.css`, themes in `src/themes.ts`).

## Adding a blockchain

1. Write an adapter in `src/chains/` returning `FetchResult` (normalized `Transfer[]`, optional labels, prices, cursor).
2. Register it in `CHAINS`, `detectChain()` and `fetchRaw()` in `src/chains/index.ts`.
3. Add its native coin to `src/chains/prices.ts`.

## Adding an obfuscation detector

Add a section to `analyzeObfuscation()` in `src/obfuscation.ts`, give it a `FindingKind` with a description in `KIND_META`, and document the signal in `docs/RESEARCH.md`.
