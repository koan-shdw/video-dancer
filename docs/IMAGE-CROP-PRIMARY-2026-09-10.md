# Image crop and primary references

Included in version 0.19.0.

## Crop

The crop keeps the original output size. Handles and the mouse wheel zoom the image without stretching it. Drag the picture to move it inside the crop; movement stops at its edges so the frame stays filled. Reset restores the full image. Enter applies; Escape cancels. A failed save leaves the crop open for retry, and repeated Apply clicks cannot create duplicate nodes. Crops become primary tree versions and retain the original.

## Which image reaches a model

Video render requests now retain Library asset IDs alongside preview paths. At dispatch, the shared reference resolver selects the current primary node, including for start/end frames and old queued requests holding original or earlier tree paths. All video supplier routes receive the resolved request. Image Gen, Voice image references, Image Editor references and video re-generation references use the same primary lookup. A missing primary node fails instead of silently substituting an older version.

The Image Editor continues to branch from the node being viewed. Selecting the explicit original row now sends that original, matching the preview; choosing a primary also selects it for editing. Independent Library copies remain separate assets.

## Verification

- Actual Image Editor controls in hidden Electron: wheel zoom, all eight handles preserve aspect, inward corner motion, pan bounds, pointer cancellation, reset, failed-save retry, duplicate-apply prevention and primary assignment. Saved PNG pixels match the preview within one channel level of canvas/PNG rounding.
- Real project files and the real fal image/video upload code with a mocked provider boundary: exact uploaded bytes match successive primary nodes, crop output and queued start/end images. Also checks Undo, original selection, independent copies, project reopen and missing-primary refusal.
- No paid generations or user images were used.
