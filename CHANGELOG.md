## [unreleased]

### 🐛 Bug Fixes

- *(chris-premades)* Make area triggers (Hunger of Hadar, Wall of Fire, …) affect every token on the active side: suppress CPR's native `updateCombat` for side combats and bridge `turnStart`/`turnEnd`/`everyTurn` to all side tokens through a serialized queue, so concurrent midi-qol workflows no longer clobber the target selection (commander no longer absorbs others' damage)
- *(gambits)* Scope the OA turn-guard override so it cannot leak
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
