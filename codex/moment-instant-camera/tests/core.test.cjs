const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'renderer.js'),'utf8'),sandbox);
const {matrix,multiply,perspective,lookAt,projectPoint,roundedBox,cylinder,plane}=sandbox.window.MomentMath;
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('camera focus projects to screen centre from every orbital quadrant',()=>{
  for(const eye of [[0,0,10],[7,4,7],[-7,3,-7],[0,-3,10]]){
    const m=multiply(perspective(Math.PI/5,1.4,.1,50),lookAt(eye,[0,0,0]));
    const p=projectPoint([0,0,0],m,1400,1000);assert.equal(p.visible,true);close(p.x,700,.001);close(p.y,500,.001);
  }
});
test('world translation and camera projection agree on the clickable release button',()=>{
  const m=matrix(-1.64,-.05,1.24),vp=multiply(perspective(Math.PI/5,1,.1,50),lookAt([0,0,10],[0,0,0]));
  const direct=projectPoint([-1.64,-.05,1.24],vp,1000,1000),transformed=projectPoint([0,0,0],multiply(vp,m),1000,1000);
  close(direct.x,transformed.x,.001);close(direct.y,transformed.y,.001);assert.ok(direct.x<500);assert.ok(direct.y>500);
});
test('rotation preserves distances and orthonormal surface normals',()=>{
  const m=matrix(0,0,0,.23,1.76,-.38);for(let i=0;i<3;i++){let length=0;for(let j=0;j<3;j++)length+=m[i*4+j]**2;close(length,1);for(let k=i+1;k<3;k++){let dot=0;for(let j=0;j<3;j++)dot+=m[i*4+j]*m[k*4+j];close(dot,0);}}
});
test('rounded hardware stays inside its specified dimensions, including thin plates',()=>{
  for(const dims of [[4.35,2.48,1.65,.23],[1.19,.37,.012,.008],[.021,.07,.29,.008],[3.94,.035,.05,.012]]){
    const mesh=roundedBox(...dims);for(let i=0;i<mesh.pos.length;i++)assert.ok(Math.abs(mesh.pos[i])<=dims[i%3]/2+1e-7);
  }
});
test('all mesh attributes are finite, normals unit length, indices address real vertices',()=>{
  for(const mesh of [roundedBox(4.4,2.5,1.65,.23),cylinder(.88,.3),cylinder(.75,.1,96,.5),plane(4,4)]){
    assert.equal(mesh.pos.length,mesh.nor.length);assert.equal(mesh.uv.length,mesh.pos.length/3*2);assert.equal(mesh.idx.length%3,0);
    for(const arr of [mesh.pos,mesh.nor,mesh.uv])for(const v of arr)assert.ok(Number.isFinite(v));
    for(let i=0;i<mesh.nor.length;i+=3)close(Math.hypot(...mesh.nor.slice(i,i+3)),1);
    for(const i of mesh.idx)assert.ok(Number.isInteger(i)&&i>=0&&i<mesh.pos.length/3);
  }
});
test('file-mode entrypoint has ordered non-module scripts and only local resources',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.indexOf('src="renderer.js"')<html.indexOf('src="app.js"'));
  assert.doesNotMatch(html,/<script[^>]*type=["']module/);
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
    const url=match[1];if(url.startsWith('#')||url.startsWith('data:')||url==='./')continue;
    assert.doesNotMatch(url,/^https?:/);assert.ok(fs.existsSync(path.join(root,url)),url);
  }
  const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');assert.doesNotMatch(css,/@import|url\(['"]?https?:/);
});
