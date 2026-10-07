// cfweb.cpp
// Context Free for the web: the WebAssembly shim
// ---------------------
// Copyright (C) 2026 davesgames.io
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program (COPYING in the page directory).
//
// ---------------------------------------------------------------------------
// This file is our own code. It replaces src-unix/main.cpp, posixSystem.cpp
// and pngCanvas.cpp of Context Free (Mark Lentczner and John Horigan) with
// a small C API for JavaScript. The engine itself (src-common, src-agg) is
// the upstream code, with the patches in ../patches.
//
// FLOW (the same as the Context Free GUI, src-osx/GView.mm):
//   cf_parse(variation, defs)     CFDG::ParseFile on /work/main.cfdg (JS
//                                 writes the file into MEMFS first)
//   cf_render(...)                design->renderer(), a canvas the size of
//                                 the renderer, then renderer->run(canvas,
//                                 partial), or renderer->animate(canvas,
//                                 frames, frame, zoom). One parse gives one
//                                 renderer, so a second one (tiles, SVG
//                                 after a render) parses the file again.
//   cf_render_svg(...)            renderer->run(nullptr), then draw() into
//                                 the upstream SVGCanvas
//
// CALLBACKS to JavaScript (EM_JS, Module.cfHooks):
//   progress(shapes, todo, inOutput, done, count) -> 0 go on, 1 finish
//                                 up (draw what is there), 2 stop now
//   frame(ptr, w, h, index)       a partial or animation frame, RGBA8, not
//                                 premultiplied, top row first
//   message(text)                 an engine message
//   diag(line, col, eline, ecol, isError, file, text)
//
// GREP MAP
//   grep -n 'class WebSystem'        the AbstractSystem of the web
//   grep -n 'class WebCanvas'        the raster canvas (abstractPngCanvas)
//   grep -n 'cfdgWebTick'            the time tick of patch 0001
//   grep -n 'EMSCRIPTEN_KEEPALIVE'   every exported function
// ---------------------------------------------------------------------------

#include <emscripten.h>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <memory>

#include "cfdg.h"
#include "aggCanvas.h"
#include "abstractPngCanvas.h"
#include "SVGCanvas.h"
#include "variation.h"
#include "astexpression.h"
#include "agg2/agg_trans_affine.h"

// ── JavaScript hooks ────────────────────────────────────────────────────────
EM_JS(int, cfjs_progress, (int shapes, int todo, int inOutput, int done, int count), {
  const h = Module.cfHooks; return h && h.progress ? (h.progress(shapes, todo, inOutput, done, count) | 0) : 0;
});
EM_JS(void, cfjs_frame, (const unsigned char* ptr, int w, int h, int index), {
  const k = Module.cfHooks; if (k && k.frame) k.frame(ptr, w, h, index);
});
EM_JS(void, cfjs_message, (const char* text), {
  const h = Module.cfHooks; if (h && h.message) h.message(UTF8ToString(text));
});
EM_JS(void, cfjs_diag, (int line, int col, int eline, int ecol, int isError, const char* file, const char* text), {
  const h = Module.cfHooks; if (h && h.diag) h.diag(line, col, eline, ecol, isError, UTF8ToString(file), UTF8ToString(text));
});
EM_JS(double, cfjs_now, (), { return performance.now(); });

// ── state ───────────────────────────────────────────────────────────────────
static Renderer* gRenderer = nullptr;   // the renderer that runs now
static double gTickMs = 120.0;          // partial frame interval (0 = off)
static double gLastTick = 0.0;
static unsigned gTickCount = 0;
static bool gStopped = false;           // a hook asked for a stop
static bool gFinished = false;          // a hook asked to finish up
static double gOutputCost = 0.0;        // ms of the last partial output

