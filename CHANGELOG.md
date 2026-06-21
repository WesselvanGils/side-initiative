## [unreleased]

### 🚀 Features

- Legendary actions windows (LAWs)
- Just script for updating dev repo on server
- Combat tracker (inspired by carousal combat tracker)
- Combat tracker can now use the D&D5e primary party art

### 🐛 Bug Fixes

- Legendary actions recovering at the start of a round
- No longer recover legendary actions on round end
- Supress end of turn combatant recovery
- CPR AOE templates now work correctly when a swapped commander is the only target
- Test run of the new CPR logic
- Shortened the description of the LAW setting
- Updated UI to favor a wider aspect ratio
- Updated tracker UI button to become opaque when hovered
- Updated buttons again
- Buttons now use foundry CSS classes
- Buttons
- Buttons again
- Removed shadow from dock frame
- *(ui)* Set image sizes for dock so first page load is consistent
- Removed notification when rolling initiative

### 📚 Documentation

- Bug lies within CPR but is an edge case, will fix with v14

### ⚙️ Miscellaneous Tasks

- More temporary logs to resolve CPR issues
## [1.2.0] - 2026-06-19

### 🚀 Features

- Chris' premades (CPR) integration

### 🐛 Bug Fixes

- Resolved serveral issues related to CPR
- Template behavior for cauldron of plentiful resources integration
- Midi-qol auto-untarget at end of turn being incompatible
- Midi-qol auto-untarget again

### 📚 Documentation

- *(changelog)* Update changelog

### ⚙️ Miscellaneous Tasks

- Added temporary logging to inspect CPR issues
## [1.1.1] - 2026-06-19

### 🐛 Bug Fixes

- *(gambits)* Scope the OA turn-guard override so it cannot leak

### 📚 Documentation

- *(changelog)* Update changelog
## [1.1.0] - 2026-06-19

### 🐛 Bug Fixes

- Apply effects that trigger on turn start and end
- Second pass on fixing start/end of turn effects and reactions
- Third pass on fixing start/end of turn effects and reactions
- Removed old MidiQOL hooks for reactions
- Finalized reaction used removal logic
- Don't stop removing reactions if one errors
- Skip commander when removing reactions

### 💼 Other

- Add TypeScript toolchain (tsc, tsx, fvtt-types)

### 🚜 Refactor

- *(ts)* Port core types, constants and logic to TypeScript
- *(ts)* Port API, controller, integrations and UI to TypeScript
- *(ts)* Make src the runtime entry; convert tests and tools

### 📚 Documentation

- Document the TypeScript workflow and finalize tooling
- *(changelog)* Update changelog

### ⚙️ Miscellaneous Tasks

- Updated changelog
## [1.0.7] - 2026-06-14

### 🐛 Bug Fixes

- CI/CD again

### 📚 Documentation

- *(changelog)* Update changelog
- *(changelog)* Update changelog
- *(changelog)* Update changelog
## [1.0.6] - 2026-06-14

### 🐛 Bug Fixes

- Hopefully the last CI/CD fix

### 📚 Documentation

- *(changelog)* Update changelog
- *(changelog)* Update changelog
## [1.0.5] - 2026-06-14

### ⚙️ Miscellaneous Tasks

- Updated node version in Github action
## [1.0.4] - 2026-06-14

### 🐛 Bug Fixes

- Added manual run to Github action

### 📚 Documentation

- *(changelog)* Update changelog
## [1.0.3] - 2026-06-14

### 🚀 Features

- Proper automatic releases through Github actions

### 📚 Documentation

- *(changelog)* Update changelog
## [1.0.2] - 2026-06-14

### 🐛 Bug Fixes

- Resolved an issue where the package download link would be incorrect

### 📚 Documentation

- *(changelog)* Update changelog
## [1.0.1] - 2026-06-14

### 🚀 Features

- Added automatic tags with changelog via just

### 🐛 Bug Fixes

- Updated module.json with release url

### 📚 Documentation

- Moved git-cliff to a pre-push hook
- Committed changelog
- *(changelog)* Update changelog
## [1.0.0] - 2026-06-14

### 🚀 Features

- Added weighted initiative as an optional rule

### 🐛 Bug Fixes

- Resolved an issue where token groups wouldn't have the correct disposition color

### 📚 Documentation

- Added project setup instructions
- Added a CHANGELOG.md
## [0.2.0] - 2026-06-13

### 🚀 Features

- Gambits premades AOO compat
- Added commanders and end turn hotkey

### 🐛 Bug Fixes

- Switched gambits' premades integration to a monkeypatch
- Resolved an issue where commands could not make AOO's
- Resolved an issue where the commands couldn't be changed through the UI
- Resolved serveral issues with the commander button

### 📚 Documentation

- Removed outdated lines from readme
## [0.1.0] - 2026-06-13

### 🐛 Bug Fixes

- Resolved an issue where the turn order would get stuck between players
