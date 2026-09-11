#version 300 es
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

mat3 g_rot;
vec2 g_gd;

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

vec3 aces(vec3 v) {
  v = max(v, 0.0);
  v *= 0.6;
  float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((v*(a*v+b))/(v*(c*v+d)+e), 0.0, 1.0);
}

float sdSphere(vec3 p, float r) { return length(p)-r; }

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p)-b;
  return length(max(d,0.0))+min(max(d.x,d.y),0.0);
}

void polyFold(inout vec3 pos) {
  for(int i=0; i<8; ++i) {
    if(i >= u_poly_type) break;
    pos.xy = abs(pos.xy);
    pos -= 2.0*min(0.0, dot(pos, u_poly_nc))*u_poly_nc;
  }
}

float polyPlane(vec3 pos) {
  float d = dot(pos, u_poly_pab);
  d = max(d, dot(pos, u_poly_pbc));
  d = max(d, dot(pos, u_poly_pca));
  return d;
}

float dot2(vec3 p) { return dot(p,p); }

float polyEdge(vec3 pos) {
  float dla = dot2(pos - min(0.0, pos.x)*vec3(1,0,0));
  float dlb = dot2(pos - min(0.0, pos.y)*vec3(0,1,0));
  float dlc = dot2(pos - min(0.0, dot(pos, u_poly_nc))*u_poly_nc);
  return sqrt(min(min(dla, dlb), dlc)) - u_edge_thick;
}

float polyCorner(vec3 pos) {
  return length(pos) - 0.0125;
}

vec3 shape(vec3 pos) {
  pos *= g_rot;
  pos /= u_poly_zoom;
  polyFold(pos);
  pos -= u_poly_p;
  return vec3(polyPlane(pos), polyEdge(pos), polyCorner(pos)) * u_poly_zoom;
}

vec3 sunDir;

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

float df_inner(vec3 p) {
  vec3 ds = shape(p);
  float d2 = ds.y - 5E-3;
  float d0 = min(-ds.x, d2);
  float d1 = sdSphere(p, u_inner_sphere);
  g_gd = min(g_gd, vec2(d2, d1));
  return min(d0, d1);
}

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

vec3 normalInner(vec3 pos) {
  vec2 e = vec2(NORM_OFF, 0.0);
  return normalize(vec3(
    df_inner(pos+e.xyy)-df_inner(pos-e.xyy),
    df_inner(pos+e.yxy)-df_inner(pos-e.yxy),
    df_inner(pos+e.yyx)-df_inner(pos-e.yyx)
  ));
}

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

float df_outer(vec3 p) {
  vec3 ds = shape(p);
  g_gd = min(g_gd, ds.yz);
  float d = min(ds.x, min(ds.y, ds.z));
  return d;
}

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

vec3 normalOuter(vec3 pos) {
  vec2 e = vec2(NORM_OFF, 0.0);
  return normalize(vec3(
    df_outer(pos+e.xyy)-df_outer(pos-e.xyy),
    df_outer(pos+e.yxy)-df_outer(pos-e.yxy),
    df_outer(pos+e.yyx)-df_outer(pos-e.yyx)
  ));
}

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

void main() {
  vec2 uv = gl_FragCoord.xy/u_resolution;
  vec2 p = -1.0+2.0*uv;
  p.x *= u_resolution.x/u_resolution.y;

  sunDir = normalize(-u_ray_origin);
  float cx = cos(u_rot_x), sx = sin(u_rot_x);
  float cy = cos(u_rot_y), sy = sin(u_rot_y);
  mat3 rx = mat3(1,0,0, 0,cx,-sx, 0,sx,cx);
  mat3 ry = mat3(cy,0,sy, 0,1,0, -sy,0,cy);
  g_rot = rx * ry;

  vec3 up = vec3(0,1,0);
  vec3 la = vec3(0);
  vec3 ww = normalize(la - u_ray_origin);
  vec3 uu = normalize(cross(up, ww));
  vec3 vv = cross(ww, uu);
  vec3 rd = normalize(-p.x*uu + p.y*vv + u_fov*ww);

  vec3 col = render(u_ray_origin, rd);
  col -= 2E-2*vec3(2,3,1)*(length(p)+0.25);
  col = aces(col);
  col = sqrt(col);
  fragColor = vec4(col, 1.0);
}