// Patch 0001 calls this once per expansion step and once per drawn shape.
// It reads the clock once in 256 calls, so the cost stays small.
extern "C" int cfdgWebTick(void)
{
    if (gTickMs <= 0.0 || (++gTickCount & 255u)) return 0;
    double now = cfjs_now();
    // A partial output draws every finished shape again. When it gets slow,
    // the ticks get further apart, so the expansion keeps most of the time.
    if (now - gLastTick < std::max(gTickMs, 3.0 * gOutputCost)) return 0;
    gLastTick = now;
    return 1;
}

// ── WebSystem ───────────────────────────────────────────────────────────────
class WebSystem : public AbstractSystem {
public:
    bool mErrorMode = false;
    bool mPendingError = false;
    int mErrors = 0;
    std::vector<char> buf;
    int mTempCount = 0;

    void message(const char* fmt, ...) override
    {
        std::va_list a1;
        va_start(a1, fmt);
        std::va_list a2;
        va_copy(a2, a1);
        std::size_t sz = 1 + std::vsnprintf(nullptr, 0, fmt, a1);
        va_end(a1);
        if (sz > buf.size()) buf.resize(2 * sz);
        std::vsnprintf(buf.data(), buf.size(), fmt, a2);
        va_end(a2);
        // ParseFile tries version 2 syntax first. Diagnostics of that try
        // are not real, so the JS side clears them on this message.
        cfjs_message(buf.data());
        // The renderer reports some errors as error() then message(), with
        // no location ("Shape with no rules encountered: X").
        if (mPendingError && std::strncmp(buf.data(), "Restarting", 10) != 0) {
            cfjs_diag(0, 0, 0, 0, 1, "", buf.data());
            ++mErrors;
            mPendingError = false;
        }
    }
    void syntaxError(const CfdgError& err) override
    {
        auto& w = err.where;
        const char* file = w.end.filename && !w.end.filename->empty()
                           ? w.end.filename->c_str() : "";
        cfjs_diag(w.begin.line, w.begin.column, w.end.line, w.end.column,
                  mPendingError ? 1 : 0, file, err.what());
        if (mPendingError) ++mErrors;
        mPendingError = false;
    }
    bool error(bool errorOccurred = true) override
    {
        if (errorOccurred) { mErrorMode = true; mPendingError = true; }
        return mErrorMode;
    }
    void catastrophicError(const char* what) override
    {
        mErrorMode = true;
        ++mErrors;
        cfjs_diag(0, 0, 0, 0, 1, "", what);
    }
    bool isGuiProgram() override { return true; }

    // Temp files live in MEMFS. With max shapes capped below the 2M shape
    // limit of getPhysicalMemory() == 0, the renderer does not use them.
    ostr_ptr tempFileForWrite(TempType tt, FileString& nameOut) override
    {
        nameOut = std::string("/tmp/") + TempPrefixes[tt] + std::to_string(++mTempCount) + TempSuffixes[tt];
        auto f = std::make_unique<std::ofstream>(nameOut, std::ios::binary | std::ios::trunc | std::ios::out);
        if (!f->is_open()) return nullptr;
        return f;
    }
    const FileChar* tempFileDirectory() override { return "/tmp"; }
    std::string tempDirectoryForWrite(const char* prefix) override
    {
        return std::string("/tmp/") + prefix + std::to_string(++mTempCount);
    }
    std::vector<FileString> findTempFiles() override { return {}; }
    int deleteTempFile(const FileString& name) override { return std::remove(name.c_str()); }
    std::size_t getPhysicalMemory() override { return 0; }

    std::string relativeFilePath(const std::string& base, const std::string& rel) override
    {
        std::string s = base;
        auto i = s.rfind('/');
        if (i == std::string::npos) return rel;
        i += 1;
        s.replace(i, s.length() - i, rel);
        return s;
    }

