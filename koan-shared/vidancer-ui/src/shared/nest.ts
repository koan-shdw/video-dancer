// NEST (list 3, 2026-09-29): the flatten lives with the timeline math (lib/timelineUtils); main
// reaches it here, through the package's shared/* door — and (list 56) the one reading of a
// remapped block's clock
export { flattenNests, nestLenOf, nestReaches, nestOfAudio, trackKey, remapped, srcAtRel, rateAt, remapAudioOut } from '../lib/timelineUtils'
