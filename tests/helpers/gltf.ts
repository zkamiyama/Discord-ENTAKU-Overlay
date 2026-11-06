import { png } from './png.ts';
export function studioFixture(){
  const buffer=Buffer.alloc(60);
  [-1,0,0,1,0,0,0,2,0, 0,0,1,0,.5,1].forEach((v,i)=>buffer.writeFloatLE(v,i*4));
  const model={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    buffers:[{uri:'../shared/triangle.bin',byteLength:60}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36,target:34962},{buffer:0,byteOffset:36,byteLength:24,target:34962}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,2,0]},{bufferView:1,componentType:5126,count:3,type:'VEC2'}],
    images:[{uri:'../textures/cutout.png'}],textures:[{source:0}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1}}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},material:0}]}]};
  return {'models/room.gltf':Buffer.from(JSON.stringify(model)),'shared/triangle.bin':buffer,'textures/cutout.png':png()};
}
