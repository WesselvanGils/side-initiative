# AGENTS.md

Guidance for AI coding agents working in this repository. Everything below is
inferred from the codebase; `Verify:` marks items that could not be fully
confirmed from the repo alone.

## 1. Project overview

**Side Initiative** is a [Foundry VTT](https://foundryvtt.com) module that
implements the 2014 DMG *side initiative* variant for D&D 5e. It rolls one die
per side, groups combatants into sides, adds commanders, and optionally
replaces the combat tracker with a top-of-screen "combat dock".

- **Runtime target:** Foundry VTT 13 (see `module.json` `compatibility`).
- **Language:** TypeScript (strict), compiled to plain JS by `tsc` — there is
  no bundler. Foundry loads the compiled `scripts/module.js` as an ES module.
- **Type source:** `fvtt-types` (the Foundry API types).
- **Integrations (optional, runtime-detected):** dnd5e, MidiQOL, Chris'
  Premades, Gambits Premades. `libs/` holds reference copies of these modules
  for study only — they are **not** part of the build and are gitignored.

### Directory map

| Path        | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `src/`      | TypeScript source. The only tree you should edit.                       |
| `scripts/`  | Compiled JS output (`tsc src/ -> scripts/`). **Generated, gitignored.** |
| `tests/`    | Logic & integration tests (Node built-in test runner, run via `tsx`).   |
| `tools/`    | Build/release/symlink scripts (`build-release.ts`, `create-symlinks.ts`).|
| `lang/`     | Localization (`en.json`). All user-facing strings live here.            |
| `styles/`   | Compiled CSS shipped to Foundry (`module.css`).                         |
| `assets/`   | Static art shipped in releases (dock frame/divider).                    |
| `module.json` | Foundry manifest (esmodules, styles, languages, compatibility).       |
| `libs/`     | Reference copies of other modules. **Gitignored, do not edit.**         |
| `foundry/`  | Local Foundry types/scaffolding. **Gitignored.**                        |
| `.github/workflows/release.yml` | CI release pipeline.                                      |

## 2. Development commands

```bash
npm install          # also runs `postinstall` -> createSymlinks (no-ops without foundry-config.yaml)
npm test             # node --import tsx --test tests/*.test.ts  (no Foundry needed)
npm run typecheck    # tsc --noEmit
npm run build        # tsc src/ -> scripts/   (one-shot)
npm run build:watch  # recompile on save
npm run format        # biome format --write .   (4-space indent, write-in-place)
npm run format:check  # biome format .            (CI / verify only)
npm run lint          # biome lint .
npm run check:fix     # biome check --write .     (lint + format in one pass)
npm run changelog    # git-cliff -o CHANGELOG.md   (requires git-cliff installed)
npm run release:build -- vX.Y.Z   # build dist/release bundle + zip (local preview of CI)
```

Local Foundry linking (after pointing `foundry-config.yaml` at your Foundry
user-data dir — see *Repository-specific warnings*):

```bash
npm run build
npm run createSymlinks   # symlinks the repo into <dataPath>/Data/modules/side-initiative
```

`justfile` recipes exist for convenience (`just update`, `just commit "msg"`,
`just release vX.Y.Z`) but are not required.

- **Node version:** CI (`.github/workflows/release.yml`) uses Node 24;
  `.tool-versions` pins `nodejs lts`. Verify your local version matches if a
  build behaves oddly.
- **Formatting/linting is handled by [Biome](biome.json).** Indentation is
  **4 spaces**; run `npm run format` to fix style or `npm run format:check` to
  verify (the formatter is scoped to `src/`, `tests/`, `tools/` and respects
  `.gitignore`, so generated/reference trees are never touched). See
  *Coding conventions*.

## 3. Architecture notes

### Layering (source lives in `src/`)

```
module.ts                 Entry point. Hooks.once("init"/"ready") wires everything.
├─ constants.ts           MODULE_ID, flag/setting keys, option maps, default sides.
├─ types.ts               *Like structural interfaces + persisted data shapes.
├─ logic.ts               PURE logic: side grouping, rolling, state math. No globals.
├─ runtime.ts             Defensive accessors for Foundry globals (game/Hooks/foundry/CONST/socket).
├─ api.ts                 Public `game.sideInitiative` API (SideInitiativeApi). Async mutation + socket.
├─ controller/            Monkey-patches Foundry Combat prototype (guarded by a Symbol).
│  └─ combat-controller.ts
├─ integration/           Guarded integrations, registered on "ready".
│  ├─ dnd5e.ts  midi-qol.ts  chris-premades.ts  gambits-premades.ts  legendary-actions.ts
└─ ui/                    combat-dock.ts, side-editor.ts, tracker.ts
```

- **Entry / lifecycle:** `src/module.ts` — `Hooks.once("init")` registers
  settings, the public API (`setSideInitiative`), keybindings, combat patches,
  and hooks; `Hooks.once("ready")` registers the socket and the integrations
  (dnd5e always; chris-premades/midi-qol only when active; legendary-actions
  always).
- **Pure core:** `logic.ts` is deliberately free of Foundry globals and is the
  most heavily unit-tested file. Keep new side math here so it stays testable.
- **Defensive runtime:** Foundry globals (`game`, `Hooks`, `foundry`, `CONST`)
  are read through `runtime.ts` accessors that go via `globalThis` so they are
  `undefined`-safe (and stubbable in tests). Do not reach for `game`/`Hooks`
  directly in logic — use the accessors.
- **Combat patching:** `controller/combat-controller.ts` overrides
  `Combat.prototype.{nextTurn,previousTurn,nextRound}` to redirect to the side
  API **only when a combat is side-controlled**; otherwise the original methods
  run. Guarded by `Symbol.for("side-initiative.combat-patches")` so it is
  installed once.

### Data model

- Side combat state is persisted on the **Combat** document flag
  `side-initiative.state` as a `CombatState` object (schema version 2 — see
  `COMBAT_STATE_VERSION` in `logic.ts` and `normalizeCombatState` for migration).
- Each combatant's side is stored on **Combatant** flags `side-initiative.sideId`
  and `side-initiative.sideSource` (`"auto"` vs `"manual"`).

### Events

- **Emitted:** `side-initiative.sideTurnStart`, `side-initiative.sideTurnEnd`
  (payload: `SideTurnPayload`). Turn-end also awaits registered
  "flushers" before advancing (see `registerSideTurnEndFlusher`) so end-of-turn
  integration work finishes before Foundry's `updateCombat` fires.
- **Consumed:** `renderCombatTracker`, `getCombatantContextOptions`,
  `createCombat`, `updateCombat`, and MidiQOL hooks such as
  `midi-qol.preSetReactionUsed`.

### Multi-client safety

- State writes are gated on the **active GM** / **primary GM** client
  (`isActiveGMClient` / `isPrimaryGMClient`). Player clients that need to change
  combat (advance side, set commander) send a request over the Foundry-native
  socket event `module.side-initiative`, which only the active GM acts on.

## 4. Coding conventions

- **Module resolution is `bundler` with `isolatedModules`.** Relative imports
  **must use the `.js` extension** even for `.ts` files
  (e.g. `import { MODULE_ID } from "./constants.js";`). New imports that omit
  `.js` will break the build or tests.
- **Strict TypeScript.** `strict`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames` are on.
- **Defensive, optional-chaining style.** Code assumes Foundry objects may be
  partial (especially the lightweight mocks used by tests). Reuse the `*Like`
  structural interfaces in `types.ts` rather than importing concrete Foundry
  document types. Deeply nested/system-specific trees are intentionally typed
  `unknown`/`any` (documented at the top of `types.ts`).
- **Indentation is enforced at 4 spaces by [Biome](biome.json)** (`npm run
  format`). Do not introduce tabs. The whole tree (`src/`, `tests/`, `tools/`) is
  normalized to 4-space indentation; run `npm run format` before committing if
  your editor uses a different default.
- **i18n:** all user-facing strings go through `SIDE-INITIATIVE.*` keys in
  `lang/en.json`. Settings register localization *keys*, never literal text
  (see `registerSettings` in `module.ts`). Add the key to `en.json` whenever you
  add a setting name/hint, notification, or UI label.
- **Flag access:** read/write module data via the flag constants in
  `constants.ts` (`FLAG_SCOPE`, `SIDE_STATE_FLAG`, `COMBATANT_SIDE_FLAG`, …),
  not magic strings.
- **Integrations are guarded:** check `game.modules.get(id)?.active` (and, for
  Gambits, a supported-version + source-shape check) before patching. If the
  guard fails, disable the integration and warn the GM — see
  `gambits-premades.ts` for the pattern.
- **Logging:** uses `console.error`/`console.log` prefixed with
  `${MODULE_ID} | …` (see the keybinding handler in `module.ts`). Prefer
  `ui.notifications` for user-facing warnings, gated on availability.

## 5. Agent workflow rules

1. **Read before editing.** For non-trivial changes, read `module.ts` (entry),
   the relevant layer file, and `types.ts` to match existing patterns.
2. **Edit `src/` only.** Never hand-edit `scripts/` — it is generated. After any
   source change, run `npm run build` (or `build:watch`) to regenerate it.
3. **Keep logic pure.** Side/grouping/rolling/state math belongs in `logic.ts`
   with no Foundry-global access; reach globals via `runtime.ts` accessors.
4. **Run checks after changes:**
   - `npm run typecheck` — must pass.
   - `npm test` — must pass; add a test in `tests/` for any new pure-logic
     behavior (tests stub `globalThis.game`/`Hooks`/`foundry` with plain
     objects — follow `tests/logic.test.ts`).
   - `npm run build` — must succeed and update `scripts/`.
   - `npm run format:check` — must pass (4-space indentation via Biome); run
     `npm run format` to auto-fix.
5. **Update `lang/en.json`** for any new user-facing string or setting.
6. **Keep changes minimal and focused.** Prefer targeted edits; reuse existing
   constants and accessor helpers instead of introducing new ones.

## 6. Repository-specific warnings

- **`scripts/` is generated** (`tsc` output) and gitignored. Never edit it by
  hand; edit `src/` and rebuild.
- **`libs/` and `foundry/` are gitignored reference/local trees.** Do not edit
  them and do not import from them in `src/`.
- **`module.json` version is a dev placeholder (`999.0.0`)** and the `download`
  URL is stale on purpose. Both are rewritten at release time by
  `tools/build-release.ts`. **Do not manually bump `module.json` version for a
  release** — tag and let the release pipeline handle it.
- **Monkey-patching is load-bearing.** `controller/combat-controller.ts`
  patches the live `Combat` prototype, and `integration/gambits-premades.ts`
  patches Gambits' Opportunity Attack function. Both are guarded; preserve the
  guards (Symbol flag, version list, source-shape markers) when touching them.
- **`foundry-config.yaml` is gitignored and currently reads `installPath`, but
  `tools/create-symlinks.ts` (and the README) expect `dataPath`.** As written,
  `npm run createSymlinks` will print "No 'dataPath' set" and skip. Verify: set
  `dataPath: "/path/to/FoundryVTT"` (the dir containing `Data/`) for local
  linking to work.
- **`git-cliff` has no config file at the repo root.** `npm run changelog` and
  the `just release` recipe rely on it. Verify a `cliff.toml` exists in your
  environment or that git-cliff's defaults are acceptable before running it.
- **`postinstall` runs `createSymlinks`.** `npm install` will try to link into
  Foundry; without a valid `dataPath` it safely no-ops.
- **No Foundry at test time.** Tests run under plain Node via `tsx` and stub the
  Foundry globals. Don't add tests that require a real Foundry instance.

## 7. PR / completion checklist

Before considering work done, confirm:

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (and new pure-logic behavior has a test).
- [ ] `npm run build` succeeds and `scripts/` is regenerated.
- [ ] `npm run format:check` passes (4-space indentation via Biome; run
      `npm run format` to fix).
- [ ] Only `src/` (plus `lang/`, `styles/`, `assets/` as appropriate) was
      edited — never `scripts/`, `libs/`, or `foundry/`.
- [ ] Any new user-facing string or setting has a `SIDE-INITIATIVE.*` key in
      `lang/en.json`.
- [ ] Foundry globals are accessed via `runtime.ts` accessors, not directly.
- [ ] Any new integration/patch is guarded (module-active / version / shape).
- [ ] `module.json` was **not** manually version-bumped (the release pipeline
      does that).
