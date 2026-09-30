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

---

## 34. ElevenLabs on the Bridge

**Finding.** ElevenLabs' login server still has no sign-up door for apps. What it takes instead
is a public web page that describes the app (its login metadata says so:
`client_id_metadata_document_supported`). The page is one small file: the app's name and the
address the login returns to. It has to sit at an https address he controls.

**Question.** Where does that file live: shdw.work, shithappensdontworry.com, or the app's GitHub
page? Once it is up, the login is a small build.

**Artlist.** Their login server publishes a sign-up door and their help page describes custom
connectors on this address, so the row is open. If the login is refused, the words on the row
say why: send them to me.

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
