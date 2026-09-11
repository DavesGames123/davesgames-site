// chromatic-aberration.vert.glsl — full-screen post pass, vertex stage
// Standard full-screen-quad passthrough; forwards uv to the fragment stage.
varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
