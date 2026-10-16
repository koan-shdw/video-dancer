// The bridge accessor (VIDANCER-UI-PACKAGE-SPEC-2026-09-06 §2.1). The package never says
// window.vidancer: the consumer hands its VidancerApi over ONCE before first render — Electron
// passes the preload surface, the site passes a browser sim. A missing member fails at typecheck.
// VidancerApi itself is the global interface declared in env.d.ts (with the shared type aliases).
export type VidancerBridge = VidancerApi

let api: VidancerApi | null = null
export function setVidancerApi(a: VidancerApi): void {
  api = a
}
export function vd(): VidancerApi {
  if (!api) throw new Error('setVidancerApi() must run before any @koan/vidancer-ui surface renders')
  return api
}
