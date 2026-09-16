# Repository workflow

- For UI work, read `DESIGN.md` and apply its mobile design rules through the shared theme and components.
- Work and release only from `main`; do not create feature, fix, release, or temporary build branches.
- Before starting, run `git checkout main`, `git pull --ff-only origin main`, and inspect `git status --short`.
- Commit small, clear milestones and push them to `origin main` by default.
- Do not create pull requests and never force-push.
- After every push, inspect GitHub Actions; repair red CI directly on `main` and push again until it is green.
- Mobile is the primary usage target. Every delivered update must include an installable Android APK and an unsigned device IPA for the owner to self-sign, built from the delivered `main` commit. Run and verify `mobile-build.yml`, provide both downloads, and increment native build numbers for each delivered mobile update.
