# Voice uploads and VIA

The reported Demonette Voice failure displayed only “Forbidden.” A read-only fal billing check returned a balance of −$3.23. Credit was the likely immediate blocker; changing code does not replenish the fal account.

Investigation also found that voice references used a video uploader, labelling both character images and audio samples as `video/mp4`. Voice uploads now use image/audio upload helpers with the actual file type. Cached uploads are separated by file type, so a correctly typed reference cannot reuse a video-labelled upload. Reference caching remains bounded.

Upload errors now name the stage (character image or voice sample), identify fal, preserve its error details, and give a key/credit hint for access failures. They stop before the generation request. Model-generation errors remain distinguishable from upload errors.

The Voice card now shows **MODEL** and **VIA** side by side using the existing dropdown style. Seed Audio shows **fal**, with “Uses your fal API key and fal credits.” The VIA field follows the selected model’s actual provider and is fixed when only one route is supported. Queue entries also include the provider. This does not add new supplier integrations.

Verification: automated upload/submission checks cover PNG, JPEG, WebP, WAV, MP3, OGG, M4A and FLAC metadata, reference exclusivity, cache reuse, upload rejection and model rejection. A hidden Electron test checks the real card’s VIA, billing text, queue label and provider changes. No paid voice render was started during these tests.

Restart the updated local app to see the VIA field. Top up fal before retrying the original render.
