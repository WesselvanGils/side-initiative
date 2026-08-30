# Graph Report - .  (2026-07-11)

## Corpus Check
- Corpus is ~47,600 words - fits in a single context window. You may not need a graph.

## Summary
- 603 nodes · 1286 edges · 29 communities (26 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.93)
- Token cost: 183,300 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Dnd5e Legendary Recovery|Dnd5e Legendary Recovery]]
- [[_COMMUNITY_Legendary Action Windows|Legendary Action Windows]]
- [[_COMMUNITY_Combat Dock Helpers|Combat Dock Helpers]]
- [[_COMMUNITY_Settings and Side Constants|Settings and Side Constants]]
- [[_COMMUNITY_Gambits Opportunity Attacks|Gambits Opportunity Attacks]]
- [[_COMMUNITY_Release Build Pipeline|Release Build Pipeline]]
- [[_COMMUNITY_Biome Formatting Configuration|Biome Formatting Configuration]]
- [[_COMMUNITY_Package Toolchain|Package Toolchain]]
- [[_COMMUNITY_Architecture and Licensing|Architecture and Licensing]]
- [[_COMMUNITY_Chris Premades Integration|Chris Premades Integration]]
- [[_COMMUNITY_TypeScript Compiler Configuration|TypeScript Compiler Configuration]]
- [[_COMMUNITY_Combat State Logic|Combat State Logic]]
- [[_COMMUNITY_Public Side API|Public Side API]]
- [[_COMMUNITY_Commander Socket Handling|Commander Socket Handling]]
- [[_COMMUNITY_Chris Premades Bridge Tests|Chris Premades Bridge Tests]]
- [[_COMMUNITY_Combat Turn Patches|Combat Turn Patches]]
- [[_COMMUNITY_Chris Premades Trigger Collection|Chris Premades Trigger Collection]]
- [[_COMMUNITY_Chris Premades Trigger Execution|Chris Premades Trigger Execution]]
- [[_COMMUNITY_MidiQOL Reaction Integration|MidiQOL Reaction Integration]]
- [[_COMMUNITY_Initiative Rolling Flow|Initiative Rolling Flow]]
- [[_COMMUNITY_Chris Premades Registration|Chris Premades Registration]]
- [[_COMMUNITY_Foundry Symlink Tool|Foundry Symlink Tool]]
- [[_COMMUNITY_Workflow Batch Bridge|Workflow Batch Bridge]]
- [[_COMMUNITY_Combat Utils Wrapper|Combat Utils Wrapper]]
- [[_COMMUNITY_Foundry Combat Test Stub|Foundry Combat Test Stub]]
- [[_COMMUNITY_Dock Divider Artwork|Dock Divider Artwork]]
- [[_COMMUNITY_Dock Frame Artwork|Dock Frame Artwork]]
- [[_COMMUNITY_Gambits Type Augmentation|Gambits Type Augmentation]]
- [[_COMMUNITY_Existing Bug List|Existing Bug List]]

## God Nodes (most connected - your core abstractions)
1. `normalizeSideId()` - 31 edges
2. `CombatDockManager` - 22 edges
3. `getCombatState()` - 21 edges
4. `hooks()` - 21 edges
5. `compilerOptions` - 19 edges
6. `getCombatantSideId()` - 17 edges
7. `getSetting()` - 16 edges
8. `CombatLike` - 16 edges
9. `scripts` - 15 edges
10. `getCombatantsForSide()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Gambits Opportunity Attack Bridge` --semantically_similar_to--> `Guarded Monkey Patches`  [INFERRED] [semantically similar]
  README.md → AGENTS.md
- `Kenney Fantasy UI Borders` --semantically_similar_to--> `Combat Dock Art License`  [INFERRED] [semantically similar]
  README.md → assets/dock/License.txt
- `deliverAsGm()` --calls--> `handleCommanderSocketRequest()`  [EXTRACTED]
  tests/commander-socket.test.ts → src/api.ts
- `Automatic GitHub Releases` --conceptually_related_to--> `Release Pipeline`  [INFERRED]
  CHANGELOG.md → .github/workflows/release.yml
- `Integration Compatibility Evolution` --conceptually_related_to--> `Gambits Opportunity Attack Bridge`  [INFERRED]
  CHANGELOG.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Automated Release Flow** — github_workflows_release_release_pipeline, agents_release_automation_policy, changelog_automatic_releases [INFERRED 0.95]

