// Every DataTransfer MIME the app uses, in one place. (They were string literals scattered
// across six files — a typo'd format silently breaks a drop target.)
export const MIME_CLIP = 'text/plain' // bin clip → timeline (clip id)
export const MIME_CLIPS = 'application/x-vd-clips' // multi-selected bin clips (JSON string[] of clip ids, selection order)
export const MIME_IMAGE = 'application/x-vd-image' // library image (absolute file path)
export const MIME_IMAGES = 'application/x-vd-images' // library image(s) by ID (JSON string[], selection order) — timeline drop auto-makes clips
export const MIME_TAKE = 'application/x-vd-take' // JSON {clipId, takeId}
export const MIME_TLITEM = 'application/x-vd-tlitem' // timeline reorder (item index as string)
export const MIME_MOVE = 'application/x-vd-move' // JSON {kind:'bin'|'lib', id} folder move
export const MIME_BEAT = 'application/x-vd-beat' // beat reorder (beat index as string)
export const MIME_AUDIO = 'application/x-vd-audio' // library music track → timeline audio lane (audio id)
export const MIME_VIDEO = 'application/x-vd-video' // library reference video → @video ref slot (video id)
export const MIME_EDITNODE = 'application/x-vd-editnode' // image-editor tree node → Library (JSON {sessionId, nodeId})
export const MIME_WATCH = 'application/x-vd-watch' // watched-folder staging image → Library (absolute file path; import on drop)
