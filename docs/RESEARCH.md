# Crypto OSINT: methodology and tool research

This document is the basis for ChainGraph's feature set. It summarizes how professional
blockchain investigations are run and what the leading tools offer, then maps each
capability to what ChainGraph implements.

## 1. Investigation workflow

A typical on-chain investigation (law enforcement, exchange compliance, scam recovery)
follows the same loop regardless of the tool:

1. **Intake.** Collect seed identifiers: addresses, tx hashes, the victim's deposit and
   withdrawal records, screenshots, URLs. Record the time window of the incident.
2. **Attribution.** For every address, ask *who is this?* Sources: explorer labels (ENS,
   verified contract names, public tags), shared tag sets (GraphSense TagPacks), vendor
   databases, and your own notes. Classify into categories: exchange, mixer, bridge,
   DeFi, gambling, scam/phishing, sanctioned, individual.
3. **Clustering.** Group addresses that one entity controls.
   - *Common-input ownership (UTXO):* all inputs of one transaction share an owner.
     CoinJoin breaks this assumption, so CoinJoin transactions must be excluded.
   - *Change detection (UTXO):* the output going back to the sender. Signals: the output
     script type matches the inputs, the payment is a round number and the change is not,
     the address is fresh.
   - *Account model (EVM/TRON):* no input clustering. Rely on deposit-address patterns,
     shared funders and gas sponsors, and labels.
4. **Tracing ("follow the money").** Move chronologically: from the incident transaction,
   follow outflows that happen *after* the funds arrived, hop by hop, prioritizing the
   largest flows. Stop at services that hold KYC (exchanges), at points where links break
   (mixers, bridges), or when the value dissipates.
   - *Peel chains:* a large balance repeatedly split into a small payment and a large
     change output. Follow the change.
   - *Cross-chain:* bridges and swaps convert the asset. Continue on the destination chain.
