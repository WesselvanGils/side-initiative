update:
    git pull
    npm run build

commit message:
    git add .
    git commit -m "{{message}}"
    git push 

release version:
    #!/usr/bin/env bash
    set -euo pipefail

    git diff --quiet || {
      echo "Working tree has uncommitted changes. Commit or stash them first."
      exit 1
    }

    git-cliff -o CHANGELOG.md
    git add CHANGELOG.md

    if ! git diff --cached --quiet; then
      git commit -m "docs(changelog): update changelog"
    fi

    git tag "{{version}}"

    git push origin main "{{version}}"


deploy-dev:
    #!/usr/bin/env bash
    set -euo pipefail

    npm run build
    rsync -azh --itemize-changes \
      module.json README.md LICENSE scripts styles lang assets \
      hydra@hydra:/mnt/HDDs/applications/foundryvtt/Data/modules/side-initiative/
