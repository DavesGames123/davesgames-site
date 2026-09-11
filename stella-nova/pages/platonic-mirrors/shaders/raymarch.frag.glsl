#version 300 es
// ============================================================================
//  raymarch.frag.glsl — Platonic Mirrors, fragment stage (the whole renderer)
// ----------------------------------------------------------------------------
//  Per pixel: build a camera ray, march a Wythoff-folded polyhedron SDF, and
//  shade it as a reflecting glass shell around a glowing inner core.
//
//  THE SDF (shape())
//  -----------------
//  Kaleidoscopic folding turns one seed point into a whole uniform polyhedron:
//  reflect the sample point across the mirror plane u_poly_nc, u_poly_type
//  times (polyFold), then measure distance to the seed point's face planes
//  (polyPlane), its edges (polyEdge), and its corner (polyCorner). shape()
//  returns those three distances at once.
//
//  TWO-LAYER RENDER
//  ----------------
//      eye ●──rd──▶ marchOuter() ─▶ outer glass shell hit (faces/edges/corner)
//                        │  reflect ─▶ renderSky()  (specular environment)
//                        │  refract ─▶ renderInner():
//                        │              bounce inside the shell up to
//                        │              u_max_bounces times, each bounce adding
//                        │              inner-glow and Beer-Lambert absorption
//                        ▼
//                    fresnel mix of reflection + refraction + edge glow
//                        ▼
//                    aces() tonemap ─▶ gamma ─▶ fragColor
//
//  g_rot (built in main) spins the field; g_gd tracks the nearest glow distance
//  along the ray so edges and the core bloom.
//
//  SECTION MAP   (jump with grep -n "<anchor>" raymarch.frag.glsl)
//  --------------------------------------------------------------------------
//      globals .......... "mat3 g_rot"      rotation + glow-distance accumulator
//      rotation ......... "mat3 rotMat"     align one vector onto another
//      tonemap .......... "vec3 aces"       ACES filmic curve
//      primitives ....... "sdSphere"        sphere / box SDFs
//      wythoff fold ..... "void polyFold"   kaleidoscopic mirror folding
//      face/edge/corner . "float polyPlane" the three solid distance parts
//      shape ............ "vec3 shape"      rotate, fold, measure (the SDF)
//      sky .............. "renderSky"       environment: floor, sky box, sun
//      inner march ...... "df_inner"        core SDF and its marcher
//      inner shade ...... "renderInner"     refracted glowing interior, bounced
//      outer march ...... "df_outer"        shell SDF and its marcher
//      composite ........ "vec3 render"     reflect + refract + edge glow
//      main ............. "void main"       camera ray, render, tonemap
// ============================================================================
precision highp float;

uniform vec2 u_resolution;
uniform float u_rot_x;
uniform float u_rot_y;
uniform int u_poly_type;
uniform float u_poly_zoom;
uniform float u_inner_sphere;
uniform float u_refr_index;
uniform int u_max_bounces;
uniform float u_fov;
uniform vec3 u_ray_origin;
uniform vec3 u_sun_col;
uniform vec3 u_bottom_col;
uniform vec3 u_top_col;
uniform vec3 u_glow_col0;
uniform vec3 u_glow_col1;
uniform vec3 u_beer_col;
uniform vec3 u_poly_nc;
uniform vec3 u_poly_p;
uniform vec3 u_poly_pab;
uniform vec3 u_poly_pbc;
uniform vec3 u_poly_pca;
uniform int u_marches_inner;
uniform int u_marches_outer;
uniform float u_edge_thick;

out vec4 fragColor;

#define PI 3.141592654
#define TAU (2.0*PI)
#define TOLERANCE 0.0005
#define MAX_RAY_LENGTH 10000.0
#define NORM_OFF 0.005

// g_rot: the field rotation (from the pitch/yaw uniforms, set in main()).
// g_gd:  running minimum distance to glow sources (x=edge/shell, y=core), used
//        after each march to bloom edges and the inner sphere.
mat3 g_rot;
vec2 g_gd;

