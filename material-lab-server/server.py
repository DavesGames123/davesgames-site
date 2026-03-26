"""
Material Lab — local inference server.
BiRefNet segmentation · Depth Anything V2 · Normal maps · PBR estimation.
"""
import io, base64, logging
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from scipy.ndimage import sobel, gaussian_filter, uniform_filter
import torch, uvicorn

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("material-lab")

app = FastAPI(title="Material Lab")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_models = {}

def get_seg():
    if "seg" not in _models:
        log.info("Loading BiRefNet…")
        from transformers import pipeline
        _models["seg"] = pipeline("image-segmentation", model="ZhengPeng7/BiRefNet",
                                  trust_remote_code=True, device=0 if torch.cuda.is_available() else -1)
        log.info("BiRefNet ready.")
    return _models["seg"]

def get_depth():
    if "depth" not in _models:
        log.info("Loading Depth Anything V2 Large…")
        from transformers import pipeline
        _models["depth"] = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Large-hf",
                                    device=0 if torch.cuda.is_available() else -1)
        log.info("Depth Anything V2 ready.")
    return _models["depth"]

def pil_b64(img, fmt="PNG"):
    buf = io.BytesIO(); img.save(buf, format=fmt); return base64.b64encode(buf.getvalue()).decode()

def read_upload(raw): return Image.open(io.BytesIO(raw)).convert("RGB")

def depth_to_normals(d, strength=1.0):
    f = gaussian_filter(d.astype(np.float64), sigma=0.8)
    dx, dy = sobel(f, axis=1)*strength, sobel(f, axis=0)*strength
    n = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-8)
    return ((n*0.5+0.5)*255).astype(np.uint8)

def est_roughness(a):
    g = np.mean(a.astype(np.float64), axis=-1)
    v = np.clip(uniform_filter(g**2, 9) - uniform_filter(g, 9)**2, 0, None)
    r = np.sqrt(v); r = np.clip(r/(r.max()+1e-8), 0.05, 0.98)
    return (gaussian_filter(r, 2)*255).astype(np.uint8)

def est_metallic(a):
    f = a.astype(np.float64)/255.0
    mx = f.max(axis=-1); mn = f.min(axis=-1)
    sat = np.where(mx>1e-8, (mx-mn)/mx, 0)
    m = np.clip(mx*0.3 + (1-sat)*0.15, 0, 0.6)
    return (gaussian_filter(m, 3)*255).astype(np.uint8)

def est_ao(d):
    f = (d.astype(np.float64)-d.min()) / (d.max()-d.min()+1e-8)
    ao = np.clip(1.0 - (gaussian_filter(f, 12)-f)*3.0, 0.3, 1.0)
    return (gaussian_filter(ao, 2)*255).astype(np.uint8)

@app.post("/segment")
async def segment(file: UploadFile = File(...)):
    try:
        img = read_upload(await file.read())
        r = get_seg()(img)
        mask = (r[0]["mask"] if isinstance(r, list) else r["mask"])
        if not isinstance(mask, Image.Image): mask = Image.fromarray(np.array(mask))
        mask = mask.convert("L").resize(img.size, Image.BILINEAR)
        return JSONResponse({"mask": pil_b64(mask), "width": img.size[0], "height": img.size[1]})
    except Exception as e: log.exception("segment"); raise HTTPException(500, str(e))

@app.post("/depth")
async def depth(file: UploadFile = File(...)):
    try:
        img = read_upload(await file.read())
        d = get_depth()(img)["depth"]
        if not isinstance(d, Image.Image): d = Image.fromarray(np.array(d))
        d = d.convert("L").resize(img.size, Image.BILINEAR)
        return JSONResponse({"depth": pil_b64(d), "width": img.size[0], "height": img.size[1]})
    except Exception as e: log.exception("depth"); raise HTTPException(500, str(e))

@app.post("/normals")
async def normals(file: UploadFile = File(...), strength: float = 2.0):
    try:
        img = read_upload(await file.read())
        d = get_depth()(img)["depth"]
        if isinstance(d, Image.Image): dn = np.array(d.convert("L").resize(img.size, Image.BILINEAR))
        else: dn = np.array(d); dn = dn[:,:,0] if dn.ndim==3 else dn
        nm = depth_to_normals(dn, strength)
        return JSONResponse({"normals": pil_b64(Image.fromarray(nm)), "depth": pil_b64(Image.fromarray(dn)),
                             "width": img.size[0], "height": img.size[1]})
    except Exception as e: log.exception("normals"); raise HTTPException(500, str(e))

@app.post("/pbr")
async def pbr(file: UploadFile = File(...)):
    try:
        img = read_upload(await file.read())
        an = np.array(img)
        log.info("PBR: segmentation…")
        sr = get_seg()(img)
        mask = (sr[0]["mask"] if isinstance(sr, list) else sr["mask"])
        if not isinstance(mask, Image.Image): mask = Image.fromarray(np.array(mask))
        mask = mask.convert("L").resize(img.size, Image.BILINEAR)
        log.info("PBR: depth…")
        d = get_depth()(img)["depth"]
        if isinstance(d, Image.Image): dn = np.array(d.convert("L").resize(img.size, Image.BILINEAR))
        else: dn = np.array(d); dn = dn[:,:,0] if dn.ndim==3 else dn
        log.info("PBR: normals + roughness + metallic + AO…")
        nm = depth_to_normals(dn, 2.0)
        return JSONResponse({
            "albedo":    pil_b64(img),
            "mask":      pil_b64(mask),
            "depth":     pil_b64(Image.fromarray(dn)),
            "normals":   pil_b64(Image.fromarray(nm)),
            "roughness": pil_b64(Image.fromarray(est_roughness(an))),
            "metallic":  pil_b64(Image.fromarray(est_metallic(an))),
            "ao":        pil_b64(Image.fromarray(est_ao(dn))),
            "width": img.size[0], "height": img.size[1],
        })
    except Exception as e: log.exception("pbr"); raise HTTPException(500, str(e))

@app.get("/health")
async def health(): return {"status": "ok", "cuda": torch.cuda.is_available()}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787)
