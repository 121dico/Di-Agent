# Di Agent Domain Glossary

## Product Brand

Di Agent is the canonical name for the multi-Agent collaboration product. The former product name is retired and must not appear in user-visible content or model-facing context.

## Data Source

An administrator-approved connection to one business data interface. A Data Source owns its query endpoint and field contract, but never exposes its credentials to report viewers.

## Report Definition

A reusable description of one fixed business report. A Report Definition belongs to exactly one Data Source and specifies approved queries and visual sections.

## Report Run

One attempt to generate a Report Definition, whether started manually or by schedule. A Report Run has an observable lifecycle and records either a snapshot or a failure.

## Report Snapshot

The immutable, presentation-ready result of a successful Report Run. It records the source partition and values used to render cards, charts, and downloads.

## Rolling-window Evidence Snapshot

The transient evidence and candidate score calculated for one observation date. It may update an existing label, but insufficient current evidence never removes an established label.

## Effective Price-sensitive Label

The persistent price-sensitivity state attached to one DUID after First Qualification. Later valid sensitive or non-sensitive behaviour may replace its score, level, and type; absence of new valid evidence preserves the previous state.

## Daily Newly Labelled Users

The number of DUIDs reaching First Qualification on an observation date. With no explicit business deletion rule, its cumulative count is monotonic and a negative daily value indicates a data-model or pipeline error.

## Labelled User Population

The cumulative distinct DUIDs with an Effective Price-sensitive Label as of an observation date. It must not be derived solely from that day's non-null candidate scores.

## First Qualification

The first historical observation date on which a user receives a valid non-null price-sensitivity score. Once established, this event is never reversed by later evidence-window expiry.
