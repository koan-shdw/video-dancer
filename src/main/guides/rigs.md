# Director rigs — camera · action · VFX vocabulary

Where this comes from: the Director Window (Night Shift v1.2, August 2026 cohort call) and
§8 of his Seedance 2.5 knowledge base. His problem, his words: "I know what I want to see, but I
don't know the proper way to articulate it." This file is the film language, so when the user
says "make it feel like the Matrix hallway" you reach for the right move by name and can explain
it in one plain line. You do not need a menu; the user talks, you pick. When a move is unusual,
name it AND translate it to what is visibly on screen (his formula: Term + Target Subject +
Visual Change + Foreground/Background Relationship + Direction/Speed).

## The five camera laws (govern every `camera` field — his §8.1, verbatim where it matters)

1. **One primary move per shot.** Optionally one secondary using "then." Never three or more —
   the model jitters trying to satisfy competing instructions.
   DO: `Slow push-in, low angle.` · `Handheld tracking, then gentle rise.` · `Static wide. Hold.`
2. **Rhythm words, not specs.** slow / smooth / gentle / gradual / controlled / steady /
   imperceptible / swift (sparingly). NOT 24fps, f/2.8, ISO 800, 85mm, 1/50. Specs may sit in
   `style` as an aesthetic anchor ("35mm film tone") but never drive camera behaviour.
3. **Speed asymmetry, PER BEAT.** Never fast camera + fast action + complex scene in the same
   beat. Fast action → slow camera. Dynamic camera → deliberate action. Complex scene (crowd,
   particles) → both slow. One speed axis fast at a time — per beat, never clip-wide.
4. **Separate camera from subject.** `camera: "Fixed wide. Hold."` + `action: "The dancer spins
   slowly across frame."` — never "spinning camera around a dancing person."
5. **Camera movement is a spent resource — but spent ≠ absent.** Spend real moves on beats that
   earn them so they read as hits. Never a whole-clip doctrine either way: "moves every beat"
   blurs the punches; "locked throughout" is a slideshow. Fights: the camera STATE changes every
   beat and mostly moves, with a locked frame reserved for ONE impact.

## Position and angle — PICK ONE EVERY BEAT (his §8.3)

Set the position BEFORE the movement. A beat that names no position defaults to a bland
eye-level medium — the single most common cause of a stale clip.
Extreme macro close-up · Low tabletop angle · Over-the-shoulder · High-angle master · Dutch angle ·
First-person POV · Low angle looking up · Medium two-shot · Wide establishing · Overhead top-down ·
90-degree side profile at ground level · Extreme low-angle worm's-eye · Inverted (upside-down) ·
Lateral side-view two-shot.

**Framing rotation (his "weirdness engine"):** never repeat a framing twice in one clip. It is
anti-drift (a composition the reference image cannot fit into cannot be hijacked by it) and
creative pressure (no eye-level medium by reflex).

## Camera rig — the menus, with what each looks like

**Bodies / travel**
- push-in / dolly in — the camera glides toward the subject; the frame tightens, the background
  falls away. Emotional focus.
- pull-out / dolly out — the reverse: the world around the subject is revealed.
- pan / lateral — the camera turns or slides sideways across the scene; scanning, tracking.
- tracking / follow — the camera keeps pace with a moving subject, ahead, beside or behind.
- orbit / arc — the camera circles the subject at a steady rate, subject centred; portraits,
  reveals, product.
- crane / boom — the camera rises or descends on a vertical sweep; dramatic transitions, scale.
- tilt — the camera pivots up or down from a fixed spot; reveals height.
- handheld — visible human shake; documentary realism. Say how much shake and who it follows.
- locked / fixed — no movement at all. The rationed hold: one per clip, on the beat that earns it.

**Aerial** — drone height and direction: a slow high drift over the landscape, a dive toward a
rooftop, an FPV flight that banks through a gap (name the path, the speed, the turns).

**Robotic**
- bullet time — the action freezes or crawls while the camera sweeps around it. Say what freezes
  and which way the orbit goes.
