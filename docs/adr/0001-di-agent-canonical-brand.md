# ADR 0001: Di Agent is the canonical product brand

## Status

Accepted on 2026-09-03.

## Context

The repository still used the retired Agent Hub brand across user-facing text, prompts, runtime paths, environment keys, package metadata, and documentation. A visual-only rename would allow prompts, logs, and generated commands to reintroduce the retired name. A blind replacement would break persisted browser state and installed daemon services.

## Decision

`Di Agent` is the only canonical product name and the only name written by new code. Context-specific identifiers use `DiAgent`, `di-agent`, or `di_agent`.

The retired name may appear only in a centralized, tested migration adapter, migration fixtures, and this ADR. Migration code may read old state once, but it must write the canonical form, remove the old key/path/service after a verified transition, and never display the retired name to users or inject it into model context.

## Consequences

- UI, prompts, logs, generated artifacts, and maintained documentation consistently say `Di Agent`.
- Existing browser and daemon state can be migrated without data loss.
- A repository branding audit guards against new leaks.
- Physical production database and external package identities require separately authorized operational migrations when downtime or publishing credentials are needed.