// Rotation matrix that turns unit vector z onto unit vector d (Rodrigues form).
mat3 rotMat(vec3 d, vec3 z) {
  vec3 v = cross(z, d);
  float c = dot(z, d);
  float k = 1.0/(1.0+c);
  return mat3(
    v.x*v.x*k+c,     v.y*v.x*k-v.z,   v.z*v.x*k+v.y,
    v.x*v.y*k+v.z,   v.y*v.y*k+c,     v.z*v.y*k-v.x,
    v.x*v.z*k-v.y,   v.y*v.z*k+v.x,   v.z*v.z*k+c
  );
}

// ACES filmic tonemap: compress unbounded HDR radiance into [0,1] with a
// filmic shoulder, so the bright glows do not clip harshly.
vec3 aces(vec3 v) {
  v = max(v, 0.0);
  v *= 0.6;
  float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((v*(a*v+b))/(v*(c*v+d)+e), 0.0, 1.0);
}

// Signed distance to a sphere of radius r centred at the origin.
float sdSphere(vec3 p, float r) { return length(p)-r; }

// Signed distance to a 2D box, used for the sky's soft rectangular light panel.
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p)-b;
  return length(max(d,0.0))+min(max(d.x,d.y),0.0);
}

// Wythoff kaleidoscopic fold. abs() on xy folds across the x=0 and y=0 mirrors;
// reflecting across the slanted plane u_poly_nc, repeated u_poly_type times,
// tiles the fundamental domain into the full symmetry group. This is what turns
// one measured point into a whole uniform polyhedron.
void polyFold(inout vec3 pos) {
  for(int i=0; i<8; ++i) {
    if(i >= u_poly_type) break;
    pos.xy = abs(pos.xy);
    pos -= 2.0*min(0.0, dot(pos, u_poly_nc))*u_poly_nc;
  }
}

// Distance to the solid's faces: the max over the three face-plane half-spaces
// (the intersection of half-spaces is the convex cell).
float polyPlane(vec3 pos) {
  float d = dot(pos, u_poly_pab);
  d = max(d, dot(pos, u_poly_pbc));
  d = max(d, dot(pos, u_poly_pca));
  return d;
}

// Squared length helper.
float dot2(vec3 p) { return dot(p,p); }

// Distance to the solid's edges: nearest of the three fold-mirror lines, minus a
// tube radius u_edge_thick. Renders the wireframe glowing along the edges.
float polyEdge(vec3 pos) {
  float dla = dot2(pos - min(0.0, pos.x)*vec3(1,0,0));
  float dlb = dot2(pos - min(0.0, pos.y)*vec3(0,1,0));
  float dlc = dot2(pos - min(0.0, dot(pos, u_poly_nc))*u_poly_nc);
  return sqrt(min(min(dla, dlb), dlc)) - u_edge_thick;
}

// Distance to the solid's corner: a small sphere at the seed vertex.
float polyCorner(vec3 pos) {
  return length(pos) - 0.0125;
}

// The SDF. Rotate the point into the field, scale by zoom, fold it into the
// fundamental domain, shift to the seed point, then return {face, edge, corner}
// distances together (rescaled by zoom so the distance stays metric).
vec3 shape(vec3 pos) {
  pos *= g_rot;
  pos /= u_poly_zoom;
  polyFold(pos);
  pos -= u_poly_p;
  return vec3(polyPlane(pos), polyEdge(pos), polyCorner(pos)) * u_poly_zoom;
}

// Sun direction (set in main from the camera), read by renderSky.
vec3 sunDir;

// The environment seen by escaping/reflecting rays: a glowing floor below, a
// soft rectangular sky panel above, and a sharp sun disc. Both reflection and
// refraction sample this so the glass has something to mirror.
vec3 renderSky(vec3 ro, vec3 rd) {
  vec3 col = vec3(0.0);
  float srd = sign(rd.y);
  float tp = -(ro.y-6.0)/abs(rd.y);
  if(srd < 0.0) {
    col += u_bottom_col * exp(-0.5*length((ro+tp*rd).xz));
  }
  if(srd > 0.0) {
    vec3 pos = ro+tp*rd;
    float db = sdBox(pos.xz, vec2(5.0,9.0))-3.0;
    col += u_top_col*rd.y*rd.y*smoothstep(0.25, 0.0, db);
    col += 0.2*u_top_col*exp(-0.5*max(db,0.0));
    col += 0.05*sqrt(u_top_col)*max(-db,0.0);
  }
  col += u_sun_col/(1.001-dot(sunDir, rd));
  return col;
}

