# Export the Chronos-Bolt and Chronos-2 core networks to ONNX.
# Scaling, patching, time encoding, and the inverse scaling stay outside the
# graph (the page does them in JS: model-io.js). The graph takes patched,
# scaled inputs and returns scaled quantiles.
import sys, os, json, math
import numpy as np
import torch
import torch.nn as nn

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
torch.manual_seed(0)


class BoltCore(nn.Module):
    """patched (B,N,2P) = [values, mask], attn (B,N) -> scaled quantiles (B,Q,H)"""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, patched, attn):
        m = self.m
        B = patched.shape[0]
        emb = m.input_patch_embedding(patched)
        reg = m.shared.weight[1].view(1, 1, -1).expand(B, 1, -1)
        emb = torch.cat([emb, reg], dim=1)
        am = torch.cat([attn, torch.ones(B, 1, dtype=attn.dtype)], dim=1)
        h = m.encoder(attention_mask=am, inputs_embeds=emb)[0]
        dec_in = m.shared.weight[m.config.decoder_start_token_id].view(1, 1, -1).expand(B, 1, -1)
        d = m.decoder(inputs_embeds=dec_in, encoder_hidden_states=h,
                      encoder_attention_mask=am, return_dict=True).last_hidden_state
        q = m.output_patch_embedding(d)
        return q.view(B, m.num_quantiles, m.chronos_config.prediction_length)


class C2Core(nn.Module):
    """ctx (B,Nc,3P), ctx_mask (B,Nc), fut (B,Nf,3P), group_ids (B,) int64
       -> scaled quantiles (B,Q,Nf*P), before sinh and the loc/scale inverse"""
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, ctx, ctx_mask, fut, group_ids):
        m = self.m
        B, Nf = fut.shape[0], fut.shape[1]
        emb = m.input_patch_embedding(ctx)
        reg = m.shared.weight[1].view(1, 1, -1).expand(B, 1, -1)
        femb = m.input_patch_embedding(fut)
        x = torch.cat([emb, reg, femb], dim=1)
        am = torch.cat([ctx_mask, torch.ones(B, 1 + Nf, dtype=ctx_mask.dtype)], dim=1)
        h = m.encoder(attention_mask=am, inputs_embeds=x, group_ids=group_ids).last_hidden_state
        fe = h[:, -Nf:]
        q = m.output_patch_embedding(fe)  # (B, Nf, Q*P)
        Q, P = m.num_quantiles, m.chronos_config.output_patch_size
        q = q.view(B, Nf, Q, P).permute(0, 2, 1, 3).reshape(B, Q, Nf * P)
        return q


def export(core, args, names, dyn, path):
    torch.onnx.export(core, args, path, input_names=names, output_names=['quantiles'],
                      dynamic_axes=dyn, opset_version=17, dynamo=False, do_constant_folding=True)
    print('exported', path, os.path.getsize(path) / 1e6, 'MB')


def main():
    from chronos import BaseChronosPipeline
    which = sys.argv[2:] or ['bolt-tiny', 'bolt-mini', 'c2-small']
    repos = {'bolt-tiny': 'amazon/chronos-bolt-tiny', 'bolt-mini': 'amazon/chronos-bolt-mini',
             'bolt-small': 'amazon/chronos-bolt-small', 'c2-small': 'autogluon/chronos-2-small'}
    for key in which:
        kw = {'attn_implementation': 'eager'} if key.startswith('c2') else {}
        pipe = BaseChronosPipeline.from_pretrained(repos[key], device_map='cpu', torch_dtype=torch.float32, **kw)
        m = pipe.model.eval()
        if key.startswith('c2'):
            m.config._attn_implementation = 'eager'
            for mod in m.modules():
                if hasattr(mod, 'config') and hasattr(mod.config, '_attn_implementation'):
                    mod.config._attn_implementation = 'eager'
        P = 16
        with torch.no_grad():
            if key.startswith('bolt'):
                core = BoltCore(m).eval()
                B, N = 2, 8
                args = (torch.randn(B, N, 2 * P), torch.ones(B, N))
                export(core, args, ['patched', 'attn'],
                       {'patched': {0: 'B', 1: 'N'}, 'attn': {0: 'B', 1: 'N'}, 'quantiles': {0: 'B'}},
                       f'{OUT}/{key}.fp32.onnx')
            else:
                core = C2Core(m).eval()
                B, Nc, Nf = 3, 8, 2
                args = (torch.randn(B, Nc, 3 * P), torch.ones(B, Nc), torch.randn(B, Nf, 3 * P),
                        torch.tensor([0, 0, 1], dtype=torch.int64))
                export(core, args, ['ctx', 'ctx_mask', 'fut', 'group_ids'],
                       {'ctx': {0: 'B', 1: 'Nc'}, 'ctx_mask': {0: 'B', 1: 'Nc'}, 'fut': {0: 'B', 1: 'Nf'},
                        'group_ids': {0: 'B'}, 'quantiles': {0: 'B', 2: 'H'}},
                       f'{OUT}/{key}.fp32.onnx')
        cfg = dict(m.chronos_config.__dict__)
        json.dump(cfg, open(f'{OUT}/{key}.config.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
