#version 300 es
void main(){float x=gl_VertexID==1?3.:-1.;float y=gl_VertexID==2?3.:-1.;gl_Position=vec4(x,y,0,1);}
