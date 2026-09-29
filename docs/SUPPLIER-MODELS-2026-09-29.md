# Supplier model review, 2026-09-29

His ask 09-29: "review which new models are out on suppliers and list them for me to review for
adding, across music, voice, video gen, video edit, reading, etc". One research agent (his GO
AGENTS), public pages only, 164 page reads across 13 suppliers. This file is that agent's report
as it came back. Every slug, price and limit gets re-read on its own page before anything is built.
Nothing here is on the list unless he picks it.

**HIS PICKS 09-29** (the ten strongest candidates below): 1 yes · 2 yes · 3 yes · 4 yes · 5 no ·
6 no · 7 yes · 8 yes · 9 yes · 10 "upscale / enhance is a later thing". On `TODO.md` as 9, 13 and 19 to 23.

---

## Read first
- **Sora 2 no longer works.** OpenAI removed `sora-2`, `sora-2-pro` and the Videos API on Sep 24 and named no replacement. fal marks `fal-ai/sora-2/image-to-video` as deprecated, so the app's Sora 2 lane will fail.
- **Newer versions of models the app already has:** Gemini Omni Flash 1.1, MiniMax H3 Max, GPT Image 2.5, ElevenLabs Music v2.5, Sonilo v1.1, Kling O3 4K edit, Gemini 3.8 Flash (reading), Claude Fable 5.1 and Sonnet 5.5. Haiku 4.5 retires "not sooner than Oct 15".
- Google marks `gemini-2.5-flash-image` (the original Nano Banana) as deprecated. fal still serves it.

## Six answers
**1. Seedream 5.0 Pro on ModelArk (list 11).** Yes. It runs on the standard Image generation API as `dola-seedream-5-0-pro-260628`.
- **Inputs:** text-to-image, and edits with up to 10 reference images. It also takes point, box and sketch edits, splits an image into up to 16 alpha layers, and makes transparent backgrounds at 1K–2K.
- **Price:** $0.045 per image up to 2.61 MP, $0.09 above. Each reference image after the first costs $0.003.
- **New sibling:** Seedream 5.0 Flash, `dola-seedream-5-0-flash-260915`, at $0.018.

**2. Venice (list 14).** It has a public API that works like OpenAI's.
- **Models:** 126 chat (Claude Opus 5.5, Gemini 3.8 Flash, Kimi K3), 41 image (Nano Banana 2 and Pro, GPT Image 2.5), 132 video (Omni 1.1, Seedance 2.5, Wan 3.0), 11 text-to-speech and 16 music/sound-effect models.
- **Payment:** credits, DIEM staking or an x402 crypto wallet. Opus 5.5 is $4.80/$24 per million tokens. Images are $0.01–0.29. Video is priced by quote.
- **App access:** the official MCP server needs a `VENICE_API_KEY`. There is no account-login (OAuth) option for other apps.

**3. Suno (list 41).** There is no public API.
- platform.suno.com says "Make music with the Suno API … REST API", but its docs and pricing pages send you to a Suno login.
- In July Suno said it is exploring an API with hand-picked partners (NEWS ONLY).
- Everything else is an unofficial wrapper. fal, Runway, Pika, Magnific and Venice list no Suno model.

