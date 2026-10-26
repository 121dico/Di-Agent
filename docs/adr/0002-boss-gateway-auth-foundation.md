# ADR 0002: Opt-in Boss gateway authentication foundation

## Status

Superseded in part on 2026-10-09: the user explicitly narrowed the integration to
trusted company login bootstrap, followed by ordinary Di Agent sessions. The
per-request gateway enforcement decision below is replaced by the current
decision section; this does not relax login identity verification.

Accepted for a disabled-by-default backend foundation on 2026-10-08. Amended the same day by explicit user request: company login is the primary entry, with local login/registration retained for testing via `boss.allow_local_login: true`. Production Boss enablement remains pending platform configuration and joint acceptance.

## Context

Di Agent currently uses local password accounts and application JWTs; daemon and MCP traffic use separate machine credentials. The user wants company authentication before considering a database or cluster migration. Read-only Dataseek documentation describes Boss role enforcement and gateway-overwritten `username`, not a verified OAuth callback implementation.

The origin currently has direct network access, so blindly accepting a header would allow impersonation. An employee username also cannot safely identify an existing local account of the same name.

## Decision

- Preserve local authentication when Boss is disabled. Do not enable on production while platform applications are pending.
- Add an explicit external identity mapping; never auto-link by username and never auto-promote an external user to administrator.
- Require an actual socket-peer CIDR allowlist, an environment-sourced origin secret, a gateway-overwritten identity header and an explicit pilot-user allowlist. Forwarded client addresses are not proof of gateway origin.
- Treat origin-secret injection as our adapter contract, not an assertion about available Boss platform features. A controlled adapter or separately reviewed transport-authentication design is required if direct injection is unavailable.
- Verify gateway identity only when issuing a company session. Afterwards use the existing Di Agent JWT/API/WebSocket/resource authorization unchanged, without company headers. The bootstrap component does not reinterpret provider claims or expand JWT/scope acceptance. Disabling Boss stops new company login; issued application sessions retain their expiry. Company revocation is not instant application-session revocation.
- Keep machine routes independent. Do not funnel daemon traffic through interactive SSO or broaden machine-token privileges.
- Add provider readiness metadata and a company-first/local-secondary login page. An operator-approved `/login?company=1` return page bootstraps only through the trusted gateway session endpoint. Until the registered login URL and gateway are ready, the company action remains unavailable; there is no invented OAuth protocol or company-password form.

## Alternatives

Generic OAuth/OIDC scaffolding would assume a protocol not established by the inspected evidence. Header-only authentication lacks origin protection. Immediate replacement of local login would lock out the current user before Boss applications exist. All are rejected for this phase.

## Consequences

Existing local data and access remain intact. Pilot local login remains enabled. Scoped `agent_management`, machine and existing business authorization retain their prior semantics; the login task does not change business endpoint exposure. Company JWTs default to60 minutes (1–480 configurable); company role removal or disabling the provider does not revoke issued application sessions immediately. Real enablement still requires a verified identity/transport contract and callback acceptance. Current same-origin frontend POST cannot alone bridge a different Boss origin. No cross-origin protocol is invented in this change. This work does not make the process horizontally scalable.