## Communities (29 total, 3 thin omitted)

### Community 0 - "Dnd5e Legendary Recovery"
Cohesion: 0.05
Nodes (56): clearSideTurnEndFlushers(), FLAG_SCOPE, getLegendaryCombatantsToRecover(), LegactResource, recoverLegendaryActionsForSide(), registerDnd5eIntegration(), resolveCombat(), shouldSuppressNativeRecovery() (+48 more)

### Community 1 - "Legendary Action Windows"
Cohesion: 0.08
Nodes (49): activitiesToArray(), actorKey(), attacksSinceLastWindow, classifyActionActivity(), debug(), executeLegendaryAction(), getCpr(), getCprModule() (+41 more)

### Community 2 - "Combat Dock Helpers"
Cohesion: 0.07
Nodes (25): getCombatantById(), getSideColor(), getSideCommanderCombatant(), getSideLabel(), getSideRepresentativeCombatant(), getSideTone(), normalizeSideId(), getSetting() (+17 more)

### Community 3 - "Settings and Side Constants"
Cohesion: 0.07
Nodes (35): COMBAT_DOCK_SIZE_OPTIONS, COMMANDER_CONTROL_OPTIONS, DEFAULT_SIDE_DATA, DEFAULT_SIDE_ORDER, INITIATIVE_METHOD_OPTIONS, SETTINGS, SideSeed, getSideSummary() (+27 more)

### Community 4 - "Gambits Opportunity Attacks"
Cohesion: 0.08
Nodes (42): emitSideTurnEndHook(), emitSideTurnStartHook(), bridgeSideTurn(), createPatchedOpportunityAttackScenarios(), disableIntegration(), GambitsIntegrationState, getGambitsModule(), getGambitsPremadesIntegrationState() (+34 more)

### Community 5 - "Release Build Pipeline"
Cohesion: 0.08
Nodes (37): STAGED_MANIFEST, repoRoot, buildReleaseManifest(), extractChangelogReleaseNotes(), extractChangelogSection(), getRepositoryBaseUrl(), main(), NormalizedTag (+29 more)

### Community 6 - "Biome Formatting Configuration"
Cohesion: 0.07
Nodes (29): files, includes, formatter, arrowParentheses, bracketSpacing, enabled, formatWithErrors, indentStyle (+21 more)

### Community 7 - "Package Toolchain"
Cohesion: 0.08
Nodes (25): devDependencies, @biomejs/biome, fvtt-types, js-yaml, tsx, @types/node, typescript, name (+17 more)

### Community 8 - "Architecture and Licensing"
Cohesion: 0.09
Nodes (23): Active GM Write Gate, Defensive Runtime Access, Guarded Monkey Patches, Pure Logic Core, Release Automation Policy, Side Initiative Architecture, CC0 1.0 Public Domain Dedication, Combat Dock Art License (+15 more)

### Community 9 - "Chris Premades Integration"
Cohesion: 0.10
Nodes (20): activeWorkflowTokens, ChrisPremadesIntegrationState, CombatTurnRef, CPR_COMBAT_UTILS_PATCH, CPR_UPDATE_COMBAT_MARKERS, CprApi, CprCombatUtils, CprMacroArg (+12 more)

### Community 10 - "TypeScript Compiler Configuration"
Cohesion: 0.09
Nodes (22): compilerOptions, allowSyntheticDefaultImports, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module (+14 more)

### Community 11 - "Combat State Logic"
Cohesion: 0.16
Nodes (20): cloneSideStateForSave(), collectCombatantSides(), dedupeSideOrder(), ensureCombatState(), getActiveSideIndex(), getCombatantSideRecord(), getCombatState(), getNextSideId() (+12 more)

### Community 12 - "Public Side API"
Cohesion: 0.14
Nodes (18): AssignCombatantSideOptions, canUserControlSide(), dispatchSideRequest(), GameSocket, getGameSocket(), getRollClass(), RefreshCombatantSidesOptions, registerSideInitiativeSocket() (+10 more)

### Community 13 - "Commander Socket Handling"
Cohesion: 0.12
Nodes (11): getRequestingUser(), getSocketCombat(), handleCommanderSocketRequest(), CombatantOptions, deliverAsGm(), EmitCall, GameSocket, TestCombat (+3 more)