// Interior distance field. Inside the shell the surface is the inverted faces
// (-ds.x) plus the edge tubes, unioned with the inner glowing sphere. Track the
// edge and core distances in g_gd for the glow terms.
float df_inner(vec3 p) {
  vec3 ds = shape(p);
  float d2 = ds.y - 5E-3;
  float d0 = min(-ds.x, d2);
  float d1 = sdSphere(p, u_inner_sphere);
  g_gd = min(g_gd, vec2(d2, d1));
  return min(d0, d1);
}

// March the interior field. Remember the closest approach (dti) so that if the
// step budget runs out, we fall back to the nearest point rather than overshoot.
float marchInner(vec3 ro, vec3 rd, float tinit) {
  float t = tinit;
  vec2 dti = vec2(1e10, 0.0);
  int mi = u_marches_inner;
  int i;
  for(i=0; i<200; ++i) {
    if(i >= mi) break;
    float d = df_inner(ro+rd*t);
    if(d < dti.x) dti = vec2(d, t);
    if(d < TOLERANCE) break;
    t += d;
  }
  if(i >= mi) t = dti.y;
  return t;
}

// Surface normal of the interior field by central differences.
vec3 normalInner(vec3 pos) {
  vec2 e = vec2(NORM_OFF, 0.0);
  return normalize(vec3(
    df_inner(pos+e.xyy)-df_inner(pos-e.xyy),
    df_inner(pos+e.yxy)-df_inner(pos-e.yxy),
    df_inner(pos+e.yyx)-df_inner(pos-e.yyx)
  ));
}

// Shade the refracted interior. Bounce the ray inside the shell up to
// u_max_bounces times: each bounce adds inner-glow (brighter the closer the ray
// passes to an edge/core, via g_gd) and attenuates the running weight by
// Beer-Lambert absorption over the path length. On a total-internal hit it
// reflects and keeps going; otherwise it leaks the sky through and fades out.
vec3 renderInner(vec3 ro, vec3 rd, float db) {
  vec3 agg = vec3(0.0);
  float ragg = 1.0;
  float tagg = 0.0;
  float ri = 1.0/u_refr_index;

  for(int bounce=0; bounce<16; ++bounce) {
    if(bounce >= u_max_bounces || ragg < 0.1) break;
    g_gd = vec2(1E3);
    float t2 = marchInner(ro, rd, min(db+0.05, 0.3));
    vec2 gd2 = g_gd;
    tagg += t2;
    vec3 p2 = ro+rd*t2;
    vec3 n2 = normalInner(p2);
    vec3 r2 = reflect(rd, n2);
    vec3 rr2 = refract(rd, n2, ri);
    float fre2 = 1.0+dot(n2, rd);
    vec3 beer = ragg*exp(0.2*u_beer_col*tagg);
    agg += u_glow_col1*beer*((1.0+tagg*tagg*4E-2)*6.0/max(gd2.x, 5E-4+tagg*tagg*2E-4/ragg));
    vec3 ocol = 0.2*beer*renderSky(p2, rr2);
    if(gd2.y <= TOLERANCE) {
      ragg *= 1.0-0.9*fre2;
    } else {
      agg += ocol;
      ragg *= 0.8;
    }
    ro = p2; rd = r2; db = gd2.x;
  }
  return agg;
}

// Outer distance field: the union of faces, edges, and corner (the solid glass
// shell as seen from outside). Track edge and corner distances for the glow.
float df_outer(vec3 p) {
  vec3 ds = shape(p);
  g_gd = min(g_gd, ds.yz);
  float d = min(ds.x, min(ds.y, ds.z));
  return d;
}