5. **Risk and exposure.** Measure how much value an address sent to or received from risky
   categories, directly or within N hops. Every score must show *why* (TRM's "glass box").
6. **Documentation.** Annotated graph, chronological transaction list, entity table,
   reasoning notes, exports (CSV for legal requests, report for stakeholders).
7. **Monitoring.** Watch key addresses for new movements (Arkham alerts).
8. **Off-chain pivot.** Exchanges are the point where identity can be established, and
   only through legal process (subpoena / official request). On-chain tools establish
   the flow of funds, not the identity of the owner.

Red flags worth automating: address poisoning (lookalike addresses sending dust or
zero-value transfers), fake stablecoins (a token named USDT from a non-official contract),
spam airdrops with URLs in the symbol, CoinJoin participation, mixer contact.

## 2. Tools studied

| Tool | Type | Signature capabilities |
|---|---|---|
| **Chainalysis Reactor** | Commercial | Graph investigations, ground-truth attribution and clustering, exposure to categories, automated pathfinding over many hops, auto-interpretation of swaps, bridges and mixers, cross-chain graphs, automatic layouts, adding off-chain entities to the graph |
| **TRM Forensics** | Commercial | Unified multi-chain graph, automated tracing through bridges (Phoenix), risk score kept separate from behavioral signatures, labels showing source and confidence, subpoena-ready CSV export from the graph |
| **Arkham Intel** | Freemium | Entity labels, Visualizer (graph of recent transactions), Tracer (inflow/outflow counterparties, "fetch flows", per-edge transaction log, filters by token, USD value, amount, time and chain, saved traces), alerts filtered by chain, token, entity and size |
| **Breadcrumbs** | Freemium | Investigation graph, private labels, risk scoring, drawn annotations included in reports, filter by time, Pathfinder auto-investigation |
| **MetaSleuth (BlockSec)** | Freemium | Auto-drawn fund-flow graph, inflow/outflow direction, token and date-range filters, hop-by-hop expansion, per-edge transaction list, sharing |
| **GraphSense (AIT)** | Open source | Multiple-input and change clustering, TagPacks (portable attribution format), path and pattern search, dashboard, REST API |
| **OXT** | Free (BTC) | Transaction-level privacy analysis: change detection, CoinJoin detection, wallet fingerprinting |
| **Maltego** | Freemium | Entity-link graphs, transforms, multiple layouts (organic, hierarchical, circular) |
| **Obsidian graph view** | UX reference | Filters (search, orphans), color groups by query, display (arrows, text fade threshold, node size, link thickness, animate), forces (center, repel, link force, link distance), local graph with depth |

Sources: chainalysis.com (Reactor, cross-chain investigations), trmlabs.com (Phoenix,
glossary, blog), codex.arkm.com (Tracer, Visualizer), docs.metasleuth.io, GraphSense
TagPacks wiki and arXiv 2102.13613, "How to Peel a Million" (USENIX Security 2022),
OXT Research, obsidian.md/help/plugins/graph.

## 3. Feature map

| Capability | Reference | ChainGraph |
|---|---|---|
| Multi-chain graph | TRM, Reactor | BTC, LTC, DOGE, BCH, ETH, Optimism, TRON keyless. BSC, Polygon, Arbitrum, Base, Avalanche and more with a free Etherscan key |
| Entity labels | Arkham, Reactor | Explorer labels plus a keyword classifier mapping to categories |
| Own label library | GraphSense TagPacks, Breadcrumbs | CSV import/export `address,label,category,chain` |
| Common-input clustering | GraphSense, Reactor | BTC-family, CoinJoin-aware, shown as cluster rings and a cluster list |
| Change detection | OXT, GraphSense | Script-type and round-number heuristics, change edges dashed or hidden |
| CoinJoin detection | OXT | Equal-output pattern, flagged and excluded from clustering |
| Risk score with reasons | TRM, Breadcrumbs | 0–100, every point explained, configurable category weights |
| Exposure breakdown | Reactor | Direct inbound and outbound share by category |
| Auto-trace | Reactor pathfinding, Breadcrumbs Pathfinder | Chronological follow-the-money with depth, branching and stop categories |
| Pathfinding | GraphSense, Reactor | Shortest paths between two nodes, highlighted |
| Edge transaction log | Arkham, MetaSleuth | Click an edge to list its transactions |
| Filters | Arkham, MetaSleuth | Asset, minimum amount, minimum USD, time range, direction, spam, change |
| Timeline | Breadcrumbs, Obsidian Animate | Histogram with a range brush and playback |
| Layouts | Reactor, Maltego | Force, left-to-right flow, top-down, radial |
| Ordered edge labels | MetaSleuth | `#n · amount · date` |
| Annotations | Breadcrumbs | Tags, aliases, Markdown notes with `[[links]]`, color groups |
| Alerts | Arkham | Watchlist polling with in-app and desktop notifications |
| Reports | Breadcrumbs, TRM | Markdown report, Obsidian vault export (zip), CSV, PNG, JSON |
| Local graph, command palette, themes | Obsidian | Depth-limited local graph, ⌘P palette, ⌘O switcher, AMOLED and other themes |

## 4. Obfuscation techniques and how ChainGraph detects them

| Technique | Signal used | Notes |
|---|---|---|
| Smart-contract mixers (Tornado Cash, Railgun, Privacy Pools) | Verified contract addresses, explorer names (incl. OFAC-flagged) | Router + pools analyzed as one entity; internal transactions capture payouts |
| Demixing | Amount/denomination match (−0…10% fee), time gap, anonymity-set penalty (log₂k), address reuse, shared counterparties | Heuristics from academic Tornado Cash studies; leads, not proof |
| Custodial mixers / instant exchangers | Keyword attribution, label library | Weighted separately in the risk model |
| CoinJoin | ≥3 independent inputs, outputs ≤ 3× inputs, ≥3 equal outputs; shape → Whirlpool / Wasabi / JoinMarket | Excluded from common-input clustering |
| Peel chain | Consecutive change outputs (≥3 hops) | One-click follow along change outputs |
| Smurfing / fan-out, fan-in | ≥8 distinct counterparties in 24 h, coefficient of variation of amounts | Services excluded |
| Structuring | ≥3 transfers in [85%, 100%) of $10k / $3k | Current prices, not historical |
| Pass-through wallets | In ≈ out (±10%), median holding < 6 h | |
| Round-tripping | Directed cycles up to 4 hops | |
| Chain hopping | Bridge in/out on different chains, USD within −10…+2%, ≤ 4 h | Also flags the same EVM address across chains |
| Asset swaps | Out to DEX and different asset back within 10 min | |
| Dusting / address poisoning / fake tokens | Sub-$0.05 transfers from many senders; lookalike prefixes/suffixes; impersonating symbols | |
| Account-model clustering | Shared exchange deposit address; common first funder | Deposit-address reuse is the strongest EVM heuristic |
| Privacy coins | Monero / Zcash shielded formats recognized | Investigate entry and exit points instead |
| Behavioral fingerprint | Hour × weekday activity, quietest 6-hour window → time zone | Bots show no quiet window |

## 5. Known limits of a keyless, client-side tool

- No proprietary attribution database: labels come from explorers and from the user.
- No bridge auto-resolution: bridge contracts are flagged and the user continues on the destination chain.
- Free APIs return recent pages, so totals reflect loaded data only.
- USD values use current prices, not historical prices at transaction time.