### Community 14 - "Chris Premades Bridge Tests"
Cohesion: 0.17
Nodes (12): flushCprBridge(), getCprPremadesIntegrationState(), resetCprPremadesIntegrationState(), CombatUtilsEnvOptions, createHooks(), HUNGER_FLAGS(), HUNGER_TEMPLATE(), installCombatUtilsEnv() (+4 more)

### Community 15 - "Combat Turn Patches"
Cohesion: 0.20
Nodes (11): getRoundTimeDelta(), SideInitiativeApi, CombatClass, CombatMethod, CombatPrototype, getCombatClass(), installCombatPatches(), isSideCombat() (+3 more)

### Community 16 - "Chris Premades Trigger Collection"
Cohesion: 0.20
Nodes (11): collectEntityTriggers(), collectTriggersForToken(), dedupeAndSort(), getActorCombatEntities(), getCprApi(), getCprCombatUtils(), getEntityCastData(), getEntityName() (+3 more)

### Community 17 - "Chris Premades Trigger Execution"
Cohesion: 0.28
Nodes (9): debug(), firePassesForSide(), getCombatTurnRef(), invokeTriggers(), isCprUpdateCombatSource(), resolveCombatantToken(), shouldSuppressCprUpdateCombat(), squashWhitespace() (+1 more)

### Community 18 - "MidiQOL Reaction Integration"
Cohesion: 0.25
Nodes (3): registerMidiQolIntegration(), createHooks(), installGlobals()

### Community 19 - "Initiative Rolling Flow"
Cohesion: 0.38
Nodes (7): getCombatantEntries(), rollStandardSideInitiative(), rollWeightedSideInitiative(), saveState(), syncCombatToSide(), rollWeightedSideInitiativeData(), setCombatState()

### Community 20 - "Chris Premades Registration"
Cohesion: 0.40
Nodes (6): registerSideTurnEndFlusher(), getCprModule(), getCprPremadesVersion(), registerChrisPremadesIntegration(), registerCprSideTurnTracker(), registerSideTurnBridge()

### Community 21 - "Foundry Symlink Tool"
Cohesion: 0.50
Nodes (4): FoundryConfig, main(), moduleRoot, readFoundryConfig()

### Community 22 - "Workflow Batch Bridge"
Cohesion: 0.50
Nodes (4): bridgeSideTurn(), enqueueWorkflowBatch(), validateCprShape(), isPrimaryGMClient()

### Community 23 - "Combat Utils Wrapper"
Cohesion: 0.50
Nodes (4): getActiveWorkflowToken(), resolveTokenPlaceable(), shouldApplySideTurnSemantics(), wrapCprCombatUtils()

### Community 25 - "Dock Divider Artwork"
Cohesion: 1.00
Nodes (3): Dock Divider Graphic, Horizontal Line Ornament, Stepped Center Motif

### Community 26 - "Dock Frame Artwork"
Cohesion: 0.67
Nodes (3): Combat Dock Frame, Ornamental Pixel Border, Transparent Content Area

## Knowledge Gaps
- **164 isolated node(s):** `$schema`, `enabled`, `clientKind`, `useIgnoreFile`, `includes` (+159 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hooks()` connect `Gambits Opportunity Attacks` to `Dnd5e Legendary Recovery`, `Legendary Action Windows`, `Combat Dock Helpers`, `Settings and Side Constants`, `Chris Premades Integration`, `Public Side API`, `MidiQOL Reaction Integration`, `Chris Premades Registration`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `CombatLike` connect `Dnd5e Legendary Recovery` to `Legendary Action Windows`, `Combat Dock Helpers`, `Settings and Side Constants`, `Gambits Opportunity Attacks`, `Chris Premades Integration`, `Combat State Logic`, `Public Side API`, `Commander Socket Handling`, `Combat Turn Patches`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `$schema`, `enabled`, `clientKind` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dnd5e Legendary Recovery` be split into smaller, more focused modules?**
  _Cohesion score 0.054414414414414414 - nodes in this community are weakly interconnected._
- **Should `Legendary Action Windows` be split into smaller, more focused modules?**
  _Cohesion score 0.07619738751814223 - nodes in this community are weakly interconnected._
- **Should `Combat Dock Helpers` be split into smaller, more focused modules?**
  _Cohesion score 0.07184325108853411 - nodes in this community are weakly interconnected._
- **Should `Settings and Side Constants` be split into smaller, more focused modules?**
  _Cohesion score 0.07227891156462585 - nodes in this community are weakly interconnected._