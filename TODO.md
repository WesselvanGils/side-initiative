# TODO

> This is an idea pool, not a roadmap or commitment. Priority scores are directional:
> **10** protects current users/releases, **7–9** is high leverage, **4–6** is worthwhile,
> and **1–3** is speculative. Effort estimates are **S**, **M**, or **L**.
>
> Last reviewed: 2026-07-11. Historical permission, Blink, and Detect Magic timing
> items were intentionally left out because they are fixed and regression-tested.

## Reviewed priorities

### Approved

- [x] **9/10 · M — Make start-of-side integration work awaitable.**
  Added a start-flusher registry so dnd5e, MidiQOL, CPR, and Gambits expose
  their pending hook work; side mutation APIs now wait before resolving.

- [x] **9/10 · M — Define and enforce supported Chris' Premades versions.**
  CPR 1.5.40 is explicitly supported. The integration validates its macro API
  and private `updateCombat` source, fails closed, and warns the GM on mismatch.

- [ ] **8/10 · M — Harden the custom tracker/editor UI.**
  Stop interpolating document values into HTML, move labels and default side
  names to i18n, associate labels with controls, improve the color input, and
  add focused interaction tests.

- [ ] **8/10 · S/M — Recheck combat-dock sizing and first-render layout.**
  Exercise every size preset at common viewport widths, with long names,
  different portrait proportions, primary-party art, browser zoom, and initial
  image loading. Record a small visual acceptance matrix before adjusting CSS.

### Research before implementation

- [ ] **8/10 · M — Reassess player round navigation and combat authority.**
  Players cannot mutate the Combat document directly, so any change must
  preserve active-GM ownership. First reproduce each navigation path with real
  GM/player clients and verify native socket sender, permission, reconnect, and
  world-time behavior. Keep the implementation on Foundry-native sockets;
  SocketLib was previously tried and rejected as disproportionate complexity.

### Deferred or consciously closed

- [ ] **3/10 · S · Blocked — Revisit Foundry VTT 14 after CPR supports it.**
  Do not maintain parallel v13/v14 releases by default. Revisit when CPR has a
  compatible release, or earlier only if a small migration spike demonstrates
  that support is genuinely low effort.

- **Closed decision — Keep CI lightweight.** The current fail-fast and rebuild
  approach fits the project. Retain basic test/build checks around releases,
  but do not add a comprehensive PR quality-gate pipeline unless the project
  grows enough to justify it.

## High-value hardening

- [ ] **8/10 · S — Surface side-turn flusher failures.**
  Rejected end-of-side integration work is currently swallowed. Log actionable
  context, notify the GM when appropriate, and define whether advancement should
  continue or stop.

- [ ] **8/10 · M — Publish an installation, compatibility, and troubleshooting matrix.**
  List tested Foundry, dnd5e, MidiQOL, Chris' Premades, and Gambits versions; explain
  degraded behavior and common warnings; include manifest-based installation steps.

- [ ] **8/10 · M — Harden the Gambits bridge.**
  Skip disabled/non-applicable region behaviors and stress-test overlapping Opportunity
  Attack calls while the shared `canvas.tokens.get` lookup is temporarily patched.

- [ ] **8/10 · M/L — Maintain a real-Foundry multi-client smoke matrix.**
  Cover active-GM handoff, reconnects, commander permissions, and player
  advancement. Include rapid repeated inputs, combat start/end, and dock
  synchronization in at least two clients.

- [ ] **8/10 · M — Add a copyable support snapshot.**
  Report Foundry/system/integration versions, enabled or disabled bridges,
  patch/wrapper status, active GM, current side state, and recent integration
  failures without exposing private world data.

- [ ] **7/10 · M — Add socket acknowledgements and identity edge-case tests.**
  Correlate player requests with GM accept/reject/timeout responses. Verify
  missing or mismatched transport sender IDs rather than silently trusting the
  payload fallback.

- [ ] **7/10 · M — Complete a combat-dock accessibility pass.**
  Announce active-side and round changes and expose semantic active states.
  Respect `prefers-reduced-motion`, verify focus order, and exercise these
  behaviors in DOM tests.

## Maintenance and documentation

- [ ] **6/10 · M — Test cancelled and failed MidiQOL workflow cleanup.**
  Ensure CPR's active-workflow token tracking cannot retain stale actors when a
  workflow is aborted or errors before `RollComplete`.

- [ ] **6/10 · S — Document the public API and side-turn hooks.**
  Add examples for `game.sideInitiative`, commander/side mutations, emitted payloads,
  async ordering expectations, and compatibility guarantees for module consumers.

- [ ] **6/10 · S — Add a repository-owned `cliff.toml`.**
  Pin changelog behavior in a repository-owned git-cliff configuration.

- [ ] **6/10 · S — Decide and declare the dnd5e system relationship.**
  If the module is intentionally D&D 5e-only, express that in `module.json.relationships`;
  otherwise document which core behavior is system-agnostic and what degrades elsewhere.

- [ ] **5/10 · S/M — Add coverage reporting with a pragmatic baseline.**
  Track coverage by subsystem, especially `api.ts`, side-editor DOM behavior,
  socket paths, and integration failure branches. Prefer trend protection over
  an arbitrary high target.

- [ ] **4/10 · S — Automate dependency update review.**
  Use Dependabot or Renovate for TypeScript, Biome, `fvtt-types`, and test
  tooling, with grouped low-noise updates rather than automatic merges.

## Product parking lot

- [ ] **5/10 · M — Allow selected settings to be overridden per combat.**
  Consider per-encounter initiative method, grouping, or dock behavior while
  keeping world defaults. Validate the UX before expanding the persisted state
  schema.

- [ ] **4/10 · M — Split large modules only when their next change justifies it.**
  `logic.ts`, `api.ts`, the CPR integration, and the combat dock are large.
  Extract cohesive units opportunistically; avoid a standalone rewrite that
  creates regression risk.

- [ ] **3/10 · L — Explore a compact dock representation for three or more sides.**
  The current two-panel design handles allies/neutral through the center state.
  Only expand this if real campaigns need direct visibility and control for
  several active factions.

- [ ] **3/10 · S/M — Make community translations easier to contribute.**
  After eliminating hard-coded strings, document the locale workflow and add a simple
  missing-key check before inviting additional language files.

- [ ] **3/10 · S/M — Expose a small set of dock theme variables.**
  CSS custom properties for scale, highlight intensity, and optional artwork
  paths could support customization without adding a full theme subsystem.
