# Logins, keys and setup (list 33 to 38): what is built, what waits on him

Date: 2026-09-30. No service was logged in to and no account was touched for any of this. The
supplier facts below were read that day from each supplier's own public pages.

---

## Built 09-30 (untested by him)

- **34, Artlist.** The Bridge row is open to a login try again. A refusal now shows the supplier's
  own words on the row.
- **37, missing-key steps.** A job that needs a key he hasn't saved opens that supplier's key
  steps (get a key, paste, save) instead of failing in a toast.
- **38, Claude sign-in.** When the Claude login has run out, a button signs in through Claude
  Code's own sign-in (his browser, no terminal) and sends the failed message again.

---

## 33. Several logins per bridge

His words: "several of same bridge, ability ot hit a plus and add a new one for each bridge"
(09-29), all "in the credit pool".

**What exists.** One login per supplier. The logins, the saved tokens, the rows, the credit bars
and every render lane are keyed by the supplier's name, so each lane asks for "the" login.

**What a build changes.** Logins are kept per supplier and slot. A ＋ on a row runs the same
browser login into a new slot. Each slot is its own row with its own credit bar, and the pool
adds them up. A render lane picks one slot.

**Questions**

1. Which login pays for a render: the one with the most credits left, the first one until it is
   empty, or his pick each time?
2. A supplier's login page signs in whichever account the browser already has open. To add a
   second account he signs out on their site first (or uses a private window). The supplier's
   page decides that, not the app. Fine?
3. The supplier rarely tells the app which account a login is. Rows named "Higgsfield 1, 2, 3"
   that he can rename?

**Answers (09-30).** He asked on 09-30 for the obvious questions to be answered for him. An answer in quotes is his own.
1. The login with the most credits left pays.
2. Not a question: the ＋ says it where he adds a login.
3. Yes: "Higgsfield 1, 2, 3", and he can rename a row.

**Built 10-01 (untested by him, unproven against a supplier: no second account was logged in).**
- **The ＋** sits on every logged-in browser login (not on a key row). It opens a strip under the
  row: "their page signs in whichever account your browser has open. Sign out on their site
  first, or use a private window." Two ways in: **open their login** (his browser), or **copy the
  link** (the login link goes to the clipboard, to paste into a private window). A refusal shows
  in the strip and adds no row.
- **Rows.** One per login, each with its own credit bar in the ledger and its own part of the pool
  bar. One login = the supplier's plain name; several = "Higgsfield 1, 2, 3". A number never
  shifts when another login leaves. Double-click a name to rename it; emptied = back to the number.
- **Who pays.** A render runs on the login with the most credits left, start to finish (upload,
  submit and every poll on that one account). Its credits are read again after the render, so the
  next pick is true. Out of credit, or a login the supplier has ended: the render moves to the
  supplier's next login. Any other failure stops where it is.
- **Bridge (auto)** ranks a supplier by its fullest login.
- **A crash mid-render.** The job is saved with the login that took it, and the recovery asks
  that account.
- **Saved logins.** The first login stays where it was in the settings file, so the old file
  reads unchanged. Added logins sit beside it (`higgsfield#2`).
- **Found and fixed on the way.** A login whose supplier had ended it (the refresh refused) stayed
  "logged in" with a red line and would have kept being picked to pay. It now drops to logged
  out with "session expired, log in again" on its row, where its own login button signs it in
  again and ✕ takes the row away.
- Code: `src/main/bridge/index.ts` (the logins, `onBestLogin`, `onLogin`), the five adapters in
  `src/main/providers/mcp/`, `panels/BridgePanel.tsx`. Tests: `scripts/test-bridge-logins.cjs`
  (in `npm test`), `scripts/test-bridge-logins-browser.cjs` (`npm run test:bridge-logins-ui`).

---

## 34. ElevenLabs on the Bridge

**Finding.** ElevenLabs' login server still has no sign-up door for apps. What it takes instead
is a public web page that describes the app (its login metadata says so:
`client_id_metadata_document_supported`). The page is one small file: the app's name and the
address the login returns to. It has to sit at an https address he controls.

**Question.** Where does that file live: shdw.work, shithappensdontworry.com, or the app's GitHub
page? Once it is up, the login is a small build.

**Answer (09-30).** "github for now, we will eventually have shdw.work".

**Artlist.** Their login server publishes a sign-up door and their help page describes custom
connectors on this address, so the row is open. If the login is refused, the words on the row
say why: send them to me.

**Artlist, his try 09-30.** Refused: the row showed "400: Bad Request". Their full reply (read
that day with the app's own request): `{"statusCode":400,"error":"Bad Request","message":"dynamic
client registration is disabled"}`. The sign-up door is published but switched off. Their login
server says `client_id_metadata_document_supported: true`, the same as ElevenLabs, so the one
public page opens both logins.

**Built 09-30 (untested by him, unproven against both suppliers).** The page is
`https://koan-shdw.github.io/video-dancer/oauth/client.json`: the file `oauth/client.json` in the
public repo (the clone beside this one, `video-dancer`), written by `scripts/write-client-page.cjs` from
`clientPage()` in `src/main/bridge/oauth.ts`. The address is the client id, so moving it to
shdw.work later means every such login is made again. The login (MCP authorization spec
2025-11-25, read that day): a registration on the spot where a supplier's door works (the proven
path), else the page, on one of three fixed loopback ports the page lists (47600 to 47602), as a
public client with no secret, asking for the resource name the supplier itself publishes.
To go live: push the public repo, and switch on its GitHub page (branch main, folder / root).

---

## 35. GPT and other chat logins

His words: "add new logins with gpt and also research other LLM servies … a more seemlyess login
experience" (09-21) · "after GPT login make it available as a codirector engine" (09-29).

**Found 09-29.** ChatGPT signs in through OpenAI's Codex CLI and Google through the Gemini CLI.
The app can drive both the way it drives Claude Code. DeepSeek is key only.

**What a build is.** A fourth Co-Director engine that runs the Codex CLI on his ChatGPT login
and gives it the same tools over the same local back-channel the Claude bridge uses. It needs
the Codex CLI installed and signed in on his machine. The Co-Director's guide was written for
Claude: how GPT follows it is untested.

**Questions**

1. Codex (ChatGPT) first, the Gemini CLI first, or both?
2. DeepSeek on a key: a Co-Director engine too, or leave it?
3. The build needs the Codex CLI on this machine. That is a download and a login: both his to
   do, or mine to download on his word?

**Answers (09-30)**
1. Codex (ChatGPT) first, his words name it. Then the Gemini CLI.
2. Yes, DeepSeek on a key is an engine too.
3. Both are his, when he tests. The build is made from their docs and proven against a stand-in.

---

## 36. Setup wizard

His words: "A install and login wizard that lets users log into all the servies in a single
login wizard the LLM, the video the image it outlines all the serves that each will provide and
guies them for the login" (09-21).

**What exists.** The first-run Welcome card: four key suppliers and a link to the Bridge logins.

**What a build is.** One wizard, a page per kind: the AI that runs the Co-Director, video, image,
voice and music, watching. Each page lists its services, says what each one gives, and carries
its login or key steps. The pieces now exist: the key steps (37), the Bridge logins, the Claude
sign-in (38).

**Questions**

1. When does it show: first run only, or also from a button in Settings?
2. Which services go on it, and which one is the recommended path on each page?
3. Does it replace the Welcome card, or follow it?

**Answers (09-30)**
1. First run, and a button in Settings.
2. Every service the app has. No "recommended" tag.
3. It replaces the Welcome card.
