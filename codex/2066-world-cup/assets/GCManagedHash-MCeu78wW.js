import{O as e,Q as t,X as n,Z as r,a as i,i as a,nt as o,o as s,p as c,s as l,t as u,ut as d,x as f}from"./Geometry-94-jBm_w.js";var p=new Set,m=!1;function h(e,t,n=2){let r=t&&t.length,i=r?t[0]*n:e.length;p.size&&p.clear();let a=g(e,0,i,n,!0),o=[];if(!a||a.next===a.prev)return o;let s=0,c=0,l=0;if(r&&(a=ne(e,t,a,n)),e.length>80*n){s=e[0],c=e[1];let t=s,r=c;for(let a=n;a<i;a+=n){let n=e[a],i=e[a+1];n<s&&(s=n),i<c&&(c=i),n>t&&(t=n),i>r&&(r=i)}l=Math.max(t-s,r-c),l=l===0?0:32767/l}return v(a,o,s,c,l),o}function g(e,t,n,r,i){let a=null;if(i===Se(e,t,n,r)>0)for(let i=t;i<n;i+=r)a=xe(i/r|0,e[i],e[i+1],a);else for(let i=n-r;i>=t;i-=r)a=xe(i/r|0,e[i],e[i+1],a);return a&&F(a,a.next)&&(R(a),a=a.next),a}function _(e,t=e){let n=t===e,r=e,i;do i=!1,r!==r.next&&(p.size===0||!p.has(r))&&(F(r,r.next)||P(r.prev,r,r.next)===0)?((n||r===t)&&(t=r.prev),m=!0,R(r),r=r.prev,i=!0):(n||r!==t)&&(r=r.next,i=!n);while(i||r!==t);return t}function v(e,t,n,r,i){i&&pe(e,n,r,i);let a=e,o=!1;for(;e.prev!==e.next;){let s=e.prev,c=e.next;if(P(s,e,c)<0&&(i?b(e,n,r,i):y(e))){t.push(s.i,e.i,c.i),R(e),e=c,a=c;continue}if(e=c,e===a){if(m=!1,e=_(e),m){a=e;continue}if(!o){e=ee(e,t),a=e,o=!0;continue}te(e,t,n,r,i);break}}}function y(e){let t=e.prev,n=e,r=e.next,i=t.x,a=n.x,o=r.x,s=t.y,c=n.y,l=r.y,u=Math.min(i,a,o),d=Math.min(s,c,l),f=Math.max(i,a,o),p=Math.max(s,c,l),m=r.next;for(;m!==t;){if(m.x>=u&&m.x<=f&&m.y>=d&&m.y<=p&&!(i===m.x&&s===m.y)&&N(i,s,a,c,o,l,m.x,m.y)&&P(m.prev,m,m.next)>=0)return!1;m=m.next}return!0}function b(e,t,n,r){let i=e.prev,a=e,o=e.next,s=i.x,c=a.x,l=o.x,u=i.y,d=a.y,f=o.y,p=Math.min(s,c,l),m=Math.min(u,d,f),h=Math.max(s,c,l),g=Math.max(u,d,f),_=M(p,m,t,n,r),v=M(h,g,t,n,r),y=e.prevZ;for(;y&&y.z>=_;){if(y.x>=p&&y.x<=h&&y.y>=m&&y.y<=g&&y!==o&&!(s===y.x&&u===y.y)&&N(s,u,c,d,l,f,y.x,y.y)&&P(y.prev,y,y.next)>=0)return!1;y=y.prevZ}let b=e.nextZ;for(;b&&b.z<=v;){if(b.x>=p&&b.x<=h&&b.y>=m&&b.y<=g&&b!==o&&!(s===b.x&&u===b.y)&&N(s,u,c,d,l,f,b.x,b.y)&&P(b.prev,b,b.next)>=0)return!1;b=b.nextZ}return!0}function ee(e,t){let n=e,r=!1;do{let i=n.prev,a=n.next.next;_e(i,n,n.next,a,!1)&&L(i,a)&&L(a,i)&&(t.push(i.i,n.i,a.i),R(n),R(n.next),n=e=a,r=!0),n=n.next}while(n!==e);return r?_(n):n}function te(e,t,n,r,i){let a=e;do{let e=a.next.next;for(;e!==a.prev;){if(a.i!==e.i&&ge(a,e)){let o=be(a,e);a=_(a,a.next),o=_(o,o.next),v(a,t,n,r,i),v(o,t,n,r,i);return}e=e.next}a=a.next}while(a!==e)}var x=!1;function ne(e,t,n,r){let i=[];for(let n=0,a=t.length;n<a;n++){let o=g(e,t[n]*r,n<a-1?t[n+1]*r:e.length,r,!1);o===o.next&&p.add(o),i.push(he(o))}i.sort(re),oe(e.length/r,t.length),se(n,n),x=!0;for(let e=0;e<i.length;e++)n=ie(i[e],n);return x=!1,_(n)}function re(e,t){return e.x-t.x||e.y-t.y||(e.next.y-e.y)/(e.next.x-e.x)-(t.next.y-t.y)/(t.next.x-t.x)}function ie(e,t){let n=de(e,t);if(!n)return t;let r=be(n,e),i=r.next;return se(n,i.next),_(r,r.next),_(n,n.next)}var ae=16,S=new Float64Array,C=0,w=[],T=[];function oe(e,t){let n=Math.ceil((e+2*t)/ae)+t+2;S.length<n*4&&(S=new Float64Array(n*4)),C=0}function se(e,t){let n=e;do{let e=C++;w[e]=n;let r=1/0,i=1/0,a=-1/0,o=-1/0,s=0;do{let t=n.next;n.z=e,n.x<r&&(r=n.x),n.x>a&&(a=n.x),n.y<i&&(i=n.y),n.y>o&&(o=n.y),t.x<r&&(r=t.x),t.x>a&&(a=t.x),t.y<i&&(i=t.y),t.y>o&&(o=t.y),n=t}while(++s<ae&&n!==t);T[e]=n;let c=e*4;S[c]=r,S[c+1]=i,S[c+2]=a,S[c+3]=o}while(n!==t)}function ce(e,t){let n=e.z*4;t.x<S[n]&&(S[n]=t.x),t.y<S[n+1]&&(S[n+1]=t.y),t.x>S[n+2]&&(S[n+2]=t.x),t.y>S[n+3]&&(S[n+3]=t.y)}function le(e){let t=T[e];for(;t.prev.next!==t;)t=t.next;return T[e]=t,t}function ue(e){let t=w[e];for(;t.prev.next!==t;)t=t.next;return w[e]=t,t}function de(e,t){let n=t,r=e.x,i=e.y,a=-1/0,o;if(F(e,n))return n;for(let t=0,s=0;t<C;t++,s+=4){if(i<S[s+1]||i>S[s+3]||S[s]>r||S[s+2]<=a)continue;let c=le(t);n=ue(t);do{if(n.prev.next===n){if(F(e,n.next))return n.next;if(i<=n.y&&i>=n.next.y&&n.next.y!==n.y){let e=n.x+(i-n.y)*(n.next.x-n.x)/(n.next.y-n.y);if(e<=r&&e>a&&(a=e,o=n.x<n.next.x?n:n.next,e===r))return o}}n=n.next}while(n!==c)}if(!o)return null;let s=o.x,c=o.y,l=Math.min(i,c),u=Math.max(i,c),d=1/0;for(let t=0,f=0;t<C;t++,f+=4){if(S[f+2]<s||S[f]>r||S[f+3]<l||S[f+1]>u)continue;let p=le(t);n=ue(t);do{if(n.prev.next===n&&r>=n.x&&n.x>=s&&r!==n.x&&N(i<c?r:a,i,s,c,i<c?a:r,i,n.x,n.y)){let t=Math.abs(i-n.y)/(r-n.x);(L(n,e)||n.y===i&&n.next.y===i&&n.next.x>r)&&(t<d||t===d&&(n.x>o.x||n.x===o.x&&fe(o,n)))&&(o=n,d=t)}n=n.next}while(n!==p)}return o}function fe(e,t){return P(e.prev,e,t.prev)<0&&P(t.next,e,e.next)<0}var E=[],D=[],O=new Uint32Array,k=new Uint32Array,A=new Uint32Array(256);function pe(e,t,n,r){let i=e,a=0;do i.z=M(i.x,i.y,t,n,r),E[a++]=i,i=i.next;while(i!==e);me(a);let o=null;for(let e=0;e<a;e++){let t=E[e];t.prevZ=o,o&&(o.nextZ=t),o=t}o.nextZ=null}function me(e){if(e<=32){for(let t=1;t<e;t++){let e=E[t],n=e.z,r=t-1;for(;r>=0&&E[r].z>n;)E[r+1]=E[r],r--;E[r+1]=e}return}O.length<e&&(O=new Uint32Array(e),k=new Uint32Array(e),D=Array(e));for(let t=0;t<e;t++)O[t]=E[t].z;j(e,E,O,D,k,0),j(e,D,k,E,O,8),j(e,E,O,D,k,16),j(e,D,k,E,O,24)}function j(e,t,n,r,i,a){A.fill(0);for(let t=0;t<e;t++)A[n[t]>>>a&255]++;let o=0;for(let e=0;e<256;e++){let t=A[e];A[e]=o,o+=t}for(let o=0;o<e;o++){let e=n[o],s=A[e>>>a&255]++;r[s]=t[o],i[s]=e}}function M(e,t,n,r,i){return e=(e-n)*i|0,t=(t-r)*i|0,e=(e|e<<8)&16711935,e=(e|e<<4)&252645135,e=(e|e<<2)&858993459,e=(e|e<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,e|t<<1}function he(e){let t=e,n=e;do(t.x<n.x||t.x===n.x&&t.y<n.y)&&(n=t),t=t.next;while(t!==e);return n}function N(e,t,n,r,i,a,o,s){return(i-o)*(t-s)>=(e-o)*(a-s)&&(e-o)*(r-s)>=(n-o)*(t-s)&&(n-o)*(a-s)>=(i-o)*(r-s)}function ge(e,t){let n=F(e,t)&&P(e.prev,e,e.next)>0&&P(t.prev,t,t.next)>0;return e.next.i!==t.i&&(n||L(e,t)&&L(t,e)&&(P(e.prev,e,t.prev)!==0||P(e,t.prev,t)!==0))&&!ve(e,t)&&(n||ye(e,t))}function P(e,t,n){return(t.y-e.y)*(n.x-t.x)-(t.x-e.x)*(n.y-t.y)}function F(e,t){return e.x===t.x&&e.y===t.y}function _e(e,t,n,r,i=!0){let a=P(e,t,n),o=P(e,t,r),s=P(n,r,e),c=P(n,r,t);return(a>0&&o<0||a<0&&o>0)&&(s>0&&c<0||s<0&&c>0)?!0:i?!!(a===0&&I(e,n,t)||o===0&&I(e,r,t)||s===0&&I(n,e,r)||c===0&&I(n,t,r)):!1}function I(e,t,n){return t.x<=Math.max(e.x,n.x)&&t.x>=Math.min(e.x,n.x)&&t.y<=Math.max(e.y,n.y)&&t.y>=Math.min(e.y,n.y)}function ve(e,t){let n=Math.min(e.x,t.x),r=Math.max(e.x,t.x),i=Math.min(e.y,t.y),a=Math.max(e.y,t.y),o=e;do{let s=o.next;if(o.x>r&&s.x>r||o.x<n&&s.x<n||o.y>a&&s.y>a||o.y<i&&s.y<i){o=s;continue}if(o.i!==e.i&&s.i!==e.i&&o.i!==t.i&&s.i!==t.i&&_e(o,s,e,t))return!0;o=s}while(o!==e);return!1}function L(e,t){return P(e.prev,e,e.next)<0?P(e,t,e.next)>=0&&P(e,e.prev,t)>=0:P(e,t,e.prev)<0||P(e,e.next,t)<0}function ye(e,t){let n=e,r=!1,i=(e.x+t.x)/2,a=(e.y+t.y)/2;do{let e=n.next;n.y>a!=e.y>a&&i<(e.x-n.x)*(a-n.y)/(e.y-n.y)+n.x&&(r=!r),n=e}while(n!==e);return r}function be(e,t){let n=z(e.i,e.x,e.y),r=z(t.i,t.x,t.y),i=e.next,a=t.prev;return e.next=t,t.prev=e,n.next=i,i.prev=n,r.next=n,n.prev=r,a.next=r,r.prev=a,r}function xe(e,t,n,r){let i=z(e,t,n);return r?(i.next=r.next,i.prev=r,r.next.prev=i,r.next=i):(i.prev=i,i.next=i),i}function R(e){e.next.prev=e.prev,e.prev.next=e.next,e.prevZ&&(e.prevZ.nextZ=e.nextZ),e.nextZ&&(e.nextZ.prevZ=e.prevZ),x&&ce(e.prev,e.next)}function z(e,t,n){return{i:e,x:t,y:n,prev:null,next:null,z:0,prevZ:null,nextZ:null}}function Se(e,t,n,r){let i=0;for(let a=t,o=n-r;a<n;a+=r)i+=(e[o]-e[a])*(e[a+1]+e[o+1]),o=a;return i}var Ce=h.default||h,B=class{constructor(e){typeof e==`number`?this.rawBinaryData=new ArrayBuffer(e):e instanceof Uint8Array?this.rawBinaryData=e.buffer:this.rawBinaryData=e,this.uint32View=new Uint32Array(this.rawBinaryData),this.float32View=new Float32Array(this.rawBinaryData),this.size=this.rawBinaryData.byteLength}get int8View(){return this._int8View||=new Int8Array(this.rawBinaryData),this._int8View}get uint8View(){return this._uint8View||=new Uint8Array(this.rawBinaryData),this._uint8View}get int16View(){return this._int16View||=new Int16Array(this.rawBinaryData),this._int16View}get int32View(){return this._int32View||=new Int32Array(this.rawBinaryData),this._int32View}get float64View(){return this._float64Array||=new Float64Array(this.rawBinaryData),this._float64Array}get bigUint64View(){return this._bigUint64Array||=new BigUint64Array(this.rawBinaryData),this._bigUint64Array}view(e){return this[`${e}View`]}destroy(){this.rawBinaryData=null,this.uint32View=null,this.float32View=null,this.uint16View=null,this._int8View=null,this._uint8View=null,this._int16View=null,this._int32View=null,this._float64Array=null,this._bigUint64Array=null}static sizeOf(e){switch(e){case`int8`:case`uint8`:return 1;case`int16`:case`uint16`:return 2;case`int32`:case`uint32`:case`float32`:return 4;default:throw Error(`${e} isn't a valid view type`)}}};function V(e,t,n,r){if(n??=0,r??=Math.min(e.byteLength-n,t.byteLength),!(n&7)&&!(r&7)){let i=r/8;new Float64Array(t,0,i).set(new Float64Array(e,n,i))}else if(!(n&3)&&!(r&3)){let i=r/4;new Float32Array(t,0,i).set(new Float32Array(e,n,i))}else new Uint8Array(t).set(new Uint8Array(e,n,r))}var we={normal:`normal-npm`,add:`add-npm`,screen:`screen-npm`},Te=(e=>(e[e.DISABLED=0]=`DISABLED`,e[e.RENDERING_MASK_ADD=1]=`RENDERING_MASK_ADD`,e[e.MASK_ACTIVE=2]=`MASK_ACTIVE`,e[e.INVERSE_MASK_ACTIVE=3]=`INVERSE_MASK_ACTIVE`,e[e.RENDERING_MASK_REMOVE=4]=`RENDERING_MASK_REMOVE`,e[e.NONE=5]=`NONE`,e))(Te||{});function H(e,t){return t.alphaMode===`no-premultiply-alpha`&&we[e]||e}var Ee=[`precision mediump float;`,`void main(void){`,`float test = 0.1;`,`%forloop%`,`gl_FragColor = vec4(0.0);`,`}`].join(`
`);function De(e){let t=``;for(let n=0;n<e;++n)n>0&&(t+=`
else `),n<e-1&&(t+=`if(test == ${n}.0){}`);return t}function Oe(e,t){if(e===0)throw Error("Invalid value of `0` passed to `checkMaxIfStatementsInShader`");let n=t.createShader(t.FRAGMENT_SHADER);try{for(;;){let r=Ee.replace(/%forloop%/gi,De(e));if(t.shaderSource(n,r),t.compileShader(n),!t.getShaderParameter(n,t.COMPILE_STATUS))e=e/2|0;else break}}finally{t.deleteShader(n)}return e}var U=null;function ke(){if(U)return U;let t=e();return U=t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),U=Oe(U,t),t.getExtension(`WEBGL_lose_context`)?.loseContext(),U}var Ae=class{constructor(){this.ids=Object.create(null),this.textures=[],this.count=0}clear(){for(let e=0;e<this.count;e++){let t=this.textures[e];this.textures[e]=null,this.ids[t.uid]=null}this.count=0}},je=class{constructor(){this.renderPipeId=`batch`,this.action=`startBatch`,this.start=0,this.size=0,this.textures=new Ae,this.blendMode=`normal`,this.topology=`triangle-strip`,this.canBundle=!0}destroy(){this.textures=null,this.gpuBindGroup=null,this.bindGroup=null,this.batcher=null,this.elements=null}},W=[],G=0;n.register({clear:()=>{if(W.length>0)for(let e of W)e&&e.destroy();W.length=0,G=0}});function Me(){return G>0?W[--G]:new je}function Ne(e){e.elements=null,W[G++]=e}var K=0,Pe=class e{constructor(n){this.uid=o(`batcher`),this.dirty=!0,this.batchIndex=0,this.batches=[],this._elements=[],n={...e.defaultOptions,...n},n.maxTextures||(t(`v8.8.0`,`maxTextures is a required option for Batcher now, please pass it in the options`),n.maxTextures=ke());let{maxTextures:r,attributesInitialSize:i,indicesInitialSize:a}=n;this.attributeBuffer=new B(i*4),this.indexBuffer=new Uint16Array(a),this.maxTextures=r}begin(){this.elementSize=0,this.elementStart=0,this.indexSize=0,this.attributeSize=0;for(let e=0;e<this.batchIndex;e++)Ne(this.batches[e]);this.batchIndex=0,this._batchIndexStart=0,this._batchIndexSize=0,this.dirty=!0}add(e){this._elements[this.elementSize++]=e,e._indexStart=this.indexSize,e._attributeStart=this.attributeSize,e._batcher=this,this.indexSize+=e.indexSize,this.attributeSize+=e.attributeSize*this.vertexSize}checkAndUpdateTexture(e,t){let n=e._batch.textures.ids[t._source.uid];return!n&&n!==0?!1:(e._textureId=n,e.texture=t,!0)}updateElement(e){this.dirty=!0;let t=this.attributeBuffer;e.packAsQuad?this.packQuadAttributes(e,t.float32View,t.uint32View,e._attributeStart,e._textureId):this.packAttributes(e,t.float32View,t.uint32View,e._attributeStart,e._textureId)}break(e){let t=this._elements;if(!t[this.elementStart])return;let n=Me(),r=n.textures;r.clear();let i=t[this.elementStart],a=H(i.blendMode,i.texture._source),o=i.topology;this.attributeSize*4>this.attributeBuffer.size&&this._resizeAttributeBuffer(this.attributeSize*4),this.indexSize>this.indexBuffer.length&&this._resizeIndexBuffer(this.indexSize);let s=this.attributeBuffer.float32View,c=this.attributeBuffer.uint32View,l=this.indexBuffer,u=this._batchIndexSize,d=this._batchIndexStart,f=`startBatch`,p=[],m=this.maxTextures;for(let i=this.elementStart;i<this.elementSize;++i){let h=t[i];t[i]=null;let g=h.texture._source,_=H(h.blendMode,g),v=a!==_||o!==h.topology;if(g._batchTick===K&&!v){h._textureId=g._textureBindLocation,u+=h.indexSize,h.packAsQuad?(this.packQuadAttributes(h,s,c,h._attributeStart,h._textureId),this.packQuadIndex(l,h._indexStart,h._attributeStart/this.vertexSize)):(this.packAttributes(h,s,c,h._attributeStart,h._textureId),this.packIndex(h,l,h._indexStart,h._attributeStart/this.vertexSize)),h._batch=n,p.push(h);continue}g._batchTick=K,(r.count>=m||v)&&(this._finishBatch(n,d,u-d,r,a,o,e,f,p),f=`renderBatch`,d=u,a=_,o=h.topology,n=Me(),r=n.textures,r.clear(),p=[],++K),h._textureId=g._textureBindLocation=r.count,r.ids[g.uid]=r.count,r.textures[r.count++]=g,h._batch=n,p.push(h),u+=h.indexSize,h.packAsQuad?(this.packQuadAttributes(h,s,c,h._attributeStart,h._textureId),this.packQuadIndex(l,h._indexStart,h._attributeStart/this.vertexSize)):(this.packAttributes(h,s,c,h._attributeStart,h._textureId),this.packIndex(h,l,h._indexStart,h._attributeStart/this.vertexSize))}r.count>0&&(this._finishBatch(n,d,u-d,r,a,o,e,f,p),d=u,++K),this.elementStart=this.elementSize,this._batchIndexStart=d,this._batchIndexSize=u}_finishBatch(e,t,n,r,i,a,o,s,c){e.gpuBindGroup=null,e.bindGroup=null,e.action=s,e.batcher=this,e.textures=r,e.blendMode=i,e.topology=a,e.start=t,e.size=n,e.elements=c,++K,this.batches[this.batchIndex++]=e,o.add(e)}finish(e){this.break(e)}ensureAttributeBuffer(e){e*4<=this.attributeBuffer.size||this._resizeAttributeBuffer(e*4)}ensureIndexBuffer(e){e<=this.indexBuffer.length||this._resizeIndexBuffer(e)}_resizeAttributeBuffer(e){let t=new B(Math.max(e,this.attributeBuffer.size*2));V(this.attributeBuffer.rawBinaryData,t.rawBinaryData),this.attributeBuffer=t}_resizeIndexBuffer(e){let t=this.indexBuffer,n=Math.max(e,t.length*1.5);n+=n%2;let r=n>65535?new Uint32Array(n):new Uint16Array(n);if(r.BYTES_PER_ELEMENT!==t.BYTES_PER_ELEMENT)for(let e=0;e<t.length;e++)r[e]=t[e];else V(t.buffer,r.buffer);this.indexBuffer=r}packQuadIndex(e,t,n){e[t]=n+0,e[t+1]=n+1,e[t+2]=n+2,e[t+3]=n+0,e[t+4]=n+2,e[t+5]=n+3}packIndex(e,t,n,r){let i=e.indices,a=e.indexSize,o=e.indexOffset,s=e.attributeOffset;for(let e=0;e<a;e++)t[n++]=r+i[e+o]-s}destroy(e={}){if(this.batches!==null){for(let e=0;e<this.batchIndex;e++)Ne(this.batches[e]);this.batches=null,this.geometry.destroy(!0),this.geometry=null,e.shader&&(this.shader?.destroy(),this.shader=null);for(let e=0;e<this._elements.length;e++)this._elements[e]&&(this._elements[e]._batch=null);this._elements=null,this.indexBuffer=null,this.attributeBuffer.destroy(),this.attributeBuffer=null}}};Pe.defaultOptions={maxTextures:null,attributesInitialSize:4,indicesInitialSize:6};var Fe=Pe,Ie=new Float32Array(1),Le=new Uint32Array(1),Re=class extends u{constructor(){let e=new a({data:Ie,label:`attribute-batch-buffer`,usage:i.VERTEX|i.COPY_DST,shrinkToFit:!1}),t=new a({data:Le,label:`index-batch-buffer`,usage:i.INDEX|i.COPY_DST,shrinkToFit:!1});super({attributes:{aPosition:{buffer:e,format:`float32x2`,stride:24,offset:0},aUV:{buffer:e,format:`float32x2`,stride:24,offset:8},aColor:{buffer:e,format:`unorm8x4`,stride:24,offset:16},aTextureIdAndRound:{buffer:e,format:`uint16x2`,stride:24,offset:20}},indexBuffer:t})}};function ze(e,t,n){if(e)for(let i in e){let a=t[i.toLocaleLowerCase()];if(a){let t=e[i];i===`header`&&(t=t.replace(/@in\s+[^;]+;\s*/g,``).replace(/@out\s+[^;]+;\s*/g,``)),n&&a.push(`//----${n}----//`),a.push(t)}else r(`${i} placement hook does not exist in shader`)}}var Be=/\{\{(.*?)\}\}/g;function q(e){let t={};return(e.match(Be)?.map(e=>e.replace(/[{()}]/g,``))??[]).forEach(e=>{t[e]=[]}),t}function Ve(e,t){let n,r=/@in\s+([^;]+);/g;for(;(n=r.exec(e))!==null;)t.push(n[1])}function J(e,t,n=!1){let r=[];Ve(t,r),e.forEach(e=>{e.header&&Ve(e.header,r)});let i=r;n&&i.sort();let a=i.map((e,t)=>`       @location(${t}) ${e},`).join(`
`),o=t.replace(/@in\s+[^;]+;\s*/g,``);return o=o.replace(`{{in}}`,`
${a}
`),o}function He(e,t){let n,r=/@out\s+([^;]+);/g;for(;(n=r.exec(e))!==null;)t.push(n[1])}function Ue(e){let t=/\b(\w+)\s*:/g.exec(e);return t?t[1]:``}function We(e){return e.replace(/@.*?\s+/g,``)}function Ge(e,t){let n=[];He(t,n),e.forEach(e=>{e.header&&He(e.header,n)});let r=0,i=n.sort().map(e=>e.indexOf(`builtin`)>-1?e:`@location(${r++}) ${e}`).join(`,
`),a=n.sort().map(e=>`       var ${We(e)};`).join(`
`),o=`return VSOutput(
            ${n.sort().map(e=>` ${Ue(e)}`).join(`,
`)});`,s=t.replace(/@out\s+[^;]+;\s*/g,``);return s=s.replace(`{{struct}}`,`
${i}
`),s=s.replace(`{{start}}`,`
${a}
`),s=s.replace(`{{return}}`,`
${o}
`),s}function Y(e,t){let n=e;for(let e in t){let r=t[e];n=r.join(`
`).length?n.replace(`{{${e}}}`,`//-----${e} START-----//
${r.join(`
`)}
//----${e} FINISH----//`):n.replace(`{{${e}}}`,``)}return n}var X=Object.create(null),Z=new Map,Ke=0;function qe({template:e,bits:t}){let n=Xe(e,t);if(X[n])return X[n];let{vertex:r,fragment:i}=Ye(e,t);return X[n]=Ze(r,i,t),X[n]}function Je({template:e,bits:t}){let n=Xe(e,t);return X[n]||(X[n]=Ze(e.vertex,e.fragment,t)),X[n]}function Ye(e,t){let n=t.map(e=>e.vertex).filter(e=>!!e),r=t.map(e=>e.fragment).filter(e=>!!e),i=J(n,e.vertex,!0);i=Ge(n,i);let a=J(r,e.fragment,!0);return{vertex:i,fragment:a}}function Xe(e,t){return t.map(e=>(Z.has(e)||Z.set(e,Ke++),Z.get(e))).sort((e,t)=>e-t).join(`-`)+e.vertex+e.fragment}function Ze(e,t,n){let r=q(e),i=q(t);return n.forEach(e=>{ze(e.vertex,r,e.name),ze(e.fragment,i,e.name)}),{vertex:Y(e,r),fragment:Y(t,i)}}var Qe=`
    @in aPosition: vec2<f32>;
    @in aUV: vec2<f32>;

    @out @builtin(position) vPosition: vec4<f32>;
    @out vUV : vec2<f32>;
    @out vColor : vec4<f32>;

    {{header}}

    struct VSOutput {
        {{struct}}
    };

    @vertex
    fn main( {{in}} ) -> VSOutput {

        var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
        var modelMatrix = mat3x3<f32>(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        var position = aPosition;
        var uv = aUV;

        {{start}}

        vColor = vec4<f32>(1., 1., 1., 1.);

        {{main}}

        vUV = uv;

        var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;

        vPosition =  vec4<f32>((modelViewProjectionMatrix *  vec3<f32>(position, 1.0)).xy, 0.0, 1.0);

        vColor *= globalUniforms.uWorldColorAlpha;

        {{end}}

        {{return}}
    };
`,$e=`
    @in vUV : vec2<f32>;
    @in vColor : vec4<f32>;

    {{header}}

    @fragment
    fn main(
        {{in}}
      ) -> @location(0) vec4<f32> {

        {{start}}

        var outColor:vec4<f32>;

        {{main}}

        var finalColor:vec4<f32> = outColor * vColor;

        {{end}}

        return finalColor;
      };
`,et=`
    in vec2 aPosition;
    in vec2 aUV;

    out vec4 vColor;
    out vec2 vUV;

    {{header}}

    void main(void){

        mat3 worldTransformMatrix = uWorldTransformMatrix;
        mat3 modelMatrix = mat3(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
          );
        vec2 position = aPosition;
        vec2 uv = aUV;

        {{start}}

        vColor = vec4(1.);

        {{main}}

        vUV = uv;

        mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;

        gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);

        vColor *= uWorldColorAlpha;

        {{end}}
    }
`,tt=`

    in vec4 vColor;
    in vec2 vUV;

    out vec4 finalColor;

    {{header}}

    void main(void) {

        {{start}}

        vec4 outColor;

        {{main}}

        finalColor = outColor * vColor;

        {{end}}
    }
`,nt={name:`global-uniforms-bit`,vertex:{header:`
        struct GlobalUniforms {
            uProjectionMatrix:mat3x3<f32>,
            uWorldTransformMatrix:mat3x3<f32>,
            uWorldColorAlpha: vec4<f32>,
            uResolution: vec2<f32>,
        }

        @group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
        `}},rt={name:`global-uniforms-ubo-bit`,vertex:{header:`
          uniform globalUniforms {
            mat3 uProjectionMatrix;
            mat3 uWorldTransformMatrix;
            vec4 uWorldColorAlpha;
            vec2 uResolution;
          };
        `}},it={name:`global-uniforms-bit`,vertex:{header:`
          uniform mat3 uProjectionMatrix;
          uniform mat3 uWorldTransformMatrix;
          uniform vec4 uWorldColorAlpha;
          uniform vec2 uResolution;
        `}};function at({bits:e,name:t}){let n=qe({template:{fragment:$e,vertex:Qe},bits:[nt,...e]});return c.from({name:t,vertex:{source:n.vertex,entryPoint:`main`},fragment:{source:n.fragment,entryPoint:`main`}})}function ot({bits:e,name:t}){return new f({name:t,...Je({template:{vertex:et,fragment:tt},bits:[it,...e]})})}var st={name:`color-bit`,vertex:{header:`
            @in aColor: vec4<f32>;
        `,main:`
            vColor *= vec4<f32>(aColor.rgb * aColor.a, aColor.a);
        `}},ct={name:`color-bit`,vertex:{header:`
            in vec4 aColor;
        `,main:`
            vColor *= vec4(aColor.rgb * aColor.a, aColor.a);
        `}},lt={};function ut(e){let t=[];if(e===1)t.push(`@group(1) @binding(0) var textureSource1: texture_2d<f32>;`),t.push(`@group(1) @binding(1) var textureSampler1: sampler;`);else{let n=0;for(let r=0;r<e;r++)t.push(`@group(1) @binding(${n++}) var textureSource${r+1}: texture_2d<f32>;`),t.push(`@group(1) @binding(${n++}) var textureSampler${r+1}: sampler;`)}return t.join(`
`)}function dt(e){let t=[];if(e===1)t.push(`outColor = textureSampleGrad(textureSource1, textureSampler1, vUV, uvDx, uvDy);`);else{t.push(`switch vTextureId {`);for(let n=0;n<e;n++)n===e-1?t.push(`  default:{`):t.push(`  case ${n}:{`),t.push(`      outColor = textureSampleGrad(textureSource${n+1}, textureSampler${n+1}, vUV, uvDx, uvDy);`),t.push(`      break;}`);t.push(`}`)}return t.join(`
`)}function ft(e){return lt[e]||(lt[e]={name:`texture-batch-bit`,vertex:{header:`
                @in aTextureIdAndRound: vec2<u32>;
                @out @interpolate(flat) vTextureId : u32;
            `,main:`
                vTextureId = aTextureIdAndRound.y;
            `,end:`
                if(aTextureIdAndRound.x == 1)
                {
                    vPosition = vec4<f32>(roundPixels(vPosition.xy, globalUniforms.uResolution), vPosition.zw);
                }
            `},fragment:{header:`
                @in @interpolate(flat) vTextureId: u32;

                ${ut(e)}
            `,main:`
                var uvDx = dpdx(vUV);
                var uvDy = dpdy(vUV);

                ${dt(e)}
            `}}),lt[e]}var pt={};function mt(e){let t=[];for(let n=0;n<e;n++)n>0&&t.push(`else`),n<e-1&&t.push(`if(vTextureId < ${n}.5)`),t.push(`{`),t.push(`	outColor = texture(uTextures[${n}], vUV);`),t.push(`}`);return t.join(`
`)}function ht(e){return pt[e]||(pt[e]={name:`texture-batch-bit`,vertex:{header:`
                in vec2 aTextureIdAndRound;
                out float vTextureId;

            `,main:`
                vTextureId = aTextureIdAndRound.y;
            `,end:`
                if(aTextureIdAndRound.x == 1.)
                {
                    gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
                }
            `},fragment:{header:`
                in float vTextureId;

                uniform sampler2D uTextures[${e}];

            `,main:`

                ${mt(e)}
            `}}),pt[e]}var gt={name:`round-pixels-bit`,vertex:{header:`
            fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32>
            {
                return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
            }
        `}},_t={name:`round-pixels-bit`,vertex:{header:`
            vec2 roundPixels(vec2 position, vec2 targetSize)
            {
                return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
            }
        `}},vt={};function yt(e){let t=vt[e];if(t)return t;let n=new Int32Array(e);for(let t=0;t<e;t++)n[t]=t;return t=vt[e]=new l({uTextures:{value:n,type:`i32`,size:e}},{isStatic:!0}),t}var Q=class extends s{constructor(e){let t=ot({name:`batch`,bits:[ct,ht(e),_t]}),n=at({name:`batch`,bits:[st,ft(e),gt]});super({glProgram:t,gpuProgram:n,resources:{batchSamplers:yt(e)}}),this.maxTextures=e}},$=null,bt=class e extends Fe{constructor(t){super(t),this.geometry=new Re,this.name=e.extension.name,this.vertexSize=6,$??=new Q(t.maxTextures),this.shader=$}packAttributes(e,t,n,r,i){let a=i<<16|e.roundPixels&65535,o=e.transform,s=o.a,c=o.b,l=o.c,u=o.d,d=o.tx,f=o.ty,{positions:p,uvs:m}=e,h=e.color,g=e.attributeOffset,_=g+e.attributeSize;for(let e=g;e<_;e++){let i=e*2,o=p[i],g=p[i+1];t[r++]=s*o+l*g+d,t[r++]=u*g+c*o+f,t[r++]=m[i],t[r++]=m[i+1],n[r++]=h,n[r++]=a}}packQuadAttributes(e,t,n,r,i){let a=e.texture,o=e.transform,s=o.a,c=o.b,l=o.c,u=o.d,d=o.tx,f=o.ty,p=e.bounds,m=p.maxX,h=p.minX,g=p.maxY,_=p.minY,v=a.uvs,y=e.color,b=i<<16|e.roundPixels&65535;t[r+0]=s*h+l*_+d,t[r+1]=u*_+c*h+f,t[r+2]=v.x0,t[r+3]=v.y0,n[r+4]=y,n[r+5]=b,t[r+6]=s*m+l*_+d,t[r+7]=u*_+c*m+f,t[r+8]=v.x1,t[r+9]=v.y1,n[r+10]=y,n[r+11]=b,t[r+12]=s*m+l*g+d,t[r+13]=u*g+c*m+f,t[r+14]=v.x2,t[r+15]=v.y2,n[r+16]=y,n[r+17]=b,t[r+18]=s*h+l*g+d,t[r+19]=u*g+c*h+f,t[r+20]=v.x3,t[r+21]=v.y3,n[r+22]=y,n[r+23]=b}_updateMaxTextures(e){this.shader.maxTextures!==e&&($=new Q(e),this.shader=$)}destroy(){this.shader=null,super.destroy()}};bt.extension={type:[d.Batcher],name:`default`};var xt=bt,St=class{constructor(e){this.items=Object.create(null);let{renderer:t,type:n,onUnload:r,priority:i,name:a}=e;this._renderer=t,t.gc.addResourceHash(this,`items`,n,i??0),this._onUnload=r,this.name=a}add(e){return this.items[e.uid]?!1:(this.items[e.uid]=e,e.once(`unload`,this.remove,this),e._gcLastUsed=this._renderer.gc.now,!0)}remove(e,...t){if(!this.items[e.uid])return;let n=e._gpuData[this._renderer.uid];n&&(this._onUnload?.(e,...t),n.destroy(),e._gpuData[this._renderer.uid]=null,this.items[e.uid]=null)}removeAll(...e){Object.values(this.items).forEach(t=>t&&this.remove(t,...e))}destroy(...e){this.removeAll(...e),this.items=Object.create(null),this._renderer=null,this._onUnload=null}};export{Ae as A,Ge as C,Re as D,ze as E,Te as F,V as I,B as L,Oe as M,H as N,je as O,we as P,Ce as R,Y as S,q as T,tt as _,gt as a,qe as b,ht as c,ot as d,at as f,$e as g,rt as h,yt as i,ke as j,Fe as k,st as l,it as m,xt as n,_t as o,nt as p,Q as r,ft as s,St as t,ct as u,Qe as v,J as w,Je as x,et as y};