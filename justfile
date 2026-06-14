release version:
    #!/usr/bin/env bash
    set -euo pipefail

    git diff --quiet || {
      echo "Working tree has uncommitted changes. Commit or stash them first."
      exit 1
    }

    git tag "{{version}}"

    git-cliff -o CHANGELOG.md
    git add CHANGELOG.md

    if ! git diff --cached --quiet; then
      git commit -m "docs(changelog): update changelog"
    fi

    git push origin main "{{version}}"
