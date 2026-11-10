import {REVISION,type ShaderMaterial} from 'three';

/** Spark 2.4.0 decodes render-target RGB with pow(rgb, 2.2), while Three r187
 * encodes linear targets with the IEC sRGB transfer. In particular, acquired
 * sRGB .025 becomes byte 1 instead of 6 after that mismatched round trip.
 *
 * Change only this material's public fragmentShader. Keep Spark's falloff,
 * premultiplied alpha, sorting and direct-to-canvas output untouched. Three's
 * ShaderMaterial prefix supplies the same EOTF paired with our output passes.
 * No global ShaderChunk or SDK source is modified. The exact call-site guard
 * makes dependency changes explicit instead of silently changing GS colors.
 */
export function prepareGaussianColor(material:ShaderMaterial):void {
 const source='rgba.rgb = srgbToLinear(rgba.rgb);';
 if(REVISION!=='187'||material.fragmentShader.split(source).length!==2)throw new Error('SPARK_COLOR_ADAPTER_CHANGED');
 material.fragmentShader=material.fragmentShader.replace(source,'rgba.rgb = sRGBTransferEOTF(vec4(rgba.rgb, 1.0)).rgb;');
 material.needsUpdate=true;
}
