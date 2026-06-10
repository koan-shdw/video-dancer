// Build a streaming URL for a local file served by the main-process `media://` protocol.
// Lets <video>/<img> stream straight from disk instead of reading the whole file over IPC.
export const mediaUrl = (file: string): string => 'media://x/' + encodeURIComponent(file)