- speed whip — a violent whip-pan that lands hard on a new subject; the blur is the cut.
- pendulum rig — the camera swings on an arc like a pendulum, passing the subject at the bottom
  of the swing and rising away; a rhythmic, physical move.
- bounce speed-ramp — the move accelerates, decelerates, rebounds; say where it speeds, slows,
  and where it comes to rest.

**Optics**
- 18–24mm wide — everything in the frame, edges stretch, the subject small in a big space.
- 85mm portrait — the face fills the frame, the background melts to soft shapes.
- dolly zoom — the subject stays the same size while the background rushes closer or farther
  (say which). Vertigo, dread.
- rack focus — focus slides from one thing to another: the foreground goes soft as the face
  behind it goes sharp. Say from what, to what. (Seedance 2.5 understands this; 2.0 tends to
  render it as a push-in.)
- tilt shift — only a thin band of the frame is sharp; the world reads as a miniature.
- one-take / oner — one continuous camera through several spaces or events; name what it
  passes.

**Impossible** — moves no real camera can do: the camera passes through a wall or a keyhole,
shrinks to fly between fingers, tracks a bullet, circles a falling drop, rises through a floor.
Describe the path as if it were real; the model can do it.

## Action rig — moves to name when the user wants "a fight" or "a dance"

- one-versus-many gauntlet — a single fighter moves through a line of opponents, each dispatched
  in turn as the camera keeps pace.
- head snap and whiplash — the impact lands, the head snaps away, the body follows a beat later.
- air juggle — the target is lifted off the ground by one hit and kept aloft by the next.
- shockwave punch — the strike lands and a visible ring of force ripples outward through dust,
  water or air.
- pose-holds freeze fights — so blocking sheets are never used for fight beats.
For dance: the move is the body's, the camera keeps pace or orbits; a video reference (depth map
when identity must not bleed) drives the exact routine.

## VFX rig — lighting and effects to name

- muzzle flash — a hard, brief flare at the barrel that lights the face for one frame.
- god rays — shafts of light through dust, smoke or leaves, volumetric, from one bright source.
- laser grid — thin coloured beams crossing the space in a lattice.
- scan-line sweep — a horizontal line of light travels down the frame like a monitor refresh.
- bloom spread — his own hover text: "Small circular colonies appear scattered across the surface.
  Not one, many. Each slightly raised disk of wrong colour."
- wet ground doubling — the floor is wet enough to mirror the subject and every light.
- lens effects live in `visual_feel` or `vfx`, never crammed into `camera`: focus rack · shallow
  DOF with soft bokeh · anamorphic streak flares · film grain · motion blur · edge distortion.

## Lighting is a per-shot lever (his §8.7)

Every beat gets a `lighting` note when it changes from the baseline — "warm golden backlight,"
"single red overhead wash," "headlight rim through rain." The cheapest way to make a beat feel
like a new shot without spending a camera move. High-impact words: hard side-key · rim/backlight
· single practical source · overhead wash · underlight · bounce fill · silhouette against a bright
field · volumetric shaft · coloured gel wash · firelight flicker.

## Intensity

The user's INTENSITY dial (1–5, auto) is how HARD you write a move, never how many moves. At 1 a
push-in is "a slow push-in"; at 5 it is the whole beat's language — the floorboards, the breath,
the frame closing like a hand. Same one move.

## Seedance 2.5 additions (his §8.6)

2.5 reasons about 3D space: you can change the angle on an existing shot ("convert to
first-person POV") and it extrapolates off-screen detail. With a `@video` reference it inherits
camera language + emotional atmosphere + rhythm, not only body motion — say which layer to
inherit ("inherit @video1's camera trajectory and colour logic") rather than re-describing the
motion. Official glossary it answers to directly: shot size (extreme wide · wide · medium ·
close-up · extreme close-up) · movement (push in · pull out · pan · lateral move · follow · orbit
· dive · dolly out · tilt up · handheld shake) · viewpoint (low angle · overhead · first-person).
Numbers are allowed but the visible result reads clearer than the spec.
