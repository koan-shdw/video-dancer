// Runs BEFORE @koan/vidancer-ui evaluates (main.tsx imports this file first; ES imports evaluate
// in order). Package modules may read the bridge at module scope, so the handoff cannot live in
// main.tsx's body — that body runs after every import has already evaluated.
// (docs/VIDANCER-UI-PACKAGE-SPEC-2026-09-06.md §2.1)
import { setVidancerApi } from '@koan/vidancer-ui/api'

setVidancerApi(window.vidancer)