    // UTF-8 to UTF-32. The posix build also applies ICU NFKC; we do not
    // ship ICU, so two names that differ only in NFKC form stay distinct.
    std::wstring normalize(const std::string& s) override
    {
        std::wstring out;
        out.reserve(s.size());
        for (std::size_t i = 0; i < s.size();) {
            unsigned char c = static_cast<unsigned char>(s[i]);
            unsigned cp = c, n = 0;
            if (c >= 0xF0) { cp = c & 0x07; n = 3; }
            else if (c >= 0xE0) { cp = c & 0x0F; n = 2; }
            else if (c >= 0xC0) { cp = c & 0x1F; n = 1; }
            ++i;
            for (unsigned k = 0; k < n && i < s.size(); ++k, ++i)
                cp = (cp << 6) | (static_cast<unsigned char>(s[i]) & 0x3F);
            out.push_back(static_cast<wchar_t>(cp));
        }
        return out;
    }

    void stats(const Stats& s) override
    {
        int cmd = cfjs_progress(s.shapeCount, s.toDoCount, s.inOutput ? 1 : 0,
                                s.outputDone, s.outputCount);
        if (gRenderer && cmd == 1) { gRenderer->requestFinishUp = true; gFinished = true; }
        if (gRenderer && cmd >= 2) { gRenderer->requestStop = true; gStopped = true; }
    }
    void orphan() override {}
};

// ── WebCanvas ───────────────────────────────────────────────────────────────
// abstractPngCanvas keeps the pixels and copies tiles for the tile
// multiplier (-T in the command line). output() is the PNG writer in the
// upstream build. Here it converts to RGBA8 and calls the frame hook.
class WebCanvas : public abstractPngCanvas {
public:
    std::vector<unsigned char> mRGBA;
    int mIndex = 0;
    bool mSendFrames = true;
    double mStart = 0.0;

    WebCanvas(int w, int h, PixelFormat fmt, int frames, int variation,
              Renderer* r, int mx, int my)
    : abstractPngCanvas("/tmp/out.png", true, w, h, fmt, false, frames,
                        variation, false, r, mx, my) {}

    void convert()
    {
        const int W = mFullWidth, H = mFullHeight;
        mRGBA.resize(static_cast<std::size_t>(W) * H * 4);
        const bool wide = (mPixelFormat & Has_16bit_Color) != 0;
        for (int y = 0; y < H; ++y) {
            const unsigned char* row = mData.data() + static_cast<std::size_t>(y) * mStride;
            unsigned char* o = mRGBA.data() + static_cast<std::size_t>(y) * W * 4;
            for (int x = 0; x < W; ++x, o += 4) {
                unsigned r, g, b, a;
                if (wide) {
                    const std::uint16_t* p = reinterpret_cast<const std::uint16_t*>(row) + x * 4;
                    r = p[0] >> 8; g = p[1] >> 8; b = p[2] >> 8; a = p[3] >> 8;
                } else {
                    const unsigned char* p = row + x * 4;
                    r = p[0]; g = p[1]; b = p[2]; a = p[3];
                }
                if (a == 0) { o[0] = o[1] = o[2] = o[3] = 0; continue; }
                if (a < 255) {
                    r = std::min(255u, (r * 255 + a / 2) / a);
                    g = std::min(255u, (g * 255 + a / 2) / a);
                    b = std::min(255u, (b * 255 + a / 2) / a);
                }
                o[0] = r; o[1] = g; o[2] = b; o[3] = a;
            }
        }
    }
    void start(bool clear, const agg::rgba& bk, int width, int height) override
    {
        mStart = cfjs_now();
        abstractPngCanvas::start(clear, bk, width, height);
    }
protected:
    void output(const char*, int) override
    {
        if (!mSendFrames) return;
        convert();
        cfjs_frame(mRGBA.data(), mFullWidth, mFullHeight, mIndex++);
        gOutputCost = cfjs_now() - mStart;
    }
};

// ── the design ──────────────────────────────────────────────────────────────
static WebSystem gSystem;
static cfdg_ptr gDesign;
static int gVariation = 1;
static std::string gResult;             // JSON or SVG text for JS
static std::unique_ptr<WebCanvas> gCanvas;
static std::string gDefs;              // the defines of the last cf_parse
static bool gUsed = false;              // a renderer took the startshape

