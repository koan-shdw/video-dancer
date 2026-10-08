# Video Dancer 0.26.0

Release notes prepared 2026-10-08.

- Settings has five pages: Connections, Co-Director, Watch, Appearance and General. Connections holds every API key and login in one place, each checked when you save it.
- The Co-Director can run on an OpenAI API key (GPT-6.1 Sol), billed per token.
- Claude Code and Codex sign in to their own Video Dancer profiles, so the app never touches your other Claude or ChatGPT logins.
- The Project button opens project controls: clean up media files nothing in the project or its undo history uses, after it shows how many and how big.
- The workspace button in the top bar is the same height as the buttons around it.
- Start a project and New project: the buttons match the close button and the toolbar.
- Image Gen takes in a project you moved find their pictures again, with their prompts, seeds and keepers.
- Ask the Co-Director to queue saved clips and it queues them. It makes a plan only when you ask for one, and there is no 20 render limit on a go.
- A Co-Director plan works one task at a time from its saved progress and survives an interrupted reply. GO picks a blocked plan back up within what you approved.
- Each finished result wakes the Co-Director once. A provider out of quota or signed out pauses the plan instead of counting as done.
- Stop plan sits on the right, works on a draft plan too, and a stopped plan leaves the panels.
- Saves ride out Dropbox and other sync apps briefly locking a file.
- Adding a Higgsfield login in the Bridge signs the browser out first, so you can pick the account with Google.

The workspace button was measured with the exact styles this release ships: 22px, the same as
New and Settings. The full test suite, TypeScript and the production build pass. A real
Co-Director plan continuing after real renders, and a live Dropbox save, remain unverified.

The development detail behind these lines (from the unreleased notes):

- Explicit commands to queue saved clips unchanged use the existing queue action. Co-Director creates a plan only when the director explicitly requests one or says they are working on one. Removed the fixed 20-render cap and instructions requiring a separate prompt review before every queue submission. Saved plan text is returned by `read_jobs` only when requested. Old manual job records that never dispatched no longer appear as queued after reopening.
- Image Gen takes use project-relative paths on disk. Opening an older moved project reconnects its generated images from their exact `images/gen/<generator>/<file>` location when present, preserving prompts, seeds and keeper selections.
- Job records use the same cloud-sync save protection as project files. Brief Windows file locks are retried; persistent replacement locks use an in-place save with a complete temporary backup.
- Ordinary conversations keep their existing history and single-exchange behavior. Detailed plan instructions, continuation controls and combined clip-edit schemas load only for approved plan turns.
- Each plan turn receives the approved scope, later user corrections, saved progress and successful actions since the last checkpoint. Completed edits survive an interrupted reply. Cancelling a reply pauses the plan; Stop plan ends it and cancels pending work.
- Job results wake Co-Director once per result version. Provider quota, sign-in and request failures pause the plan.
- One clip read can include the saved fields, compiled prompt, model capabilities and reference pictures. One write can save fields, beats and settings together. Unsupported clip modes, resolutions and aspects are rejected before a plan queues the request.
