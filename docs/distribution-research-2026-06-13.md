# vi-dancer — Distribution & Auto-Update: researched recommendation

*2026-06-13. Deep-research pass (24 sources fetched, 25 claims adversarially verified — 23 confirmed,
2 refuted). Goal: Windows + macOS installers, silent auto-update on publish, one-command "ship it."*

---

## The one-paragraph truth

Keep **electron-builder + electron-updater + GitHub** — it's the right stack and it's already wired.
The three requirements split hard by platform:

- **Windows: all three work for $0, today.** NSIS installer + auto-update + tag-triggered release all
  function **unsigned**. Testers click through one "Windows protected your PC → Run anyway" the first
  time; **auto-updates apply silently after that**. ([Microsoft SmartScreen docs](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))
- **macOS: auto-update is physically impossible without paying Apple $99/yr.** Squirrel.Mac (what
  electron-updater wraps) **requires the app to be code-signed + notarized** for an update to apply —
  this is an architectural requirement, not a setting. No Apple account → no Mac auto-update, ever.
  ([electron-builder](https://www.electron.build/auto-update), [Electron API](https://www.electronjs.org/docs/latest/api/auto-updater), [Apple — $99/yr](https://developer.apple.com/programs/whats-included/))

So: **the $99/yr Apple Developer account is the single unavoidable cost** to get auto-update on Mac.
Everything else can be free.

---

## Findings (all verified)

### Hosting the update feed (the "place updates live")
- electron-updater providers: **GitHub Releases** (default when a token is set), generic BYO server,
  S3, DigitalOcean Spaces (→ Cloudflare R2 via the S3/generic config), Keygen, Snap, GitLab,
  Bitbucket. `--publish onTag|onTagOrDraft|always|never` controls upload timing. ([electron-builder publish](https://www.electron.build/publish.html))
- **Private repo + auto-update:** works *only* by embedding a repo-scoped `GH_TOKEN` inside the
  shipped app (electron-updater switches to the GitHub API). That token is readable in the app =
  a real security trade-off. ([electron-builder auto-update](https://www.electron.build/auto-update))
- **`update.electronjs.org`** (free hosted updater) needs a **PUBLIC** repo + signed mac builds →
  doesn't fit a private repo as-is. ([Electron updates tutorial](https://www.electronjs.org/docs/latest/tutorial/updates))
- **Clean fix for both:** keep source **private**, publish only the **built installers** to a
  separate **public** `*-releases` repo. electron-updater reads it with **no token**, source stays
  closed. (Standard pattern; sidesteps the embedded-token risk.)

### macOS (the wall)
- **Must sign + notarize** for auto-update — confirmed across electron-builder, Electron docs, Apple.
  Notarization in CI needs `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (or an App
  Store Connect key). ([code-signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [notarize](https://github.com/electron/notarize))
- **You don't need to own a Mac** — GitHub Actions macOS runners build+sign+notarize. Cost on a
  *private* repo: ~**$0.062/min** (10× Linux), but a release is only a few Mac-minutes; public repos
  are free. ([GitHub runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing))

### Windows signing (optional, later)
- **Azure Artifact Signing** (renamed from Trusted Signing, Jan 2026) ≈ **$10/mo**, no hardware
  token, native in electron-builder (`win.azureSignOptions` + 3 secrets). Removes the SmartScreen
  warning; reputation still builds over time. ([Microsoft SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation))
- **Don't buy an EV cert** — Microsoft removed EV's SmartScreen bypass (~Aug 2024); EV no longer
  buys instant trust. ([DigiCert advisory](https://knowledge.digicert.com/alerts/ev-signed-application-showing-microsoft-defender-smartscreen-warnings))
- Eligibility wrinkle: Azure historically wanted ~3-yr org verifiability for *org* certs; individual
  enrollment exists — verify before committing.

### The "ship it" button
- **Tag-triggered CI** (already drafted): `push v* tag` → matrix build → `electron-builder
  --publish always` → uploads to the Release → installed clients poll + auto-update. ([GH Actions](https://www.electron.build/docs/features/github-actions/))
- Caveat: default `GITHUB_TOKEN` sometimes can't upload to a *private* repo's Release — use a PAT
  with `repo` scope, or publish to the public releases repo (which the token can write).

### Managed escape hatch
- **ToDesktop** (and similar) will do build + sign + notarize (Mac **and** Win) + host + auto-update
  for a monthly fee — "run one command, it ships." Removes the CI/signing/Mac burden entirely; trade
  is cost + lock-in. (2026 pricing not independently verified here — worth a direct quote if tempted.)

### Refuted (don't believe these)
- ✗ "Both Windows and macOS *prevent running* unsigned apps." — False. They *warn*; the user can
  proceed. Unsigned Windows auto-update is **not** blocked, only gated by the one-time click.
- ✗ "electron-github-autoupdater is the private-repo answer." — Abandoned (2022, ~6 stars) and still
  can't bypass the Mac signing wall. Use electron-updater's built-in private support instead.

---

## Recommendation

**The genuinely best path for "auto-update on BOTH platforms + one-command ship" = pay the $99/yr
Apple account.** There is no free version of Mac auto-update. Concretely:

| | Windows | macOS |
|---|---|---|
| **Installer** | NSIS `.exe` (builds now) | `.dmg` built+signed+notarized in CI (no Mac needed) |
| **Auto-update** | ✅ free, silent | ✅ **only** with Apple $99/yr |
| **First-run friction** | SmartScreen "Run anyway" (gone if +$10/mo Azure) | none once notarized |
| **Ship it** | `npm version patch && git push --follow-tags` → CI → everyone updates | same command, same tag |

**Cost:** $99/yr (Apple, mandatory for Mac auto-update) + optional $10/mo Azure (kill the Windows
warning) → **~$99–$230/yr.**

**Architecture:** source stays in private `vi-dancer`; CI publishes installers to a **public
`vi-dancer-releases`** repo; both apps' electron-updater reads that public feed (no embedded token);
one tag push ships to everyone.

**If you skip the $99 for now:** Windows gets the full auto-updating experience immediately; Mac
testers **download each new build manually** from the releases page (right-click → Open past
Gatekeeper). You can add Apple later with zero rework — the pipeline's identical.
