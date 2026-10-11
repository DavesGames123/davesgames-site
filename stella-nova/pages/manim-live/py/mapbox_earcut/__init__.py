"""mapbox_earcut -- the mapbox-earcut API in pure Python.

Why this module exists
----------------------
mapbox-earcut is a pybind11 binding to the C++ earcut.hpp. A browser cannot
load it. manim/utils/space_ops.py imports ``triangulate_float32`` at import
time; only the OpenGL renderer calls it (earclip_triangulation), so the
Cairo renderer that manim-live runs never needs it for drawing. This module
is a port of the earcut algorithm (mapbox/earcut.js 2.2, ISC licence,
Copyright (c) 2016 Mapbox) without the z-order hash speed-up, so
``earclip_triangulation`` still gives correct triangles when a user calls it.

API: triangulate_float32, triangulate_float64, triangulate_int32,
triangulate_int64 -- (vertices (N, 2), ring_end_indices) -> uint32 indices.
"""

from __future__ import annotations

import numpy as np

__version__ = "1.0.0+manim-live-python"


class _Node:
    __slots__ = ("i", "x", "y", "prev", "next", "steiner")

    def __init__(self, i, x, y):
        self.i = i
        self.x = x
        self.y = y
        self.prev = None
        self.next = None
        self.steiner = False


def _area(p, q, r):
    return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)


def _equals(a, b):
    return a.x == b.x and a.y == b.y


def _insert(i, x, y, last):
    p = _Node(i, x, y)
    if last is None:
        p.prev = p
        p.next = p
    else:
        p.next = last.next
        p.prev = last
        last.next.prev = p
        last.next = p
    return p


def _remove(p):
    p.next.prev = p.prev
    p.prev.next = p.next


def _signed_area(data, start, end):
    s = 0.0
    j = end - 1
    for i in range(start, end):
        s += (data[j][0] - data[i][0]) * (data[i][1] + data[j][1])
        j = i
    return s


def _linked_list(data, start, end, clockwise):
    last = None
    if clockwise == (_signed_area(data, start, end) > 0):
        for i in range(start, end):
            last = _insert(i, data[i][0], data[i][1], last)
    else:
        for i in range(end - 1, start - 1, -1):
            last = _insert(i, data[i][0], data[i][1], last)
    if last is not None and _equals(last, last.next):
        _remove(last)
        last = last.next
    return last


def _filter_points(start, end=None):
    if start is None:
        return start
    if end is None:
        end = start
    p = start
    while True:
        again = False
        if not p.steiner and (_equals(p, p.next) or _area(p.prev, p, p.next) == 0):
            _remove(p)
            p = end = p.prev
            if p is p.next:
                break
            again = True
        else:
            p = p.next
        if not (again or p is not end):
            break
    return end


def _point_in_triangle(ax, ay, bx, by, cx, cy, px, py):
    return (
        (cx - px) * (ay - py) >= (ax - px) * (cy - py)
        and (ax - px) * (by - py) >= (bx - px) * (ay - py)
        and (bx - px) * (cy - py) >= (cx - px) * (by - py)
    )


def _is_ear(ear):
    a, b, c = ear.prev, ear, ear.next
    if _area(a, b, c) >= 0:
        return False
    p = ear.next.next
    while p is not ear.prev:
        if _point_in_triangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) and _area(p.prev, p, p.next) >= 0:
            return False
        p = p.next
    return True


def _sign(v):
    return (v > 0) - (v < 0)


def _on_segment(p, q, r):
    return min(p.x, r.x) <= q.x <= max(p.x, r.x) and min(p.y, r.y) <= q.y <= max(p.y, r.y)


def _intersects(p1, q1, p2, q2):
    o1 = _sign(_area(p1, q1, p2))
    o2 = _sign(_area(p1, q1, q2))
    o3 = _sign(_area(p2, q2, p1))
    o4 = _sign(_area(p2, q2, q1))
    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and _on_segment(p1, p2, q1):
        return True
    if o2 == 0 and _on_segment(p1, q2, q1):
        return True
    if o3 == 0 and _on_segment(p2, p1, q2):
        return True
    if o4 == 0 and _on_segment(p2, q1, q2):
        return True
    return False


def _locally_inside(a, b):
    if _area(a.prev, a, a.next) < 0:
        return _area(a, b, a.next) >= 0 and _area(a, a.prev, b) >= 0
    return _area(a, b, a.prev) < 0 or _area(a, a.next, b) < 0


def _cure_local_intersections(start, triangles):
    p = start
    while True:
        a, b = p.prev, p.next.next
        if not _equals(a, b) and _intersects(a, p, p.next, b) and _locally_inside(a, b) and _locally_inside(b, a):
            triangles.extend((a.i, p.i, b.i))
            _remove(p)
            _remove(p.next)
            p = start = b
        p = p.next
        if p is start:
            break
    return _filter_points(p)


def _intersects_polygon(a, b):
    p = a
    while True:
        if p.i != a.i and p.next.i != a.i and p.i != b.i and p.next.i != b.i and _intersects(p, p.next, a, b):
            return True
        p = p.next
        if p is a:
            break
    return False


def _middle_inside(a, b):
    p = a
    inside = False
    px, py = (a.x + b.x) / 2, (a.y + b.y) / 2
    while True:
        if (p.y > py) != (p.next.y > py) and p.next.y != p.y and px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x:
            inside = not inside
        p = p.next
        if p is a:
            break
    return inside


