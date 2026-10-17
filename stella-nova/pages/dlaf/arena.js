// ============================================================================
//  DLAF PAGE  ·  arena.js — slot allocator for the brick meshes on the GPU
// ----------------------------------------------------------------------------
//  DOM-free. The surface view keeps every brick mesh in one vertex buffer
//  and one index buffer, so the whole surface is one draw call. Each brick
//  gets a slot in each buffer. A slot size is a power of two (in vertices
//  or in indices), so a freed slot is used again by a brick of the same
//  size class. A new slot that no free list holds comes from the top of
//  the arena. The arena grows by doubling. render code copies the old
//  buffer into the new one (copyBufferSubData) when cap changes.
//
//  A freed index slot must be filled with zeros by the caller: the draw
//  covers the arena up to `top`, and zeros give degenerate triangles.
//
//  grep -n targets
//    allocator ............. "export function createArena"
// ============================================================================

// The power-of-two size class of n (n >= 1). Class c holds 2^c units.
export function sizeClass(n) { return Math.max(4, Math.ceil(Math.log2(Math.max(1, n)))); }

// createArena(cap) -> { alloc(n) -> { off, size }, free(slot), top, cap, used, live }
// alloc never moves a live slot. When top passes cap, cap doubles (the
// caller reads arena.cap after each alloc and grows its buffer to match).
export function createArena(cap0 = 1 << 16) {
  const free = [];                         // free[c] = list of offsets
  const A = { top: 0, cap: cap0, used: 0, live: 0 };
  A.alloc = function (n) {
    const c = sizeClass(n), size = 1 << c;
    const list = free[c];
    let off;
    if (list && list.length) off = list.pop();
    else {
      off = A.top; A.top += size;
      while (A.top > A.cap) A.cap *= 2;
    }
    A.used += size; A.live++;
    return { off, size, c };
  };
  A.free = function (slot) {
    if (!slot) return;
    (free[slot.c] || (free[slot.c] = [])).push(slot.off);
    A.used -= slot.size; A.live--;
  };
  A.reset = function () { free.length = 0; A.top = 0; A.used = 0; A.live = 0; };
  return A;
}
