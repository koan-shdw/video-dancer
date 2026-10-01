# COMMUNITY MOODS (list 43), spec of 2026-10-01

His words (09-08): "eventually i'd like this to be a wired into a commuinity project where vMDs can
be taken froma repo and downloaded by anyone with the app with the name of the uyser who made them
in there credited". His pick 10-01: "finish the remaining todo". The approved MOODS spec
(`MOODS-VMD-SPEC-2026-09-08.md` §8) already set the shape: a public repo `koan-shdw/vidancer-moods`
with an `index.json`, one click installs, the author from the header credited, publishing = a pull
request.

## The repo

- `koan-shdw/vidancer-moods`, public, on his GitHub. Prepared at `C:\Claude\vidancer-moods`
  (committed there, not on GitHub): `moods/` (one `.vmd` each, named by its slug), `index.json`,
  `README.md` (what it is, how to share, the rules), `scripts/build-index.mjs` and
  `.github/workflows/index.yml`.
- `index.json` is built from the files, never typed: on every push to main the workflow reads each
  `.vmd` header and writes `{ v: 1, moods: [{ slug, name, author, description, tags, version,
  bytes }] }`. A pull request runs the same script with `--check`: a file without a `vmd:` header,
  a name or an author fails it, so he sees it before he merges.
- The app reads `https://raw.githubusercontent.com/koan-shdw/vidancer-moods/main/index.json` and
  the files beside it. Until the repo is up the list says so.
- Creating the repo on his GitHub and pushing it are his call (asked, not done).

## In the app (the MOODS fold, Co-Director panel and Room)

- **⇣ community** in the fold's bottom row opens the community list under the chips: each MOOD
  with its name, "by <maker>", version and size; the description on hover. One click:
  - **install**: the file is fetched (2 MB at most, a `vmd:` header or it is refused) and lands in
    the library switched off, like any added MOOD. Its maker stays in its header, so the chip's
    hover keeps the credit.
  - **installed ✓** when the same version is in the library; **update** when the version differs
    (it asks first: the copy in the library is replaced).
  - The list reads again on ↻.
- **Share to the community** (right-click a MOOD): a pull request, the GitHub way.
  - It needs his name (Settings → "your name on MOODS"); it is written into the file as the maker
    when the file has none.
  - Refused, with the reason: a MOOD credited to someone else ("only its maker shares it"), and
    the two shipped MOODS made from someone else's skills.
  - It asks first ("only share MOODS you made"), then writes the `.vmd` into a share folder,
    shows it in Explorer and opens the repo's upload page: drag the file in, GitHub forks the repo
    and opens the pull request. The repo's owner merges it into the list everyone sees.
- The old ⇩ share (save the file anywhere) stays.

## Safety

A MOOD is text the Co-Director reads when it is switched on; nothing in it runs. Community MOODS
install switched off, show their maker and size, and only reach the list through a pull request he
merged.
