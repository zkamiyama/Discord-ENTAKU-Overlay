/** WebGL adapter for selective saturation. Three.js r187 offers vibrance only
 * in TSL, not a WebGL ShaderPass; that formula also lacks explicit high-chroma
 * attenuation. Keep the existing renderer and use this single bounded pass.
 * 1 is neutral. Gain tapers to zero at full saturation; luminance/alpha remain.
 * This is not a reproduction of Adobe's proprietary implementation. */
export const VibranceShader={
 name:'EntakuNaturalVibrance',uniforms:{tDiffuse:{value:null},amount:{value:1}},
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`uniform sampler2D tDiffuse;uniform float amount;varying vec2 vUv;
 void main(){
  vec4 inputColor=texture2D(tDiffuse,vUv);vec3 rgb=clamp(inputColor.rgb,0.0,1.0);
  float hi=max(rgb.r,max(rgb.g,rgb.b)),lo=min(rgb.r,min(rgb.g,rgb.b));
  float saturation=hi>0.000001?(hi-lo)/hi:0.0;
  float luma=dot(rgb,vec3(0.2126,0.7152,0.0722));vec3 chroma=rgb-vec3(luma);
  float gain=amount<1.0?amount:1.0+(amount-1.0)*pow(1.0-saturation,2.0);
  for(int i=0;i<3;i++){
   if(chroma[i]>0.000001)gain=min(gain,(1.0-luma)/chroma[i]);
   else if(chroma[i]<-0.000001)gain=min(gain,-luma/chroma[i]);
  }
  gl_FragColor=vec4(clamp(vec3(luma)+chroma*max(0.0,gain),0.0,1.0),inputColor.a);
 }`,
};
/** Reference math for CPU/GPU regression comparison. */
export function naturalVibrance(rgb:readonly number[],amount:number):number[]{
 const c=rgb.slice(0,3).map(v=>Math.max(0,Math.min(1,v))),hi=Math.max(...c),lo=Math.min(...c);
 const saturation=hi>1e-6?(hi-lo)/hi:0,luma=.2126*c[0]!+.7152*c[1]!+.0722*c[2]!;
 const chroma=c.map(v=>v-luma);let gain=amount<1?amount:1+(amount-1)*(1-saturation)**2;
 for(const v of chroma)if(v>1e-6)gain=Math.min(gain,(1-luma)/v);else if(v< -1e-6)gain=Math.min(gain,-luma/v);
 return chroma.map(v=>Math.max(0,Math.min(1,luma+v*Math.max(0,gain))));
}
