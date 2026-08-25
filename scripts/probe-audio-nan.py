# P1 audio-NaN bisect: load the LTX 2.5 audio VAE exactly the way ComfyUI does,
# decode a zero latent, and report the first module whose output goes non-finite.
import os, sys
COMFY = os.path.expandvars(r'%APPDATA%\vi-dancer\runtime\envs\ltx-comfy-engine\ComfyUI')
sys.path.insert(0, COMFY)
import torch
import comfy.sd, comfy.utils

VAE_PATH = os.path.expandvars(r'%APPDATA%\vi-dancer\models\video\ltx-2.5\ltx-2.5-audio-vae-bf16.safetensors')
sd = comfy.utils.load_torch_file(VAE_PATH)
print('tensors:', len(sd), '| any NaN in weights:', any(not torch.isfinite(v.float()).all() for v in sd.values()))
vae = comfy.sd.VAE(sd=sd)
print('vae class:', type(vae.first_stage_model).__name__, '| dtype:', vae.vae_dtype, '| device:', vae.device)

m = vae.first_stage_model
hits = []
def hook(name):
    def fn(mod, inp, out):
        t = out if torch.is_tensor(out) else (out[0] if isinstance(out, (tuple, list)) and torch.is_tensor(out[0]) else None)
        if t is not None and not torch.isfinite(t).all() and len(hits) < 8:
            fin_in = all(torch.isfinite(x).all() for x in inp if torch.is_tensor(x))
            hits.append((name, type(mod).__name__, fin_in))
    return fn
for name, mod in m.named_modules():
    if name:
        mod.register_forward_hook(hook(name))

# the latent shape LTXVEmptyLatentAudio makes for 49 frames @ 24 fps: ask the node's own math
import comfy_extras.nodes_lt_audio as nla
import inspect
src = inspect.getsource(nla.LTXVEmptyLatentAudio.execute)
print('--- empty-latent node source ---')
print(src)
# reproduce it faithfully via the node itself
out = nla.LTXVEmptyLatentAudio.execute.__func__(nla.LTXVEmptyLatentAudio, 49, 24.0, 1, vae)
lat = out.args[0]['samples'] if hasattr(out, 'args') else out[0]['samples']
print('latent shape:', tuple(lat.shape), 'dtype:', lat.dtype, 'finite:', bool(torch.isfinite(lat).all()))

aud = vae.decode(lat)
print('decoded shape:', tuple(aud.shape), 'dtype:', aud.dtype)
fin = torch.isfinite(aud)
print('finite fraction:', float(fin.float().mean()))
print('--- first non-finite modules (name, type, inputs_were_finite) ---')
for h in hits:
    print(' ', h)
if not hits and float(fin.float().mean()) < 1.0:
    print('  (NaN appeared outside hooked modules — top-level op)')