**4. Gemini 3.8 TTS (list 19).** The model ids are `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, launched Sep 23. A normal Gemini API key reaches them, through Google's Interactions API.
- **Voices:** 30 prebuilt, plus a larger library (Google's blog says 2,000+). It can design a voice from a text description or copy one from a ~30 s sample.
- **Languages and speakers:** 130+ languages, up to 2 speakers per request.
- **Style:** set with `speech_metadata`/`style` text and inline tags like `<laugh>`.
- **Limits:** 8,192 input tokens and 16,384 output tokens. Output is 24 kHz WAV.
- **Price:** $0.50 per million text tokens in and $9 per million audio tokens out (about $0.00225 per 10 s) until Dec 31, then double. Lite output is $6 per million. There is a free tier.
- On fal: `google/gemini-3.8-flash-tts`.

**5. Nano Banana outside fal (list 10).**
- **Google direct:** `gemini-3.1-flash-image` (Nano Banana 2, about $0.067 per 1K image), `gemini-3-pro-image` (Pro, about $0.134) and the new `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite, about $0.034).
- **Runway API:** `gemini_2.5_flash`, `gemini_image3.1_flash`, `gemini_image3_pro`. Its account-login MCP at `mcp.runwayml.com` shows Pro (NEWS ONLY).
- **Higgsfield MCP and CLI** (browser login, uses plan credits): Pro.
- **Magnific API:** `gemini-2-5-flash-image-preview`, `nano-banana-pro` and `nano-banana-pro-flash` (Magnific's name for Gemini 3.1 Flash). Its account-login MCP page names no models.
- **Pika:** the API has Pro, Nano Banana 2 and 2 Lite. Pika's account-login MCP lists "Gemini Image (nano banana)".
- **Artlist MCP** (`mcp.artlist.io/mcp`, Artlist login, plan credits, beta): the Nano Banana family (NEWS ONLY on which versions).
- **Astria:** Nano Banana, Pro (tune 3618064) and 2 Lite. **Venice:** Nano Banana 2, Pro and 2 Lite.

**6. Chat on a subscription login (list 35).**
- **OpenAI Codex CLI:**
  - Login: sign in with ChatGPT in a browser, or run `codex login --device-auth` on a machine without one. The token is cached in `~/.codex/auth.json`.
  - Driven by another app: yes. `codex exec` reuses the login and can output JSON (`--json`). `codex app-server` is a JSON-RPC server built for other products to drive.
- **Google Gemini CLI:**
  - Login: "Sign in with Google" uses the free Code Assist tier or a Google AI Pro/Ultra plan.
  - Driven by another app: yes. `gemini -p … --output-format json` reuses the cached login, and `gemini --acp` gives program control.
- **DeepSeek:** V4.1 Flash came out Sep 10 (`deepseek-flash`, 1M context, reads images, open weights). There is no subscription login and no CLI, only an API key: $0.15 per million tokens in and $0.60 out at off-peak rates. It is also on ModelArk as `deepseek-v4-1-flash-260910`.

## By category (newest first)
**Video generation**
- **Creatify Boreal**, fal `creatify/boreal` (Sep 15): text plus optional image or audio, 1–20 s, sound on. $0.01/s at 720p, $0.12/s at 2K.
- **MiniMax H3 Max**, fal `minimax/h3-max/{text,image,reference}-to-video` (Aug 23), plus `h3-max-turbo` and `/camera-controls`; Runway `h3_max`. 5–15 s, up to 1080p, references of 9 images, 3 videos and 3 audio clips. $0.05–0.16/s, half off until Sep 30. Turbo costs half.
- **Gemini Omni Flash 1.1**, fal `google/gemini-omni-flash/v1.1/{text,image,reference}-to-video` and `/edit` (Aug 25); Google `gemini-omni-1.1-flash`; Runway `gemini_omni_flash_1.1`. 3–10 s per call, extends to 40 s, 360p–4K (1080p and 4K are upscaled), 10 image and 3 video references, sound on. $0.03–0.30/s.
- **Wan 3.0 and Wan 3.0 Prime**, fal `alibaba/wan-3.0/…` and `alibaba/wan-3.0-prime/…` (Aug); Runway `wan3` (up to 30 s); Astria `wan30_*`. Sound on. Prime takes 10 image, 5 video and 5 audio references. $0.05–0.28/s.
- **Grok Imagine Video 1.5**, fal `xai/grok-imagine-video/v1.5/…` (Jul 29); Runway `grok_imagine_1_5`. 1–15 s, up to 720p, 7 image references plus an audio reference. $0.08–0.14/s.
- **FLUX 3**, fal `blackforestlabs/flux-3/{text,image,keyframes}-to-video` (Jul 17); Astria `flux3_1080p`. 5–20 s, sound on. $0.17–0.29/s.
- **Seedance 2.0 Mini**, fal `bytedance/seedance-2.0/mini/…` (Jun 23); ModelArk `dreamina-seedance-2-0-mini-260615`; Runway `seedance2_mini`. 4–15 s, up to 720p, sound on. About $0.03/s on ModelArk under an enterprise discount that runs until Oct 7.
- **Happy Horse 1.1**, fal `alibaba/happy-horse/v1.1/…` (Jun 21): 3–15 s, 1080p, sound on, 9 references. $0.14–0.18/s.
- **LTX 2.5 in the cloud**, fal `lightricks/ltx-2.5/audio-to-video/pro` (Aug 11): makes video timed to a track you supply. $0.17 per second of input audio at 1080p.
- **Older but missing:** Veo 3.1, fal `fal-ai/veo3.1` ($0.40/s with sound), and Veo 3.1 Lite, `fal-ai/veo3.1/lite` ($0.05/s).

**Video edit**
- **Kling O3 4K edit**, fal `fal-ai/kling-video/o3/4k/video-to-video/edit` (Aug 31): native 4K, keeps the original audio, takes element references. $0.42/s.
- **H3 Max Extend**, fal `minimax/h3-max/extend-video` (Sep 17): adds 5–15 s to a clip, up to 2K. $0.05–0.32/s.
- **ID-V2V and Relight**, fal `fal-ai/id-v2v` (Sep 14, by Netflix and Eyeline): restyles or relights a clip from up to 5 edited keyframes and keeps people's identity. No price shown.
- **FLUX 3 Edit Video FAST**, fal `blackforestlabs/flux-3/edit-video` (Jul 17): $0.03/s.
- **Runway Aleph 2.0**, `aleph2` (Jun 2): edits a 2–30 s clip from a prompt plus up to 5 keyframe images placed at set times.

**Image generation and edit**
- **Seedream 5.0 Flash**, fal `bytedance/seedream/v5/flash/{text-to-image,edit,layerize}` (Sep 23). $0.018 per image on ModelArk.
- **GPT Image 2.5 Flare and Sunburst**, fal `openai/gpt-image-2.5/{flare,sunburst}/{text-to-image,edit}` (Sep 8); OpenAI `gpt-image-2.5-flare`; Runway `gpt_image_2_5_flare`. 16 reference images, masks, transparent background. $8 per million image tokens in, $30 out.
- **Meta Muse Image**, fal `meta/muse-image/edit` (Aug 21); Runway `muse_image`. Up to 10 reference images.
- **Seedream 5.0 Pro Layerize**, fal `bytedance/seedream/v5/pro/layerize` (Aug 6): splits an image into alpha layers. $0.034 per layer up to 1536×1536.
- **Qwen Image 3**, fal `alibaba/qwen-image-3/edit` (Jul 21): 1–3 reference images. $0.04–0.075.
- **Nano Banana 2 Lite**, fal `google/nano-banana-2-lite` (Jun 30): 1K only, under 2 s.
- **Local:** Qwen-Image-2.1 (Hugging Face, Sep 14), a 7B model that generates and edits images with transparency. Its "qwen-research" license needs checking before commercial use.

**Music**
- **Lyria 3.5**, Google `lyria-3.5` at $0.08 per song; fal `google/lyria-3.5` (Sep 19). Takes text or up to 10 images and your own lyrics. Sings, outputs 44.1 kHz stereo, songs run "a couple of minutes".
- **ElevenLabs Music v2.5**, `music_v2_5` (Sep 21); fal `elevenlabs/music/v2.5`. $0.15/min direct.
- **PixVerse VibeMV**, fal `pixverse/music-video/vibemv` (Sep 17): turns a song into a music video with lyric subtitles. $0.06/s.
- **Pika Music**, Pika API (Aug): takes lyrics and a voice or track reference, up to 6 min. $0.015/min.
- **Sonilo v1.1**, fal `sonilo/v1.1/text-to-music` ($0.0025/s) and `/video-to-video-music` ($0.009/s).

**Voice, text-to-speech and cloning**
- **Eleven v4 and v4 Turbo**, `eleven_v4` and `eleven_v4_turbo` (Sep 28); fal `elevenlabs/tts/eleven-v4`. 90+ languages, audio tags. $0.08 and $0.04 per 1K characters, 72% off until Oct 12. Cloning from 10 s of audio and #1 on the Speech Arena ranking are NEWS ONLY.
- **Gemini 3.8 Flash TTS and Lite:** see answer 4.
- **Pika Speech**, Pika API (Aug): 48 kHz, clones a voice from a few seconds of audio, up to 5 min. $0.01/min.
- **Local:**
  - `tencent/AuK` (MIT license, 1.5B): speech, voice cloning and speech editing.
  - `IndexTeam/IndexTTS-2.5` (Aug 10): clones a voice from one sample in 5 languages.

**Sound effects** (a slot the app doesn't fill today)
- **Pika Soundtrack and SFX**, Pika API (Aug): Soundtrack turns a video into a full soundscape at $0.005/s. SFX makes clips up to 20 s at $0.0002/s.
- **Sonilo v1.1**, fal `sonilo/v1.1/video-to-sound-effects` (Jul 20): effects timed to what happens on screen. $0.009/s.
- **Mirelo SFX 1.6**, fal `mirelo-ai/sfx1.6/video-to-video` (May).

**Lip-sync** (empty slot)
- **H3 Max Lip Sync**, fal `minimax/h3-max/lip-sync/image-to-video` (Sep 17): image plus audio, up to 2K. $0.08/s at 768p.
- **VEED Lipsync v2**, fal `veed/lipsync/v2` (Jul 13): video plus audio. $0.07/s.
- **sync-3**, fal `fal-ai/sync-lipsync/v3` (Apr) and `/v3/image-to-video` (Jun 22). $0.1333/s.
- **Local:** LongCat-Video-Avatar-1.5 (Hugging Face, MIT).

**Upscaling** (empty slot)
- **FLUX Video Upscale**, fal `blackforestlabs/flux-video-upscale` (Aug 20): up to 4K. $0.14–0.79/s.
- **Topaz on fal** (Aug 11): `topaz/upscale/video/generative`, `/precision`, `topaz/sdr-to-hdr/video` and `topaz/interpolate/video`. Its Starlight model costs $1.20 per 10 s up to 1080p.
- **Bria**, fal `bria/increase-resolution` (Sep 7): 2× or 4×, keeps transparency. $0.04.
- **Runway:** `enhance_frame_rate` (Sep 17, up to 120 fps), Ruby SDR-to-HDR (Aug 20), and `magnific_video_upscaler_creative` (Jun 11).

**Reading**
- **Gemini 3.8 Flash**, `gemini-3.8-flash` (Sep): reads video, audio, images and PDFs, 1M context. $0.75/$3.75 per million tokens.
- **Scene Finder**, fal `fal-ai/scene-finder` (Jun 3): you describe a moment in text and it returns the matching time ranges and frames. $0.0042 per second of input video.
- **Local:** `Qwen/Qwen3.8-27B` (Apache-2.0 license, reads images and text).

**Chat**
- **Claude:** Fable 5.1 `claude-fable-5-1` ($10/$50 per million tokens) and Sonnet 5.5 `claude-sonnet-5-5` ($2/$10).
- **OpenAI:** `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`.

## Strongest candidates
1. **Gemini Omni Flash 1.1:** an upgrade of a model the app already has, and it can replace the dead Sora 2 lane.
2. **Eleven v4:** the newest ElevenLabs voice, 72% off until Oct 12.
3. **Gemini 3.8 Flash TTS:** two-speaker dialogue and voice cloning, very cheap, and it uses the same Gemini key as reading.
4. **GPT Image 2.5:** the successor to GPT Image 2.
5. **MiniMax H3 Max:** H3 plus extend, lip-sync and camera paths.
6. **Kling O3 4K edit:** the native 4K successor to the O3 Pro edit the app uses.
7. **Lyria 3.5:** full songs with lyrics for $0.08 each.
8. **Sonilo v1.1 sound effects or Pika Soundtrack:** fills the empty sound-effects slot cheaply.
9. **sync-3 or VEED Lipsync v2:** fills the empty lip-sync slot.
10. **FLUX Video Upscale or Topaz:** fills the empty upscaling slot.

## Sources
- **fal:** api.fal.ai/v1/models (public catalog: slugs, dates, status, inputs) and fal.ai/models/<slug> (prices).
- **ModelArk:** docs.byteplus.com/en/docs/ModelArk/2582774, /1099320, /1330310.
- **Google:** ai.google.dev/gemini-api/docs/pricing, /speech-generation, /omni, /music-generation; blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/.
- **OpenAI:** developers.openai.com/api/docs/deprecations, /api/docs/models; learn.chatgpt.com/docs/auth, /non-interactive-mode, /app-server.
- **Anthropic:** platform.claude.com/docs/en/about-claude/models/overview.
- **ElevenLabs:** elevenlabs.io/docs/overview/models, /docs/changelog, /pricing/api.
- **Runway:** docs.dev.runwayml.com/api/, /api-details/api_changelog/.
- **Astria:** docs.astria.ai/docs/changes/.
- **Magnific:** docs.magnific.com/sitemap.xml.
- **Pika:** pika.art/blog/pika-audio-models, dev.pika.art/pricing, pika.art/mcp.
- **Higgsfield:** higgsfield.ai/mcp, higgsfield.ai/cli.
- **Artlist:** help.artlist.io/hc/en-us/articles/38948588333469.
- **Venice:** docs.venice.ai/llms.txt, /overview/pricing; api.venice.ai/api/v1/models.
- **Suno:** platform.suno.com.
- **DeepSeek:** deepseek.com/en/news/deepseek-v4-1-flash/, api-docs.deepseek.com/quick_start/pricing.
- **Gemini CLI:** geminicli.com/docs/get-started/authentication/, /cli/headless/, /cli/acp-mode/.
- **Hugging Face:** huggingface.co/<repo> for each local model named above.
- **NEWS ONLY:**
  - digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program/
  - techcrunch.com/2026/09/28/elevenlabs-new-v4-speech-model-supports-more-expression-control-and-90-languages/
  - mcp.directory/blog/runway-mcp-complete-guide-2026
