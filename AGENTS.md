# Repository workflow

- For UI work, read `DESIGN.md` and apply its mobile design rules through the shared theme and components.
- Work and release only from `main`; do not create feature, fix, release, or temporary build branches.
- Before starting, run `git checkout main`, `git pull --ff-only origin main`, and inspect `git status --short`.
- Commit small, clear milestones and push them to `origin main` by default.
- Do not create pull requests and never force-push.
- Before pushing, run the local quality gate (`npm test`, `npm run typecheck`, `npm run lint` in `mobile/` and `server/`) so pushes are green by default; do not wait on or poll GitHub Actions after routine pushes. Check the latest `main` CI run only when starting new work or preparing a release — if it is red, repair it directly on `main` and push.
- Mobile is the primary usage target. When the owner explicitly requests an installable release, deliver it from the delivered `main` commit: dispatch and verify `mobile-build.yml` (full source SHA), provide the Android APK and the unsigned device IPA for the owner to self-sign, and increment native build numbers once per release. Routine milestone pushes do not require a mobile build.
