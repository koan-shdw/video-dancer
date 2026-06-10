import { useEffect, useRef, useState } from 'react'

// ===========================================================================
// Phase 0 spike: prove the preview stack works in this Electron build.
//   1. WebGPU device + render loop drawing to a <canvas>  (animated clear)
//   2. video frame -> WebGPU texture via copyExternalImageToTexture (textured quad)
//   3. feature-detect WebCodecs (VideoDecoder) — the real scrub path comes later
// If this renders, the hard part of the stack is proven on the user's machine.
// ===========================================================================

const SHADER = /* wgsl */ `
struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> VSOut {
  // fullscreen triangle
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[i];
  var out : VSOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = vec2f((xy.x + 1.0) * 0.5, 1.0 - (xy.y + 1.0) * 0.5); // flip Y for image space
  return out;
}

@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var tex  : texture_2d<f32>;

@fragment
fn fs(in : VSOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
}
`

interface GpuState {
  device?: GPUDevice
  ctx?: GPUCanvasContext
  pipeline?: GPURenderPipeline
  sampler?: GPUSampler
  texture?: GPUTexture
  bindGroup?: GPUBindGroup
}

export function WebGpuVideoSpike(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const gpu = useRef<GpuState>({})
  const [webgpu, setWebgpu] = useState('checking…')
  const [webcodecs, setWebcodecs] = useState('checking…')

  useEffect(() => {
    let raf = 0
    let disposed = false
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    setWebcodecs('VideoDecoder' in window ? '✓ available' : '✗ missing')

    async function init(): Promise<void> {
      if (!('gpu' in navigator) || !navigator.gpu) {
        setWebgpu('✗ navigator.gpu missing')
        return
      }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        setWebgpu('✗ no adapter')
        return
      }
      const device = await adapter.requestDevice()
      const ctx = canvas!.getContext('webgpu') as GPUCanvasContext | null
      if (!ctx) {
        setWebgpu('✗ no webgpu canvas context')
        return
      }
      const format = navigator.gpu.getPreferredCanvasFormat()
      ctx.configure({ device, format, alphaMode: 'premultiplied' })

      const module = device.createShaderModule({ code: SHADER })
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
      })
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })

      gpu.current = { device, ctx, pipeline, sampler }

      // when a video is loaded, (re)create a matching texture + bind group
      video!.addEventListener('loadeddata', () => {
        const s = gpu.current
        if (!s.device || !s.pipeline) return
        s.texture?.destroy()
        s.texture = s.device.createTexture({
          size: [video!.videoWidth || 2, video!.videoHeight || 2],
          format: 'rgba8unorm',
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT
        })
        s.bindGroup = s.device.createBindGroup({
          layout: s.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: s.sampler! },
            { binding: 1, resource: s.texture.createView() }
          ]
        })
        void video!.play()
      })

      const adapterName =
        (adapter as unknown as { info?: { description?: string; vendor?: string } }).info
          ?.description || 'device ready'
      setWebgpu('✓ ' + adapterName)

      const frame = (): void => {
        if (disposed) return
        raf = requestAnimationFrame(frame)
        const s = gpu.current
        if (!s.device || !s.ctx) return
        const enc = s.device.createCommandEncoder()
        const view = s.ctx.getCurrentTexture().createView()

        const hasFrame = s.texture && s.bindGroup && video!.readyState >= 2
        if (hasFrame) {
          s.device.queue.copyExternalImageToTexture(
            { source: video! },
            { texture: s.texture! },
            [video!.videoWidth, video!.videoHeight]
          )
          const pass = enc.beginRenderPass({
            colorAttachments: [
              { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }
            ]
          })
          pass.setPipeline(s.pipeline!)
          pass.setBindGroup(0, s.bindGroup!)
          pass.draw(3)
          pass.end()
        } else {
          // no video yet — animated clear proves the device + render loop
          const t = performance.now() / 1000
          const pass = enc.beginRenderPass({
            colorAttachments: [
              {
                view,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: {
                  r: 0.07 + 0.05 * Math.sin(t),
                  g: 0.07,
                  b: 0.1 + 0.05 * Math.cos(t * 0.7),
                  a: 1
                }
              }
            ]
          })
          pass.end()
        }
        s.device.queue.submit([enc.finish()])
      }
      frame()
    }

    void init()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      gpu.current.texture?.destroy()
      gpu.current.device?.destroy()
      gpu.current = {}
    }
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    const video = videoRef.current
    if (!file || !video) return
    video.src = URL.createObjectURL(file)
    video.load()
  }

  return (
    <div className="spike">
      <canvas ref={canvasRef} width={960} height={540} className="spike-canvas" />
      <video ref={videoRef} muted loop playsInline className="spike-video-hidden" />
      <div className="spike-bar">
        <span className="spike-stat">WebGPU: {webgpu}</span>
        <span className="spike-stat">WebCodecs: {webcodecs}</span>
        <label className="btn">
          load test video
          <input type="file" accept="video/*" onChange={onPick} hidden />
        </label>
      </div>
    </div>
  )
}