def _is_valid_diagonal(a, b):
    return (
        a.next.i != b.i
        and a.prev.i != b.i
        and not _intersects_polygon(a, b)
        and (
            (_locally_inside(a, b) and _locally_inside(b, a) and _middle_inside(a, b)
             and (_area(a.prev, a, b.prev) != 0 or _area(a, b.prev, b) != 0))
            or (_equals(a, b) and _area(a.prev, a, a.next) > 0 and _area(b.prev, b, b.next) > 0)
        )
    )


def _split_polygon(a, b):
    a2 = _Node(a.i, a.x, a.y)
    b2 = _Node(b.i, b.x, b.y)
    an, bp = a.next, b.prev
    a.next = b
    b.prev = a
    a2.next = an
    an.prev = a2
    b2.next = a2
    a2.prev = b2
    bp.next = b2
    b2.prev = bp
    return b2


def _split_earcut(start, triangles):
    a = start
    while True:
        b = a.next.next
        while b is not a.prev:
            if a.i != b.i and _is_valid_diagonal(a, b):
                c = _split_polygon(a, b)
                a = _filter_points(a, a.next)
                c = _filter_points(c, c.next)
                _earcut_linked(a, triangles, 0)
                _earcut_linked(c, triangles, 0)
                return
            b = b.next
        a = a.next
        if a is start:
            break


def _earcut_linked(ear, triangles, pass_):
    if ear is None:
        return
    stop = ear
    while ear.prev is not ear.next:
        prev, nxt = ear.prev, ear.next
        if _is_ear(ear):
            triangles.extend((prev.i, ear.i, nxt.i))
            _remove(ear)
            ear = nxt.next
            stop = nxt.next
            continue
        ear = nxt
        if ear is stop:
            if pass_ == 0:
                _earcut_linked(_filter_points(ear), triangles, 1)
            elif pass_ == 1:
                ear = _cure_local_intersections(_filter_points(ear), triangles)
                _earcut_linked(ear, triangles, 2)
            elif pass_ == 2:
                _split_earcut(ear, triangles)
            break


def _get_leftmost(start):
    p = leftmost = start
    while True:
        if p.x < leftmost.x or (p.x == leftmost.x and p.y < leftmost.y):
            leftmost = p
        p = p.next
        if p is start:
            break
    return leftmost


def _sector_contains_sector(m, p):
    return _area(m.prev, m, p.prev) < 0 and _area(p.next, m, m.next) < 0


def _find_hole_bridge(hole, outer):
    p = outer
    hx, hy = hole.x, hole.y
    qx = -float("inf")
    m = None
    while True:
        if hy <= p.y and hy >= p.next.y and p.next.y != p.y:
            x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y)
            if hx >= x > qx:
                qx = x
                m = p if p.x < p.next.x else p.next
                if x == hx:
                    return m
        p = p.next
        if p is outer:
            break
    if m is None:
        return None
    stop = m
    mx, my = m.x, m.y
    tan_min = float("inf")
    p = m
    while True:
        if hx >= p.x >= mx and hx != p.x and _point_in_triangle(
            hx if hy < my else qx, hy, mx, my, qx if hy < my else hx, hy, p.x, p.y
        ):
            tan = abs(hy - p.y) / (hx - p.x)
            if _locally_inside(p, hole) and (
                tan < tan_min or (tan == tan_min and (p.x > m.x or (p.x == m.x and _sector_contains_sector(m, p))))
            ):
                m = p
                tan_min = tan
        p = p.next
        if p is stop:
            break
    return m


def _eliminate_holes(data, hole_indices, outer):
    queue = []
    for k, start in enumerate(hole_indices):
        end = hole_indices[k + 1] if k + 1 < len(hole_indices) else len(data)
        lst = _linked_list(data, start, end, False)
        if lst is lst.next:
            lst.steiner = True
        queue.append(_get_leftmost(lst))
    queue.sort(key=lambda n: n.x)
    for hole in queue:
        bridge = _find_hole_bridge(hole, outer)
        if bridge is None:
            continue
        bridge_reverse = _split_polygon(bridge, hole)
        _filter_points(bridge_reverse, bridge_reverse.next)
        outer = _filter_points(bridge, bridge.next)
    return outer


def _earcut(data, ring_ends):
    ends = [int(e) for e in ring_ends] or [len(data)]
    outer_len = ends[0]
    hole_indices = ends[:-1] if len(ends) > 1 else []
    outer = _linked_list(data, 0, outer_len, True)
    triangles: list[int] = []
    if outer is None or outer.next is outer.prev:
        return triangles
    if hole_indices:
        outer = _eliminate_holes(data, hole_indices, outer)
    _earcut_linked(outer, triangles, 0)
    return triangles


def _triangulate(vertices, ring_end_indices, dtype):
    v = np.asarray(vertices, dtype=dtype)
    if v.ndim != 2 or v.shape[1] != 2:
        raise ValueError("vertices must have shape (N, 2)")
    data = [(float(x), float(y)) for x, y in v]
    return np.asarray(_earcut(data, list(np.asarray(ring_end_indices).ravel())), dtype=np.uint32)


def triangulate_float32(vertices, ring_end_indices):
    return _triangulate(vertices, ring_end_indices, np.float32)


def triangulate_float64(vertices, ring_end_indices):
    return _triangulate(vertices, ring_end_indices, np.float64)


def triangulate_int32(vertices, ring_end_indices):
    return _triangulate(vertices, ring_end_indices, np.int32)


def triangulate_int64(vertices, ring_end_indices):
    return _triangulate(vertices, ring_end_indices, np.int64)
