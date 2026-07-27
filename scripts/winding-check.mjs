// A correctly-wound closed mesh has positive signed volume (divergence theorem).
// This validates shell AND caps together, unlike a radial-only test.
import * as THREE from 'three';
import { loftBody } from '../src/render/VehicleBodywork.ts';
const stations=[
 {z:-1,halfWidth:.3,y:0,top:.2,bottom:.2,squareness:3},
 {z:0,halfWidth:.4,y:0,top:.3,bottom:.3,squareness:3},
 {z:1,halfWidth:.25,y:0,top:.18,bottom:.18,squareness:3},
];
function signedVolume(g){
 const pos=g.attributes.position, idx=g.index;
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cr=new THREE.Vector3();
 let v=0;
 for(let i=0;i<idx.count;i+=3){
  a.fromBufferAttribute(pos,idx.getX(i));
  b.fromBufferAttribute(pos,idx.getX(i+1));
  c.fromBufferAttribute(pos,idx.getX(i+2));
  v += cr.crossVectors(b,c).dot(a)/6;
 }
 return v;
}
const closed=loftBody(stations,20,true);
const v=signedVolume(closed);
console.log(JSON.stringify({
 signedVolume:+v.toFixed(5),
 verdict: v>0 ? 'OUTWARD (correct)' : 'INWARD (flipped)',
}));