// March the outer field to the first surface hit; report the iteration count so
// the shader can dim ambiguous, march-budget-exhausted pixels.
float marchOuter(vec3 ro, vec3 rd, float tinit, out int iter) {
  float t = tinit;
  int mo = u_marches_outer;
  int i;
  for(i=0; i<300; ++i) {
    if(i >= mo) break;
    float d = df_outer(ro+rd*t);
    if(d < TOLERANCE || t > MAX_RAY_LENGTH) break;
    t += d;
  }
  iter = i;
  return t;
}

// Surface normal of the outer field by central differences.
vec3 normalOuter(vec3 pos) {
  vec2 e = vec2(NORM_OFF, 0.0);
  return normalize(vec3(
    df_outer(pos+e.xyy)-df_outer(pos-e.xyy),
    df_outer(pos+e.yxy)-df_outer(pos-e.yxy),
    df_outer(pos+e.yyx)-df_outer(pos-e.yyx)
  ));
}

// Top-level shading for one primary ray. March the shell; at the hit, split into
// a Fresnel-weighted reflection of the sky and a refracted interior from
// renderInner; add the outer edge glow. ifo dims pixels where the march did not
// clearly converge. A miss returns the sky.
vec3 render(vec3 ro, vec3 rd) {
  int iter;
  vec3 skyCol = renderSky(ro, rd);
  vec3 col = skyCol;
  g_gd = vec2(1E3);
  float t1 = marchOuter(ro, rd, 0.1, iter);
  vec2 gd1 = g_gd;
  vec3 p1 = ro+t1*rd;
  vec3 n1 = normalOuter(p1);
  vec3 r1 = reflect(rd, n1);
  vec3 rr1 = refract(rd, n1, u_refr_index);
  float fre1 = 1.0+dot(rd, n1);
  fre1 *= fre1;
  float ifo = mix(0.5, 1.0, smoothstep(1.0, 0.9, float(iter)/float(u_marches_outer)));
  col = renderSky(p1, r1)*(0.5+0.5*fre1)*ifo;
  vec3 icol = renderInner(p1, rr1, gd1.x);
  if(gd1.x > TOLERANCE && gd1.y > TOLERANCE && rr1 != vec3(0.0)) {
    col += icol*(1.0-0.75*fre1)*ifo;
  }
  col += (u_glow_col0+1.0*fre1*u_glow_col0)/max(gd1.x, 3E-4);
  return col;
}

// Per-pixel entry point. Build normalized device coordinates, set the sun toward
// the origin, assemble the field rotation from the pitch/yaw uniforms, construct
// a look-at camera basis, cast the ray, render, then vignette, tonemap, and
// gamma-correct.
void main() {
  vec2 uv = gl_FragCoord.xy/u_resolution;
  vec2 p = -1.0+2.0*uv;
  // Correct for aspect ratio so the solid is not stretched.
  p.x *= u_resolution.x/u_resolution.y;

  sunDir = normalize(-u_ray_origin);
  // Field rotation from pitch (rot_x) and yaw (rot_y); shape() applies it.
  float cx = cos(u_rot_x), sx = sin(u_rot_x);
  float cy = cos(u_rot_y), sy = sin(u_rot_y);
  mat3 rx = mat3(1,0,0, 0,cx,-sx, 0,sx,cx);
  mat3 ry = mat3(cy,0,sy, 0,1,0, -sy,0,cy);
  g_rot = rx * ry;

  // Look-at camera basis from the ray origin toward the origin; u_fov sets the
  // forward weight, so a larger value narrows the field of view.
  vec3 up = vec3(0,1,0);
  vec3 la = vec3(0);
  vec3 ww = normalize(la - u_ray_origin);
  vec3 uu = normalize(cross(up, ww));
  vec3 vv = cross(ww, uu);
  vec3 rd = normalize(-p.x*uu + p.y*vv + u_fov*ww);

  // Render, then a subtle cool vignette, ACES tonemap, and gamma (sqrt ~ 2.0).
  vec3 col = render(u_ray_origin, rd);
  col -= 2E-2*vec3(2,3,1)*(length(p)+0.25);
  col = aces(col);
  col = sqrt(col);
  fragColor = vec4(col, 1.0);
}
