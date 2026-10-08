# Audit leads (2026-10-08)

Scope: (a) money, keys, lost work; (b) bugs that break workflows. One person on their own PC.
Source: Astra's reports on branch `astra-audit-2026-10` (`docs/audit-2026-10/02-SECURITY.md`, `03-CODE.md`, `05-WORKFLOWS.md`).
Every line is UNVERIFIED on the restored code (`5f8a25b` / `4b46f10`) until checked. Nothing here is a fix.

## Check first

1. A1 double spend after a credit error
2. A2 a cancelled job comes back after restart
3. C1 cleanup deletes the wrong files
4. C2 deleting an imported take deletes the original file
5. C3 a bad settings file gets wiped on the next save
6. C4 results land in the wrong project after a switch
7. B1 keys in logs
8. B2 Civitai key sent on to the download CDN
9. D1 same LoRA name in two folders loads the wrong file
10. B3 private MOODS drafts inside the installer

## a. Money

- A1 (SEC-07, high) After a job is accepted, a credit error retries on another account or provider. Two charges for one render.
- A2 (SEC-70, high) Cancelling a parked pending job only hides its row. The saved request runs again after restart.
- A3 (SEC-72, med) fal: one render can use two accounts (upload with one, dispatch or recover with another).
- A4 (SEC-69, med) A late result and its spend get booked into whichever project is open.
- A5 (SEC-38, med) Reopening a project may resume an approved Co-Director plan. Check whether it spends without a new approval.
- A6 (03-CODE falImage, med) Image Edit: one failed variant drops the earlier paid variants from the edit tree. Files stay on disk, unseen.
- A7 (05-WORKFLOWS, med) Paid results after a crash or restart: which providers recover them and which lose them.
- A8 (03-CODE draft.ts, low) After a key change, a draft from the old account can be sent on the new one.
- A9 (SEC-08, SEC-45, low) Upload and ElevenLabs music caches ignore which account they belong to. Renders fail or use the wrong file after a key change.

## a. Keys and private data

- B1 (SEC-10, high) Provider replies, request URLs and tokens get written to logs. Old logs were never cleaned.
- B2 (SEC-31, high) Civitai downloads: the API key header follows the redirect to a third-party CDN.
- B3 (SEC-46, SEC-13, med) Four private MOODS drafts are inside the shipped app bundle, plus raw shared source. Public installers carry them.
- B4 (SEC-01, med) If the Windows key store is unavailable, new keys are saved as plain text.
- B5 (SEC-03, low) The app's screens can see more key material than they need.

## a. Lost work

- C1 (SEC-65, high) Cleanup: scan in project A, switch, confirm, and it deletes in project B. Files made after the scan also get deleted.
- C2 (SEC-14, high) Deleting an imported take or edit node deletes the original file outside the project.
- C3 (SEC-02, high) An unreadable settings file is replaced by an empty one on the next save. All keys and settings gone.
- C4 (SEC-36, 57, 60, 61, 62, 66, 68, high) Anything that finishes after a project switch (render, save, menu, Get + Use, Assemble, file picker) writes into the newly open project. A same-ID recipe can be overwritten.
- C5 (SEC-67, med) External editor: a later save can be hidden, a damaged tracking file gets overwritten, and an edit can land in another project.
- C6 (SEC-39, med) A failed engine download deletes the working engine before unpacking the new one.
- C7 (03-CODE, med) A failed project save leaves the app ahead of disk with no clear retry path.
- C8 (SEC-17, med) An older build opening a newer project downgrades it. A damaged spend file is replaced with an empty one.
- C9 (SEC-53, low) LoRA tags get lost: damaged tag file replaced, a late Civitai lookup erases a newer tag.
- C10 (SEC-19, low) Send to project may overwrite a same-named file in the destination. Check.
- C11 (03-CODE exportAs, low) A failed Export As leaves a partial file at the destination.

## b. Broken workflows

- D1 (SEC-58, 59, med) The same LoRA or model filename in two engine folders loads the wrong one. WARNING: Astra's fix for this is what broke LoRA. Any fix must accept junctions and his real folders.
- D2 (SEC-51, 55, med) LoRA import and Civitai Get + Use report success when a different file or no file was saved.
- D3 (05-WORKFLOWS, med) Export vs preview: speed, time remap, loop, nest, linked audio and effects must match.
- D4 (03-CODE exportAs, med) Export As MP4/MOV stream-copies codecs the container may not take. Broken file.
- D5 (03-CODE editors.ts, med) A missing external editor exe has no error handler. Check whether it crashes the app.
- D6 (03-CODE installers, med) Audio/LTX/H3 installs: cancel between stages keeps going, delete does not wait for install, an interrupted H3 pip step is never repaired.
- D7 (SEC-23, 25, low) A malformed Co-Director tool call runs with defaults (empty clip), or half a batch applies.
- D8 (SEC-41, low) GPU cleanup can kill a worker that just started.
- D9 (SEC-37, low) Assemble: a failed save leaves an empty timeline.
- D10 (03-CODE reverse.ts, low) Reverse breaks on a path with an apostrophe. Console window flashes.
- D11 (03-CODE wave.ts, low) Waveform stays stale after a file is overwritten. Long audio is decoded whole into memory.
- D12 (SEC-28, low) A half-downloaded Civitai image is reused as a good cache hit forever.
- D13 (03-CODE falImage, low) Image Edit uploads reference images only when there is a base image. Check from-scratch edits.
- D14 (03-CODE pasteBack, low) Paste-back makes changed pixels opaque. Transparency lost.
- D15 (03-CODE, low) Wrong words: Watch and Score name Claude when OpenAI is chosen; errors point to a removed Settings section; ACE says 4 GB but needs 8 GB; opening a newer project shows a generic error.
- D16 (SEC-34, low) Watch reads a large video fully into memory before upload.
- D17 (SEC-56, low) One malformed checkpoint name hides the whole checkpoint list.
- D18 (SEC-76, low) Effects cancel can miss an encode that is already finishing.
- D19 (03-CODE watchIpc, low) Watch abort waits ten minutes if the window stops answering.
- D20 (03-CODE jobs, low) Assemble ignores global cancel. Job history is never pruned.
- D21 (SEC-40, low) The uv bootstrap downloads "latest", so installs can break when upstream changes.

## His call (behaviour, not a bug)

- E1 (SEC-63) The LoRA master switch turns off the two slots but leaves unleashed on. The tooltip says all optional LoRAs stop. Change the tooltip or the switch?

## Out of scope (hostile files on his own PC)

- Junctions, hardlinks and linked folders: SEC-06, 15, 18, 20, 30, 32, 42, 47, 54, 56 (delete), 64, 71, 73, 74, 75, 76 (hardlink).
- Crafted projects reading outside files: SEC-16, 19 (read), 21, 22, 29, 33, 43, 49.
- Size caps on trusted input: SEC-27, 40 (limits), 48, 50, 52.
- Provider redirects and IPC hardening: SEC-04, 05, 09, 11, 12, 26, 35, 44.
- Co-Director file permissions: SEC-24.
