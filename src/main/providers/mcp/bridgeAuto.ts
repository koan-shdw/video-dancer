// Bridge AUTO router (BRIDGE-SPEC-2026-09-01 §3.3) — the user picked the MODEL and said "any of
// my accounts": the router picks the ACCOUNT, never the model. Candidates = logged-in services
// whose registry carries this model family; order = most credits first (rate tables aren't
// measured yet — his ruling allowed my call), unknown balance last. A failure that smells like
// "out of credit / wrong plan" falls through to the next account ONCE PER ACCOUNT, and the queue
// row says so; any other failure stops honestly. The chosen account is named in the row.
// List 33: a supplier with several logins counts here by the one that would pay (its fullest), and
// its adapter runs through its own logins before this router moves to the next supplier.
import type { RenderOutput } from '../../fal'
import type { EngineId, BridgeServiceId } from '@koan/vidancer-ui/shared/types'
import { modelFor } from '@koan/vidancer-ui/shared/models'
import { bridgeReady, bridgeBalance, bridgeKey, CREDIT_SMELL } from '../../bridge'
import { runVeniceRender, veniceLane } from '../venice'
import { runHfMcpRender, type HfMcpRenderOpts } from './higgsfieldMcp'
import { runRunwayMcpRender } from './runwayMcp'
import { runMagnificMcpRender } from './magnificMcp'
import { runPikaMcpRender } from './pikaMcp'

// family → per-service concrete engine (the service adapters read model ids off THESE engines)
const FAMILY_LANES: Record<string, Partial<Record<BridgeServiceId, EngineId>>> = {
  seedance2bridge: {
    higgsfield: 'seedance2hfmcp',
    runway: 'seedance2runway',
    magnific: 'seedance2mag',
    pika: 'seedance2pika',
    venice: 'seedance2venice' // the quality engine — the router never picks the fast tier on its own
  },
  seedance25bridge: {
    higgsfield: 'seedance25hfmcp',
    runway: 'seedance25runway',
    magnific: 'seedance25mag',
    venice: 'seedance25venice'
  }
}

const LABEL: Record<string, string> = { higgsfield: 'Higgsfield', runway: 'Runway', magnific: 'Magnific', pika: 'Pika', venice: 'Venice' }

export async function runBridgeAutoRender(opts: HfMcpRenderOpts): Promise<RenderOutput> {
  const lanes = FAMILY_LANES[opts.engine ?? '']
  if (!lanes) throw new Error(`Bridge auto doesn't cover ${opts.engine}`)
  const hasRefs = opts.mode === 'ref2v' && !!(opts.images.length || opts.videos?.length || opts.audios?.length)
  const candidates = (Object.entries(lanes) as [BridgeServiceId, EngineId][])
    .filter(([svc]) => bridgeReady(svc))
    // never route refs to a lane that can't carry them — a silently dropped ref is a wrong render
    .filter(([, engineId]) => !hasRefs || modelFor(engineId).maxRefImages > 0)
    // most credits first; unknown balance last (they still get a turn — unknown ≠ empty)
    .sort(([a], [b]) => (bridgeBalance(b) ?? -1) - (bridgeBalance(a) ?? -1))
  if (!candidates.length) throw new Error('Bridge auto: no logged-in account serves this model — log in on the Bridge panel')

  let lastErr: unknown
  for (let i = 0; i < candidates.length; i++) {
    const [svc, engineId] = candidates[i]
    opts.onProgress?.(`Bridge → ${LABEL[svc]}…`)
    const laneOpts = { ...opts, engine: engineId }
    try {
      if (svc === 'runway') return await runRunwayMcpRender(laneOpts)
      if (svc === 'magnific') return await runMagnificMcpRender(laneOpts)
      if (svc === 'pika') return await runPikaMcpRender(laneOpts)
      if (svc === 'venice') return await runVeniceRender({ ...laneOpts, ...veniceLane(engineId, opts.mode, opts.mode === 'i2v' || hasRefs), veniceKey: bridgeKey('venice') ?? '' })
      return await runHfMcpRender(laneOpts)
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      // fall through ONLY on money/plan refusals, and only while accounts remain
      if (i < candidates.length - 1 && CREDIT_SMELL.test(msg)) {
        opts.onProgress?.(`${LABEL[svc]} declined (${msg.slice(0, 80)}) — trying ${LABEL[candidates[i + 1][0]]}…`)
        continue
      }
      throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Bridge auto: every account declined')
}
