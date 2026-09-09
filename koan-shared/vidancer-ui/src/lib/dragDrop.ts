// Every DataTransfer MIME the app uses, in one place. (They were string literals scattered
// across six files — a typo'd format silently breaks a drop target.)
export const MIME_CLIP = 'text/plain' // bin clip → timeline (clip id)
export const MIME_CLIPS = 'application/x-vd-clips' // multi-selected bin clips (JSON string[] of clip ids, selection order)
export const MIME_IMAGE = 'application/x-vd-image' // library image (absolute file path)
export const MIME_IMAGES = 'application/x-vd-images' // library image(s) by ID (JSON string[], selection order) — timeline drop auto-makes clips
export const MIME_TAKE = 'application/x-vd-take' // JSON {clipId, takeId, inSec?, outSec?} — trims ride from the Clip Gen preview window
export const MIME_TLITEM = 'application/x-vd-tlitem' // timeline reorder (item index as string)
export const MIME_MOVE = 'application/x-vd-move' // JSON {kind:'bin'|'lib', id} folder move
export const MIME_BEAT = 'application/x-vd-beat' // beat reorder (beat index as string)
export const MIME_AUDIO = 'application/x-vd-audio' // library music track → timeline audio lane (audio id)
export const MIME_SCORE = 'application/x-vd-score' // Bin score clip → timeline score lane (score clip id)
export const MIME_VIDEO = 'application/x-vd-video' // library reference video → @video ref slot (video id)
export const MIME_EDITNODE = 'application/x-vd-editnode' // image-editor tree node → Library (JSON {sessionId, nodeId})
export const MIME_VEDITNODE = 'application/x-vd-veditnode' // VIDEO-editor tree node → bake on drop (JSON {sessionId, nodeId}): Bin space = new clip · clip card = new take · timeline = clip + block
export const MIME_WATCH = 'application/x-vd-watch' // watched-folder staging image → Library (absolute file path; import on drop)
export const MIME_CIVIT = 'application/x-vd-civit' // a civitai like from the Watched panel (JSON {id, url}); the Library fetches the file through main, then imports (CIVIT-LIKES-SPEC)
export const MIME_BINCARD = 'application/x-vd-bincard' // Bin section card reorder (the card key)
export const MIME_LIBCARD = 'application/x-vd-libcard' // Library section card reorder (the card key)
export const MIME_GENTAKE = 'application/x-vd-gentake' // Image Gen take → Library (JSON {imageGenId, takeId}): the PNG copies into images/ (KREA2-LOCAL-SPEC §4.5)
export const MIME_VOICE = 'application/x-vd-voice' // Library voice sample → char-sheet voice slot / Voices-card clone source (voice id)
