import os
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

"""
Material Lab — local inference server.
BiRefNet on CPU, Depth Anything V2 on best device.
"""
import io, base64, logging
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from scipy.ndimage import sobel, gaussian_filter, uniform_filter
import torch
import uvicorn

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("material-lab")

app = FastAPI(title="Material Lab")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_models = {}
_device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
log.info(f"Device: {_device}")

def get_seg():
    if "seg_model" not in _models:
        log.info("Loading BiRefNet…")
        from transformers import AutoModelForImageSegmentation
        from torchvision import transforms
        model = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True)
        model.to("cpu")
        model.eval()
        _models["seg_model"] = model
        _models["seg_transform"] = transforms.Compose([
            transforms.Resize((1024, 1024)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        log.info("BiRefNet ready (CPU).")
    return _models["seg_model"], _models["seg_transform"]

def run_birefnet(img):
    model, transform = get_seg()
    w, h = img.size
    input_tensor = transform(img).unsqueeze(0).to("cpu")
    with torch.no_grad():
        preds = model(input_tensor)[-1]
    pred = torch.sigmoid(preds[0, 0])
    pred_np = (pred.cpu().numpy() * 255).astype(np.uint8)
    return Image.fromarray(pred_np).resize((w, h), Image.BILINEAR)

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

def read_upload(raw):
    return Image.open(io.BytesIO(raw)).convert("RGB")

def depth_to_normals(d, strength=1.0, smooth=1.0):
    """Compute normal map from depth. smooth=gaussian sigma before Sobel."""
    f = d.astype(np.float64)
    # Pre-smooth to reduce hard-edge artifacts (don't normalize range — kills gradients)
    if smooth > 0:
        f = gaussian_filter(f, sigma=max(smooth, 0.1))
    # Sobel gradients
    dx = sobel(f, axis=1)
    dy = sobel(f, axis=0)
    # Scale: strength controls how pronounced the normals are
    # Adaptive scale based on gradient magnitude so strength=1 gives reasonable results
    grad_mag = np.sqrt(dx * dx + dy * dy)
    p95 = np.percentile(grad_mag[grad_mag > 0], 95) if np.any(grad_mag > 0) else 1.0
    scale = strength / max(p95, 1e-8)
    dx = dx * scale
    dy = dy * scale
    # Build normal vectors (z=1 is the flat-surface base)
    n = np.stack([-dx, dy, np.ones_like(dx)], axis=-1)
    # Normalize
    length = np.sqrt(np.sum(n * n, axis=-1, keepdims=True))
    n = n / np.maximum(length, 1e-8)
    # Encode to 0-255
    out = np.clip(n * 0.5 + 0.5, 0.0, 1.0)
    return (out * 255).astype(np.uint8)

def est_roughness(a):
    g = np.mean(a.astype(np.float64), axis=-1)
    v = np.clip(uniform_filter(g**2, 9) - uniform_filter(g, 9)**2, 0, None)
    r = np.sqrt(v); r = np.clip(r / (r.max() + 1e-8), 0.05, 0.98)
    return (gaussian_filter(r, 2) * 255).astype(np.uint8)

def est_metallic(a):
    f = a.astype(np.float64) / 255.0
    mx = f.max(axis=-1); mn = f.min(axis=-1)
    sat = np.where(mx > 1e-8, (mx - mn) / mx, 0)
    m = np.clip(mx * 0.3 + (1 - sat) * 0.15, 0, 0.6)
    return (gaussian_filter(m, 3) * 255).astype(np.uint8)

def est_ao(d):
    f = (d.astype(np.float64) - d.min()) / (d.max() - d.min() + 1e-8)
    ao = np.clip(1.0 - (gaussian_filter(f, 12) - f) * 3.0, 0.3, 1.0)
    return (gaussian_filter(ao, 2) * 255).astype(np.uint8)

def run_depth(img):
    """Returns (float_depth, uint8_depth). Float is used for normals, uint8 for display/saving."""
    pipe = get_depth()
    result = pipe(img)
    w, h = img.size

    # Get raw float prediction (before quantization)
    raw = None
    if "predicted_depth" in result:
        import torch as _t
        pd = result["predicted_depth"]
        if isinstance(pd, _t.Tensor):
            raw = pd.squeeze().cpu().numpy().astype(np.float64)
        else:
            raw = np.array(pd, dtype=np.float64)
            if raw.ndim == 3:
                raw = raw[:, :, 0]
        # Resize to original image size
        from PIL import Image as _Im
        raw_pil = _Im.fromarray(raw.astype(np.float32), mode='F')
        raw = np.array(raw_pil.resize((w, h), _Im.BILINEAR), dtype=np.float64)

    # Get uint8 for display
    d = result["depth"]
    if isinstance(d, Image.Image):
        uint8 = np.array(d.convert("L").resize((w, h), Image.BILINEAR))
    else:
        uint8 = np.array(d)
        if uint8.ndim == 3:
            uint8 = uint8[:, :, 0]

    # If we didn't get raw, derive from uint8 (fallback)
    if raw is None:
        raw = uint8.astype(np.float64)

    return raw, uint8

@app.post("/segment")
async def segment(file: UploadFile = File(...)):
    try:
        img = read_upload(await file.read())
        mask = run_birefnet(img)
        return JSONResponse({"mask": pil_b64(mask), "width": img.size[0], "height": img.size[1]})
    except Exception as e:
        log.exception("segment"); raise HTTPException(500, str(e))

@app.post("/depth")
async def depth(file: UploadFile = File(...)):
    try:
        img = read_upload(await file.read())
        raw, dn = run_depth(img)
        return JSONResponse({"depth": pil_b64(Image.fromarray(dn)), "width": img.size[0], "height": img.size[1]})
    except Exception as e:
        log.exception("depth"); raise HTTPException(500, str(e))

@app.post("/normals")
async def normals(file: UploadFile = File(...), strength: float = 2.0, smooth: float = 2.0):
    try:
        img = read_upload(await file.read())
        raw, dn = run_depth(img)
        nm = depth_to_normals(raw, strength, smooth)
        return JSONResponse({"normals": pil_b64(Image.fromarray(nm)), "depth": pil_b64(Image.fromarray(dn)),
                             "width": img.size[0], "height": img.size[1]})
    except Exception as e:
        log.exception("normals"); raise HTTPException(500, str(e))

@app.post("/normals-from-depth")
async def normals_from_depth(file: UploadFile = File(...), strength: float = 2.0, smooth: float = 2.0):
    try:
        depth_img = Image.open(io.BytesIO(await file.read())).convert("L")
        dn = np.array(depth_img)
        nm = depth_to_normals(dn.astype(np.float64), strength, smooth)
        return JSONResponse({"normals": pil_b64(Image.fromarray(nm)), "width": depth_img.size[0], "height": depth_img.size[1]})
    except Exception as e:
        log.exception("normals-from-depth"); raise HTTPException(500, str(e))

@app.post("/pbr")
async def pbr(file: UploadFile = File(...)):
    try:
        img = read_upload(await file.read())
        an = np.array(img)
        log.info("PBR: segmentation…"); mask = run_birefnet(img)
        log.info("PBR: depth…"); raw, dn = run_depth(img)
        log.info("PBR: normals + roughness + metallic + AO…"); nm = depth_to_normals(raw, 2.0, 1.0)
        return JSONResponse({
            "albedo": pil_b64(img), "mask": pil_b64(mask), "depth": pil_b64(Image.fromarray(dn)),
            "normals": pil_b64(Image.fromarray(nm)), "roughness": pil_b64(Image.fromarray(est_roughness(an))),
            "metallic": pil_b64(Image.fromarray(est_metallic(an))), "ao": pil_b64(Image.fromarray(est_ao(dn))),
            "width": img.size[0], "height": img.size[1],
        })
    except Exception as e:
        log.exception("pbr"); raise HTTPException(500, str(e))

@app.get("/health")
async def health():
    return {"status": "ok", "device": _device}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8787)