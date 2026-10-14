/* MOMENT — small, dependency-free WebGL2 studio renderer. */
(() => {
  'use strict';
  const PI = Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const vsub = (a,b) => a.map((v,i)=>v-b[i]);
  const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => {const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
  const identity = () => new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function multiply(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
  function matrix(x=0,y=0,z=0,rx=0,ry=0,rz=0){const t=identity();t[12]=x;t[13]=y;t[14]=z;const a=identity(),b=identity(),c=identity();a[5]=a[10]=Math.cos(rx);a[6]=Math.sin(rx);a[9]=-a[6];b[0]=b[10]=Math.cos(ry);b[8]=Math.sin(ry);b[2]=-b[8];c[0]=c[5]=Math.cos(rz);c[1]=Math.sin(rz);c[4]=-c[1];return multiply(t,multiply(c,multiply(b,a)));}
  function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=f/aspect;m[5]=f;m[10]=(far+near)/(near-far);m[11]=-1;m[14]=2*far*near/(near-far);return m;}
  function ortho(l,r,b,t,n,f){const m=identity();m[0]=2/(r-l);m[5]=2/(t-b);m[10]=-2/(f-n);m[12]=-(r+l)/(r-l);m[13]=-(t+b)/(t-b);m[14]=-(f+n)/(f-n);return m;}
  function lookAt(eye,target,up=[0,1,0]){const z=norm(vsub(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
  function projectPoint(p,m,w,h){const a=[...p,1],q=[0,0,0,0];for(let r=0;r<4;r++)for(let c=0;c<4;c++)q[r]+=m[c*4+r]*a[c];return {x:(q[0]/q[3]*.5+.5)*w,y:(-.5*q[1]/q[3]+.5)*h,visible:q[3]>0};}

  function roundedBox(w,h,d,r=.12){
    r=Math.min(r,w*.499,h*.499,d*.499);
    const pos=[],nor=[],uv=[],idx=[],half=[w/2,h/2,d/2],core=half.map(x=>Math.max(1e-7,x-r));
    const axes=[[0,1,2],[1,2,0],[2,0,1]];
    for(const [u,v,n] of axes)for(const sign of [-1,1]){
      const uval=[-half[u],-half[u]+r*.14,-half[u]+r*.5,-half[u]+r,half[u]-r,half[u]-r*.5,half[u]-r*.14,half[u]];
      const vval=[-half[v],-half[v]+r*.14,-half[v]+r*.5,-half[v]+r,half[v]-r,half[v]-r*.5,half[v]-r*.14,half[v]];
      const start=pos.length/3;
      for(let j=0;j<8;j++)for(let i=0;i<8;i++){
        const p=[0,0,0];p[u]=uval[i];p[v]=vval[j];p[n]=half[n]*sign;
        const q=p.map((x,k)=>clamp(x,-core[k],core[k])),normal=norm(vsub(p,q));
        pos.push(...q.map((x,k)=>x+normal[k]*r));nor.push(...normal);uv.push(i/7,j/7);
      }
      for(let j=0;j<7;j++)for(let i=0;i<7;i++){const a=start+j*8+i,b=a+1,c=a+8,e=c+1;sign>0?idx.push(a,b,c,b,e,c):idx.push(a,c,b,b,c,e);}
    }
    return {pos,nor,uv,idx};
  }
  function cylinder(radius,depth,segments=96,inner=0){
    const pos=[],nor=[],uv=[],idx=[];
    function ring(rad,z,nz){const s=pos.length/3;for(let i=0;i<=segments;i++){const a=i/segments*PI*2;pos.push(Math.cos(a)*rad,Math.sin(a)*rad,z);nor.push(0,0,nz);uv.push(Math.cos(a)*rad/radius*.5+.5,Math.sin(a)*rad/radius*.5+.5);}return s;}
    for(const side of [-1,1]){const outer=ring(radius,depth/2*side,side),inside=ring(inner,depth/2*side,side);for(let i=0;i<segments;i++){const a=outer+i,b=inside+i;side>0?idx.push(a,a+1,b,a+1,b+1,b):idx.push(a,b,a+1,a+1,b,b+1);}}
    for(const rad of inner?[radius,inner]:[radius]){const start=pos.length/3,ns=rad===radius?1:-1;for(let i=0;i<=segments;i++){const a=i/segments*PI*2;for(const z of [-depth/2,depth/2]){pos.push(Math.cos(a)*rad,Math.sin(a)*rad,z);nor.push(Math.cos(a)*ns,Math.sin(a)*ns,0);uv.push(i/segments,z/depth+.5);}}for(let i=0;i<segments;i++){const a=start+i*2;ns>0?idx.push(a,a+2,a+1,a+2,a+3,a+1):idx.push(a,a+1,a+2,a+2,a+1,a+3);}}
    return {pos,nor,uv,idx};
  }
  function plane(w,h){return {pos:[-w/2,-h/2,0,w/2,-h/2,0,w/2,h/2,0,-w/2,h/2,0],nor:[0,0,1,0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,1,1,0,1],idx:[0,1,2,0,2,3]};}

  const vertex=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aNormal; layout(location=2) in vec2 aUV;
  uniform mat4 uModel,uVP,uLightVP;out vec3 vPosition,vNormal;out vec2 vUV;out vec4 vLight;
  void main(){vec4 world=uModel*vec4(aPosition,1.);vPosition=world.xyz;vNormal=mat3(uModel)*aNormal;vUV=aUV;vLight=uLightVP*world;gl_Position=uVP*world;}`;
  const fragment=`#version 300 es
  precision highp float;
  in vec3 vPosition,vNormal;in vec2 vUV;in vec4 vLight;
  uniform vec3 uColor,uEye;uniform float uRoughness,uMetal,uEmission,uTime,uFlash;uniform int uKind,uHasTexture;
  uniform sampler2D uTexture,uShadow;out vec4 outColor;
  float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  vec3 environment(vec3 r){vec3 c=mix(vec3(.065,.083,.065),vec3(.38,.44,.37),smoothstep(-.4,1.,r.y));float softbox=pow(max(dot(r,normalize(vec3(-3.,5.,5.))),0.),16.);float strip=pow(max(dot(r,normalize(vec3(3.,2.,1.))),0.),60.);float rim=pow(max(dot(r,normalize(vec3(2.,1.,-4.))),0.),12.);return c+softbox*vec3(2.3,2.1,1.65)+strip*vec3(.8,1.15,1.3)+rim*vec3(.7,.35,.12);}
  float shadow(vec3 N,vec3 L){vec3 p=vLight.xyz/vLight.w*.5+.5;if(p.z>1.||p.x<0.||p.x>1.||p.y<0.||p.y>1.)return 1.;float s=0.;float bias=max(.0015*(1.-dot(N,L)),.00035);for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){float d=texture(uShadow,p.xy+vec2(x,y)/2048.).r;s+=p.z-bias>d?.48:1.;}return s/9.;}
  void main(){
    if(uKind==4){vec2 p=(vUV-.5)*2.;float a=exp(-dot(p*vec2(1.,1.4),p*vec2(1.,1.4))*3.)*.62;outColor=vec4(.025,.03,.018,a);return;}
    vec3 N=normalize(vNormal),V=normalize(uEye-vPosition),L=normalize(vec3(-3.5,6.,5.)),H=normalize(L+V);
    vec3 base=uColor;float alpha=1.;if(uHasTexture==1){vec4 tex=texture(uTexture,vUV);base*=pow(tex.rgb,vec3(2.2));alpha=tex.a;if(alpha<.05)discard;}
    float noise=hash(vPosition*780.);base*=1.+(noise-.5)*.05*uRoughness;
    float NoV=max(dot(N,V),.001),NoL=max(dot(N,L),.0),NoH=max(dot(N,H),.0);float r=max(.075,uRoughness),a=r*r,a2=a*a;
    float den=NoH*NoH*(a2-1.)+1.;float D=a2/(3.14159*den*den+.0001);float k=(r+1.)*(r+1.)/8.;
    float G=NoV/(NoV*(1.-k)+k)*NoL/(NoL*(1.-k)+k);vec3 F0=mix(vec3(.04),base,uMetal);vec3 F=F0+(1.-F0)*pow(1.-max(dot(H,V),0.),5.);
    vec3 spec=D*G*F/(4.*NoV*max(NoL,.01)+.001);float sh=shadow(N,L);
    vec3 c=((1.-F)*(1.-uMetal)*base/3.14159+spec)*vec3(3.5,3.18,2.55)*NoL*sh;
    c+=base*mix(vec3(.15,.19,.14),vec3(.5,.54,.42),N.y*.5+.5)*(.8-.35*uMetal);
    float fill=max(dot(N,normalize(vec3(4.,2.,2.))),0.);c+=base*fill*vec3(.18,.25,.26);
    vec3 env=environment(reflect(-V,N));c+=env*(F0+(1.-F0)*pow(1.-NoV,5.))*(1.-r*.73)*.55;
    if(uKind==1){vec3 R=reflect(-V,N);float fres=pow(1.-NoV,3.);vec3 glass=vec3(.007,.025,.026);glass+=environment(R)*(.18+fres*.5);float circle=length(vUV-.5);glass+=vec3(.04,.13,.12)*smoothstep(.3,.48,circle);float flare=pow(max(dot(R,normalize(vec3(-.8,1.2,2.))),0.),75.);glass+=vec3(.32,.6,.55)*flare;glass+=vec3(.08,.035,.085)*pow(max(dot(R,normalize(vec3(.8,-.7,2.))),0.),90.);c=glass;}
    c+=base*uEmission;c+=vec3(.8,.7,.5)*uFlash*NoL*.45;
    c=c/(c+vec3(1.));c=pow(c,vec3(1./2.2));outColor=vec4(c,alpha);
  }`;
  const depthVertex=`#version 300 es
  layout(location=0)in vec3 aPosition;uniform mat4 uModel,uVP;void main(){gl_Position=uVP*uModel*vec4(aPosition,1.);}`;
  const depthFragment=`#version 300 es
  precision highp float;void main(){}`;

  class CameraStudio {
    constructor(canvas,onShutter){
      this.canvas=canvas;this.onShutter=onShutter;this.yaw=.24;this.pitch=.19;this.targetYaw=.24;this.targetPitch=.19;this.distance=9.7;this.targetDistance=9.7;this.meshes=[];this.textures=[];this.frameCount=0;this.flash=0;this.eject=0;this.float=0;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.gl=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:false});
      if(!this.gl)throw new Error('WebGL2 unavailable');
      const gl=this.gl;this.program=this.programFrom(vertex,fragment);this.depthProgram=this.programFrom(depthVertex,depthFragment);
      this.locations={};for(const n of ['uModel','uVP','uLightVP','uColor','uEye','uRoughness','uMetal','uEmission','uTime','uFlash','uKind','uHasTexture','uTexture','uShadow'])this.locations[n]=gl.getUniformLocation(this.program,n);
      this.depthLoc={model:gl.getUniformLocation(this.depthProgram,'uModel'),vp:gl.getUniformLocation(this.depthProgram,'uVP')};
      this.lightVP=multiply(ortho(-6,6,-6,6,.1,25),lookAt([-4,7,7],[0,0,0]));
      this.shadowTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.shadowTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,2048,2048,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.shadowBuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowBuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.shadowTexture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Shadow framebuffer unavailable');gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
      this.buildCamera();this.bindInput();this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
      this.started=performance.now();this.render=this.render.bind(this);this.raf=requestAnimationFrame(this.render);
      document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(this.raf);this.raf=0;}else if(!this.raf)this.raf=requestAnimationFrame(this.render);});
      canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelAnimationFrame(this.raf);this.raf=0;canvas.dispatchEvent(new CustomEvent('renderer-lost'));});
    }
    programFrom(v,f){const gl=this.gl,p=gl.createProgram();for(const [type,src]of[[gl.VERTEX_SHADER,v],[gl.FRAGMENT_SHADER,f]]){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
    geometry(data){const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);for(const [i,arr,size]of[[0,data.pos,3],[1,data.nor,3],[2,data.uv,2]]){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.STATIC_DRAW);gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,gl.FLOAT,false,0,0);}const b=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(data.idx),gl.STATIC_DRAW);gl.bindVertexArray(null);return {vao,count:data.idx.length};}
    texture(canvas){const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);this.textures.push(t);return t;}
    add(shape,pos,mat={},rot=[0,0,0]){const m={geometry:this.geometry(shape),base:matrix(...pos,...rot),color:[.65,.65,.58],rough:.45,metal:0,emission:0,kind:0,...mat};m.model=m.base;this.meshes.push(m);return m;}
    label(text,w,h,font='600 64px Arial',color='#303b32',bg=null){const c=document.createElement('canvas');c.width=1024;c.height=Math.round(1024*h/w);const x=c.getContext('2d');if(bg){x.fillStyle=bg;x.fillRect(0,0,c.width,c.height);}x.font=font;x.textAlign='center';x.textBaseline='middle';x.fillStyle=color;x.fillText(text,c.width/2,c.height/2);return this.texture(c);}
    buildCamera(){
      const cream={color:[.82,.79,.65],rough:.4},top={color:[.88,.84,.71],rough:.32},black={color:[.019,.025,.022],rough:.48},rubber={color:[.015,.020,.017],rough:.79},metal={color:[.46,.48,.41],rough:.28,metal:.82};
      const box=(s,p,m,r=.12,rot)=>this.add(roundedBox(...s,r),p,m,rot);const cyl=(r,d,p,m,inner=0,rot)=>this.add(cylinder(r,d,96,inner),p,m,rot);
      this.floor=this.add(plane(8.2,5.8),[0,-1.73,0],{color:[0,0,0],kind:4},[-PI/2,0,0]);
      box([4.35,2.48,1.65],[0,.03,0],cream,.23);
      box([4.38,.78,1.72],[0,.97,-.02],top,.2);
      box([4.41,.12,1.65],[0,.59,0],{color:[.11,.13,.1],rough:.7},.04);
      box([4.42,.13,1.67],[0,.64,0],cream,.04);
      box([4.53,.83,1.92],[0,-1.17,.12],black,.16);
      box([4.38,.16,1.75],[0,-1.6,.08],{color:[.041,.049,.036],rough:.5},.06);
      // Front fascia, fine housing seam, film ejection mouth.
      box([4.17,1.55,.11],[0,-.23,.864],top,.1);
      box([3.88,.19,.08],[0,-1.23,1.101],{color:[.005,.01,.006],rough:.88},.045);
      box([3.94,.035,.05],[0,-1.11,1.14],metal,.012);
      box([3.94,.035,.05],[0,-1.345,1.13],{color:[.22,.23,.18],rough:.65},.012);
      for(const x of [-1.7,1.7])box([.13,.15,.1],[x,-1.23,1.08],black,.02);
      // Five authentic, individually raised colour stripes.
      const colors=[[.65,.12,.08],[.9,.32,.08],[.87,.66,.18],[.22,.4,.27],[.17,.35,.42]];
      colors.forEach((c,i)=>box([.078,1.46,.018],[-1.04+i*.084,-.24,.93],{color:c,rough:.4},.005));
      // Flash with prismatic diffuser and black surround.
      box([1.45,.58,.16],[-1.12,.98,.88],black,.085);
      box([1.25,.407,.055],[-1.12,.98,.99],{color:[.6,.65,.55],rough:.17,metal:.5},.035);
      for(let i=0;i<12;i++)box([.054,.36,.024],[-1.677+i*.101,.98,1.027],{color:[.75,.79,.64],rough:.2,metal:.6},.007);
      for(let i=0;i<3;i++)box([1.17,.014,.008],[-1.12,.861+i*.12,1.043],{color:[.23,.29,.22],rough:.3},.004);
      this.flashFace=box([1.19,.37,.012],[-1.12,.98,1.043],{color:[.75,.8,.65],rough:.3,emission:0},.008);this.flashFace.hidden=true;
      // Optical viewfinder, recessed glass and pilot LED.
      box([.63,.51,.2],[1.48,.98,.898],black,.085);
      box([.43,.32,.05],[1.48,.98,1.021],{color:[.13,.23,.19],rough:.15,metal:.4,kind:1},.05);
      box([.26,.18,.015],[1.48,.98,1.053],{color:[.02,.06,.055],rough:.12,kind:1},.025);
      cyl(.047,.014,[.971,.98,.956],{color:[.36,.6,.18],rough:.18,emission:1.3});
      // Layered metal and ribbed rubber lens barrel.
      cyl(.92,.1,[.35,-.17,1.015],{color:[.2,.21,.17],rough:.35,metal:.5});
      cyl(.88,.31,[.35,-.17,1.2],rubber);
      for(let i=0;i<72;i++){const a=i/72*PI*2;box([.021,.07,.29],[.35+Math.cos(a)*.858,-.17+Math.sin(a)*.858,1.2],{color:[.044,.052,.04],rough:.52},.008,[0,0,a-PI/2]);}
      cyl(.80,.045,[.35,-.17,1.385],metal,.716);
      cyl(.745,.073,[.35,-.17,1.429],black,.568);
      cyl(.605,.032,[.35,-.17,1.477],{color:[.1,.125,.095],rough:.22,metal:.8},.54);
      cyl(.548,.017,[.35,-.17,1.49],{color:[.021,.029,.019],rough:.55});
      // Aperture geometry beneath multicoated optical glass.
      for(let i=0;i<7;i++){const a=i/7*2*PI;box([.33,.19,.005],[.35+Math.cos(a)*.18,-.17+Math.sin(a)*.18,1.507],{color:[.029,.052,.048],metal:.65,rough:.24},.013,[0,0,a+.5]);}
      cyl(.40,.005,[.35,-.17,1.523],{color:[.012,.019,.017],kind:1,rough:.12});
      cyl(.496,.007,[.35,-.17,1.515],{color:[.1,.25,.19],rough:.19,metal:.78},.465);
      // Lens typography, rasterized locally onto transparent geometry.
      const lensCanvas=document.createElement('canvas');lensCanvas.width=lensCanvas.height=1024;const lc=lensCanvas.getContext('2d');lc.translate(512,512);lc.fillStyle='#aeb6a2';lc.font='23px Arial';lc.textAlign='center';
      for(const [str,start,step,r]of[['M O M E N T   O P T I C S',-2.37,.073,425],['1 : 8   /   f = 1 0 3 m m',.83,.065,424]]){[...str].forEach((s,i)=>{const a=start+i*step;lc.save();lc.translate(Math.cos(a)*r,Math.sin(a)*r);lc.rotate(a+PI/2);lc.fillText(s,0,0);lc.restore();});}
      this.add(plane(1.56,1.56),[.35,-.17,1.478],{color:[1,1,1],rough:.6,texture:this.texture(lensCanvas)});
      // Soft-touch orange release with brushed rim; click target follows projection.
      cyl(.29,.11,[-1.64,-.05,1.005],black);cyl(.245,.1,[-1.64,-.05,1.104],{color:[.52,.28,.13],rough:.29,metal:.38});
      this.release=cyl(.207,.098,[-1.64,-.05,1.166],{color:[.94,.24,.08],rough:.32});
      this.shutterPosition=[-1.64,-.05,1.24];
      // Light meter, selector and counters.
      cyl(.125,.055,[1.67,-.14,.979],black);cyl(.073,.01,[1.67,-.14,1.012],{color:[.035,.075,.055],kind:1,rough:.15});
      box([.55,.19,.075],[1.63,-.7,.969],black,.04);
      this.add(plane(.4,.14),[1.63,-.7,1.012],{color:[1,1,1],texture:this.label('08',.4,.14,'180px monospace','#bfceb3'),emission:.15});
      this.counter=this.meshes[this.meshes.length-1];
      this.add(plane(1.09,.25),[.27,.98,.853],{color:[1,1,1],rough:.8,texture:this.label('MOMENT',1.09,.25,'600 132px Arial','#394435')});
      this.add(plane(.6,.14),[-1.42,-.61,.935],{color:[1,1,1],rough:.8,texture:this.label('ONE',.6,.14,'70px Arial','#48553f')});
      this.add(plane(1.05,.12),[.29,-.89,.932],{color:[1,1,1],rough:.8,texture:this.label('INSTANT ANALOG CAMERA',1.05,.12,'37px Arial','#53614a')});
      // Side hardware and leather-textured rear panel reward a complete orbit.
      box([.06,.55,.49],[2.192,.02,-.18],metal,.025);box([.1,.22,.24],[2.231,.02,-.18],black,.05);
      box([.07,.56,.47],[-2.192,.02,-.18],metal,.03);box([.1,.22,.24],[-2.23,.02,-.18],black,.05);
      box([3.91,1.91,.085],[0,-.02,-.877],rubber,.13);
      box([3.41,.17,.10],[0,-.88,-.94],black,.04);
      this.add(plane(1.84,.38),[0,.3,-.928],{color:[1,1,1],rough:.8,texture:this.label('MOMENT / ONE',1.84,.38,'75px Arial','#c2c5b4')},[0,PI,0]);
      this.add(plane(1.6,.18),[0,-.05,-.93],{color:[1,1,1],texture:this.label('MADE OF LIGHT',1.6,.18,'42px Arial','#8a9782')},[0,PI,0]);
      for(const x of [-1.77,1.77])for(const y of [-.76,.72]){cyl(.05,.018,[x,y,-.932],metal,0,[0,PI,0]);box([.055,.008,.005],[x,y,-.945],black,.002);}
      // Recessed top plate, rear optical window and a restrained rainbow accent.
      box([2.45,.015,.85],[.25,1.373,-.12],{color:[.74,.73,.6],rough:.48},.005);
      box([.61,.42,.08],[1.48,.97,-.89],black,.06);box([.42,.25,.02],[1.48,.97,-.942],{color:[.1,.2,.13],kind:1,rough:.15},.02);
      for(let i=0;i<5;i++)box([.078,.012,.67],[-1.04+i*.084,1.378,-.12],{color:colors[i],rough:.5},.004);
      this.baseMeshCount=this.meshes.length;
    }
    setCount(n){const gl=this.gl,old=this.counter.texture;this.counter.texture=this.label(String(n).padStart(2,'0'),.4,.14,'180px monospace','#bfceb3');gl.deleteTexture(old);this.textures=this.textures.filter(t=>t!==old);}
    triggerFlash(enabled=true){this.flash=enabled?1:0;this.releasePush=performance.now();}
    reset(){this.targetYaw=.24;this.targetPitch=.19;this.targetDistance=9.7;}
    bindInput(){let down=null,last=null;const c=this.canvas;
      c.addEventListener('pointerdown',e=>{if(e.button!==0)return;down={x:e.clientX,y:e.clientY,id:e.pointerId,yaw:this.targetYaw,pitch:this.targetPitch};last=down;c.setPointerCapture(e.pointerId);c.classList.add('dragging');});
      c.addEventListener('pointermove',e=>{if(!down)return;this.targetYaw=down.yaw+(e.clientX-down.x)*.008;this.targetPitch=clamp(down.pitch+(e.clientY-down.y)*.006,-.42,.85);last={x:e.clientX,y:e.clientY};});
      const release=e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);if(moved<7&&e.type==='pointerup'&&this.vp){const r=c.getBoundingClientRect(),p=projectPoint(this.shutterPosition,this.vp,r.width,r.height);if(Math.hypot(e.clientX-r.left-p.x,e.clientY-r.top-p.y)<35&&Math.cos(this.yaw)>0)this.onShutter();}down=null;last=null;c.classList.remove('dragging');if(c.hasPointerCapture(e.pointerId))c.releasePointerCapture(e.pointerId);};
      c.addEventListener('pointerup',release);c.addEventListener('pointercancel',release);
      c.addEventListener('wheel',e=>{e.preventDefault();this.targetDistance=clamp(this.targetDistance+e.deltaY*.005,7.7,13);},{passive:false});
      c.addEventListener('keydown',e=>{const d=.15;if(e.key==='ArrowLeft')this.targetYaw-=d;else if(e.key==='ArrowRight')this.targetYaw+=d;else if(e.key==='ArrowUp')this.targetPitch=clamp(this.targetPitch-d,-.42,.85);else if(e.key==='ArrowDown')this.targetPitch=clamp(this.targetPitch+d,-.42,.85);else return;e.preventDefault();});
    }
    resize(){const r=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.8);this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));}
    render(now){
      const gl=this.gl;if(gl.isContextLost())return;
      if(this.lastTime&&now-this.lastTime<(this.reduced?80:16)){this.raf=requestAnimationFrame(this.render);return;}
      const t=(now-this.started)*.001,dt=Math.min(.12,(now-(this.lastTime||now-16))*.001);this.lastTime=now;
      const smooth=1-Math.exp(-9*dt);this.yaw+=(this.targetYaw-this.yaw)*smooth;this.pitch+=(this.targetPitch-this.pitch)*smooth;this.distance+=(this.targetDistance-this.distance)*smooth;
      const aspect=this.canvas.width/this.canvas.height,distance=this.distance*Math.max(1,.97/aspect);const target=[0,-.09,0],eye=[Math.sin(this.yaw)*Math.cos(this.pitch)*distance,Math.sin(this.pitch)*distance+.15,Math.cos(this.yaw)*Math.cos(this.pitch)*distance];this.eye=eye;
      this.vp=multiply(perspective(36*PI/180,aspect,.1,50),lookAt(eye,target));this.float=0;
      for(const mesh of this.meshes){mesh.model=mesh===this.floor?mesh.base:multiply(matrix(0,this.float,0),mesh.base);}
      if(this.releasePush){const elapsed=now-this.releasePush;if(elapsed<230)this.release.model=multiply(matrix(0,this.float,-Math.sin(elapsed/230*PI)*.055),this.release.base);else this.releasePush=null;}
      this.flash*=Math.exp(-dt*8);this.flashFace.hidden=this.flash<.1;this.flashFace.emission=this.flash*10;
      // Stable depth shadow pass; no screen-space dependence or outside resources.
      if(this.frameCount===0||this.releasePush||this.shadowRelease){
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowBuffer);gl.viewport(0,0,2048,2048);gl.clear(gl.DEPTH_BUFFER_BIT);gl.useProgram(this.depthProgram);gl.uniformMatrix4fv(this.depthLoc.vp,false,this.lightVP);gl.disable(gl.BLEND);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1.1,2);
      for(const m of this.meshes){if(m.hidden||m===this.floor||m.texture)continue;gl.uniformMatrix4fv(this.depthLoc.model,false,m.model);gl.bindVertexArray(m.geometry.vao);gl.drawElements(gl.TRIANGLES,m.geometry.count,gl.UNSIGNED_SHORT,0);}
      gl.disable(gl.POLYGON_OFFSET_FILL);gl.enable(gl.BLEND);this.shadowRelease=Boolean(this.releasePush);}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
      const u=this.locations;gl.uniformMatrix4fv(u.uVP,false,this.vp);gl.uniformMatrix4fv(u.uLightVP,false,this.lightVP);gl.uniform3fv(u.uEye,eye);gl.uniform1f(u.uTime,t);gl.uniform1f(u.uFlash,this.flash);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.shadowTexture);gl.uniform1i(u.uShadow,1);gl.uniform1i(u.uTexture,0);
      for(const m of this.meshes){if(m.hidden)continue;gl.uniformMatrix4fv(u.uModel,false,m.model);gl.uniform3fv(u.uColor,m.color);gl.uniform1f(u.uRoughness,m.rough);gl.uniform1f(u.uMetal,m.metal);gl.uniform1f(u.uEmission,m.emission);gl.uniform1i(u.uKind,m.kind);gl.uniform1i(u.uHasTexture,m.texture?1:0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,m.texture||null);gl.bindVertexArray(m.geometry.vao);gl.drawElements(gl.TRIANGLES,m.geometry.count,gl.UNSIGNED_SHORT,0);}
      gl.bindVertexArray(null);this.frameCount++;this.raf=requestAnimationFrame(this.render);
    }
    diagnostics(){return {renderer:'WebGL2',frames:this.frameCount,meshes:this.meshes.length,contextLost:this.gl.isContextLost(),canvas:[this.canvas.width,this.canvas.height],yaw:this.yaw,pitch:this.pitch,glError:this.gl.getError()};}
  }
  window.MomentMath={multiply,matrix,perspective,lookAt,projectPoint,roundedBox,cylinder,plane};window.CameraStudio=CameraStudio;
})();
