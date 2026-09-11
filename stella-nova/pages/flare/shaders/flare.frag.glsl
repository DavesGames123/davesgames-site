#version 300 es
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform sampler2D u_ch0;
uniform vec2  u_flarePos;
uniform float u_intensity;
uniform float u_flickerSpeed;
uniform float u_flickerAmt;
uniform float u_trailLength;
uniform float u_trailSpread;
uniform float u_trailWidth;
uniform float u_particleCount;
uniform float u_colorShift;
uniform float u_noiseStrength;
out vec4 fragColor;
void main(){
  vec2 origin=vec2(u_flarePos.x,1.-u_flarePos.y)*u_res;
  vec2 pos=(gl_FragCoord.xy-origin)/u_res.y;
  vec4 C=vec4(1.,2.,3.,0.);
  float phase=u_flickerSpeed*u_time+pos.y*0.25;
  vec4 colorSum=vec4(0.);
  for(float i=0.;i<50.;i++){
    if(i>=u_particleCount)break;
    vec4 W=sin(i)*C;
    vec4 hue=cos(W+u_colorShift)+1.;
    float bright=u_intensity*exp(u_flickerAmt*sin(i+i*phase));
    vec2 nuv=pos/exp(W.x)+vec2(i,u_time*u_flickerSpeed)/8.;
    float ns=texture(u_ch0,fract(nuv)).r*40.*u_noiseStrength;
    ns=max(ns,0.01);
    vec2 ap=max(pos,pos/vec2(u_trailWidth,ns));
    float falloff=1./(length(ap)*1e4);
    colorSum+=hue*bright*falloff;
    pos.x+=u_trailLength*0.02;
    pos.y+=u_trailSpread*0.015*cos(i*(C.z+8.+i)+2.*phase);
  }
  vec4 bg=pos.x*(C-1.)*0.018;
  fragColor=vec4(tanh((bg+colorSum*colorSum).rgb),1.);
}