// CFDGImpl::renderer() moves the startshape out of the design, so one
// parse makes one renderer. A second renderer needs a new parse of the
// same file, variation and defines.
static bool reparse()
{
    gDesign.reset();
    try {
        gDesign = CFDG::ParseFile("/work/main.cfdg", &gSystem, gVariation, gDefs);
    } catch (...) {
        gDesign.reset();
    }
    gUsed = false;
    return gDesign != nullptr;
}

static std::string jsonEscape(const std::string& s)
{
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (static_cast<unsigned char>(c) < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
        else o += c;
    }
    return o;
}

extern "C" {

// Parse /work/main.cfdg (JS writes it, with the files it imports, into
// MEMFS first). defs is the -D text of the command line ("CF::Background
// = [b -1]"); the engine then reads the design as CFDG 3 only.
// Returns 1 on success, 0 on error.
EMSCRIPTEN_KEEPALIVE int cf_parse(int variation, const char* defs)
{
    gCanvas.reset();
    gDesign.reset();
    gSystem.mErrorMode = false;
    gSystem.mPendingError = false;
    gSystem.mErrors = 0;
    gVariation = variation > 0 ? variation : 1;
    gDefs = defs ? defs : "";
    gUsed = false;
    AST::ASTfunction::RandStaticIsConst = true;
    try {
        gDesign = CFDG::ParseFile("/work/main.cfdg", &gSystem, gVariation, defs ? defs : "");
    } catch (CfdgError& e) {
        gSystem.error();
        gSystem.syntaxError(e);
        gDesign.reset();
    } catch (std::exception& e) {
        gSystem.catastrophicError(e.what());
        gDesign.reset();
    } catch (...) {
        gSystem.catastrophicError("unknown engine exception");
        gDesign.reset();
    }
    return gDesign && !gSystem.mErrorMode ? 1 : 0;
}

// Facts about the parsed design, as JSON.
EMSCRIPTEN_KEEPALIVE const char* cf_info(void)
{
    if (!gDesign) return "null";
    // isTimed() and isSized() check values that the renderer sets up, and
    // throw CfdgError before that. Each check is guarded; call cf_info()
    // again after cf_render() for the final values.
    double sx = 0, sy = 0;
    bool sized = false, timed = false, tiled = false;
    int fz = 0;
    agg::trans_affine_time t;
    try { sized = gDesign->isSized(&sx, &sy); } catch (...) {}
    try { timed = gDesign->isTimed(&t); } catch (...) {}
    try { tiled = gDesign->isTiled(); } catch (...) {}
    try { fz = static_cast<int>(gDesign->isFrieze()); } catch (...) {}
    agg::rgba bg = gDesign->getBackgroundColor();
    char b[512];
    std::snprintf(b, sizeof b,
        "{\"tiled\":%s,\"frieze\":%d,\"sized\":%s,\"sizeX\":%g,\"sizeY\":%g,"
        "\"timed\":%s,\"time\":[%g,%g],\"usesTime\":%s,\"usesFrameTime\":%s,\"looped\":%s,"
        "\"usesColor\":%s,\"usesAlpha\":%s,\"uses16bit\":%s,\"usesBlend\":%s,"
        "\"bg\":[%g,%g,%g,%g]}",
        tiled ? "true" : "false", fz,
        sized ? "true" : "false", sx, sy,
        timed ? "true" : "false", t.tbegin, t.tend,
        gDesign->usesTime ? "true" : "false", gDesign->usesFrameTime ? "true" : "false",
        gDesign->isLooped ? "true" : "false",
        gDesign->usesColor ? "true" : "false", gDesign->usesAlpha ? "true" : "false",
        gDesign->uses16bitColor ? "true" : "false", gDesign->usesBlendMode ? "true" : "false",
        bg.r, bg.g, bg.b, bg.a);
    gResult = b;
    return gResult.c_str();
}

// Render the parsed design to RGBA8.
//   width, height   the tile or image size in px
//   maxShapes       0 = no limit (the engine default)
//   minSize         minimum shape size in px (upstream default 0.3)
//   border          -1..2 (upstream default 2)
//   tile            repeats of a tiled design in x and y, of a frieze
//                   along its axis (1 = off); width and height are then
//                   the size of the whole output
//   frames          0 = still image; > 0 = animate that many frames
//   frame           with frames > 0: 0 = every frame, k = frame k only
//   flags           1 = partial frames, 2 = no antialiasing, 4 = zoom
//                   (animation), 8 = 16 bit colour when the design asks
//   tickMs          the progress tick in ms (0 = off): progress() runs at
//                   each tick, and with flag 1 a partial frame too
// Returns a JSON string: status, size, shape count, and where the final
// RGBA8 pixels are (cf_pixels()).
EMSCRIPTEN_KEEPALIVE const char* cf_render(int width, int height, int maxShapes,
    double minSize, double border, int tile, int frames, int frame,
    int flags, double tickMs)
{
    gCanvas.reset();
    if (!gDesign) { gResult = "{\"ok\":false,\"error\":\"no design\"}"; return gResult.c_str(); }
    gStopped = gFinished = false;
    gTickMs = tickMs;       // progress ticks; partial frames only with flag 1
    gLastTick = cfjs_now();
    gTickCount = 0;
    gOutputCost = 0.0;
    aggCanvas::NoAntialias = (flags & 2) != 0;
    Renderer::AbortEverything = false;

    // A tiled or frieze design repeats `tile` times across the output (the
    // -T option of the command line). The renderer is made at the full
    // size first: CF::Tile is known only once a renderer exists. Then it
    // is made again at the size of one tile.
    renderer_ptr r;
    int mx = 1, my = 1;
    auto make = [&](int w, int h) {
        if (gUsed && !reparse()) { r.reset(); return; }
        gUsed = true;
        try {
            r = gDesign->renderer(gDesign, w, h, minSize, gVariation, border);
        } catch (CfdgError& e) {
            gSystem.error(); gSystem.syntaxError(e); r.reset();
        } catch (std::exception& e) {
            gSystem.catastrophicError(e.what()); r.reset();
        } catch (...) {
            gSystem.catastrophicError("unknown engine exception"); r.reset();
        }
    };
    make(width, height);
    if (r && tile > 1) {
        bool tiled = false;
        int fz = 0;
        try { tiled = gDesign->isTiled(); } catch (...) {}
        try { fz = static_cast<int>(gDesign->isFrieze()); } catch (...) {}
        if (tiled || fz) {
            mx = fz == CFDG::frieze_y ? 1 : tile;
            my = fz == CFDG::frieze_x ? 1 : tile;
            r.reset();
            make(std::max(16, width / mx), std::max(16, height / my));
        }
    }
    if (!r) { gResult = "{\"ok\":false,\"error\":\"renderer failed\"}"; return gResult.c_str(); }
    gRenderer = r.get();
    if (maxShapes > 0) r->setMaxShapes(maxShapes);

    int pix = gDesign->usesBlendMode ? aggCanvas::RGBA8_Custom_Blend : aggCanvas::RGBA8_Blend;
    if ((flags & 8) && gDesign->uses16bitColor) pix |= aggCanvas::Has_16bit_Color;
    auto fmt = static_cast<aggCanvas::PixelFormat>(pix);

    double scale = 0.0;
    try {
    if (frames > 0) {
        gCanvas = std::make_unique<WebCanvas>(r->m_width, r->m_height, fmt, frames, gVariation, r.get(), mx, my);
        int one = (frame > 0 && frame <= frames) ? frame : 0;
        r->animate(gCanvas.get(), frames, one, (flags & 4) != 0);
    } else {
        gCanvas = std::make_unique<WebCanvas>(r->m_width, r->m_height, fmt, 0, gVariation, r.get(), mx, my);
        if (gCanvas->mWidth != r->m_width || gCanvas->mHeight != r->m_height)
            r->resetSize(gCanvas->mWidth, gCanvas->mHeight);
        gCanvas->mSendFrames = (flags & 1) != 0;
        scale = r->run(gCanvas.get(), (flags & 1) != 0);
        gCanvas->convert();
    }
    } catch (CfdgError& e) {
        gSystem.error(); gSystem.syntaxError(e);
    } catch (std::exception& e) {
        gSystem.catastrophicError(e.what());
    } catch (...) {
        gSystem.catastrophicError("unknown engine exception");
    }
    gRenderer = nullptr;

    // The shape count is not in the result: the JS side keeps the last
    // progress() call, which run() makes at its end (outputStats).
    char b[384];
    std::snprintf(b, sizeof b,
        "{\"ok\":%s,\"stopped\":%s,\"finished\":%s,\"width\":%d,\"height\":%d,"
        "\"tileWidth\":%d,\"tileHeight\":%d,\"scale\":%g,\"frames\":%d,\"errors\":%d}",
        gSystem.mErrorMode ? "false" : "true", gStopped ? "true" : "false",
        gFinished ? "true" : "false",
        gCanvas->mWidth * mx, gCanvas->mHeight * my, gCanvas->mWidth, gCanvas->mHeight,
        scale, frames, gSystem.mErrors);
    // The full canvas includes the tile copies.
    gResult = b;
    return gResult.c_str();
}

// The final RGBA8 pixels of the last cf_render (top row first).
EMSCRIPTEN_KEEPALIVE const unsigned char* cf_pixels(void)
{
    return gCanvas ? gCanvas->mRGBA.data() : nullptr;
}

// Free the canvas memory of the last render.
EMSCRIPTEN_KEEPALIVE void cf_release(void)
{
    gCanvas.reset();
}

// Render the parsed design as SVG text (the upstream SVGCanvas).
EMSCRIPTEN_KEEPALIVE const char* cf_render_svg(int width, int height, int maxShapes,
    double minSize, double border)
{
    gCanvas.reset();
    gResult.clear();
    if (!gDesign) return "";
    gStopped = gFinished = false;
    gTickMs = 0.0;
    Renderer::AbortEverything = false;
    if (gUsed && !reparse()) return "";
    gUsed = true;
    renderer_ptr r;
    try {
        r = gDesign->renderer(gDesign, width, height, minSize, gVariation, border);
    } catch (...) {
        r.reset();
    }
    if (!r) return "";
    gRenderer = r.get();
    if (maxShapes > 0) r->setMaxShapes(maxShapes);
    try {
        r->run(nullptr, false);
        SVGCanvas svg("/tmp/out.svg", r->m_width, r->m_height, false, nullptr, -1, false);
        if (!svg.mError) r->draw(&svg);
    } catch (std::exception& e) {
        gSystem.catastrophicError(e.what());
    } catch (...) {
        gSystem.catastrophicError("unknown engine exception");
    }
    gRenderer = nullptr;
    std::ifstream in("/tmp/out.svg", std::ios::binary);
    std::ostringstream ss;
    ss << in.rdbuf();
    gResult = ss.str();
    std::remove("/tmp/out.svg");
    return gResult.c_str();
}

// The variation code system (src-common/variation.cpp).
EMSCRIPTEN_KEEPALIVE const char* cf_variation_to_string(int v)
{
    gResult = Variation::toString(v, false);
    return gResult.c_str();
}
EMSCRIPTEN_KEEPALIVE int cf_variation_from_string(const char* s)
{
    return Variation::fromString(s);
}
EMSCRIPTEN_KEEPALIVE int cf_variation_max(int letters)
{
    return Variation::recommendedMax(letters);
}

}   // extern "C"
