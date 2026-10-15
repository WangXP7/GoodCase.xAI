(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function n(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();const Eo="178",Ch=0,nc=1,Ph=2,Il=1,Ll=2,Ln=3,Mn=0,Xt=1,xt=2,Zn=0,Vi=1,$t=2,ic=3,sc=4,Ih=5,fi=100,Lh=101,Dh=102,Nh=103,Uh=104,Fh=200,Oh=201,Bh=202,kh=203,Ra=204,Ca=205,zh=206,Hh=207,Vh=208,Gh=209,Wh=210,Xh=211,qh=212,jh=213,Yh=214,Pa=0,Ia=1,La=2,ji=3,Da=4,Na=5,Ua=6,Fa=7,Dl=0,Kh=1,$h=2,Qn=0,Jh=1,Zh=2,Qh=3,Nl=4,eu=5,tu=6,nu=7,rc="attached",iu="detached",Ul=300,Yi=301,Ki=302,Oa=303,Ba=304,Lr=306,ei=1e3,$n=1001,Tr=1002,Dt=1003,Fl=1004,vs=1005,Qt=1006,_r=1007,Nn=1008,Sn=1009,Ol=1010,Bl=1011,As=1012,To=1013,_i=1014,mn=1015,Ns=1016,wo=1017,Ao=1018,Rs=1020,kl=35902,zl=1021,Hl=1022,en=1023,Cs=1026,Ps=1027,Ro=1028,Co=1029,Vl=1030,Po=1031,Io=1033,vr=33776,xr=33777,yr=33778,Mr=33779,ka=35840,za=35841,Ha=35842,Va=35843,Ga=36196,Wa=37492,Xa=37496,qa=37808,ja=37809,Ya=37810,Ka=37811,$a=37812,Ja=37813,Za=37814,Qa=37815,eo=37816,to=37817,no=37818,io=37819,so=37820,ro=37821,Sr=36492,ao=36494,oo=36495,Gl=36283,co=36284,lo=36285,ho=36286,uo=2200,Wl=2201,su=2202,Is=2300,Ls=2301,Br=2302,Bi=2400,ki=2401,wr=2402,Lo=2500,ru=2501,au=0,Xl=1,fo=2,ou=3200,cu=3201,Do=0,lu=1,Kn="",wt="srgb",zt="srgb-linear",Ar="linear",at="srgb",Mi=7680,ac=519,hu=512,uu=513,du=514,ql=515,fu=516,pu=517,mu=518,gu=519,po=35044,oc="300 es",Un=2e3,Rr=2001;class xi{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){const n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){const n=this._listeners;if(n===void 0)return;const i=n[e];if(i!==void 0){const s=i.indexOf(t);s!==-1&&i.splice(s,1)}}dispatchEvent(e){const t=this._listeners;if(t===void 0)return;const n=t[e.type];if(n!==void 0){e.target=this;const i=n.slice(0);for(let s=0,a=i.length;s<a;s++)i[s].call(this,e);e.target=null}}}const Nt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let cc=1234567;const ys=Math.PI/180,$i=180/Math.PI;function gn(){const r=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Nt[r&255]+Nt[r>>8&255]+Nt[r>>16&255]+Nt[r>>24&255]+"-"+Nt[e&255]+Nt[e>>8&255]+"-"+Nt[e>>16&15|64]+Nt[e>>24&255]+"-"+Nt[t&63|128]+Nt[t>>8&255]+"-"+Nt[t>>16&255]+Nt[t>>24&255]+Nt[n&255]+Nt[n>>8&255]+Nt[n>>16&255]+Nt[n>>24&255]).toLowerCase()}function Ge(r,e,t){return Math.max(e,Math.min(t,r))}function No(r,e){return(r%e+e)%e}function _u(r,e,t,n,i){return n+(r-e)*(i-n)/(t-e)}function vu(r,e,t){return r!==e?(t-r)/(e-r):0}function Ms(r,e,t){return(1-t)*r+t*e}function xu(r,e,t,n){return Ms(r,e,1-Math.exp(-t*n))}function yu(r,e=1){return e-Math.abs(No(r,e*2)-e)}function Mu(r,e,t){return r<=e?0:r>=t?1:(r=(r-e)/(t-e),r*r*(3-2*r))}function Su(r,e,t){return r<=e?0:r>=t?1:(r=(r-e)/(t-e),r*r*r*(r*(r*6-15)+10))}function bu(r,e){return r+Math.floor(Math.random()*(e-r+1))}function Eu(r,e){return r+Math.random()*(e-r)}function Tu(r){return r*(.5-Math.random())}function wu(r){r!==void 0&&(cc=r);let e=cc+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function Au(r){return r*ys}function Ru(r){return r*$i}function Cu(r){return(r&r-1)===0&&r!==0}function Pu(r){return Math.pow(2,Math.ceil(Math.log(r)/Math.LN2))}function Iu(r){return Math.pow(2,Math.floor(Math.log(r)/Math.LN2))}function Lu(r,e,t,n,i){const s=Math.cos,a=Math.sin,o=s(t/2),c=a(t/2),l=s((e+n)/2),h=a((e+n)/2),u=s((e-n)/2),d=a((e-n)/2),f=s((n-e)/2),g=a((n-e)/2);switch(i){case"XYX":r.set(o*h,c*u,c*d,o*l);break;case"YZY":r.set(c*d,o*h,c*u,o*l);break;case"ZXZ":r.set(c*u,c*d,o*h,o*l);break;case"XZX":r.set(o*h,c*g,c*f,o*l);break;case"YXY":r.set(c*f,o*h,c*g,o*l);break;case"ZYZ":r.set(c*g,c*f,o*h,o*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function fn(r,e){switch(e.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("Invalid component type.")}}function st(r,e){switch(e.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("Invalid component type.")}}const ft={DEG2RAD:ys,RAD2DEG:$i,generateUUID:gn,clamp:Ge,euclideanModulo:No,mapLinear:_u,inverseLerp:vu,lerp:Ms,damp:xu,pingpong:yu,smoothstep:Mu,smootherstep:Su,randInt:bu,randFloat:Eu,randFloatSpread:Tu,seededRandom:wu,degToRad:Au,radToDeg:Ru,isPowerOfTwo:Cu,ceilPowerOfTwo:Pu,floorPowerOfTwo:Iu,setQuaternionFromProperEuler:Lu,normalize:st,denormalize:fn};class me{constructor(e=0,t=0){me.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6],this.y=i[1]*t+i[4]*n+i[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Ge(this.x,e.x,t.x),this.y=Ge(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Ge(this.x,e,t),this.y=Ge(this.y,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ge(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ge(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),i=Math.sin(t),s=this.x-e.x,a=this.y-e.y;return this.x=s*n-a*i+e.x,this.y=s*i+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class _n{constructor(e=0,t=0,n=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=i}static slerpFlat(e,t,n,i,s,a,o){let c=n[i+0],l=n[i+1],h=n[i+2],u=n[i+3];const d=s[a+0],f=s[a+1],g=s[a+2],_=s[a+3];if(o===0){e[t+0]=c,e[t+1]=l,e[t+2]=h,e[t+3]=u;return}if(o===1){e[t+0]=d,e[t+1]=f,e[t+2]=g,e[t+3]=_;return}if(u!==_||c!==d||l!==f||h!==g){let m=1-o;const p=c*d+l*f+h*g+u*_,M=p>=0?1:-1,b=1-p*p;if(b>Number.EPSILON){const P=Math.sqrt(b),R=Math.atan2(P,p*M);m=Math.sin(m*R)/P,o=Math.sin(o*R)/P}const v=o*M;if(c=c*m+d*v,l=l*m+f*v,h=h*m+g*v,u=u*m+_*v,m===1-o){const P=1/Math.sqrt(c*c+l*l+h*h+u*u);c*=P,l*=P,h*=P,u*=P}}e[t]=c,e[t+1]=l,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,i,s,a){const o=n[i],c=n[i+1],l=n[i+2],h=n[i+3],u=s[a],d=s[a+1],f=s[a+2],g=s[a+3];return e[t]=o*g+h*u+c*f-l*d,e[t+1]=c*g+h*d+l*u-o*f,e[t+2]=l*g+h*f+o*d-c*u,e[t+3]=h*g-o*u-c*d-l*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,i){return this._x=e,this._y=t,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,i=e._y,s=e._z,a=e._order,o=Math.cos,c=Math.sin,l=o(n/2),h=o(i/2),u=o(s/2),d=c(n/2),f=c(i/2),g=c(s/2);switch(a){case"XYZ":this._x=d*h*u+l*f*g,this._y=l*f*u-d*h*g,this._z=l*h*g+d*f*u,this._w=l*h*u-d*f*g;break;case"YXZ":this._x=d*h*u+l*f*g,this._y=l*f*u-d*h*g,this._z=l*h*g-d*f*u,this._w=l*h*u+d*f*g;break;case"ZXY":this._x=d*h*u-l*f*g,this._y=l*f*u+d*h*g,this._z=l*h*g+d*f*u,this._w=l*h*u-d*f*g;break;case"ZYX":this._x=d*h*u-l*f*g,this._y=l*f*u+d*h*g,this._z=l*h*g-d*f*u,this._w=l*h*u+d*f*g;break;case"YZX":this._x=d*h*u+l*f*g,this._y=l*f*u+d*h*g,this._z=l*h*g-d*f*u,this._w=l*h*u-d*f*g;break;case"XZY":this._x=d*h*u-l*f*g,this._y=l*f*u-d*h*g,this._z=l*h*g+d*f*u,this._w=l*h*u+d*f*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,i=Math.sin(n);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],i=t[4],s=t[8],a=t[1],o=t[5],c=t[9],l=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){const f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-c)*f,this._y=(s-l)*f,this._z=(a-i)*f}else if(n>o&&n>u){const f=2*Math.sqrt(1+n-o-u);this._w=(h-c)/f,this._x=.25*f,this._y=(i+a)/f,this._z=(s+l)/f}else if(o>u){const f=2*Math.sqrt(1+o-n-u);this._w=(s-l)/f,this._x=(i+a)/f,this._y=.25*f,this._z=(c+h)/f}else{const f=2*Math.sqrt(1+u-n-o);this._w=(a-i)/f,this._x=(s+l)/f,this._y=(c+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ge(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const i=Math.min(1,t/n);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,i=e._y,s=e._z,a=e._w,o=t._x,c=t._y,l=t._z,h=t._w;return this._x=n*h+a*o+i*l-s*c,this._y=i*h+a*c+s*o-n*l,this._z=s*h+a*l+n*c-i*o,this._w=a*h-n*o-i*c-s*l,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,i=this._y,s=this._z,a=this._w;let o=a*e._w+n*e._x+i*e._y+s*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=a,this._x=n,this._y=i,this._z=s,this;const c=1-o*o;if(c<=Number.EPSILON){const f=1-t;return this._w=f*a+t*this._w,this._x=f*n+t*this._x,this._y=f*i+t*this._y,this._z=f*s+t*this._z,this.normalize(),this}const l=Math.sqrt(c),h=Math.atan2(l,o),u=Math.sin((1-t)*h)/l,d=Math.sin(t*h)/l;return this._w=a*u+this._w*d,this._x=n*u+this._x*d,this._y=i*u+this._y*d,this._z=s*u+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(i*Math.sin(e),i*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class T{constructor(e=0,t=0,n=0){T.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(lc.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(lc.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6]*i,this.y=s[1]*t+s[4]*n+s[7]*i,this.z=s[2]*t+s[5]*n+s[8]*i,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,s=e.elements,a=1/(s[3]*t+s[7]*n+s[11]*i+s[15]);return this.x=(s[0]*t+s[4]*n+s[8]*i+s[12])*a,this.y=(s[1]*t+s[5]*n+s[9]*i+s[13])*a,this.z=(s[2]*t+s[6]*n+s[10]*i+s[14])*a,this}applyQuaternion(e){const t=this.x,n=this.y,i=this.z,s=e.x,a=e.y,o=e.z,c=e.w,l=2*(a*i-o*n),h=2*(o*t-s*i),u=2*(s*n-a*t);return this.x=t+c*l+a*u-o*h,this.y=n+c*h+o*l-s*u,this.z=i+c*u+s*h-a*l,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[4]*n+s[8]*i,this.y=s[1]*t+s[5]*n+s[9]*i,this.z=s[2]*t+s[6]*n+s[10]*i,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Ge(this.x,e.x,t.x),this.y=Ge(this.y,e.y,t.y),this.z=Ge(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Ge(this.x,e,t),this.y=Ge(this.y,e,t),this.z=Ge(this.z,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ge(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,i=e.y,s=e.z,a=t.x,o=t.y,c=t.z;return this.x=i*c-s*o,this.y=s*a-n*c,this.z=n*o-i*a,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return kr.copy(this).projectOnVector(e),this.sub(kr)}reflect(e){return this.sub(kr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ge(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,i=this.z-e.z;return t*t+n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const i=Math.sin(t)*e;return this.x=i*Math.sin(n),this.y=Math.cos(t)*e,this.z=i*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),i=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=i,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const kr=new T,lc=new _n;class ze{constructor(e,t,n,i,s,a,o,c,l){ze.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,a,o,c,l)}set(e,t,n,i,s,a,o,c,l){const h=this.elements;return h[0]=e,h[1]=i,h[2]=o,h[3]=t,h[4]=s,h[5]=c,h[6]=n,h[7]=a,h[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,s=this.elements,a=n[0],o=n[3],c=n[6],l=n[1],h=n[4],u=n[7],d=n[2],f=n[5],g=n[8],_=i[0],m=i[3],p=i[6],M=i[1],b=i[4],v=i[7],P=i[2],R=i[5],A=i[8];return s[0]=a*_+o*M+c*P,s[3]=a*m+o*b+c*R,s[6]=a*p+o*v+c*A,s[1]=l*_+h*M+u*P,s[4]=l*m+h*b+u*R,s[7]=l*p+h*v+u*A,s[2]=d*_+f*M+g*P,s[5]=d*m+f*b+g*R,s[8]=d*p+f*v+g*A,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],c=e[6],l=e[7],h=e[8];return t*a*h-t*o*l-n*s*h+n*o*c+i*s*l-i*a*c}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],c=e[6],l=e[7],h=e[8],u=h*a-o*l,d=o*c-h*s,f=l*s-a*c,g=t*u+n*d+i*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return e[0]=u*_,e[1]=(i*l-h*n)*_,e[2]=(o*n-i*a)*_,e[3]=d*_,e[4]=(h*t-i*c)*_,e[5]=(i*s-o*t)*_,e[6]=f*_,e[7]=(n*c-l*t)*_,e[8]=(a*t-n*s)*_,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,i,s,a,o){const c=Math.cos(s),l=Math.sin(s);return this.set(n*c,n*l,-n*(c*a+l*o)+a+e,-i*l,i*c,-i*(-l*a+c*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(zr.makeScale(e,t)),this}rotate(e){return this.premultiply(zr.makeRotation(-e)),this}translate(e,t){return this.premultiply(zr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<9;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const zr=new ze;function jl(r){for(let e=r.length-1;e>=0;--e)if(r[e]>=65535)return!0;return!1}function Ds(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}function Du(){const r=Ds("canvas");return r.style.display="block",r}const hc={};function Gi(r){r in hc||(hc[r]=!0,console.warn(r))}function Nu(r,e,t){return new Promise(function(n,i){function s(){switch(r.clientWaitSync(e,r.SYNC_FLUSH_COMMANDS_BIT,0)){case r.WAIT_FAILED:i();break;case r.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:n()}}setTimeout(s,t)})}function Uu(r){const e=r.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function Fu(r){const e=r.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const uc=new ze().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),dc=new ze().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function Ou(){const r={enabled:!0,workingColorSpace:zt,spaces:{},convert:function(i,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===at&&(i.r=On(i.r),i.g=On(i.g),i.b=On(i.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(i.applyMatrix3(this.spaces[s].toXYZ),i.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===at&&(i.r=Wi(i.r),i.g=Wi(i.g),i.b=Wi(i.b))),i},workingToColorSpace:function(i,s){return this.convert(i,this.workingColorSpace,s)},colorSpaceToWorking:function(i,s){return this.convert(i,s,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===Kn?Ar:this.spaces[i].transfer},getLuminanceCoefficients:function(i,s=this.workingColorSpace){return i.fromArray(this.spaces[s].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,s,a){return i.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(i,s){return Gi("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),r.workingToColorSpace(i,s)},toWorkingColorSpace:function(i,s){return Gi("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),r.colorSpaceToWorking(i,s)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return r.define({[zt]:{primaries:e,whitePoint:n,transfer:Ar,toXYZ:uc,fromXYZ:dc,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:wt},outputColorSpaceConfig:{drawingBufferColorSpace:wt}},[wt]:{primaries:e,whitePoint:n,transfer:at,toXYZ:uc,fromXYZ:dc,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:wt}}}),r}const Ye=Ou();function On(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function Wi(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}let Si;class Bu{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Si===void 0&&(Si=Ds("canvas")),Si.width=e.width,Si.height=e.height;const i=Si.getContext("2d");e instanceof ImageData?i.putImageData(e,0,0):i.drawImage(e,0,0,e.width,e.height),n=Si}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Ds("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const i=n.getImageData(0,0,e.width,e.height),s=i.data;for(let a=0;a<s.length;a++)s[a]=On(s[a]/255)*255;return n.putImageData(i,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(On(t[n]/255)*255):t[n]=On(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let ku=0;class Uo{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:ku++}),this.uuid=gn(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){const t=this.data;return t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let s;if(Array.isArray(i)){s=[];for(let a=0,o=i.length;a<o;a++)i[a].isDataTexture?s.push(Hr(i[a].image)):s.push(Hr(i[a]))}else s=Hr(i);n.url=s}return t||(e.images[this.uuid]=n),n}}function Hr(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?Bu.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let zu=0;const Vr=new T;class At extends xi{constructor(e=At.DEFAULT_IMAGE,t=At.DEFAULT_MAPPING,n=$n,i=$n,s=Qt,a=Nn,o=en,c=Sn,l=At.DEFAULT_ANISOTROPY,h=Kn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:zu++}),this.uuid=gn(),this.name="",this.source=new Uo(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=s,this.minFilter=a,this.anisotropy=l,this.format=o,this.internalFormat=null,this.type=c,this.offset=new me(0,0),this.repeat=new me(1,1),this.center=new me(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new ze,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(Vr).x}get height(){return this.source.getSize(Vr).y}get depth(){return this.source.getSize(Vr).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${t}' has value of undefined.`);continue}const i=this[t];if(i===void 0){console.warn(`THREE.Texture.setValues(): property '${t}' does not exist.`);continue}i&&n&&i.isVector2&&n.isVector2||i&&n&&i.isVector3&&n.isVector3||i&&n&&i.isMatrix3&&n.isMatrix3?i.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Ul)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ei:e.x=e.x-Math.floor(e.x);break;case $n:e.x=e.x<0?0:1;break;case Tr:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ei:e.y=e.y-Math.floor(e.y);break;case $n:e.y=e.y<0?0:1;break;case Tr:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}At.DEFAULT_IMAGE=null;At.DEFAULT_MAPPING=Ul;At.DEFAULT_ANISOTROPY=1;class et{constructor(e=0,t=0,n=0,i=1){et.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,i){return this.x=e,this.y=t,this.z=n,this.w=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,s=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*i+a[12]*s,this.y=a[1]*t+a[5]*n+a[9]*i+a[13]*s,this.z=a[2]*t+a[6]*n+a[10]*i+a[14]*s,this.w=a[3]*t+a[7]*n+a[11]*i+a[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,i,s;const c=e.elements,l=c[0],h=c[4],u=c[8],d=c[1],f=c[5],g=c[9],_=c[2],m=c[6],p=c[10];if(Math.abs(h-d)<.01&&Math.abs(u-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+_)<.1&&Math.abs(g+m)<.1&&Math.abs(l+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const b=(l+1)/2,v=(f+1)/2,P=(p+1)/2,R=(h+d)/4,A=(u+_)/4,C=(g+m)/4;return b>v&&b>P?b<.01?(n=0,i=.707106781,s=.707106781):(n=Math.sqrt(b),i=R/n,s=A/n):v>P?v<.01?(n=.707106781,i=0,s=.707106781):(i=Math.sqrt(v),n=R/i,s=C/i):P<.01?(n=.707106781,i=.707106781,s=0):(s=Math.sqrt(P),n=A/s,i=C/s),this.set(n,i,s,t),this}let M=Math.sqrt((m-g)*(m-g)+(u-_)*(u-_)+(d-h)*(d-h));return Math.abs(M)<.001&&(M=1),this.x=(m-g)/M,this.y=(u-_)/M,this.z=(d-h)/M,this.w=Math.acos((l+f+p-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Ge(this.x,e.x,t.x),this.y=Ge(this.y,e.y,t.y),this.z=Ge(this.z,e.z,t.z),this.w=Ge(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Ge(this.x,e,t),this.y=Ge(this.y,e,t),this.z=Ge(this.z,e,t),this.w=Ge(this.w,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ge(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Hu extends xi{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Qt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new et(0,0,e,t),this.scissorTest=!1,this.viewport=new et(0,0,e,t);const i={width:e,height:t,depth:n.depth},s=new At(i);this.textures=[];const a=n.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(e={}){const t={minFilter:Qt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let i=0,s=this.textures.length;i<s;i++)this.textures[i].image.width=e,this.textures[i].image.height=t,this.textures[i].image.depth=n,this.textures[i].isArrayTexture=this.textures[i].image.depth>1;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;const i=Object.assign({},e.textures[t].image);this.textures[t].source=new Uo(i)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class vi extends Hu{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class Yl extends At{constructor(e=null,t=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=Dt,this.minFilter=Dt,this.wrapR=$n,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Vu extends At{constructor(e=null,t=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=Dt,this.minFilter=Dt,this.wrapR=$n,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Bn{constructor(e=new T(1/0,1/0,1/0),t=new T(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(cn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(cn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=cn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const s=n.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,cn):cn.fromBufferAttribute(s,a),cn.applyMatrix4(e.matrixWorld),this.expandByPoint(cn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),zs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),zs.copy(n.boundingBox)),zs.applyMatrix4(e.matrixWorld),this.union(zs)}const i=e.children;for(let s=0,a=i.length;s<a;s++)this.expandByObject(i[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,cn),cn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(os),Hs.subVectors(this.max,os),bi.subVectors(e.a,os),Ei.subVectors(e.b,os),Ti.subVectors(e.c,os),zn.subVectors(Ei,bi),Hn.subVectors(Ti,Ei),si.subVectors(bi,Ti);let t=[0,-zn.z,zn.y,0,-Hn.z,Hn.y,0,-si.z,si.y,zn.z,0,-zn.x,Hn.z,0,-Hn.x,si.z,0,-si.x,-zn.y,zn.x,0,-Hn.y,Hn.x,0,-si.y,si.x,0];return!Gr(t,bi,Ei,Ti,Hs)||(t=[1,0,0,0,1,0,0,0,1],!Gr(t,bi,Ei,Ti,Hs))?!1:(Vs.crossVectors(zn,Hn),t=[Vs.x,Vs.y,Vs.z],Gr(t,bi,Ei,Ti,Hs))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,cn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(cn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(wn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),wn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),wn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),wn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),wn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),wn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),wn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),wn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(wn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}}const wn=[new T,new T,new T,new T,new T,new T,new T,new T],cn=new T,zs=new Bn,bi=new T,Ei=new T,Ti=new T,zn=new T,Hn=new T,si=new T,os=new T,Hs=new T,Vs=new T,ri=new T;function Gr(r,e,t,n,i){for(let s=0,a=r.length-3;s<=a;s+=3){ri.fromArray(r,s);const o=i.x*Math.abs(ri.x)+i.y*Math.abs(ri.y)+i.z*Math.abs(ri.z),c=e.dot(ri),l=t.dot(ri),h=n.dot(ri);if(Math.max(-Math.max(c,l,h),Math.min(c,l,h))>o)return!1}return!0}const Gu=new Bn,cs=new T,Wr=new T;class bn{constructor(e=new T,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Gu.setFromPoints(e).getCenter(n);let i=0;for(let s=0,a=e.length;s<a;s++)i=Math.max(i,n.distanceToSquared(e[s]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;cs.subVectors(e,this.center);const t=cs.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),i=(n-this.radius)*.5;this.center.addScaledVector(cs,i/n),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Wr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(cs.copy(e.center).add(Wr)),this.expandByPoint(cs.copy(e.center).sub(Wr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}}const An=new T,Xr=new T,Gs=new T,Vn=new T,qr=new T,Ws=new T,jr=new T;class Us{constructor(e=new T,t=new T(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,An)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=An.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(An.copy(this.origin).addScaledVector(this.direction,t),An.distanceToSquared(e))}distanceSqToSegment(e,t,n,i){Xr.copy(e).add(t).multiplyScalar(.5),Gs.copy(t).sub(e).normalize(),Vn.copy(this.origin).sub(Xr);const s=e.distanceTo(t)*.5,a=-this.direction.dot(Gs),o=Vn.dot(this.direction),c=-Vn.dot(Gs),l=Vn.lengthSq(),h=Math.abs(1-a*a);let u,d,f,g;if(h>0)if(u=a*c-o,d=a*o-c,g=s*h,u>=0)if(d>=-g)if(d<=g){const _=1/h;u*=_,d*=_,f=u*(u+a*d+2*o)+d*(a*u+d+2*c)+l}else d=s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*c)+l;else d=-s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*c)+l;else d<=-g?(u=Math.max(0,-(-a*s+o)),d=u>0?-s:Math.min(Math.max(-s,-c),s),f=-u*u+d*(d+2*c)+l):d<=g?(u=0,d=Math.min(Math.max(-s,-c),s),f=d*(d+2*c)+l):(u=Math.max(0,-(a*s+o)),d=u>0?s:Math.min(Math.max(-s,-c),s),f=-u*u+d*(d+2*c)+l);else d=a>0?-s:s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,u),i&&i.copy(Xr).addScaledVector(Gs,d),f}intersectSphere(e,t){An.subVectors(e.center,this.origin);const n=An.dot(this.direction),i=An.dot(An)-n*n,s=e.radius*e.radius;if(i>s)return null;const a=Math.sqrt(s-i),o=n-a,c=n+a;return c<0?null:o<0?this.at(c,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,i,s,a,o,c;const l=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return l>=0?(n=(e.min.x-d.x)*l,i=(e.max.x-d.x)*l):(n=(e.max.x-d.x)*l,i=(e.min.x-d.x)*l),h>=0?(s=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(s=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||s>i||((s>n||isNaN(n))&&(n=s),(a<i||isNaN(i))&&(i=a),u>=0?(o=(e.min.z-d.z)*u,c=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,c=(e.min.z-d.z)*u),n>c||o>i)||((o>n||n!==n)&&(n=o),(c<i||i!==i)&&(i=c),i<0)?null:this.at(n>=0?n:i,t)}intersectsBox(e){return this.intersectBox(e,An)!==null}intersectTriangle(e,t,n,i,s){qr.subVectors(t,e),Ws.subVectors(n,e),jr.crossVectors(qr,Ws);let a=this.direction.dot(jr),o;if(a>0){if(i)return null;o=1}else if(a<0)o=-1,a=-a;else return null;Vn.subVectors(this.origin,e);const c=o*this.direction.dot(Ws.crossVectors(Vn,Ws));if(c<0)return null;const l=o*this.direction.dot(qr.cross(Vn));if(l<0||c+l>a)return null;const h=-o*Vn.dot(jr);return h<0?null:this.at(h/a,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Oe{constructor(e,t,n,i,s,a,o,c,l,h,u,d,f,g,_,m){Oe.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,a,o,c,l,h,u,d,f,g,_,m)}set(e,t,n,i,s,a,o,c,l,h,u,d,f,g,_,m){const p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=i,p[1]=s,p[5]=a,p[9]=o,p[13]=c,p[2]=l,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=g,p[11]=_,p[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Oe().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,i=1/wi.setFromMatrixColumn(e,0).length(),s=1/wi.setFromMatrixColumn(e,1).length(),a=1/wi.setFromMatrixColumn(e,2).length();return t[0]=n[0]*i,t[1]=n[1]*i,t[2]=n[2]*i,t[3]=0,t[4]=n[4]*s,t[5]=n[5]*s,t[6]=n[6]*s,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,i=e.y,s=e.z,a=Math.cos(n),o=Math.sin(n),c=Math.cos(i),l=Math.sin(i),h=Math.cos(s),u=Math.sin(s);if(e.order==="XYZ"){const d=a*h,f=a*u,g=o*h,_=o*u;t[0]=c*h,t[4]=-c*u,t[8]=l,t[1]=f+g*l,t[5]=d-_*l,t[9]=-o*c,t[2]=_-d*l,t[6]=g+f*l,t[10]=a*c}else if(e.order==="YXZ"){const d=c*h,f=c*u,g=l*h,_=l*u;t[0]=d+_*o,t[4]=g*o-f,t[8]=a*l,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=f*o-g,t[6]=_+d*o,t[10]=a*c}else if(e.order==="ZXY"){const d=c*h,f=c*u,g=l*h,_=l*u;t[0]=d-_*o,t[4]=-a*u,t[8]=g+f*o,t[1]=f+g*o,t[5]=a*h,t[9]=_-d*o,t[2]=-a*l,t[6]=o,t[10]=a*c}else if(e.order==="ZYX"){const d=a*h,f=a*u,g=o*h,_=o*u;t[0]=c*h,t[4]=g*l-f,t[8]=d*l+_,t[1]=c*u,t[5]=_*l+d,t[9]=f*l-g,t[2]=-l,t[6]=o*c,t[10]=a*c}else if(e.order==="YZX"){const d=a*c,f=a*l,g=o*c,_=o*l;t[0]=c*h,t[4]=_-d*u,t[8]=g*u+f,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-l*h,t[6]=f*u+g,t[10]=d-_*u}else if(e.order==="XZY"){const d=a*c,f=a*l,g=o*c,_=o*l;t[0]=c*h,t[4]=-u,t[8]=l*h,t[1]=d*u+_,t[5]=a*h,t[9]=f*u-g,t[2]=g*u-f,t[6]=o*h,t[10]=_*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Wu,e,Xu)}lookAt(e,t,n){const i=this.elements;return Yt.subVectors(e,t),Yt.lengthSq()===0&&(Yt.z=1),Yt.normalize(),Gn.crossVectors(n,Yt),Gn.lengthSq()===0&&(Math.abs(n.z)===1?Yt.x+=1e-4:Yt.z+=1e-4,Yt.normalize(),Gn.crossVectors(n,Yt)),Gn.normalize(),Xs.crossVectors(Yt,Gn),i[0]=Gn.x,i[4]=Xs.x,i[8]=Yt.x,i[1]=Gn.y,i[5]=Xs.y,i[9]=Yt.y,i[2]=Gn.z,i[6]=Xs.z,i[10]=Yt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,s=this.elements,a=n[0],o=n[4],c=n[8],l=n[12],h=n[1],u=n[5],d=n[9],f=n[13],g=n[2],_=n[6],m=n[10],p=n[14],M=n[3],b=n[7],v=n[11],P=n[15],R=i[0],A=i[4],C=i[8],S=i[12],x=i[1],I=i[5],k=i[9],O=i[13],X=i[2],Y=i[6],W=i[10],J=i[14],H=i[3],ne=i[7],he=i[11],ve=i[15];return s[0]=a*R+o*x+c*X+l*H,s[4]=a*A+o*I+c*Y+l*ne,s[8]=a*C+o*k+c*W+l*he,s[12]=a*S+o*O+c*J+l*ve,s[1]=h*R+u*x+d*X+f*H,s[5]=h*A+u*I+d*Y+f*ne,s[9]=h*C+u*k+d*W+f*he,s[13]=h*S+u*O+d*J+f*ve,s[2]=g*R+_*x+m*X+p*H,s[6]=g*A+_*I+m*Y+p*ne,s[10]=g*C+_*k+m*W+p*he,s[14]=g*S+_*O+m*J+p*ve,s[3]=M*R+b*x+v*X+P*H,s[7]=M*A+b*I+v*Y+P*ne,s[11]=M*C+b*k+v*W+P*he,s[15]=M*S+b*O+v*J+P*ve,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],i=e[8],s=e[12],a=e[1],o=e[5],c=e[9],l=e[13],h=e[2],u=e[6],d=e[10],f=e[14],g=e[3],_=e[7],m=e[11],p=e[15];return g*(+s*c*u-i*l*u-s*o*d+n*l*d+i*o*f-n*c*f)+_*(+t*c*f-t*l*d+s*a*d-i*a*f+i*l*h-s*c*h)+m*(+t*l*u-t*o*f-s*a*u+n*a*f+s*o*h-n*l*h)+p*(-i*o*h-t*c*u+t*o*d+i*a*u-n*a*d+n*c*h)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const i=this.elements;return e.isVector3?(i[12]=e.x,i[13]=e.y,i[14]=e.z):(i[12]=e,i[13]=t,i[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],c=e[6],l=e[7],h=e[8],u=e[9],d=e[10],f=e[11],g=e[12],_=e[13],m=e[14],p=e[15],M=u*m*l-_*d*l+_*c*f-o*m*f-u*c*p+o*d*p,b=g*d*l-h*m*l-g*c*f+a*m*f+h*c*p-a*d*p,v=h*_*l-g*u*l+g*o*f-a*_*f-h*o*p+a*u*p,P=g*u*c-h*_*c-g*o*d+a*_*d+h*o*m-a*u*m,R=t*M+n*b+i*v+s*P;if(R===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const A=1/R;return e[0]=M*A,e[1]=(_*d*s-u*m*s-_*i*f+n*m*f+u*i*p-n*d*p)*A,e[2]=(o*m*s-_*c*s+_*i*l-n*m*l-o*i*p+n*c*p)*A,e[3]=(u*c*s-o*d*s-u*i*l+n*d*l+o*i*f-n*c*f)*A,e[4]=b*A,e[5]=(h*m*s-g*d*s+g*i*f-t*m*f-h*i*p+t*d*p)*A,e[6]=(g*c*s-a*m*s-g*i*l+t*m*l+a*i*p-t*c*p)*A,e[7]=(a*d*s-h*c*s+h*i*l-t*d*l-a*i*f+t*c*f)*A,e[8]=v*A,e[9]=(g*u*s-h*_*s-g*n*f+t*_*f+h*n*p-t*u*p)*A,e[10]=(a*_*s-g*o*s+g*n*l-t*_*l-a*n*p+t*o*p)*A,e[11]=(h*o*s-a*u*s-h*n*l+t*u*l+a*n*f-t*o*f)*A,e[12]=P*A,e[13]=(h*_*i-g*u*i+g*n*d-t*_*d-h*n*m+t*u*m)*A,e[14]=(g*o*i-a*_*i-g*n*c+t*_*c+a*n*m-t*o*m)*A,e[15]=(a*u*i-h*o*i+h*n*c-t*u*c-a*n*d+t*o*d)*A,this}scale(e){const t=this.elements,n=e.x,i=e.y,s=e.z;return t[0]*=n,t[4]*=i,t[8]*=s,t[1]*=n,t[5]*=i,t[9]*=s,t[2]*=n,t[6]*=i,t[10]*=s,t[3]*=n,t[7]*=i,t[11]*=s,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],i=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,i))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),i=Math.sin(t),s=1-n,a=e.x,o=e.y,c=e.z,l=s*a,h=s*o;return this.set(l*a+n,l*o-i*c,l*c+i*o,0,l*o+i*c,h*o+n,h*c-i*a,0,l*c-i*o,h*c+i*a,s*c*c+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,i,s,a){return this.set(1,n,s,0,e,1,a,0,t,i,1,0,0,0,0,1),this}compose(e,t,n){const i=this.elements,s=t._x,a=t._y,o=t._z,c=t._w,l=s+s,h=a+a,u=o+o,d=s*l,f=s*h,g=s*u,_=a*h,m=a*u,p=o*u,M=c*l,b=c*h,v=c*u,P=n.x,R=n.y,A=n.z;return i[0]=(1-(_+p))*P,i[1]=(f+v)*P,i[2]=(g-b)*P,i[3]=0,i[4]=(f-v)*R,i[5]=(1-(d+p))*R,i[6]=(m+M)*R,i[7]=0,i[8]=(g+b)*A,i[9]=(m-M)*A,i[10]=(1-(d+_))*A,i[11]=0,i[12]=e.x,i[13]=e.y,i[14]=e.z,i[15]=1,this}decompose(e,t,n){const i=this.elements;let s=wi.set(i[0],i[1],i[2]).length();const a=wi.set(i[4],i[5],i[6]).length(),o=wi.set(i[8],i[9],i[10]).length();this.determinant()<0&&(s=-s),e.x=i[12],e.y=i[13],e.z=i[14],ln.copy(this);const l=1/s,h=1/a,u=1/o;return ln.elements[0]*=l,ln.elements[1]*=l,ln.elements[2]*=l,ln.elements[4]*=h,ln.elements[5]*=h,ln.elements[6]*=h,ln.elements[8]*=u,ln.elements[9]*=u,ln.elements[10]*=u,t.setFromRotationMatrix(ln),n.x=s,n.y=a,n.z=o,this}makePerspective(e,t,n,i,s,a,o=Un){const c=this.elements,l=2*s/(t-e),h=2*s/(n-i),u=(t+e)/(t-e),d=(n+i)/(n-i);let f,g;if(o===Un)f=-(a+s)/(a-s),g=-2*a*s/(a-s);else if(o===Rr)f=-a/(a-s),g=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return c[0]=l,c[4]=0,c[8]=u,c[12]=0,c[1]=0,c[5]=h,c[9]=d,c[13]=0,c[2]=0,c[6]=0,c[10]=f,c[14]=g,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,i,s,a,o=Un){const c=this.elements,l=1/(t-e),h=1/(n-i),u=1/(a-s),d=(t+e)*l,f=(n+i)*h;let g,_;if(o===Un)g=(a+s)*u,_=-2*u;else if(o===Rr)g=s*u,_=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return c[0]=2*l,c[4]=0,c[8]=0,c[12]=-d,c[1]=0,c[5]=2*h,c[9]=0,c[13]=-f,c[2]=0,c[6]=0,c[10]=_,c[14]=-g,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<16;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const wi=new T,ln=new Oe,Wu=new T(0,0,0),Xu=new T(1,1,1),Gn=new T,Xs=new T,Yt=new T,fc=new Oe,pc=new _n;class Tt{constructor(e=0,t=0,n=0,i=Tt.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,i=this._order){return this._x=e,this._y=t,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const i=e.elements,s=i[0],a=i[4],o=i[8],c=i[1],l=i[5],h=i[9],u=i[2],d=i[6],f=i[10];switch(t){case"XYZ":this._y=Math.asin(Ge(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(d,l),this._z=0);break;case"YXZ":this._x=Math.asin(-Ge(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-u,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ge(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,l)):(this._y=0,this._z=Math.atan2(c,s));break;case"ZYX":this._y=Math.asin(-Ge(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(c,s)):(this._x=0,this._z=Math.atan2(-a,l));break;case"YZX":this._z=Math.asin(Ge(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-h,l),this._y=Math.atan2(-u,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Ge(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,l),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-h,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return fc.makeRotationFromQuaternion(e),this.setFromRotationMatrix(fc,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return pc.setFromEuler(this),this.setFromQuaternion(pc,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Tt.DEFAULT_ORDER="XYZ";class Fo{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let qu=0;const mc=new T,Ai=new _n,Rn=new Oe,qs=new T,ls=new T,ju=new T,Yu=new _n,gc=new T(1,0,0),_c=new T(0,1,0),vc=new T(0,0,1),xc={type:"added"},Ku={type:"removed"},Ri={type:"childadded",child:null},Yr={type:"childremoved",child:null};class pt extends xi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:qu++}),this.uuid=gn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=pt.DEFAULT_UP.clone();const e=new T,t=new Tt,n=new _n,i=new T(1,1,1);function s(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(s),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Oe},normalMatrix:{value:new ze}}),this.matrix=new Oe,this.matrixWorld=new Oe,this.matrixAutoUpdate=pt.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=pt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Fo,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Ai.setFromAxisAngle(e,t),this.quaternion.multiply(Ai),this}rotateOnWorldAxis(e,t){return Ai.setFromAxisAngle(e,t),this.quaternion.premultiply(Ai),this}rotateX(e){return this.rotateOnAxis(gc,e)}rotateY(e){return this.rotateOnAxis(_c,e)}rotateZ(e){return this.rotateOnAxis(vc,e)}translateOnAxis(e,t){return mc.copy(e).applyQuaternion(this.quaternion),this.position.add(mc.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(gc,e)}translateY(e){return this.translateOnAxis(_c,e)}translateZ(e){return this.translateOnAxis(vc,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Rn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?qs.copy(e):qs.set(e,t,n);const i=this.parent;this.updateWorldMatrix(!0,!1),ls.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Rn.lookAt(ls,qs,this.up):Rn.lookAt(qs,ls,this.up),this.quaternion.setFromRotationMatrix(Rn),i&&(Rn.extractRotation(i.matrixWorld),Ai.setFromRotationMatrix(Rn),this.quaternion.premultiply(Ai.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(xc),Ri.child=e,this.dispatchEvent(Ri),Ri.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Ku),Yr.child=e,this.dispatchEvent(Yr),Yr.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Rn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Rn.multiply(e.parent.matrixWorld)),e.applyMatrix4(Rn),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(xc),Ri.child=e,this.dispatchEvent(Ri),Ri.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,i=this.children.length;n<i;n++){const a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const i=this.children;for(let s=0,a=i.length;s<a;s++)i[s].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ls,e,ju),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ls,Yu,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const i=this.children;for(let s=0,a=i.length;s<a;s++)i[s].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.geometryInfo=this._geometryInfo.map(o=>({...o,boundingBox:o.boundingBox?o.boundingBox.toJSON():void 0,boundingSphere:o.boundingSphere?o.boundingSphere.toJSON():void 0})),i.instanceInfo=this._instanceInfo.map(o=>({...o})),i.availableInstanceIds=this._availableInstanceIds.slice(),i.availableGeometryIds=this._availableGeometryIds.slice(),i.nextIndexStart=this._nextIndexStart,i.nextVertexStart=this._nextVertexStart,i.geometryCount=this._geometryCount,i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.matricesTexture=this._matricesTexture.toJSON(e),i.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(i.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(i.boundingBox=this.boundingBox.toJSON()));function s(o,c){return o[c.uuid]===void 0&&(o[c.uuid]=c.toJSON(e)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=s(e.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const c=o.shapes;if(Array.isArray(c))for(let l=0,h=c.length;l<h;l++){const u=c[l];s(e.shapes,u)}else s(e.shapes,c)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let c=0,l=this.material.length;c<l;c++)o.push(s(e.materials,this.material[c]));i.material=o}else i.material=s(e.materials,this.material);if(this.children.length>0){i.children=[];for(let o=0;o<this.children.length;o++)i.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){i.animations=[];for(let o=0;o<this.animations.length;o++){const c=this.animations[o];i.animations.push(s(e.animations,c))}}if(t){const o=a(e.geometries),c=a(e.materials),l=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),f=a(e.animations),g=a(e.nodes);o.length>0&&(n.geometries=o),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),g.length>0&&(n.nodes=g)}return n.object=i,n;function a(o){const c=[];for(const l in o){const h=o[l];delete h.metadata,c.push(h)}return c}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const i=e.children[n];this.add(i.clone())}return this}}pt.DEFAULT_UP=new T(0,1,0);pt.DEFAULT_MATRIX_AUTO_UPDATE=!0;pt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const hn=new T,Cn=new T,Kr=new T,Pn=new T,Ci=new T,Pi=new T,yc=new T,$r=new T,Jr=new T,Zr=new T,Qr=new et,ea=new et,ta=new et;class pn{constructor(e=new T,t=new T,n=new T){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,i){i.subVectors(n,t),hn.subVectors(e,t),i.cross(hn);const s=i.lengthSq();return s>0?i.multiplyScalar(1/Math.sqrt(s)):i.set(0,0,0)}static getBarycoord(e,t,n,i,s){hn.subVectors(i,t),Cn.subVectors(n,t),Kr.subVectors(e,t);const a=hn.dot(hn),o=hn.dot(Cn),c=hn.dot(Kr),l=Cn.dot(Cn),h=Cn.dot(Kr),u=a*l-o*o;if(u===0)return s.set(0,0,0),null;const d=1/u,f=(l*c-o*h)*d,g=(a*h-o*c)*d;return s.set(1-f-g,g,f)}static containsPoint(e,t,n,i){return this.getBarycoord(e,t,n,i,Pn)===null?!1:Pn.x>=0&&Pn.y>=0&&Pn.x+Pn.y<=1}static getInterpolation(e,t,n,i,s,a,o,c){return this.getBarycoord(e,t,n,i,Pn)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(s,Pn.x),c.addScaledVector(a,Pn.y),c.addScaledVector(o,Pn.z),c)}static getInterpolatedAttribute(e,t,n,i,s,a){return Qr.setScalar(0),ea.setScalar(0),ta.setScalar(0),Qr.fromBufferAttribute(e,t),ea.fromBufferAttribute(e,n),ta.fromBufferAttribute(e,i),a.setScalar(0),a.addScaledVector(Qr,s.x),a.addScaledVector(ea,s.y),a.addScaledVector(ta,s.z),a}static isFrontFacing(e,t,n,i){return hn.subVectors(n,t),Cn.subVectors(e,t),hn.cross(Cn).dot(i)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,i){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[i]),this}setFromAttributeAndIndices(e,t,n,i){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,i),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return hn.subVectors(this.c,this.b),Cn.subVectors(this.a,this.b),hn.cross(Cn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return pn.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return pn.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,i,s){return pn.getInterpolation(e,this.a,this.b,this.c,t,n,i,s)}containsPoint(e){return pn.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return pn.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,i=this.b,s=this.c;let a,o;Ci.subVectors(i,n),Pi.subVectors(s,n),$r.subVectors(e,n);const c=Ci.dot($r),l=Pi.dot($r);if(c<=0&&l<=0)return t.copy(n);Jr.subVectors(e,i);const h=Ci.dot(Jr),u=Pi.dot(Jr);if(h>=0&&u<=h)return t.copy(i);const d=c*u-h*l;if(d<=0&&c>=0&&h<=0)return a=c/(c-h),t.copy(n).addScaledVector(Ci,a);Zr.subVectors(e,s);const f=Ci.dot(Zr),g=Pi.dot(Zr);if(g>=0&&f<=g)return t.copy(s);const _=f*l-c*g;if(_<=0&&l>=0&&g<=0)return o=l/(l-g),t.copy(n).addScaledVector(Pi,o);const m=h*g-f*u;if(m<=0&&u-h>=0&&f-g>=0)return yc.subVectors(s,i),o=(u-h)/(u-h+(f-g)),t.copy(i).addScaledVector(yc,o);const p=1/(m+_+d);return a=_*p,o=d*p,t.copy(n).addScaledVector(Ci,a).addScaledVector(Pi,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const Kl={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Wn={h:0,s:0,l:0},js={h:0,s:0,l:0};function na(r,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?r+(e-r)*6*t:t<1/2?e:t<2/3?r+(e-r)*6*(2/3-t):r}class Pe{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=wt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Ye.colorSpaceToWorking(this,t),this}setRGB(e,t,n,i=Ye.workingColorSpace){return this.r=e,this.g=t,this.b=n,Ye.colorSpaceToWorking(this,i),this}setHSL(e,t,n,i=Ye.workingColorSpace){if(e=No(e,1),t=Ge(t,0,1),n=Ge(n,0,1),t===0)this.r=this.g=this.b=n;else{const s=n<=.5?n*(1+t):n+t-n*t,a=2*n-s;this.r=na(a,s,e+1/3),this.g=na(a,s,e),this.b=na(a,s,e-1/3)}return Ye.colorSpaceToWorking(this,i),this}setStyle(e,t=wt){function n(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let s;const a=i[1],o=i[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){const s=i[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(s,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=wt){const n=Kl[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=On(e.r),this.g=On(e.g),this.b=On(e.b),this}copyLinearToSRGB(e){return this.r=Wi(e.r),this.g=Wi(e.g),this.b=Wi(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=wt){return Ye.workingToColorSpace(Ut.copy(this),e),Math.round(Ge(Ut.r*255,0,255))*65536+Math.round(Ge(Ut.g*255,0,255))*256+Math.round(Ge(Ut.b*255,0,255))}getHexString(e=wt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Ye.workingColorSpace){Ye.workingToColorSpace(Ut.copy(this),t);const n=Ut.r,i=Ut.g,s=Ut.b,a=Math.max(n,i,s),o=Math.min(n,i,s);let c,l;const h=(o+a)/2;if(o===a)c=0,l=0;else{const u=a-o;switch(l=h<=.5?u/(a+o):u/(2-a-o),a){case n:c=(i-s)/u+(i<s?6:0);break;case i:c=(s-n)/u+2;break;case s:c=(n-i)/u+4;break}c/=6}return e.h=c,e.s=l,e.l=h,e}getRGB(e,t=Ye.workingColorSpace){return Ye.workingToColorSpace(Ut.copy(this),t),e.r=Ut.r,e.g=Ut.g,e.b=Ut.b,e}getStyle(e=wt){Ye.workingToColorSpace(Ut.copy(this),e);const t=Ut.r,n=Ut.g,i=Ut.b;return e!==wt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(e,t,n){return this.getHSL(Wn),this.setHSL(Wn.h+e,Wn.s+t,Wn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Wn),e.getHSL(js);const n=Ms(Wn.h,js.h,t),i=Ms(Wn.s,js.s,t),s=Ms(Wn.l,js.l,t);return this.setHSL(n,i,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,i=this.b,s=e.elements;return this.r=s[0]*t+s[3]*n+s[6]*i,this.g=s[1]*t+s[4]*n+s[7]*i,this.b=s[2]*t+s[5]*n+s[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Ut=new Pe;Pe.NAMES=Kl;let $u=0;class vn extends xi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:$u++}),this.uuid=gn(),this.name="",this.type="Material",this.blending=Vi,this.side=Mn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Ra,this.blendDst=Ca,this.blendEquation=fi,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Pe(0,0,0),this.blendAlpha=0,this.depthFunc=ji,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=ac,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Mi,this.stencilZFail=Mi,this.stencilZPass=Mi,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const i=this[t];if(i===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Vi&&(n.blending=this.blending),this.side!==Mn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Ra&&(n.blendSrc=this.blendSrc),this.blendDst!==Ca&&(n.blendDst=this.blendDst),this.blendEquation!==fi&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==ji&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==ac&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Mi&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Mi&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Mi&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(s){const a=[];for(const o in s){const c=s[o];delete c.metadata,a.push(c)}return a}if(t){const s=i(e.textures),a=i(e.images);s.length>0&&(n.textures=s),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const i=t.length;n=new Array(i);for(let s=0;s!==i;++s)n[s]=t[s].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}}class ke extends vn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Pe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Tt,this.combine=Dl,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const Mt=new T,Ys=new me;let Ju=0;class It{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:Ju++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=po,this.updateRanges=[],this.gpuType=mn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let i=0,s=this.itemSize;i<s;i++)this.array[e+i]=t.array[n+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Ys.fromBufferAttribute(this,t),Ys.applyMatrix3(e),this.setXY(t,Ys.x,Ys.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Mt.fromBufferAttribute(this,t),Mt.applyMatrix3(e),this.setXYZ(t,Mt.x,Mt.y,Mt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Mt.fromBufferAttribute(this,t),Mt.applyMatrix4(e),this.setXYZ(t,Mt.x,Mt.y,Mt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Mt.fromBufferAttribute(this,t),Mt.applyNormalMatrix(e),this.setXYZ(t,Mt.x,Mt.y,Mt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Mt.fromBufferAttribute(this,t),Mt.transformDirection(e),this.setXYZ(t,Mt.x,Mt.y,Mt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=fn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=st(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=fn(t,this.array)),t}setX(e,t){return this.normalized&&(t=st(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=fn(t,this.array)),t}setY(e,t){return this.normalized&&(t=st(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=fn(t,this.array)),t}setZ(e,t){return this.normalized&&(t=st(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=fn(t,this.array)),t}setW(e,t){return this.normalized&&(t=st(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=st(t,this.array),n=st(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,i){return e*=this.itemSize,this.normalized&&(t=st(t,this.array),n=st(n,this.array),i=st(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e*=this.itemSize,this.normalized&&(t=st(t,this.array),n=st(n,this.array),i=st(i,this.array),s=st(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==po&&(e.usage=this.usage),e}}class $l extends It{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class Jl extends It{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class nt extends It{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Zu=0;const sn=new Oe,ia=new pt,Ii=new T,Kt=new Bn,hs=new Bn,Pt=new T;class yt extends xi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Zu++}),this.uuid=gn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(jl(e)?Jl:$l)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const s=new ze().getNormalMatrix(e);n.applyNormalMatrix(s),n.needsUpdate=!0}const i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(e),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return sn.makeRotationFromQuaternion(e),this.applyMatrix4(sn),this}rotateX(e){return sn.makeRotationX(e),this.applyMatrix4(sn),this}rotateY(e){return sn.makeRotationY(e),this.applyMatrix4(sn),this}rotateZ(e){return sn.makeRotationZ(e),this.applyMatrix4(sn),this}translate(e,t,n){return sn.makeTranslation(e,t,n),this.applyMatrix4(sn),this}scale(e,t,n){return sn.makeScale(e,t,n),this.applyMatrix4(sn),this}lookAt(e){return ia.lookAt(e),ia.updateMatrix(),this.applyMatrix4(ia.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ii).negate(),this.translate(Ii.x,Ii.y,Ii.z),this}setFromPoints(e){const t=this.getAttribute("position");if(t===void 0){const n=[];for(let i=0,s=e.length;i<s;i++){const a=e[i];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new nt(n,3))}else{const n=Math.min(e.length,t.count);for(let i=0;i<n;i++){const s=e[i];t.setXYZ(i,s.x,s.y,s.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Bn);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new T(-1/0,-1/0,-1/0),new T(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,i=t.length;n<i;n++){const s=t[n];Kt.setFromBufferAttribute(s),this.morphTargetsRelative?(Pt.addVectors(this.boundingBox.min,Kt.min),this.boundingBox.expandByPoint(Pt),Pt.addVectors(this.boundingBox.max,Kt.max),this.boundingBox.expandByPoint(Pt)):(this.boundingBox.expandByPoint(Kt.min),this.boundingBox.expandByPoint(Kt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new bn);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new T,1/0);return}if(e){const n=this.boundingSphere.center;if(Kt.setFromBufferAttribute(e),t)for(let s=0,a=t.length;s<a;s++){const o=t[s];hs.setFromBufferAttribute(o),this.morphTargetsRelative?(Pt.addVectors(Kt.min,hs.min),Kt.expandByPoint(Pt),Pt.addVectors(Kt.max,hs.max),Kt.expandByPoint(Pt)):(Kt.expandByPoint(hs.min),Kt.expandByPoint(hs.max))}Kt.getCenter(n);let i=0;for(let s=0,a=e.count;s<a;s++)Pt.fromBufferAttribute(e,s),i=Math.max(i,n.distanceToSquared(Pt));if(t)for(let s=0,a=t.length;s<a;s++){const o=t[s],c=this.morphTargetsRelative;for(let l=0,h=o.count;l<h;l++)Pt.fromBufferAttribute(o,l),c&&(Ii.fromBufferAttribute(e,l),Pt.add(Ii)),i=Math.max(i,n.distanceToSquared(Pt))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,i=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new It(new Float32Array(4*n.count),4));const a=this.getAttribute("tangent"),o=[],c=[];for(let C=0;C<n.count;C++)o[C]=new T,c[C]=new T;const l=new T,h=new T,u=new T,d=new me,f=new me,g=new me,_=new T,m=new T;function p(C,S,x){l.fromBufferAttribute(n,C),h.fromBufferAttribute(n,S),u.fromBufferAttribute(n,x),d.fromBufferAttribute(s,C),f.fromBufferAttribute(s,S),g.fromBufferAttribute(s,x),h.sub(l),u.sub(l),f.sub(d),g.sub(d);const I=1/(f.x*g.y-g.x*f.y);isFinite(I)&&(_.copy(h).multiplyScalar(g.y).addScaledVector(u,-f.y).multiplyScalar(I),m.copy(u).multiplyScalar(f.x).addScaledVector(h,-g.x).multiplyScalar(I),o[C].add(_),o[S].add(_),o[x].add(_),c[C].add(m),c[S].add(m),c[x].add(m))}let M=this.groups;M.length===0&&(M=[{start:0,count:e.count}]);for(let C=0,S=M.length;C<S;++C){const x=M[C],I=x.start,k=x.count;for(let O=I,X=I+k;O<X;O+=3)p(e.getX(O+0),e.getX(O+1),e.getX(O+2))}const b=new T,v=new T,P=new T,R=new T;function A(C){P.fromBufferAttribute(i,C),R.copy(P);const S=o[C];b.copy(S),b.sub(P.multiplyScalar(P.dot(S))).normalize(),v.crossVectors(R,S);const I=v.dot(c[C])<0?-1:1;a.setXYZW(C,b.x,b.y,b.z,I)}for(let C=0,S=M.length;C<S;++C){const x=M[C],I=x.start,k=x.count;for(let O=I,X=I+k;O<X;O+=3)A(e.getX(O+0)),A(e.getX(O+1)),A(e.getX(O+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new It(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);const i=new T,s=new T,a=new T,o=new T,c=new T,l=new T,h=new T,u=new T;if(e)for(let d=0,f=e.count;d<f;d+=3){const g=e.getX(d+0),_=e.getX(d+1),m=e.getX(d+2);i.fromBufferAttribute(t,g),s.fromBufferAttribute(t,_),a.fromBufferAttribute(t,m),h.subVectors(a,s),u.subVectors(i,s),h.cross(u),o.fromBufferAttribute(n,g),c.fromBufferAttribute(n,_),l.fromBufferAttribute(n,m),o.add(h),c.add(h),l.add(h),n.setXYZ(g,o.x,o.y,o.z),n.setXYZ(_,c.x,c.y,c.z),n.setXYZ(m,l.x,l.y,l.z)}else for(let d=0,f=t.count;d<f;d+=3)i.fromBufferAttribute(t,d+0),s.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,s),u.subVectors(i,s),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Pt.fromBufferAttribute(e,t),Pt.normalize(),e.setXYZ(t,Pt.x,Pt.y,Pt.z)}toNonIndexed(){function e(o,c){const l=o.array,h=o.itemSize,u=o.normalized,d=new l.constructor(c.length*h);let f=0,g=0;for(let _=0,m=c.length;_<m;_++){o.isInterleavedBufferAttribute?f=c[_]*o.data.stride+o.offset:f=c[_]*h;for(let p=0;p<h;p++)d[g++]=l[f++]}return new It(d,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new yt,n=this.index.array,i=this.attributes;for(const o in i){const c=i[o],l=e(c,n);t.setAttribute(o,l)}const s=this.morphAttributes;for(const o in s){const c=[],l=s[o];for(let h=0,u=l.length;h<u;h++){const d=l[h],f=e(d,n);c.push(f)}t.morphAttributes[o]=c}t.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,c=a.length;o<c;o++){const l=a[o];t.addGroup(l.start,l.count,l.materialIndex)}return t}toJSON(){const e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const c=this.parameters;for(const l in c)c[l]!==void 0&&(e[l]=c[l]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const c in n){const l=n[c];e.data.attributes[c]=l.toJSON(e.data)}const i={};let s=!1;for(const c in this.morphAttributes){const l=this.morphAttributes[c],h=[];for(let u=0,d=l.length;u<d;u++){const f=l[u];h.push(f.toJSON(e.data))}h.length>0&&(i[c]=h,s=!0)}s&&(e.data.morphAttributes=i,e.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone());const i=e.attributes;for(const l in i){const h=i[l];this.setAttribute(l,h.clone(t))}const s=e.morphAttributes;for(const l in s){const h=[],u=s[l];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[l]=h}this.morphTargetsRelative=e.morphTargetsRelative;const a=e.groups;for(let l=0,h=a.length;l<h;l++){const u=a[l];this.addGroup(u.start,u.count,u.materialIndex)}const o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());const c=e.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Mc=new Oe,ai=new Us,Ks=new bn,Sc=new T,$s=new T,Js=new T,Zs=new T,sa=new T,Qs=new T,bc=new T,er=new T;class Wt extends pt{constructor(e=new yt,t=new ke){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=i.length;s<a;s++){const o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(e,t){const n=this.geometry,i=n.attributes.position,s=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(i,e);const o=this.morphTargetInfluences;if(s&&o){Qs.set(0,0,0);for(let c=0,l=s.length;c<l;c++){const h=o[c],u=s[c];h!==0&&(sa.fromBufferAttribute(u,e),a?Qs.addScaledVector(sa,h):Qs.addScaledVector(sa.sub(t),h))}t.add(Qs)}return t}raycast(e,t){const n=this.geometry,i=this.material,s=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Ks.copy(n.boundingSphere),Ks.applyMatrix4(s),ai.copy(e.ray).recast(e.near),!(Ks.containsPoint(ai.origin)===!1&&(ai.intersectSphere(Ks,Sc)===null||ai.origin.distanceToSquared(Sc)>(e.far-e.near)**2))&&(Mc.copy(s).invert(),ai.copy(e.ray).applyMatrix4(Mc),!(n.boundingBox!==null&&ai.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,ai)))}_computeIntersections(e,t,n){let i;const s=this.geometry,a=this.material,o=s.index,c=s.attributes.position,l=s.attributes.uv,h=s.attributes.uv1,u=s.attributes.normal,d=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,_=d.length;g<_;g++){const m=d[g],p=a[m.materialIndex],M=Math.max(m.start,f.start),b=Math.min(o.count,Math.min(m.start+m.count,f.start+f.count));for(let v=M,P=b;v<P;v+=3){const R=o.getX(v),A=o.getX(v+1),C=o.getX(v+2);i=tr(this,p,e,n,l,h,u,R,A,C),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=m.materialIndex,t.push(i))}}else{const g=Math.max(0,f.start),_=Math.min(o.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){const M=o.getX(m),b=o.getX(m+1),v=o.getX(m+2);i=tr(this,a,e,n,l,h,u,M,b,v),i&&(i.faceIndex=Math.floor(m/3),t.push(i))}}else if(c!==void 0)if(Array.isArray(a))for(let g=0,_=d.length;g<_;g++){const m=d[g],p=a[m.materialIndex],M=Math.max(m.start,f.start),b=Math.min(c.count,Math.min(m.start+m.count,f.start+f.count));for(let v=M,P=b;v<P;v+=3){const R=v,A=v+1,C=v+2;i=tr(this,p,e,n,l,h,u,R,A,C),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=m.materialIndex,t.push(i))}}else{const g=Math.max(0,f.start),_=Math.min(c.count,f.start+f.count);for(let m=g,p=_;m<p;m+=3){const M=m,b=m+1,v=m+2;i=tr(this,a,e,n,l,h,u,M,b,v),i&&(i.faceIndex=Math.floor(m/3),t.push(i))}}}}function Qu(r,e,t,n,i,s,a,o){let c;if(e.side===Xt?c=n.intersectTriangle(a,s,i,!0,o):c=n.intersectTriangle(i,s,a,e.side===Mn,o),c===null)return null;er.copy(o),er.applyMatrix4(r.matrixWorld);const l=t.ray.origin.distanceTo(er);return l<t.near||l>t.far?null:{distance:l,point:er.clone(),object:r}}function tr(r,e,t,n,i,s,a,o,c,l){r.getVertexPosition(o,$s),r.getVertexPosition(c,Js),r.getVertexPosition(l,Zs);const h=Qu(r,e,t,n,$s,Js,Zs,bc);if(h){const u=new T;pn.getBarycoord(bc,$s,Js,Zs,u),i&&(h.uv=pn.getInterpolatedAttribute(i,o,c,l,u,new me)),s&&(h.uv1=pn.getInterpolatedAttribute(s,o,c,l,u,new me)),a&&(h.normal=pn.getInterpolatedAttribute(a,o,c,l,u,new T),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const d={a:o,b:c,c:l,normal:new T,materialIndex:0};pn.getNormal($s,Js,Zs,d.normal),h.face=d,h.barycoord=u}return h}class bt extends yt{constructor(e=1,t=1,n=1,i=1,s=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:i,heightSegments:s,depthSegments:a};const o=this;i=Math.floor(i),s=Math.floor(s),a=Math.floor(a);const c=[],l=[],h=[],u=[];let d=0,f=0;g("z","y","x",-1,-1,n,t,e,a,s,0),g("z","y","x",1,-1,n,t,-e,a,s,1),g("x","z","y",1,1,e,n,t,i,a,2),g("x","z","y",1,-1,e,n,-t,i,a,3),g("x","y","z",1,-1,e,t,n,i,s,4),g("x","y","z",-1,-1,e,t,-n,i,s,5),this.setIndex(c),this.setAttribute("position",new nt(l,3)),this.setAttribute("normal",new nt(h,3)),this.setAttribute("uv",new nt(u,2));function g(_,m,p,M,b,v,P,R,A,C,S){const x=v/A,I=P/C,k=v/2,O=P/2,X=R/2,Y=A+1,W=C+1;let J=0,H=0;const ne=new T;for(let he=0;he<W;he++){const ve=he*I-O;for(let Be=0;Be<Y;Be++){const ot=Be*x-k;ne[_]=ot*M,ne[m]=ve*b,ne[p]=X,l.push(ne.x,ne.y,ne.z),ne[_]=0,ne[m]=0,ne[p]=R>0?1:-1,h.push(ne.x,ne.y,ne.z),u.push(Be/A),u.push(1-he/C),J+=1}}for(let he=0;he<C;he++)for(let ve=0;ve<A;ve++){const Be=d+ve+Y*he,ot=d+ve+Y*(he+1),j=d+(ve+1)+Y*(he+1),ie=d+(ve+1)+Y*he;c.push(Be,ot,ie),c.push(ot,j,ie),H+=6}o.addGroup(f,H,S),f+=H,d+=J}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new bt(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Ji(r){const e={};for(const t in r){e[t]={};for(const n in r[t]){const i=r[t][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=i.clone():Array.isArray(i)?e[t][n]=i.slice():e[t][n]=i}}return e}function kt(r){const e={};for(let t=0;t<r.length;t++){const n=Ji(r[t]);for(const i in n)e[i]=n[i]}return e}function ed(r){const e=[];for(let t=0;t<r.length;t++)e.push(r[t].clone());return e}function Zl(r){const e=r.getRenderTarget();return e===null?r.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Ye.workingColorSpace}const td={clone:Ji,merge:kt};var nd=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,id=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class ti extends vn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=nd,this.fragmentShader=id,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ji(e.uniforms),this.uniformsGroups=ed(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const i in this.uniforms){const a=this.uniforms[i].value;a&&a.isTexture?t.uniforms[i]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[i]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[i]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[i]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[i]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[i]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[i]={type:"m4",value:a.toArray()}:t.uniforms[i]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class Ql extends pt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Oe,this.projectionMatrix=new Oe,this.projectionMatrixInverse=new Oe,this.coordinateSystem=Un}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Xn=new T,Ec=new me,Tc=new me;class Gt extends Ql{constructor(e=50,t=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=$i*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(ys*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return $i*2*Math.atan(Math.tan(ys*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Xn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Xn.x,Xn.y).multiplyScalar(-e/Xn.z),Xn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Xn.x,Xn.y).multiplyScalar(-e/Xn.z)}getViewSize(e,t){return this.getViewBounds(e,Ec,Tc),t.subVectors(Tc,Ec)}setViewOffset(e,t,n,i,s,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(ys*.5*this.fov)/this.zoom,n=2*t,i=this.aspect*n,s=-.5*i;const a=this.view;if(this.view!==null&&this.view.enabled){const c=a.fullWidth,l=a.fullHeight;s+=a.offsetX*i/c,t-=a.offsetY*n/l,i*=a.width/c,n*=a.height/l}const o=this.filmOffset;o!==0&&(s+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+i,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const Li=-90,Di=1;class sd extends pt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const i=new Gt(Li,Di,e,t);i.layers=this.layers,this.add(i);const s=new Gt(Li,Di,e,t);s.layers=this.layers,this.add(s);const a=new Gt(Li,Di,e,t);a.layers=this.layers,this.add(a);const o=new Gt(Li,Di,e,t);o.layers=this.layers,this.add(o);const c=new Gt(Li,Di,e,t);c.layers=this.layers,this.add(c);const l=new Gt(Li,Di,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,i,s,a,o,c]=t;for(const l of t)this.remove(l);if(e===Un)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(e===Rr)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[s,a,o,c,l,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,i),e.render(t,s),e.setRenderTarget(n,1,i),e.render(t,a),e.setRenderTarget(n,2,i),e.render(t,o),e.setRenderTarget(n,3,i),e.render(t,c),e.setRenderTarget(n,4,i),e.render(t,l),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,i),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class eh extends At{constructor(e=[],t=Yi,n,i,s,a,o,c,l,h){super(e,t,n,i,s,a,o,c,l,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class rd extends vi{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},i=[n,n,n,n,n,n];this.texture=new eh(i),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new bt(5,5,5),s=new ti({name:"CubemapFromEquirect",uniforms:Ji(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Xt,blending:Zn});s.uniforms.tEquirect.value=t;const a=new Wt(i,s),o=t.minFilter;return t.minFilter===Nn&&(t.minFilter=Qt),new sd(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,i=!0){const s=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,i);e.setRenderTarget(s)}}class je extends pt{constructor(){super(),this.isGroup=!0,this.type="Group"}}const ad={type:"move"};class ra{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new je,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new je,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new T,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new T),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new je,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new T,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new T),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let i=null,s=null,a=null;const o=this._targetRay,c=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){a=!0;for(const _ of e.hand.values()){const m=t.getJointPose(_,n),p=this._getHandJoint(l,_);m!==null&&(p.matrix.fromArray(m.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=m.radius),p.visible=m!==null}const h=l.joints["index-finger-tip"],u=l.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,g=.005;l.inputState.pinching&&d>f+g?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&d<=f-g&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else c!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,n),s!==null&&(c.matrix.fromArray(s.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,s.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(s.linearVelocity)):c.hasLinearVelocity=!1,s.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(s.angularVelocity)):c.hasAngularVelocity=!1));o!==null&&(i=t.getPose(e.targetRaySpace,n),i===null&&s!==null&&(i=s),i!==null&&(o.matrix.fromArray(i.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,i.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(i.linearVelocity)):o.hasLinearVelocity=!1,i.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(i.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(ad)))}return o!==null&&(o.visible=i!==null),c!==null&&(c.visible=s!==null),l!==null&&(l.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new je;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}class Oo{constructor(e,t=25e-5){this.isFogExp2=!0,this.name="",this.color=new Pe(e),this.density=t}clone(){return new Oo(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class od extends pt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Tt,this.environmentIntensity=1,this.environmentRotation=new Tt,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class cd{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=po,this.updateRanges=[],this.version=0,this.uuid=gn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let i=0,s=this.stride;i<s;i++)this.array[e+i]=t.array[n+i];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=gn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=gn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Bt=new T;class Bo{constructor(e,t,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.applyMatrix4(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.applyNormalMatrix(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Bt.fromBufferAttribute(this,t),Bt.transformDirection(e),this.setXYZ(t,Bt.x,Bt.y,Bt.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=fn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=st(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=st(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=st(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=st(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=st(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=fn(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=fn(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=fn(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=fn(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=st(t,this.array),n=st(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=st(t,this.array),n=st(n,this.array),i=st(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=st(t,this.array),n=st(n,this.array),i=st(i,this.array),s=st(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this.data.array[e+3]=s,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return new It(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new Bo(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}const wc=new T,Ac=new et,Rc=new et,ld=new T,Cc=new Oe,nr=new T,aa=new bn,Pc=new Oe,oa=new Us;class hd extends Wt{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=rc,this.bindMatrix=new Oe,this.bindMatrixInverse=new Oe,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){const e=this.geometry;this.boundingBox===null&&(this.boundingBox=new Bn),this.boundingBox.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,nr),this.boundingBox.expandByPoint(nr)}computeBoundingSphere(){const e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new bn),this.boundingSphere.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,nr),this.boundingSphere.expandByPoint(nr)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){const n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),aa.copy(this.boundingSphere),aa.applyMatrix4(i),e.ray.intersectsSphere(aa)!==!1&&(Pc.copy(i).invert(),oa.copy(e.ray).applyMatrix4(Pc),!(this.boundingBox!==null&&oa.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,oa)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){const e=new et,t=this.geometry.attributes.skinWeight;for(let n=0,i=t.count;n<i;n++){e.fromBufferAttribute(t,n);const s=1/e.manhattanLength();s!==1/0?e.multiplyScalar(s):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===rc?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===iu?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){const n=this.skeleton,i=this.geometry;Ac.fromBufferAttribute(i.attributes.skinIndex,e),Rc.fromBufferAttribute(i.attributes.skinWeight,e),wc.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let s=0;s<4;s++){const a=Rc.getComponent(s);if(a!==0){const o=Ac.getComponent(s);Cc.multiplyMatrices(n.bones[o].matrixWorld,n.boneInverses[o]),t.addScaledVector(ld.copy(wc).applyMatrix4(Cc),a)}}return t.applyMatrix4(this.bindMatrixInverse)}}class th extends pt{constructor(){super(),this.isBone=!0,this.type="Bone"}}class ko extends At{constructor(e=null,t=1,n=1,i,s,a,o,c,l=Dt,h=Dt,u,d){super(null,a,o,c,l,h,i,s,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}const Ic=new Oe,ud=new Oe;class zo{constructor(e=[],t=[]){this.uuid=gn(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){const e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new Oe)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){const n=new Oe;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){const e=this.bones,t=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let s=0,a=e.length;s<a;s++){const o=e[s]?e[s].matrixWorld:ud;Ic.multiplyMatrices(o,t[s]),Ic.toArray(n,s*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new zo(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);const t=new Float32Array(e*e*4);t.set(this.boneMatrices);const n=new ko(t,e,e,en,mn);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){const i=this.bones[t];if(i.name===e)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,i=e.bones.length;n<i;n++){const s=e.bones[n];let a=t[s];a===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",s),a=new th),this.bones.push(a),this.boneInverses.push(new Oe().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){const e={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;const t=this.bones,n=this.boneInverses;for(let i=0,s=t.length;i<s;i++){const a=t[i];e.bones.push(a.uuid);const o=n[i];e.boneInverses.push(o.toArray())}return e}}class mo extends It{constructor(e,t,n,i=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){const e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}}const Ni=new Oe,Lc=new Oe,ir=[],Dc=new Bn,dd=new Oe,us=new Wt,ds=new bn;class fd extends Wt{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new mo(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,dd)}computeBoundingBox(){const e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Bn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ni),Dc.copy(e.boundingBox).applyMatrix4(Ni),this.boundingBox.union(Dc)}computeBoundingSphere(){const e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new bn),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ni),ds.copy(e.boundingSphere).applyMatrix4(Ni),this.boundingSphere.union(ds)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){const n=t.morphTargetInfluences,i=this.morphTexture.source.data.data,s=n.length+1,a=e*s+1;for(let o=0;o<n.length;o++)n[o]=i[a+o]}raycast(e,t){const n=this.matrixWorld,i=this.count;if(us.geometry=this.geometry,us.material=this.material,us.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ds.copy(this.boundingSphere),ds.applyMatrix4(n),e.ray.intersectsSphere(ds)!==!1))for(let s=0;s<i;s++){this.getMatrixAt(s,Ni),Lc.multiplyMatrices(n,Ni),us.matrixWorld=Lc,us.raycast(e,ir);for(let a=0,o=ir.length;a<o;a++){const c=ir[a];c.instanceId=s,c.object=this,t.push(c)}ir.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new mo(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){const n=t.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new ko(new Float32Array(i*this.count),i,this.count,Ro,mn));const s=this.morphTexture.source.data.data;let a=0;for(let l=0;l<n.length;l++)a+=n[l];const o=this.geometry.morphTargetsRelative?1:1-a,c=i*e;s[c]=o,s.set(n,c+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}const ca=new T,pd=new T,md=new ze;class ui{constructor(e=new T(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,i){return this.normal.set(e,t,n),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const i=ca.subVectors(n,t).cross(pd.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(ca),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const s=-(e.start.dot(this.normal)+this.constant)/i;return s<0||s>1?null:t.copy(e.start).addScaledVector(n,s)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||md.getNormalMatrix(e),i=this.coplanarPoint(ca).applyMatrix4(e),s=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const oi=new bn,gd=new me(.5,.5),sr=new T;class Ho{constructor(e=new ui,t=new ui,n=new ui,i=new ui,s=new ui,a=new ui){this.planes=[e,t,n,i,s,a]}set(e,t,n,i,s,a){const o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(i),o[4].copy(s),o[5].copy(a),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Un){const n=this.planes,i=e.elements,s=i[0],a=i[1],o=i[2],c=i[3],l=i[4],h=i[5],u=i[6],d=i[7],f=i[8],g=i[9],_=i[10],m=i[11],p=i[12],M=i[13],b=i[14],v=i[15];if(n[0].setComponents(c-s,d-l,m-f,v-p).normalize(),n[1].setComponents(c+s,d+l,m+f,v+p).normalize(),n[2].setComponents(c+a,d+h,m+g,v+M).normalize(),n[3].setComponents(c-a,d-h,m-g,v-M).normalize(),n[4].setComponents(c-o,d-u,m-_,v-b).normalize(),t===Un)n[5].setComponents(c+o,d+u,m+_,v+b).normalize();else if(t===Rr)n[5].setComponents(o,u,_,b).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),oi.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),oi.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(oi)}intersectsSprite(e){oi.center.set(0,0,0);const t=gd.distanceTo(e.center);return oi.radius=.7071067811865476+t,oi.applyMatrix4(e.matrixWorld),this.intersectsSphere(oi)}intersectsSphere(e){const t=this.planes,n=e.center,i=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(n)<i)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const i=t[n];if(sr.x=i.normal.x>0?e.max.x:e.min.x,sr.y=i.normal.y>0?e.max.y:e.min.y,sr.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(sr)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class Ss extends vn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Pe(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Cr=new T,Pr=new T,Nc=new Oe,fs=new Us,rr=new bn,la=new T,Uc=new T;class Xi extends pt{constructor(e=new yt,t=new Ss){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[0];for(let i=1,s=t.count;i<s;i++)Cr.fromBufferAttribute(t,i-1),Pr.fromBufferAttribute(t,i),n[i]=n[i-1],n[i]+=Cr.distanceTo(Pr);e.setAttribute("lineDistance",new nt(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,s=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),rr.copy(n.boundingSphere),rr.applyMatrix4(i),rr.radius+=s,e.ray.intersectsSphere(rr)===!1)return;Nc.copy(i).invert(),fs.copy(e.ray).applyMatrix4(Nc);const o=s/((this.scale.x+this.scale.y+this.scale.z)/3),c=o*o,l=this.isLineSegments?2:1,h=n.index,d=n.attributes.position;if(h!==null){const f=Math.max(0,a.start),g=Math.min(h.count,a.start+a.count);for(let _=f,m=g-1;_<m;_+=l){const p=h.getX(_),M=h.getX(_+1),b=ar(this,e,fs,c,p,M,_);b&&t.push(b)}if(this.isLineLoop){const _=h.getX(g-1),m=h.getX(f),p=ar(this,e,fs,c,_,m,g-1);p&&t.push(p)}}else{const f=Math.max(0,a.start),g=Math.min(d.count,a.start+a.count);for(let _=f,m=g-1;_<m;_+=l){const p=ar(this,e,fs,c,_,_+1,_);p&&t.push(p)}if(this.isLineLoop){const _=ar(this,e,fs,c,g-1,f,g-1);_&&t.push(_)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=i.length;s<a;s++){const o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}}function ar(r,e,t,n,i,s,a){const o=r.geometry.attributes.position;if(Cr.fromBufferAttribute(o,i),Pr.fromBufferAttribute(o,s),t.distanceSqToSegment(Cr,Pr,la,Uc)>n)return;la.applyMatrix4(r.matrixWorld);const l=e.ray.origin.distanceTo(la);if(!(l<e.near||l>e.far))return{distance:l,point:Uc.clone().applyMatrix4(r.matrixWorld),index:a,face:null,faceIndex:null,barycoord:null,object:r}}const Fc=new T,Oc=new T;class _d extends Xi{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[];for(let i=0,s=t.count;i<s;i+=2)Fc.fromBufferAttribute(t,i),Oc.fromBufferAttribute(t,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+Fc.distanceTo(Oc);e.setAttribute("lineDistance",new nt(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class vd extends Xi{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}}class Vo extends vn{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Pe(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}const Bc=new Oe,go=new Us,or=new bn,cr=new T;class nh extends pt{constructor(e=new yt,t=new Vo){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,s=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),or.copy(n.boundingSphere),or.applyMatrix4(i),or.radius+=s,e.ray.intersectsSphere(or)===!1)return;Bc.copy(i).invert(),go.copy(e.ray).applyMatrix4(Bc);const o=s/((this.scale.x+this.scale.y+this.scale.z)/3),c=o*o,l=n.index,u=n.attributes.position;if(l!==null){const d=Math.max(0,a.start),f=Math.min(l.count,a.start+a.count);for(let g=d,_=f;g<_;g++){const m=l.getX(g);cr.fromBufferAttribute(u,m),kc(cr,m,c,i,e,t,this)}}else{const d=Math.max(0,a.start),f=Math.min(u.count,a.start+a.count);for(let g=d,_=f;g<_;g++)cr.fromBufferAttribute(u,g),kc(cr,g,c,i,e,t,this)}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=i.length;s<a;s++){const o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}}function kc(r,e,t,n,i,s,a){const o=go.distanceSqToPoint(r);if(o<t){const c=new T;go.closestPointToPoint(r,c),c.applyMatrix4(n);const l=i.ray.origin.distanceTo(c);if(l<i.near||l>i.far)return;s.push({distance:l,distanceToRay:Math.sqrt(o),point:c,index:e,face:null,faceIndex:null,barycoord:null,object:a})}}class xd extends At{constructor(e,t,n,i,s,a,o,c,l){super(e,t,n,i,s,a,o,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}}class ih extends At{constructor(e,t,n=_i,i,s,a,o=Dt,c=Dt,l,h=Cs,u=1){if(h!==Cs&&h!==Ps)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const d={width:e,height:t,depth:u};super(d,i,s,a,o,c,h,n,l),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new Uo(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}class bs extends yt{constructor(e=1,t=32,n=0,i=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:i},t=Math.max(3,t);const s=[],a=[],o=[],c=[],l=new T,h=new me;a.push(0,0,0),o.push(0,0,1),c.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){const f=n+u/t*i;l.x=e*Math.cos(f),l.y=e*Math.sin(f),a.push(l.x,l.y,l.z),o.push(0,0,1),h.x=(a[d]/e+1)/2,h.y=(a[d+1]/e+1)/2,c.push(h.x,h.y)}for(let u=1;u<=t;u++)s.push(u,u+1,0);this.setIndex(s),this.setAttribute("position",new nt(a,3)),this.setAttribute("normal",new nt(o,3)),this.setAttribute("uv",new nt(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new bs(e.radius,e.segments,e.thetaStart,e.thetaLength)}}class St extends yt{constructor(e=1,t=1,n=1,i=32,s=1,a=!1,o=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:i,heightSegments:s,openEnded:a,thetaStart:o,thetaLength:c};const l=this;i=Math.floor(i),s=Math.floor(s);const h=[],u=[],d=[],f=[];let g=0;const _=[],m=n/2;let p=0;M(),a===!1&&(e>0&&b(!0),t>0&&b(!1)),this.setIndex(h),this.setAttribute("position",new nt(u,3)),this.setAttribute("normal",new nt(d,3)),this.setAttribute("uv",new nt(f,2));function M(){const v=new T,P=new T;let R=0;const A=(t-e)/n;for(let C=0;C<=s;C++){const S=[],x=C/s,I=x*(t-e)+e;for(let k=0;k<=i;k++){const O=k/i,X=O*c+o,Y=Math.sin(X),W=Math.cos(X);P.x=I*Y,P.y=-x*n+m,P.z=I*W,u.push(P.x,P.y,P.z),v.set(Y,A,W).normalize(),d.push(v.x,v.y,v.z),f.push(O,1-x),S.push(g++)}_.push(S)}for(let C=0;C<i;C++)for(let S=0;S<s;S++){const x=_[S][C],I=_[S+1][C],k=_[S+1][C+1],O=_[S][C+1];(e>0||S!==0)&&(h.push(x,I,O),R+=3),(t>0||S!==s-1)&&(h.push(I,k,O),R+=3)}l.addGroup(p,R,0),p+=R}function b(v){const P=g,R=new me,A=new T;let C=0;const S=v===!0?e:t,x=v===!0?1:-1;for(let k=1;k<=i;k++)u.push(0,m*x,0),d.push(0,x,0),f.push(.5,.5),g++;const I=g;for(let k=0;k<=i;k++){const X=k/i*c+o,Y=Math.cos(X),W=Math.sin(X);A.x=S*W,A.y=m*x,A.z=S*Y,u.push(A.x,A.y,A.z),d.push(0,x,0),R.x=Y*.5+.5,R.y=W*.5*x+.5,f.push(R.x,R.y),g++}for(let k=0;k<i;k++){const O=P+k,X=I+k;v===!0?h.push(X,X+1,O):h.push(X+1,X,O),C+=3}l.addGroup(p,C,v===!0?1:2),p+=C}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new St(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class Jt extends St{constructor(e=1,t=1,n=32,i=1,s=!1,a=0,o=Math.PI*2){super(0,e,t,n,i,s,a,o),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:i,openEnded:s,thetaStart:a,thetaLength:o}}static fromJSON(e){return new Jt(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class ts extends yt{constructor(e=[],t=[],n=1,i=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:i};const s=[],a=[];o(i),l(n),h(),this.setAttribute("position",new nt(s,3)),this.setAttribute("normal",new nt(s.slice(),3)),this.setAttribute("uv",new nt(a,2)),i===0?this.computeVertexNormals():this.normalizeNormals();function o(M){const b=new T,v=new T,P=new T;for(let R=0;R<t.length;R+=3)f(t[R+0],b),f(t[R+1],v),f(t[R+2],P),c(b,v,P,M)}function c(M,b,v,P){const R=P+1,A=[];for(let C=0;C<=R;C++){A[C]=[];const S=M.clone().lerp(v,C/R),x=b.clone().lerp(v,C/R),I=R-C;for(let k=0;k<=I;k++)k===0&&C===R?A[C][k]=S:A[C][k]=S.clone().lerp(x,k/I)}for(let C=0;C<R;C++)for(let S=0;S<2*(R-C)-1;S++){const x=Math.floor(S/2);S%2===0?(d(A[C][x+1]),d(A[C+1][x]),d(A[C][x])):(d(A[C][x+1]),d(A[C+1][x+1]),d(A[C+1][x]))}}function l(M){const b=new T;for(let v=0;v<s.length;v+=3)b.x=s[v+0],b.y=s[v+1],b.z=s[v+2],b.normalize().multiplyScalar(M),s[v+0]=b.x,s[v+1]=b.y,s[v+2]=b.z}function h(){const M=new T;for(let b=0;b<s.length;b+=3){M.x=s[b+0],M.y=s[b+1],M.z=s[b+2];const v=m(M)/2/Math.PI+.5,P=p(M)/Math.PI+.5;a.push(v,1-P)}g(),u()}function u(){for(let M=0;M<a.length;M+=6){const b=a[M+0],v=a[M+2],P=a[M+4],R=Math.max(b,v,P),A=Math.min(b,v,P);R>.9&&A<.1&&(b<.2&&(a[M+0]+=1),v<.2&&(a[M+2]+=1),P<.2&&(a[M+4]+=1))}}function d(M){s.push(M.x,M.y,M.z)}function f(M,b){const v=M*3;b.x=e[v+0],b.y=e[v+1],b.z=e[v+2]}function g(){const M=new T,b=new T,v=new T,P=new T,R=new me,A=new me,C=new me;for(let S=0,x=0;S<s.length;S+=9,x+=6){M.set(s[S+0],s[S+1],s[S+2]),b.set(s[S+3],s[S+4],s[S+5]),v.set(s[S+6],s[S+7],s[S+8]),R.set(a[x+0],a[x+1]),A.set(a[x+2],a[x+3]),C.set(a[x+4],a[x+5]),P.copy(M).add(b).add(v).divideScalar(3);const I=m(P);_(R,x+0,M,I),_(A,x+2,b,I),_(C,x+4,v,I)}}function _(M,b,v,P){P<0&&M.x===1&&(a[b]=M.x-1),v.x===0&&v.z===0&&(a[b]=P/2/Math.PI+.5)}function m(M){return Math.atan2(M.z,-M.x)}function p(M){return Math.atan2(-M.y,Math.sqrt(M.x*M.x+M.z*M.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ts(e.vertices,e.indices,e.radius,e.details)}}class Zt extends ts{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,i=1/n,s=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-i,-n,0,-i,n,0,i,-n,0,i,n,-i,-n,0,-i,n,0,i,-n,0,i,n,0,-n,0,-i,n,0,-i,-n,0,i,n,0,i],a=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(s,a,e,t),this.type="DodecahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new Zt(e.radius,e.detail)}}class kn{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){console.warn("THREE.Curve: .getPoint() not implemented.")}getPointAt(e,t){const n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){const t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){const t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){const e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;const t=[];let n,i=this.getPoint(0),s=0;t.push(0);for(let a=1;a<=e;a++)n=this.getPoint(a/e),s+=n.distanceTo(i),t.push(s),i=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){const n=this.getLengths();let i=0;const s=n.length;let a;t?a=t:a=e*n[s-1];let o=0,c=s-1,l;for(;o<=c;)if(i=Math.floor(o+(c-o)/2),l=n[i]-a,l<0)o=i+1;else if(l>0)c=i-1;else{c=i;break}if(i=c,n[i]===a)return i/(s-1);const h=n[i],d=n[i+1]-h,f=(a-h)/d;return(i+f)/(s-1)}getTangent(e,t){let i=e-1e-4,s=e+1e-4;i<0&&(i=0),s>1&&(s=1);const a=this.getPoint(i),o=this.getPoint(s),c=t||(a.isVector2?new me:new T);return c.copy(o).sub(a).normalize(),c}getTangentAt(e,t){const n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){const n=new T,i=[],s=[],a=[],o=new T,c=new Oe;for(let f=0;f<=e;f++){const g=f/e;i[f]=this.getTangentAt(g,new T)}s[0]=new T,a[0]=new T;let l=Number.MAX_VALUE;const h=Math.abs(i[0].x),u=Math.abs(i[0].y),d=Math.abs(i[0].z);h<=l&&(l=h,n.set(1,0,0)),u<=l&&(l=u,n.set(0,1,0)),d<=l&&n.set(0,0,1),o.crossVectors(i[0],n).normalize(),s[0].crossVectors(i[0],o),a[0].crossVectors(i[0],s[0]);for(let f=1;f<=e;f++){if(s[f]=s[f-1].clone(),a[f]=a[f-1].clone(),o.crossVectors(i[f-1],i[f]),o.length()>Number.EPSILON){o.normalize();const g=Math.acos(Ge(i[f-1].dot(i[f]),-1,1));s[f].applyMatrix4(c.makeRotationAxis(o,g))}a[f].crossVectors(i[f],s[f])}if(t===!0){let f=Math.acos(Ge(s[0].dot(s[e]),-1,1));f/=e,i[0].dot(o.crossVectors(s[0],s[e]))>0&&(f=-f);for(let g=1;g<=e;g++)s[g].applyMatrix4(c.makeRotationAxis(i[g],f*g)),a[g].crossVectors(i[g],s[g])}return{tangents:i,normals:s,binormals:a}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){const e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}}class sh extends kn{constructor(e=0,t=0,n=1,i=1,s=0,a=Math.PI*2,o=!1,c=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=i,this.aStartAngle=s,this.aEndAngle=a,this.aClockwise=o,this.aRotation=c}getPoint(e,t=new me){const n=t,i=Math.PI*2;let s=this.aEndAngle-this.aStartAngle;const a=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=i;for(;s>i;)s-=i;s<Number.EPSILON&&(a?s=0:s=i),this.aClockwise===!0&&!a&&(s===i?s=-i:s=s-i);const o=this.aStartAngle+e*s;let c=this.aX+this.xRadius*Math.cos(o),l=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){const h=Math.cos(this.aRotation),u=Math.sin(this.aRotation),d=c-this.aX,f=l-this.aY;c=d*h-f*u+this.aX,l=d*u+f*h+this.aY}return n.set(c,l)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){const e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}}class yd extends sh{constructor(e,t,n,i,s,a){super(e,t,n,n,i,s,a),this.isArcCurve=!0,this.type="ArcCurve"}}function Go(){let r=0,e=0,t=0,n=0;function i(s,a,o,c){r=s,e=o,t=-3*s+3*a-2*o-c,n=2*s-2*a+o+c}return{initCatmullRom:function(s,a,o,c,l){i(a,o,l*(o-s),l*(c-a))},initNonuniformCatmullRom:function(s,a,o,c,l,h,u){let d=(a-s)/l-(o-s)/(l+h)+(o-a)/h,f=(o-a)/h-(c-a)/(h+u)+(c-o)/u;d*=h,f*=h,i(a,o,d,f)},calc:function(s){const a=s*s,o=a*s;return r+e*s+t*a+n*o}}}const lr=new T,ha=new Go,ua=new Go,da=new Go;class rh extends kn{constructor(e=[],t=!1,n="centripetal",i=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=i}getPoint(e,t=new T){const n=t,i=this.points,s=i.length,a=(s-(this.closed?0:1))*e;let o=Math.floor(a),c=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/s)+1)*s:c===0&&o===s-1&&(o=s-2,c=1);let l,h;this.closed||o>0?l=i[(o-1)%s]:(lr.subVectors(i[0],i[1]).add(i[0]),l=lr);const u=i[o%s],d=i[(o+1)%s];if(this.closed||o+2<s?h=i[(o+2)%s]:(lr.subVectors(i[s-1],i[s-2]).add(i[s-1]),h=lr),this.curveType==="centripetal"||this.curveType==="chordal"){const f=this.curveType==="chordal"?.5:.25;let g=Math.pow(l.distanceToSquared(u),f),_=Math.pow(u.distanceToSquared(d),f),m=Math.pow(d.distanceToSquared(h),f);_<1e-4&&(_=1),g<1e-4&&(g=_),m<1e-4&&(m=_),ha.initNonuniformCatmullRom(l.x,u.x,d.x,h.x,g,_,m),ua.initNonuniformCatmullRom(l.y,u.y,d.y,h.y,g,_,m),da.initNonuniformCatmullRom(l.z,u.z,d.z,h.z,g,_,m)}else this.curveType==="catmullrom"&&(ha.initCatmullRom(l.x,u.x,d.x,h.x,this.tension),ua.initCatmullRom(l.y,u.y,d.y,h.y,this.tension),da.initCatmullRom(l.z,u.z,d.z,h.z,this.tension));return n.set(ha.calc(c),ua.calc(c),da.calc(c)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(i.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){const e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){const i=this.points[t];e.points.push(i.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(new T().fromArray(i))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}}function zc(r,e,t,n,i){const s=(n-e)*.5,a=(i-t)*.5,o=r*r,c=r*o;return(2*t-2*n+s+a)*c+(-3*t+3*n-2*s-a)*o+s*r+t}function Md(r,e){const t=1-r;return t*t*e}function Sd(r,e){return 2*(1-r)*r*e}function bd(r,e){return r*r*e}function Es(r,e,t,n){return Md(r,e)+Sd(r,t)+bd(r,n)}function Ed(r,e){const t=1-r;return t*t*t*e}function Td(r,e){const t=1-r;return 3*t*t*r*e}function wd(r,e){return 3*(1-r)*r*r*e}function Ad(r,e){return r*r*r*e}function Ts(r,e,t,n,i){return Ed(r,e)+Td(r,t)+wd(r,n)+Ad(r,i)}class Rd extends kn{constructor(e=new me,t=new me,n=new me,i=new me){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=i}getPoint(e,t=new me){const n=t,i=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(Ts(e,i.x,s.x,a.x,o.x),Ts(e,i.y,s.y,a.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}}class Cd extends kn{constructor(e=new T,t=new T,n=new T,i=new T){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=i}getPoint(e,t=new T){const n=t,i=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(Ts(e,i.x,s.x,a.x,o.x),Ts(e,i.y,s.y,a.y,o.y),Ts(e,i.z,s.z,a.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}}class Pd extends kn{constructor(e=new me,t=new me){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new me){const n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new me){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Id extends kn{constructor(e=new T,t=new T){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new T){const n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new T){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Ld extends kn{constructor(e=new me,t=new me,n=new me){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new me){const n=t,i=this.v0,s=this.v1,a=this.v2;return n.set(Es(e,i.x,s.x,a.x),Es(e,i.y,s.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class ah extends kn{constructor(e=new T,t=new T,n=new T){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new T){const n=t,i=this.v0,s=this.v1,a=this.v2;return n.set(Es(e,i.x,s.x,a.x),Es(e,i.y,s.y,a.y),Es(e,i.z,s.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Dd extends kn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new me){const n=t,i=this.points,s=(i.length-1)*e,a=Math.floor(s),o=s-a,c=i[a===0?a:a-1],l=i[a],h=i[a>i.length-2?i.length-1:a+1],u=i[a>i.length-3?i.length-1:a+2];return n.set(zc(o,c.x,l.x,h.x,u.x),zc(o,c.y,l.y,h.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(i.clone())}return this}toJSON(){const e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){const i=this.points[t];e.points.push(i.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(new me().fromArray(i))}return this}}var Nd=Object.freeze({__proto__:null,ArcCurve:yd,CatmullRomCurve3:rh,CubicBezierCurve:Rd,CubicBezierCurve3:Cd,EllipseCurve:sh,LineCurve:Pd,LineCurve3:Id,QuadraticBezierCurve:Ld,QuadraticBezierCurve3:ah,SplineCurve:Dd});class zi extends ts{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,i=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],s=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(i,s,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new zi(e.radius,e.detail)}}class Vt extends ts{constructor(e=1,t=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],i=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,i,e,t),this.type="OctahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new Vt(e.radius,e.detail)}}class gi extends yt{constructor(e=1,t=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:i};const s=e/2,a=t/2,o=Math.floor(n),c=Math.floor(i),l=o+1,h=c+1,u=e/o,d=t/c,f=[],g=[],_=[],m=[];for(let p=0;p<h;p++){const M=p*d-a;for(let b=0;b<l;b++){const v=b*u-s;g.push(v,-M,0),_.push(0,0,1),m.push(b/o),m.push(1-p/c)}}for(let p=0;p<c;p++)for(let M=0;M<o;M++){const b=M+l*p,v=M+l*(p+1),P=M+1+l*(p+1),R=M+1+l*p;f.push(b,v,R),f.push(v,P,R)}this.setIndex(f),this.setAttribute("position",new nt(g,3)),this.setAttribute("normal",new nt(_,3)),this.setAttribute("uv",new nt(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new gi(e.width,e.height,e.widthSegments,e.heightSegments)}}class pi extends yt{constructor(e=.5,t=1,n=32,i=1,s=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:i,thetaStart:s,thetaLength:a},n=Math.max(3,n),i=Math.max(1,i);const o=[],c=[],l=[],h=[];let u=e;const d=(t-e)/i,f=new T,g=new me;for(let _=0;_<=i;_++){for(let m=0;m<=n;m++){const p=s+m/n*a;f.x=u*Math.cos(p),f.y=u*Math.sin(p),c.push(f.x,f.y,f.z),l.push(0,0,1),g.x=(f.x/t+1)/2,g.y=(f.y/t+1)/2,h.push(g.x,g.y)}u+=d}for(let _=0;_<i;_++){const m=_*(n+1);for(let p=0;p<n;p++){const M=p+m,b=M,v=M+n+1,P=M+n+2,R=M+1;o.push(b,v,R),o.push(v,P,R)}}this.setIndex(o),this.setAttribute("position",new nt(c,3)),this.setAttribute("normal",new nt(l,3)),this.setAttribute("uv",new nt(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new pi(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}}class un extends yt{constructor(e=1,t=32,n=16,i=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:i,phiLength:s,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));const c=Math.min(a+o,Math.PI);let l=0;const h=[],u=new T,d=new T,f=[],g=[],_=[],m=[];for(let p=0;p<=n;p++){const M=[],b=p/n;let v=0;p===0&&a===0?v=.5/t:p===n&&c===Math.PI&&(v=-.5/t);for(let P=0;P<=t;P++){const R=P/t;u.x=-e*Math.cos(i+R*s)*Math.sin(a+b*o),u.y=e*Math.cos(a+b*o),u.z=e*Math.sin(i+R*s)*Math.sin(a+b*o),g.push(u.x,u.y,u.z),d.copy(u).normalize(),_.push(d.x,d.y,d.z),m.push(R+v,1-b),M.push(l++)}h.push(M)}for(let p=0;p<n;p++)for(let M=0;M<t;M++){const b=h[p][M+1],v=h[p][M],P=h[p+1][M],R=h[p+1][M+1];(p!==0||a>0)&&f.push(b,v,R),(p!==n-1||c<Math.PI)&&f.push(v,P,R)}this.setIndex(f),this.setAttribute("position",new nt(g,3)),this.setAttribute("normal",new nt(_,3)),this.setAttribute("uv",new nt(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new un(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class Yn extends ts{constructor(e=1,t=0){const n=[1,1,1,-1,-1,1,-1,1,-1,1,-1,-1],i=[2,1,0,0,3,2,1,3,0,2,3,1];super(n,i,e,t),this.type="TetrahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new Yn(e.radius,e.detail)}}class dn extends yt{constructor(e=1,t=.4,n=12,i=48,s=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:i,arc:s},n=Math.floor(n),i=Math.floor(i);const a=[],o=[],c=[],l=[],h=new T,u=new T,d=new T;for(let f=0;f<=n;f++)for(let g=0;g<=i;g++){const _=g/i*s,m=f/n*Math.PI*2;u.x=(e+t*Math.cos(m))*Math.cos(_),u.y=(e+t*Math.cos(m))*Math.sin(_),u.z=t*Math.sin(m),o.push(u.x,u.y,u.z),h.x=e*Math.cos(_),h.y=e*Math.sin(_),d.subVectors(u,h).normalize(),c.push(d.x,d.y,d.z),l.push(g/i),l.push(f/n)}for(let f=1;f<=n;f++)for(let g=1;g<=i;g++){const _=(i+1)*f+g-1,m=(i+1)*(f-1)+g-1,p=(i+1)*(f-1)+g,M=(i+1)*f+g;a.push(_,m,M),a.push(m,p,M)}this.setIndex(a),this.setAttribute("position",new nt(o,3)),this.setAttribute("normal",new nt(c,3)),this.setAttribute("uv",new nt(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new dn(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}}class Wo extends yt{constructor(e=new ah(new T(-1,-1,0),new T(-1,1,0),new T(1,1,0)),t=64,n=1,i=8,s=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:t,radius:n,radialSegments:i,closed:s};const a=e.computeFrenetFrames(t,s);this.tangents=a.tangents,this.normals=a.normals,this.binormals=a.binormals;const o=new T,c=new T,l=new me;let h=new T;const u=[],d=[],f=[],g=[];_(),this.setIndex(g),this.setAttribute("position",new nt(u,3)),this.setAttribute("normal",new nt(d,3)),this.setAttribute("uv",new nt(f,2));function _(){for(let b=0;b<t;b++)m(b);m(s===!1?t:0),M(),p()}function m(b){h=e.getPointAt(b/t,h);const v=a.normals[b],P=a.binormals[b];for(let R=0;R<=i;R++){const A=R/i*Math.PI*2,C=Math.sin(A),S=-Math.cos(A);c.x=S*v.x+C*P.x,c.y=S*v.y+C*P.y,c.z=S*v.z+C*P.z,c.normalize(),d.push(c.x,c.y,c.z),o.x=h.x+n*c.x,o.y=h.y+n*c.y,o.z=h.z+n*c.z,u.push(o.x,o.y,o.z)}}function p(){for(let b=1;b<=t;b++)for(let v=1;v<=i;v++){const P=(i+1)*(b-1)+(v-1),R=(i+1)*b+(v-1),A=(i+1)*b+v,C=(i+1)*(b-1)+v;g.push(P,R,C),g.push(R,A,C)}}function M(){for(let b=0;b<=t;b++)for(let v=0;v<=i;v++)l.x=b/t,l.y=v/i,f.push(l.x,l.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){const e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new Wo(new Nd[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}}class Fs extends vn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Pe(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Pe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Do,this.normalScale=new me(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Tt,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class En extends Fs{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new me(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Ge(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Pe(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Pe(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Pe(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}}class Ud extends vn{constructor(e){super(),this.isMeshToonMaterial=!0,this.defines={TOON:""},this.type="MeshToonMaterial",this.color=new Pe(16777215),this.map=null,this.gradientMap=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Pe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Do,this.normalScale=new me(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.gradientMap=e.gradientMap,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.alphaMap=e.alphaMap,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}class Fd extends vn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=ou,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class Od extends vn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}function hr(r,e){return!r||r.constructor===e?r:typeof e.BYTES_PER_ELEMENT=="number"?new e(r):Array.prototype.slice.call(r)}function Bd(r){return ArrayBuffer.isView(r)&&!(r instanceof DataView)}function kd(r){function e(i,s){return r[i]-r[s]}const t=r.length,n=new Array(t);for(let i=0;i!==t;++i)n[i]=i;return n.sort(e),n}function Hc(r,e,t){const n=r.length,i=new r.constructor(n);for(let s=0,a=0;a!==n;++s){const o=t[s]*e;for(let c=0;c!==e;++c)i[a++]=r[o+c]}return i}function oh(r,e,t,n){let i=1,s=r[0];for(;s!==void 0&&s[n]===void 0;)s=r[i++];if(s===void 0)return;let a=s[n];if(a!==void 0)if(Array.isArray(a))do a=s[n],a!==void 0&&(e.push(s.time),t.push(...a)),s=r[i++];while(s!==void 0);else if(a.toArray!==void 0)do a=s[n],a!==void 0&&(e.push(s.time),a.toArray(t,t.length)),s=r[i++];while(s!==void 0);else do a=s[n],a!==void 0&&(e.push(s.time),t.push(a)),s=r[i++];while(s!==void 0)}class Os{constructor(e,t,n,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){const t=this.parameterPositions;let n=this._cachedIndex,i=t[n],s=t[n-1];e:{t:{let a;n:{i:if(!(e<i)){for(let o=n+2;;){if(i===void 0){if(e<s)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(s=i,i=t[++n],e<i)break t}a=t.length;break n}if(!(e>=s)){const o=t[1];e<o&&(n=2,s=o);for(let c=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(i=s,s=t[--n-1],e>=s)break t}a=n,n=0;break n}break e}for(;n<a;){const o=n+a>>>1;e<t[o]?a=o:n=o+1}if(i=t[n],s=t[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,i)}return this.interpolate_(n,s,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i;for(let a=0;a!==i;++a)t[a]=n[s+a];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}}class zd extends Os{constructor(e,t,n,i){super(e,t,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Bi,endingEnd:Bi}}intervalChanged_(e,t,n){const i=this.parameterPositions;let s=e-2,a=e+1,o=i[s],c=i[a];if(o===void 0)switch(this.getSettings_().endingStart){case ki:s=e,o=2*t-n;break;case wr:s=i.length-2,o=t+i[s]-i[s+1];break;default:s=e,o=n}if(c===void 0)switch(this.getSettings_().endingEnd){case ki:a=e,c=2*n-t;break;case wr:a=1,c=n+i[1]-i[0];break;default:a=e-1,c=t}const l=(n-t)*.5,h=this.valueSize;this._weightPrev=l/(t-o),this._weightNext=l/(c-n),this._offsetPrev=s*h,this._offsetNext=a*h}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=e*o,l=c-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,g=(n-t)/(i-t),_=g*g,m=_*g,p=-d*m+2*d*_-d*g,M=(1+d)*m+(-1.5-2*d)*_+(-.5+d)*g+1,b=(-1-f)*m+(1.5+f)*_+.5*g,v=f*m-f*_;for(let P=0;P!==o;++P)s[P]=p*a[h+P]+M*a[l+P]+b*a[c+P]+v*a[u+P];return s}}class ch extends Os{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=e*o,l=c-o,h=(n-t)/(i-t),u=1-h;for(let d=0;d!==o;++d)s[d]=a[l+d]*u+a[c+d]*h;return s}}class Hd extends Os{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e){return this.copySampleValue_(e-1)}}class xn{constructor(e,t,n,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=hr(t,this.TimeBufferType),this.values=hr(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){const t=e.constructor;let n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:hr(e.times,Array),values:hr(e.values,Array)};const i=e.getInterpolation();i!==e.DefaultInterpolation&&(n.interpolation=i)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new Hd(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new ch(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new zd(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Is:t=this.InterpolantFactoryMethodDiscrete;break;case Ls:t=this.InterpolantFactoryMethodLinear;break;case Br:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){const n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Is;case this.InterpolantFactoryMethodLinear:return Ls;case this.InterpolantFactoryMethodSmooth:return Br}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]+=e}return this}scale(e){if(e!==1){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]*=e}return this}trim(e,t){const n=this.times,i=n.length;let s=0,a=i-1;for(;s!==i&&n[s]<e;)++s;for(;a!==-1&&n[a]>t;)--a;if(++a,s!==0||a!==i){s>=a&&(a=Math.max(a,1),s=a-1);const o=this.getValueSize();this.times=n.slice(s,a),this.values=this.values.slice(s*o,a*o)}return this}validate(){let e=!0;const t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);const n=this.times,i=this.values,s=n.length;s===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==s;o++){const c=n[o];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,o,c),e=!1;break}if(a!==null&&a>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,o,c,a),e=!1;break}a=c}if(i!==void 0&&Bd(i))for(let o=0,c=i.length;o!==c;++o){const l=i[o];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,o,l),e=!1;break}}return e}optimize(){const e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===Br,s=e.length-1;let a=1;for(let o=1;o<s;++o){let c=!1;const l=e[o],h=e[o+1];if(l!==h&&(o!==1||l!==e[0]))if(i)c=!0;else{const u=o*n,d=u-n,f=u+n;for(let g=0;g!==n;++g){const _=t[u+g];if(_!==t[d+g]||_!==t[f+g]){c=!0;break}}}if(c){if(o!==a){e[a]=e[o];const u=o*n,d=a*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++a}}if(s>0){e[a]=e[s];for(let o=s*n,c=a*n,l=0;l!==n;++l)t[c+l]=t[o+l];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){const e=this.times.slice(),t=this.values.slice(),n=this.constructor,i=new n(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}}xn.prototype.ValueTypeName="";xn.prototype.TimeBufferType=Float32Array;xn.prototype.ValueBufferType=Float32Array;xn.prototype.DefaultInterpolation=Ls;class ns extends xn{constructor(e,t,n){super(e,t,n)}}ns.prototype.ValueTypeName="bool";ns.prototype.ValueBufferType=Array;ns.prototype.DefaultInterpolation=Is;ns.prototype.InterpolantFactoryMethodLinear=void 0;ns.prototype.InterpolantFactoryMethodSmooth=void 0;class lh extends xn{constructor(e,t,n,i){super(e,t,n,i)}}lh.prototype.ValueTypeName="color";class Zi extends xn{constructor(e,t,n,i){super(e,t,n,i)}}Zi.prototype.ValueTypeName="number";class Vd extends Os{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=(n-t)/(i-t);let l=e*o;for(let h=l+o;l!==h;l+=4)_n.slerpFlat(s,0,a,l-o,a,l,c);return s}}class Qi extends xn{constructor(e,t,n,i){super(e,t,n,i)}InterpolantFactoryMethodLinear(e){return new Vd(this.times,this.values,this.getValueSize(),e)}}Qi.prototype.ValueTypeName="quaternion";Qi.prototype.InterpolantFactoryMethodSmooth=void 0;class is extends xn{constructor(e,t,n){super(e,t,n)}}is.prototype.ValueTypeName="string";is.prototype.ValueBufferType=Array;is.prototype.DefaultInterpolation=Is;is.prototype.InterpolantFactoryMethodLinear=void 0;is.prototype.InterpolantFactoryMethodSmooth=void 0;class es extends xn{constructor(e,t,n,i){super(e,t,n,i)}}es.prototype.ValueTypeName="vector";class _o{constructor(e="",t=-1,n=[],i=Lo){this.name=e,this.tracks=n,this.duration=t,this.blendMode=i,this.uuid=gn(),this.duration<0&&this.resetDuration()}static parse(e){const t=[],n=e.tracks,i=1/(e.fps||1);for(let a=0,o=n.length;a!==o;++a)t.push(Wd(n[a]).scale(i));const s=new this(e.name,e.duration,t,e.blendMode);return s.uuid=e.uuid,s}static toJSON(e){const t=[],n=e.tracks,i={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode};for(let s=0,a=n.length;s!==a;++s)t.push(xn.toJSON(n[s]));return i}static CreateFromMorphTargetSequence(e,t,n,i){const s=t.length,a=[];for(let o=0;o<s;o++){let c=[],l=[];c.push((o+s-1)%s,o,(o+1)%s),l.push(0,1,0);const h=kd(c);c=Hc(c,1,h),l=Hc(l,1,h),!i&&c[0]===0&&(c.push(s),l.push(l[0])),a.push(new Zi(".morphTargetInfluences["+t[o].name+"]",c,l).scale(1/n))}return new this(e,-1,a)}static findByName(e,t){let n=e;if(!Array.isArray(e)){const i=e;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===t)return n[i];return null}static CreateClipsFromMorphTargetSequences(e,t,n){const i={},s=/^([\w-]*?)([\d]+)$/;for(let o=0,c=e.length;o<c;o++){const l=e[o],h=l.name.match(s);if(h&&h.length>1){const u=h[1];let d=i[u];d||(i[u]=d=[]),d.push(l)}}const a=[];for(const o in i)a.push(this.CreateFromMorphTargetSequence(o,i[o],t,n));return a}static parseAnimation(e,t){if(console.warn("THREE.AnimationClip: parseAnimation() is deprecated and will be removed with r185"),!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;const n=function(u,d,f,g,_){if(f.length!==0){const m=[],p=[];oh(f,m,p,g),m.length!==0&&_.push(new u(d,m,p))}},i=[],s=e.name||"default",a=e.fps||30,o=e.blendMode;let c=e.length||-1;const l=e.hierarchy||[];for(let u=0;u<l.length;u++){const d=l[u].keys;if(!(!d||d.length===0))if(d[0].morphTargets){const f={};let g;for(g=0;g<d.length;g++)if(d[g].morphTargets)for(let _=0;_<d[g].morphTargets.length;_++)f[d[g].morphTargets[_]]=-1;for(const _ in f){const m=[],p=[];for(let M=0;M!==d[g].morphTargets.length;++M){const b=d[g];m.push(b.time),p.push(b.morphTarget===_?1:0)}i.push(new Zi(".morphTargetInfluence["+_+"]",m,p))}c=f.length*a}else{const f=".bones["+t[u].name+"]";n(es,f+".position",d,"pos",i),n(Qi,f+".quaternion",d,"rot",i),n(es,f+".scale",d,"scl",i)}}return i.length===0?null:new this(s,c,i,o)}resetDuration(){const e=this.tracks;let t=0;for(let n=0,i=e.length;n!==i;++n){const s=this.tracks[n];t=Math.max(t,s.times[s.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){const e=[];for(let t=0;t<this.tracks.length;t++)e.push(this.tracks[t].clone());return new this.constructor(this.name,this.duration,e,this.blendMode)}toJSON(){return this.constructor.toJSON(this)}}function Gd(r){switch(r.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Zi;case"vector":case"vector2":case"vector3":case"vector4":return es;case"color":return lh;case"quaternion":return Qi;case"bool":case"boolean":return ns;case"string":return is}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+r)}function Wd(r){if(r.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");const e=Gd(r.type);if(r.times===void 0){const t=[],n=[];oh(r.keys,t,n,"value"),r.times=t,r.values=n}return e.parse!==void 0?e.parse(r):new e(r.name,r.times,r.values,r.interpolation)}const Fn={enabled:!1,files:{},add:function(r,e){this.enabled!==!1&&(this.files[r]=e)},get:function(r){if(this.enabled!==!1)return this.files[r]},remove:function(r){delete this.files[r]},clear:function(){this.files={}}};class Xd{constructor(e,t,n){const i=this;let s=!1,a=0,o=0,c;const l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){o++,s===!1&&i.onStart!==void 0&&i.onStart(h,a,o),s=!0},this.itemEnd=function(h){a++,i.onProgress!==void 0&&i.onProgress(h,a,o),a===o&&(s=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(h){i.onError!==void 0&&i.onError(h)},this.resolveURL=function(h){return c?c(h):h},this.setURLModifier=function(h){return c=h,this},this.addHandler=function(h,u){return l.push(h,u),this},this.removeHandler=function(h){const u=l.indexOf(h);return u!==-1&&l.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=l.length;u<d;u+=2){const f=l[u],g=l[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return g}return null}}}const qd=new Xd;class ss{constructor(e){this.manager=e!==void 0?e:qd,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){const n=this;return new Promise(function(i,s){n.load(e,i,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}}ss.DEFAULT_MATERIAL_NAME="__DEFAULT";const In={};class jd extends Error{constructor(e,t){super(e),this.response=t}}class hh extends ss{constructor(e){super(e),this.mimeType="",this.responseType=""}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=Fn.get(`file:${e}`);if(s!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(s),this.manager.itemEnd(e)},0),s;if(In[e]!==void 0){In[e].push({onLoad:t,onProgress:n,onError:i});return}In[e]=[],In[e].push({onLoad:t,onProgress:n,onError:i});const a=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin"}),o=this.mimeType,c=this.responseType;fetch(a).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;const h=In[e],u=l.body.getReader(),d=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),f=d?parseInt(d):0,g=f!==0;let _=0;const m=new ReadableStream({start(p){M();function M(){u.read().then(({done:b,value:v})=>{if(b)p.close();else{_+=v.byteLength;const P=new ProgressEvent("progress",{lengthComputable:g,loaded:_,total:f});for(let R=0,A=h.length;R<A;R++){const C=h[R];C.onProgress&&C.onProgress(P)}p.enqueue(v),M()}},b=>{p.error(b)})}}});return new Response(m)}else throw new jd(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(h=>new DOMParser().parseFromString(h,o));case"json":return l.json();default:if(o==="")return l.text();{const u=/charset="?([^;"\s]*)"?/i.exec(o),d=u&&u[1]?u[1].toLowerCase():void 0,f=new TextDecoder(d);return l.arrayBuffer().then(g=>f.decode(g))}}}).then(l=>{Fn.add(`file:${e}`,l);const h=In[e];delete In[e];for(let u=0,d=h.length;u<d;u++){const f=h[u];f.onLoad&&f.onLoad(l)}}).catch(l=>{const h=In[e];if(h===void 0)throw this.manager.itemError(e),l;delete In[e];for(let u=0,d=h.length;u<d;u++){const f=h[u];f.onError&&f.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}}const Ui=new WeakMap;class Yd extends ss{constructor(e){super(e)}load(e,t,n,i){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,a=Fn.get(`image:${e}`);if(a!==void 0){if(a.complete===!0)s.manager.itemStart(e),setTimeout(function(){t&&t(a),s.manager.itemEnd(e)},0);else{let u=Ui.get(a);u===void 0&&(u=[],Ui.set(a,u)),u.push({onLoad:t,onError:i})}return a}const o=Ds("img");function c(){h(),t&&t(this);const u=Ui.get(this)||[];for(let d=0;d<u.length;d++){const f=u[d];f.onLoad&&f.onLoad(this)}Ui.delete(this),s.manager.itemEnd(e)}function l(u){h(),i&&i(u),Fn.remove(`image:${e}`);const d=Ui.get(this)||[];for(let f=0;f<d.length;f++){const g=d[f];g.onError&&g.onError(u)}Ui.delete(this),s.manager.itemError(e),s.manager.itemEnd(e)}function h(){o.removeEventListener("load",c,!1),o.removeEventListener("error",l,!1)}return o.addEventListener("load",c,!1),o.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),Fn.add(`image:${e}`,o),s.manager.itemStart(e),o.src=e,o}}class Kd extends ss{constructor(e){super(e)}load(e,t,n,i){const s=new At,a=new Yd(this.manager);return a.setCrossOrigin(this.crossOrigin),a.setPath(this.path),a.load(e,function(o){s.image=o,s.needsUpdate=!0,t!==void 0&&t(s)},n,i),s}}class Dr extends pt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Pe(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}class $d extends Dr{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(pt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Pe(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}}const fa=new Oe,Vc=new T,Gc=new T;class Xo{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new me(512,512),this.mapType=Sn,this.map=null,this.mapPass=null,this.matrix=new Oe,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Ho,this._frameExtents=new me(1,1),this._viewportCount=1,this._viewports=[new et(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;Vc.setFromMatrixPosition(e.matrixWorld),t.position.copy(Vc),Gc.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Gc),t.updateMatrixWorld(),fa.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(fa),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(fa)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class Jd extends Xo{constructor(){super(new Gt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){const t=this.camera,n=$i*2*e.angle*this.focus,i=this.mapSize.width/this.mapSize.height*this.aspect,s=e.distance||t.far;(n!==t.fov||i!==t.aspect||s!==t.far)&&(t.fov=n,t.aspect=i,t.far=s,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}}class Zd extends Dr{constructor(e,t,n=0,i=Math.PI/3,s=0,a=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(pt.DEFAULT_UP),this.updateMatrix(),this.target=new pt,this.distance=n,this.angle=i,this.penumbra=s,this.decay=a,this.map=null,this.shadow=new Jd}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}const Wc=new Oe,ps=new T,pa=new T;class Qd extends Xo{constructor(){super(new Gt(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new me(4,2),this._viewportCount=6,this._viewports=[new et(2,1,1,1),new et(0,1,1,1),new et(3,1,1,1),new et(1,1,1,1),new et(3,0,1,1),new et(1,0,1,1)],this._cubeDirections=[new T(1,0,0),new T(-1,0,0),new T(0,0,1),new T(0,0,-1),new T(0,1,0),new T(0,-1,0)],this._cubeUps=[new T(0,1,0),new T(0,1,0),new T(0,1,0),new T(0,1,0),new T(0,0,1),new T(0,0,-1)]}updateMatrices(e,t=0){const n=this.camera,i=this.matrix,s=e.distance||n.far;s!==n.far&&(n.far=s,n.updateProjectionMatrix()),ps.setFromMatrixPosition(e.matrixWorld),n.position.copy(ps),pa.copy(n.position),pa.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(pa),n.updateMatrixWorld(),i.makeTranslation(-ps.x,-ps.y,-ps.z),Wc.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Wc)}}class vo extends Dr{constructor(e,t,n=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Qd}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}}class Nr extends Ql{constructor(e=-1,t=1,n=1,i=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=i,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,i,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2;let s=n-e,a=n+e,o=i+t,c=i-t;if(this.view!==null&&this.view.enabled){const l=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=l*this.view.offsetX,a=s+l*this.view.width,o-=h*this.view.offsetY,c=o-h*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,c,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}class ef extends Xo{constructor(){super(new Nr(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class uh extends Dr{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(pt.DEFAULT_UP),this.updateMatrix(),this.target=new pt,this.shadow=new ef}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class ws{static extractUrlBase(e){const t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}}const ma=new WeakMap;class tf extends ss{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"}}setOptions(e){return this.options=e,this}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,a=Fn.get(`image-bitmap:${e}`);if(a!==void 0){if(s.manager.itemStart(e),a.then){a.then(l=>{if(ma.has(a)===!0)i&&i(ma.get(a)),s.manager.itemError(e),s.manager.itemEnd(e);else return t&&t(l),s.manager.itemEnd(e),l});return}return setTimeout(function(){t&&t(a),s.manager.itemEnd(e)},0),a}const o={};o.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",o.headers=this.requestHeader;const c=fetch(e,o).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(s.options,{colorSpaceConversion:"none"}))}).then(function(l){return Fn.add(`image-bitmap:${e}`,l),t&&t(l),s.manager.itemEnd(e),l}).catch(function(l){i&&i(l),ma.set(c,l),Fn.remove(`image-bitmap:${e}`),s.manager.itemError(e),s.manager.itemEnd(e)});Fn.add(`image-bitmap:${e}`,c),s.manager.itemStart(e)}}class nf extends Gt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}}class sf{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const t=performance.now();e=(t-this.oldTime)/1e3,this.oldTime=t,this.elapsedTime+=e}return e}}class rf{constructor(e,t,n){this.binding=e,this.valueSize=n;let i,s,a;switch(t){case"quaternion":i=this._slerp,s=this._slerpAdditive,a=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":i=this._select,s=this._select,a=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:i=this._lerp,s=this._lerpAdditive,a=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=i,this._mixBufferRegionAdditive=s,this._setIdentity=a,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(e,t){const n=this.buffer,i=this.valueSize,s=e*i+i;let a=this.cumulativeWeight;if(a===0){for(let o=0;o!==i;++o)n[s+o]=n[o];a=t}else{a+=t;const o=t/a;this._mixBufferRegion(n,s,0,o,i)}this.cumulativeWeight=a}accumulateAdditive(e){const t=this.buffer,n=this.valueSize,i=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(t,i,0,e,n),this.cumulativeWeightAdditive+=e}apply(e){const t=this.valueSize,n=this.buffer,i=e*t+t,s=this.cumulativeWeight,a=this.cumulativeWeightAdditive,o=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,s<1){const c=t*this._origIndex;this._mixBufferRegion(n,i,c,1-s,t)}a>0&&this._mixBufferRegionAdditive(n,i,this._addIndex*t,1,t);for(let c=t,l=t+t;c!==l;++c)if(n[c]!==n[c+t]){o.setValue(n,i);break}}saveOriginalState(){const e=this.binding,t=this.buffer,n=this.valueSize,i=n*this._origIndex;e.getValue(t,i);for(let s=n,a=i;s!==a;++s)t[s]=t[i+s%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){const e=this.valueSize*3;this.binding.setValue(this.buffer,e)}_setAdditiveIdentityNumeric(){const e=this._addIndex*this.valueSize,t=e+this.valueSize;for(let n=e;n<t;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){const e=this._origIndex*this.valueSize,t=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[t+n]=this.buffer[e+n]}_select(e,t,n,i,s){if(i>=.5)for(let a=0;a!==s;++a)e[t+a]=e[n+a]}_slerp(e,t,n,i){_n.slerpFlat(e,t,e,t,e,n,i)}_slerpAdditive(e,t,n,i,s){const a=this._workIndex*s;_n.multiplyQuaternionsFlat(e,a,e,t,e,n),_n.slerpFlat(e,t,e,t,e,a,i)}_lerp(e,t,n,i,s){const a=1-i;for(let o=0;o!==s;++o){const c=t+o;e[c]=e[c]*a+e[n+o]*i}}_lerpAdditive(e,t,n,i,s){for(let a=0;a!==s;++a){const o=t+a;e[o]=e[o]+e[n+a]*i}}}const qo="\\[\\]\\.:\\/",af=new RegExp("["+qo+"]","g"),jo="[^"+qo+"]",of="[^"+qo.replace("\\.","")+"]",cf=/((?:WC+[\/:])*)/.source.replace("WC",jo),lf=/(WCOD+)?/.source.replace("WCOD",of),hf=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",jo),uf=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",jo),df=new RegExp("^"+cf+lf+hf+uf+"$"),ff=["material","materials","bones","map"];class pf{constructor(e,t,n){const i=n||tt.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();const n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(e,t)}setValue(e,t){const n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,s=n.length;i!==s;++i)n[i].setValue(e,t)}bind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}}class tt{constructor(e,t,n){this.path=t,this.parsedPath=n||tt.parseTrackName(t),this.node=tt.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new tt.Composite(e,t,n):new tt(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(af,"")}static parseTrackName(e){const t=df.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);const n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){const s=n.nodeName.substring(i+1);ff.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){const n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){const n=function(s){for(let a=0;a<s.length;a++){const o=s[a];if(o.name===t||o.uuid===t)return o;const c=n(o.children);if(c)return c}return null},i=n(e.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)e[t++]=n[i]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++]}_setValue_array_setNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node;const t=this.parsedPath,n=t.objectName,i=t.propertyName;let s=t.propertyIndex;if(e||(e=tt.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===l){l=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(l!==void 0){if(e[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[l]}}const a=e[i];if(a===void 0){const l=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+i+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(s!==void 0){if(i==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}c=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=s}else a.fromArray!==void 0&&a.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(c=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}tt.Composite=pf;tt.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};tt.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};tt.prototype.GetterByBindingType=[tt.prototype._getValue_direct,tt.prototype._getValue_array,tt.prototype._getValue_arrayElement,tt.prototype._getValue_toArray];tt.prototype.SetterByBindingTypeAndVersioning=[[tt.prototype._setValue_direct,tt.prototype._setValue_direct_setNeedsUpdate,tt.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[tt.prototype._setValue_array,tt.prototype._setValue_array_setNeedsUpdate,tt.prototype._setValue_array_setMatrixWorldNeedsUpdate],[tt.prototype._setValue_arrayElement,tt.prototype._setValue_arrayElement_setNeedsUpdate,tt.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[tt.prototype._setValue_fromArray,tt.prototype._setValue_fromArray_setNeedsUpdate,tt.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];class mf{constructor(e,t,n=null,i=t.blendMode){this._mixer=e,this._clip=t,this._localRoot=n,this.blendMode=i;const s=t.tracks,a=s.length,o=new Array(a),c={endingStart:Bi,endingEnd:Bi};for(let l=0;l!==a;++l){const h=s[l].createInterpolant(null);o[l]=h,h.settings=c}this._interpolantSettings=c,this._interpolants=o,this._propertyBindings=new Array(a),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._weightInterpolant=null,this.loop=Wl,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(e){return this._startTime=e,this}setLoop(e,t){return this.loop=e,this.repetitions=t,this}setEffectiveWeight(e){return this.weight=e,this._effectiveWeight=this.enabled?e:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(e){return this._scheduleFading(e,0,1)}fadeOut(e){return this._scheduleFading(e,1,0)}crossFadeFrom(e,t,n=!1){if(e.fadeOut(t),this.fadeIn(t),n===!0){const i=this._clip.duration,s=e._clip.duration,a=s/i,o=i/s;e.warp(1,a,t),this.warp(o,1,t)}return this}crossFadeTo(e,t,n=!1){return e.crossFadeFrom(this,t,n)}stopFading(){const e=this._weightInterpolant;return e!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}setEffectiveTimeScale(e){return this.timeScale=e,this._effectiveTimeScale=this.paused?0:e,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(e){return this.timeScale=this._clip.duration/e,this.stopWarping()}syncWith(e){return this.time=e.time,this.timeScale=e.timeScale,this.stopWarping()}halt(e){return this.warp(this._effectiveTimeScale,0,e)}warp(e,t,n){const i=this._mixer,s=i.time,a=this.timeScale;let o=this._timeScaleInterpolant;o===null&&(o=i._lendControlInterpolant(),this._timeScaleInterpolant=o);const c=o.parameterPositions,l=o.sampleValues;return c[0]=s,c[1]=s+n,l[0]=e/a,l[1]=t/a,this}stopWarping(){const e=this._timeScaleInterpolant;return e!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(e,t,n,i){if(!this.enabled){this._updateWeight(e);return}const s=this._startTime;if(s!==null){const c=(e-s)*n;c<0||n===0?t=0:(this._startTime=null,t=n*c)}t*=this._updateTimeScale(e);const a=this._updateTime(t),o=this._updateWeight(e);if(o>0){const c=this._interpolants,l=this._propertyBindings;switch(this.blendMode){case ru:for(let h=0,u=c.length;h!==u;++h)c[h].evaluate(a),l[h].accumulateAdditive(o);break;case Lo:default:for(let h=0,u=c.length;h!==u;++h)c[h].evaluate(a),l[h].accumulate(i,o)}}}_updateWeight(e){let t=0;if(this.enabled){t=this.weight;const n=this._weightInterpolant;if(n!==null){const i=n.evaluate(e)[0];t*=i,e>n.parameterPositions[1]&&(this.stopFading(),i===0&&(this.enabled=!1))}}return this._effectiveWeight=t,t}_updateTimeScale(e){let t=0;if(!this.paused){t=this.timeScale;const n=this._timeScaleInterpolant;if(n!==null){const i=n.evaluate(e)[0];t*=i,e>n.parameterPositions[1]&&(this.stopWarping(),t===0?this.paused=!0:this.timeScale=t)}}return this._effectiveTimeScale=t,t}_updateTime(e){const t=this._clip.duration,n=this.loop;let i=this.time+e,s=this._loopCount;const a=n===su;if(e===0)return s===-1?i:a&&(s&1)===1?t-i:i;if(n===uo){s===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));e:{if(i>=t)i=t;else if(i<0)i=0;else{this.time=i;break e}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:e<0?-1:1})}}else{if(s===-1&&(e>=0?(s=0,this._setEndings(!0,this.repetitions===0,a)):this._setEndings(this.repetitions===0,!0,a)),i>=t||i<0){const o=Math.floor(i/t);i-=t*o,s+=Math.abs(o);const c=this.repetitions-s;if(c<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,i=e>0?t:0,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:e>0?1:-1});else{if(c===1){const l=e<0;this._setEndings(l,!l,a)}else this._setEndings(!1,!1,a);this._loopCount=s,this.time=i,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:o})}}else this.time=i;if(a&&(s&1)===1)return t-i}return i}_setEndings(e,t,n){const i=this._interpolantSettings;n?(i.endingStart=ki,i.endingEnd=ki):(e?i.endingStart=this.zeroSlopeAtStart?ki:Bi:i.endingStart=wr,t?i.endingEnd=this.zeroSlopeAtEnd?ki:Bi:i.endingEnd=wr)}_scheduleFading(e,t,n){const i=this._mixer,s=i.time;let a=this._weightInterpolant;a===null&&(a=i._lendControlInterpolant(),this._weightInterpolant=a);const o=a.parameterPositions,c=a.sampleValues;return o[0]=s,c[0]=t,o[1]=s+e,c[1]=n,this}}const gf=new Float32Array(1);class _f extends xi{constructor(e){super(),this._root=e,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1}_bindAction(e,t){const n=e._localRoot||this._root,i=e._clip.tracks,s=i.length,a=e._propertyBindings,o=e._interpolants,c=n.uuid,l=this._bindingsByRootAndName;let h=l[c];h===void 0&&(h={},l[c]=h);for(let u=0;u!==s;++u){const d=i[u],f=d.name;let g=h[f];if(g!==void 0)++g.referenceCount,a[u]=g;else{if(g=a[u],g!==void 0){g._cacheIndex===null&&(++g.referenceCount,this._addInactiveBinding(g,c,f));continue}const _=t&&t._propertyBindings[u].binding.parsedPath;g=new rf(tt.create(n,f,_),d.ValueTypeName,d.getValueSize()),++g.referenceCount,this._addInactiveBinding(g,c,f),a[u]=g}o[u].resultBuffer=g.buffer}}_activateAction(e){if(!this._isActiveAction(e)){if(e._cacheIndex===null){const n=(e._localRoot||this._root).uuid,i=e._clip.uuid,s=this._actionsByClip[i];this._bindAction(e,s&&s.knownActions[0]),this._addInactiveAction(e,i,n)}const t=e._propertyBindings;for(let n=0,i=t.length;n!==i;++n){const s=t[n];s.useCount++===0&&(this._lendBinding(s),s.saveOriginalState())}this._lendAction(e)}}_deactivateAction(e){if(this._isActiveAction(e)){const t=e._propertyBindings;for(let n=0,i=t.length;n!==i;++n){const s=t[n];--s.useCount===0&&(s.restoreOriginalState(),this._takeBackBinding(s))}this._takeBackAction(e)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;const e=this;this.stats={actions:{get total(){return e._actions.length},get inUse(){return e._nActiveActions}},bindings:{get total(){return e._bindings.length},get inUse(){return e._nActiveBindings}},controlInterpolants:{get total(){return e._controlInterpolants.length},get inUse(){return e._nActiveControlInterpolants}}}}_isActiveAction(e){const t=e._cacheIndex;return t!==null&&t<this._nActiveActions}_addInactiveAction(e,t,n){const i=this._actions,s=this._actionsByClip;let a=s[t];if(a===void 0)a={knownActions:[e],actionByRoot:{}},e._byClipCacheIndex=0,s[t]=a;else{const o=a.knownActions;e._byClipCacheIndex=o.length,o.push(e)}e._cacheIndex=i.length,i.push(e),a.actionByRoot[n]=e}_removeInactiveAction(e){const t=this._actions,n=t[t.length-1],i=e._cacheIndex;n._cacheIndex=i,t[i]=n,t.pop(),e._cacheIndex=null;const s=e._clip.uuid,a=this._actionsByClip,o=a[s],c=o.knownActions,l=c[c.length-1],h=e._byClipCacheIndex;l._byClipCacheIndex=h,c[h]=l,c.pop(),e._byClipCacheIndex=null;const u=o.actionByRoot,d=(e._localRoot||this._root).uuid;delete u[d],c.length===0&&delete a[s],this._removeInactiveBindingsForAction(e)}_removeInactiveBindingsForAction(e){const t=e._propertyBindings;for(let n=0,i=t.length;n!==i;++n){const s=t[n];--s.referenceCount===0&&this._removeInactiveBinding(s)}}_lendAction(e){const t=this._actions,n=e._cacheIndex,i=this._nActiveActions++,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_takeBackAction(e){const t=this._actions,n=e._cacheIndex,i=--this._nActiveActions,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_addInactiveBinding(e,t,n){const i=this._bindingsByRootAndName,s=this._bindings;let a=i[t];a===void 0&&(a={},i[t]=a),a[n]=e,e._cacheIndex=s.length,s.push(e)}_removeInactiveBinding(e){const t=this._bindings,n=e.binding,i=n.rootNode.uuid,s=n.path,a=this._bindingsByRootAndName,o=a[i],c=t[t.length-1],l=e._cacheIndex;c._cacheIndex=l,t[l]=c,t.pop(),delete o[s],Object.keys(o).length===0&&delete a[i]}_lendBinding(e){const t=this._bindings,n=e._cacheIndex,i=this._nActiveBindings++,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_takeBackBinding(e){const t=this._bindings,n=e._cacheIndex,i=--this._nActiveBindings,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_lendControlInterpolant(){const e=this._controlInterpolants,t=this._nActiveControlInterpolants++;let n=e[t];return n===void 0&&(n=new ch(new Float32Array(2),new Float32Array(2),1,gf),n.__cacheIndex=t,e[t]=n),n}_takeBackControlInterpolant(e){const t=this._controlInterpolants,n=e.__cacheIndex,i=--this._nActiveControlInterpolants,s=t[i];e.__cacheIndex=i,t[i]=e,s.__cacheIndex=n,t[n]=s}clipAction(e,t,n){const i=t||this._root,s=i.uuid;let a=typeof e=="string"?_o.findByName(i,e):e;const o=a!==null?a.uuid:e,c=this._actionsByClip[o];let l=null;if(n===void 0&&(a!==null?n=a.blendMode:n=Lo),c!==void 0){const u=c.actionByRoot[s];if(u!==void 0&&u.blendMode===n)return u;l=c.knownActions[0],a===null&&(a=l._clip)}if(a===null)return null;const h=new mf(this,a,t,n);return this._bindAction(h,l),this._addInactiveAction(h,o,s),h}existingAction(e,t){const n=t||this._root,i=n.uuid,s=typeof e=="string"?_o.findByName(n,e):e,a=s?s.uuid:e,o=this._actionsByClip[a];return o!==void 0&&o.actionByRoot[i]||null}stopAllAction(){const e=this._actions,t=this._nActiveActions;for(let n=t-1;n>=0;--n)e[n].stop();return this}update(e){e*=this.timeScale;const t=this._actions,n=this._nActiveActions,i=this.time+=e,s=Math.sign(e),a=this._accuIndex^=1;for(let l=0;l!==n;++l)t[l]._update(i,e,s,a);const o=this._bindings,c=this._nActiveBindings;for(let l=0;l!==c;++l)o[l].apply(a);return this}setTime(e){this.time=0;for(let t=0;t<this._actions.length;t++)this._actions[t].time=0;return this.update(e)}getRoot(){return this._root}uncacheClip(e){const t=this._actions,n=e.uuid,i=this._actionsByClip,s=i[n];if(s!==void 0){const a=s.knownActions;for(let o=0,c=a.length;o!==c;++o){const l=a[o];this._deactivateAction(l);const h=l._cacheIndex,u=t[t.length-1];l._cacheIndex=null,l._byClipCacheIndex=null,u._cacheIndex=h,t[h]=u,t.pop(),this._removeInactiveBindingsForAction(l)}delete i[n]}}uncacheRoot(e){const t=e.uuid,n=this._actionsByClip;for(const a in n){const o=n[a].actionByRoot,c=o[t];c!==void 0&&(this._deactivateAction(c),this._removeInactiveAction(c))}const i=this._bindingsByRootAndName,s=i[t];if(s!==void 0)for(const a in s){const o=s[a];o.restoreOriginalState(),this._removeInactiveBinding(o)}}uncacheAction(e,t){const n=this.existingAction(e,t);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}}const Xc=new Oe;class vf{constructor(e,t,n=0,i=1/0){this.ray=new Us(e,t),this.near=n,this.far=i,this.camera=null,this.layers=new Fo,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return Xc.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Xc),this}intersectObject(e,t=!0,n=[]){return xo(e,this,n,t),n.sort(qc),n}intersectObjects(e,t=!0,n=[]){for(let i=0,s=e.length;i<s;i++)xo(e[i],this,n,t);return n.sort(qc),n}}function qc(r,e){return r.distance-e.distance}function xo(r,e,t,n){let i=!0;if(r.layers.test(e.layers)&&r.raycast(e,t)===!1&&(i=!1),i===!0&&n===!0){const s=r.children;for(let a=0,o=s.length;a<o;a++)xo(s[a],e,t,!0)}}function jc(r,e,t,n){const i=xf(n);switch(t){case zl:return r*e;case Ro:return r*e/i.components*i.byteLength;case Co:return r*e/i.components*i.byteLength;case Vl:return r*e*2/i.components*i.byteLength;case Po:return r*e*2/i.components*i.byteLength;case Hl:return r*e*3/i.components*i.byteLength;case en:return r*e*4/i.components*i.byteLength;case Io:return r*e*4/i.components*i.byteLength;case vr:case xr:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*8;case yr:case Mr:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case za:case Va:return Math.max(r,16)*Math.max(e,8)/4;case ka:case Ha:return Math.max(r,8)*Math.max(e,8)/2;case Ga:case Wa:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*8;case Xa:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case qa:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case ja:return Math.floor((r+4)/5)*Math.floor((e+3)/4)*16;case Ya:return Math.floor((r+4)/5)*Math.floor((e+4)/5)*16;case Ka:return Math.floor((r+5)/6)*Math.floor((e+4)/5)*16;case $a:return Math.floor((r+5)/6)*Math.floor((e+5)/6)*16;case Ja:return Math.floor((r+7)/8)*Math.floor((e+4)/5)*16;case Za:return Math.floor((r+7)/8)*Math.floor((e+5)/6)*16;case Qa:return Math.floor((r+7)/8)*Math.floor((e+7)/8)*16;case eo:return Math.floor((r+9)/10)*Math.floor((e+4)/5)*16;case to:return Math.floor((r+9)/10)*Math.floor((e+5)/6)*16;case no:return Math.floor((r+9)/10)*Math.floor((e+7)/8)*16;case io:return Math.floor((r+9)/10)*Math.floor((e+9)/10)*16;case so:return Math.floor((r+11)/12)*Math.floor((e+9)/10)*16;case ro:return Math.floor((r+11)/12)*Math.floor((e+11)/12)*16;case Sr:case ao:case oo:return Math.ceil(r/4)*Math.ceil(e/4)*16;case Gl:case co:return Math.ceil(r/4)*Math.ceil(e/4)*8;case lo:case ho:return Math.ceil(r/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function xf(r){switch(r){case Sn:case Ol:return{byteLength:1,components:1};case As:case Bl:case Ns:return{byteLength:2,components:1};case wo:case Ao:return{byteLength:2,components:4};case _i:case To:case mn:return{byteLength:4,components:1};case kl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${r}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Eo}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Eo);function dh(){let r=null,e=!1,t=null,n=null;function i(s,a){t(s,a),n=r.requestAnimationFrame(i)}return{start:function(){e!==!0&&t!==null&&(n=r.requestAnimationFrame(i),e=!0)},stop:function(){r.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){r=s}}}function yf(r){const e=new WeakMap;function t(o,c){const l=o.array,h=o.usage,u=l.byteLength,d=r.createBuffer();r.bindBuffer(c,d),r.bufferData(c,l,h),o.onUploadCallback();let f;if(l instanceof Float32Array)f=r.FLOAT;else if(typeof Float16Array<"u"&&l instanceof Float16Array)f=r.HALF_FLOAT;else if(l instanceof Uint16Array)o.isFloat16BufferAttribute?f=r.HALF_FLOAT:f=r.UNSIGNED_SHORT;else if(l instanceof Int16Array)f=r.SHORT;else if(l instanceof Uint32Array)f=r.UNSIGNED_INT;else if(l instanceof Int32Array)f=r.INT;else if(l instanceof Int8Array)f=r.BYTE;else if(l instanceof Uint8Array)f=r.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)f=r.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:d,type:f,bytesPerElement:l.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,c,l){const h=c.array,u=c.updateRanges;if(r.bindBuffer(l,o),u.length===0)r.bufferSubData(l,0,h);else{u.sort((f,g)=>f.start-g.start);let d=0;for(let f=1;f<u.length;f++){const g=u[d],_=u[f];_.start<=g.start+g.count+1?g.count=Math.max(g.count,_.start+_.count-g.start):(++d,u[d]=_)}u.length=d+1;for(let f=0,g=u.length;f<g;f++){const _=u[f];r.bufferSubData(l,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}c.clearUpdateRanges()}c.onUploadCallback()}function i(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);const c=e.get(o);c&&(r.deleteBuffer(c.buffer),e.delete(o))}function a(o,c){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const l=e.get(o);if(l===void 0)e.set(o,t(o,c));else if(l.version<o.version){if(l.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,o,c),l.version=o.version}}return{get:i,remove:s,update:a}}var Mf=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Sf=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,bf=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Ef=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Tf=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,wf=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Af=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Rf=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Cf=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Pf=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,If=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Lf=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Df=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Nf=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Uf=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Ff=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Of=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Bf=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,kf=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,zf=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,Hf=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Vf=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,Gf=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Wf=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,Xf=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,qf=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,jf=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Yf=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Kf=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,$f=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Jf="gl_FragColor = linearToOutputTexel( gl_FragColor );",Zf=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Qf=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,ep=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,tp=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,np=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,ip=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,sp=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,rp=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,ap=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,op=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,cp=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,lp=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,hp=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,up=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,dp=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,fp=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,pp=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,mp=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,gp=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,_p=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,vp=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,xp=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,yp=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Mp=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Sp=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,bp=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Ep=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Tp=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,wp=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Ap=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Rp=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Cp=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Pp=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Ip=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Lp=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Dp=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,Np=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Up=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Fp=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,Op=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,Bp=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,kp=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,zp=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Hp=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Vp=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Gp=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,Wp=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Xp=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,qp=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,jp=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Yp=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,Kp=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,$p=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Jp=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Zp=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Qp=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,em=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,tm=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,nm=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,im=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,sm=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,rm=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,am=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,om=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,cm=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,lm=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,hm=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,um=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,dm=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,fm=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,pm=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,mm=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,gm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,_m=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,vm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,xm=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const ym=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Mm=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Sm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,bm=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Em=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Tm=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,wm=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Am=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,Rm=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Cm=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Pm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Im=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Lm=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Dm=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Nm=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Um=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Fm=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Om=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Bm=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,km=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,zm=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Hm=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Vm=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Gm=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Wm=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,Xm=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,qm=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,jm=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Ym=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Km=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,$m=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Jm=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Zm=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Qm=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ve={alphahash_fragment:Mf,alphahash_pars_fragment:Sf,alphamap_fragment:bf,alphamap_pars_fragment:Ef,alphatest_fragment:Tf,alphatest_pars_fragment:wf,aomap_fragment:Af,aomap_pars_fragment:Rf,batching_pars_vertex:Cf,batching_vertex:Pf,begin_vertex:If,beginnormal_vertex:Lf,bsdfs:Df,iridescence_fragment:Nf,bumpmap_pars_fragment:Uf,clipping_planes_fragment:Ff,clipping_planes_pars_fragment:Of,clipping_planes_pars_vertex:Bf,clipping_planes_vertex:kf,color_fragment:zf,color_pars_fragment:Hf,color_pars_vertex:Vf,color_vertex:Gf,common:Wf,cube_uv_reflection_fragment:Xf,defaultnormal_vertex:qf,displacementmap_pars_vertex:jf,displacementmap_vertex:Yf,emissivemap_fragment:Kf,emissivemap_pars_fragment:$f,colorspace_fragment:Jf,colorspace_pars_fragment:Zf,envmap_fragment:Qf,envmap_common_pars_fragment:ep,envmap_pars_fragment:tp,envmap_pars_vertex:np,envmap_physical_pars_fragment:fp,envmap_vertex:ip,fog_vertex:sp,fog_pars_vertex:rp,fog_fragment:ap,fog_pars_fragment:op,gradientmap_pars_fragment:cp,lightmap_pars_fragment:lp,lights_lambert_fragment:hp,lights_lambert_pars_fragment:up,lights_pars_begin:dp,lights_toon_fragment:pp,lights_toon_pars_fragment:mp,lights_phong_fragment:gp,lights_phong_pars_fragment:_p,lights_physical_fragment:vp,lights_physical_pars_fragment:xp,lights_fragment_begin:yp,lights_fragment_maps:Mp,lights_fragment_end:Sp,logdepthbuf_fragment:bp,logdepthbuf_pars_fragment:Ep,logdepthbuf_pars_vertex:Tp,logdepthbuf_vertex:wp,map_fragment:Ap,map_pars_fragment:Rp,map_particle_fragment:Cp,map_particle_pars_fragment:Pp,metalnessmap_fragment:Ip,metalnessmap_pars_fragment:Lp,morphinstance_vertex:Dp,morphcolor_vertex:Np,morphnormal_vertex:Up,morphtarget_pars_vertex:Fp,morphtarget_vertex:Op,normal_fragment_begin:Bp,normal_fragment_maps:kp,normal_pars_fragment:zp,normal_pars_vertex:Hp,normal_vertex:Vp,normalmap_pars_fragment:Gp,clearcoat_normal_fragment_begin:Wp,clearcoat_normal_fragment_maps:Xp,clearcoat_pars_fragment:qp,iridescence_pars_fragment:jp,opaque_fragment:Yp,packing:Kp,premultiplied_alpha_fragment:$p,project_vertex:Jp,dithering_fragment:Zp,dithering_pars_fragment:Qp,roughnessmap_fragment:em,roughnessmap_pars_fragment:tm,shadowmap_pars_fragment:nm,shadowmap_pars_vertex:im,shadowmap_vertex:sm,shadowmask_pars_fragment:rm,skinbase_vertex:am,skinning_pars_vertex:om,skinning_vertex:cm,skinnormal_vertex:lm,specularmap_fragment:hm,specularmap_pars_fragment:um,tonemapping_fragment:dm,tonemapping_pars_fragment:fm,transmission_fragment:pm,transmission_pars_fragment:mm,uv_pars_fragment:gm,uv_pars_vertex:_m,uv_vertex:vm,worldpos_vertex:xm,background_vert:ym,background_frag:Mm,backgroundCube_vert:Sm,backgroundCube_frag:bm,cube_vert:Em,cube_frag:Tm,depth_vert:wm,depth_frag:Am,distanceRGBA_vert:Rm,distanceRGBA_frag:Cm,equirect_vert:Pm,equirect_frag:Im,linedashed_vert:Lm,linedashed_frag:Dm,meshbasic_vert:Nm,meshbasic_frag:Um,meshlambert_vert:Fm,meshlambert_frag:Om,meshmatcap_vert:Bm,meshmatcap_frag:km,meshnormal_vert:zm,meshnormal_frag:Hm,meshphong_vert:Vm,meshphong_frag:Gm,meshphysical_vert:Wm,meshphysical_frag:Xm,meshtoon_vert:qm,meshtoon_frag:jm,points_vert:Ym,points_frag:Km,shadow_vert:$m,shadow_frag:Jm,sprite_vert:Zm,sprite_frag:Qm},re={common:{diffuse:{value:new Pe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new ze},alphaMap:{value:null},alphaMapTransform:{value:new ze},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new ze}},envmap:{envMap:{value:null},envMapRotation:{value:new ze},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new ze}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new ze}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new ze},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new ze},normalScale:{value:new me(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new ze},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new ze}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new ze}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new ze}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Pe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Pe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new ze},alphaTest:{value:0},uvTransform:{value:new ze}},sprite:{diffuse:{value:new Pe(16777215)},opacity:{value:1},center:{value:new me(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new ze},alphaMap:{value:null},alphaMapTransform:{value:new ze},alphaTest:{value:0}}},yn={basic:{uniforms:kt([re.common,re.specularmap,re.envmap,re.aomap,re.lightmap,re.fog]),vertexShader:Ve.meshbasic_vert,fragmentShader:Ve.meshbasic_frag},lambert:{uniforms:kt([re.common,re.specularmap,re.envmap,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.fog,re.lights,{emissive:{value:new Pe(0)}}]),vertexShader:Ve.meshlambert_vert,fragmentShader:Ve.meshlambert_frag},phong:{uniforms:kt([re.common,re.specularmap,re.envmap,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.fog,re.lights,{emissive:{value:new Pe(0)},specular:{value:new Pe(1118481)},shininess:{value:30}}]),vertexShader:Ve.meshphong_vert,fragmentShader:Ve.meshphong_frag},standard:{uniforms:kt([re.common,re.envmap,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.roughnessmap,re.metalnessmap,re.fog,re.lights,{emissive:{value:new Pe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ve.meshphysical_vert,fragmentShader:Ve.meshphysical_frag},toon:{uniforms:kt([re.common,re.aomap,re.lightmap,re.emissivemap,re.bumpmap,re.normalmap,re.displacementmap,re.gradientmap,re.fog,re.lights,{emissive:{value:new Pe(0)}}]),vertexShader:Ve.meshtoon_vert,fragmentShader:Ve.meshtoon_frag},matcap:{uniforms:kt([re.common,re.bumpmap,re.normalmap,re.displacementmap,re.fog,{matcap:{value:null}}]),vertexShader:Ve.meshmatcap_vert,fragmentShader:Ve.meshmatcap_frag},points:{uniforms:kt([re.points,re.fog]),vertexShader:Ve.points_vert,fragmentShader:Ve.points_frag},dashed:{uniforms:kt([re.common,re.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ve.linedashed_vert,fragmentShader:Ve.linedashed_frag},depth:{uniforms:kt([re.common,re.displacementmap]),vertexShader:Ve.depth_vert,fragmentShader:Ve.depth_frag},normal:{uniforms:kt([re.common,re.bumpmap,re.normalmap,re.displacementmap,{opacity:{value:1}}]),vertexShader:Ve.meshnormal_vert,fragmentShader:Ve.meshnormal_frag},sprite:{uniforms:kt([re.sprite,re.fog]),vertexShader:Ve.sprite_vert,fragmentShader:Ve.sprite_frag},background:{uniforms:{uvTransform:{value:new ze},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ve.background_vert,fragmentShader:Ve.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new ze}},vertexShader:Ve.backgroundCube_vert,fragmentShader:Ve.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ve.cube_vert,fragmentShader:Ve.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ve.equirect_vert,fragmentShader:Ve.equirect_frag},distanceRGBA:{uniforms:kt([re.common,re.displacementmap,{referencePosition:{value:new T},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ve.distanceRGBA_vert,fragmentShader:Ve.distanceRGBA_frag},shadow:{uniforms:kt([re.lights,re.fog,{color:{value:new Pe(0)},opacity:{value:1}}]),vertexShader:Ve.shadow_vert,fragmentShader:Ve.shadow_frag}};yn.physical={uniforms:kt([yn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new ze},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new ze},clearcoatNormalScale:{value:new me(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new ze},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new ze},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new ze},sheen:{value:0},sheenColor:{value:new Pe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new ze},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new ze},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new ze},transmissionSamplerSize:{value:new me},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new ze},attenuationDistance:{value:0},attenuationColor:{value:new Pe(0)},specularColor:{value:new Pe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new ze},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new ze},anisotropyVector:{value:new me},anisotropyMap:{value:null},anisotropyMapTransform:{value:new ze}}]),vertexShader:Ve.meshphysical_vert,fragmentShader:Ve.meshphysical_frag};const ur={r:0,b:0,g:0},ci=new Tt,eg=new Oe;function tg(r,e,t,n,i,s,a){const o=new Pe(0);let c=s===!0?0:1,l,h,u=null,d=0,f=null;function g(b){let v=b.isScene===!0?b.background:null;return v&&v.isTexture&&(v=(b.backgroundBlurriness>0?t:e).get(v)),v}function _(b){let v=!1;const P=g(b);P===null?p(o,c):P&&P.isColor&&(p(P,1),v=!0);const R=r.xr.getEnvironmentBlendMode();R==="additive"?n.buffers.color.setClear(0,0,0,1,a):R==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,a),(r.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),r.clear(r.autoClearColor,r.autoClearDepth,r.autoClearStencil))}function m(b,v){const P=g(v);P&&(P.isCubeTexture||P.mapping===Lr)?(h===void 0&&(h=new Wt(new bt(1,1,1),new ti({name:"BackgroundCubeMaterial",uniforms:Ji(yn.backgroundCube.uniforms),vertexShader:yn.backgroundCube.vertexShader,fragmentShader:yn.backgroundCube.fragmentShader,side:Xt,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(R,A,C){this.matrixWorld.copyPosition(C.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),ci.copy(v.backgroundRotation),ci.x*=-1,ci.y*=-1,ci.z*=-1,P.isCubeTexture&&P.isRenderTargetTexture===!1&&(ci.y*=-1,ci.z*=-1),h.material.uniforms.envMap.value=P,h.material.uniforms.flipEnvMap.value=P.isCubeTexture&&P.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(eg.makeRotationFromEuler(ci)),h.material.toneMapped=Ye.getTransfer(P.colorSpace)!==at,(u!==P||d!==P.version||f!==r.toneMapping)&&(h.material.needsUpdate=!0,u=P,d=P.version,f=r.toneMapping),h.layers.enableAll(),b.unshift(h,h.geometry,h.material,0,0,null)):P&&P.isTexture&&(l===void 0&&(l=new Wt(new gi(2,2),new ti({name:"BackgroundMaterial",uniforms:Ji(yn.background.uniforms),vertexShader:yn.background.vertexShader,fragmentShader:yn.background.fragmentShader,side:Mn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=P,l.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,l.material.toneMapped=Ye.getTransfer(P.colorSpace)!==at,P.matrixAutoUpdate===!0&&P.updateMatrix(),l.material.uniforms.uvTransform.value.copy(P.matrix),(u!==P||d!==P.version||f!==r.toneMapping)&&(l.material.needsUpdate=!0,u=P,d=P.version,f=r.toneMapping),l.layers.enableAll(),b.unshift(l,l.geometry,l.material,0,0,null))}function p(b,v){b.getRGB(ur,Zl(r)),n.buffers.color.setClear(ur.r,ur.g,ur.b,v,a)}function M(){h!==void 0&&(h.geometry.dispose(),h.material.dispose(),h=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(b,v=1){o.set(b),c=v,p(o,c)},getClearAlpha:function(){return c},setClearAlpha:function(b){c=b,p(o,c)},render:_,addToRenderList:m,dispose:M}}function ng(r,e){const t=r.getParameter(r.MAX_VERTEX_ATTRIBS),n={},i=d(null);let s=i,a=!1;function o(x,I,k,O,X){let Y=!1;const W=u(O,k,I);s!==W&&(s=W,l(s.object)),Y=f(x,O,k,X),Y&&g(x,O,k,X),X!==null&&e.update(X,r.ELEMENT_ARRAY_BUFFER),(Y||a)&&(a=!1,v(x,I,k,O),X!==null&&r.bindBuffer(r.ELEMENT_ARRAY_BUFFER,e.get(X).buffer))}function c(){return r.createVertexArray()}function l(x){return r.bindVertexArray(x)}function h(x){return r.deleteVertexArray(x)}function u(x,I,k){const O=k.wireframe===!0;let X=n[x.id];X===void 0&&(X={},n[x.id]=X);let Y=X[I.id];Y===void 0&&(Y={},X[I.id]=Y);let W=Y[O];return W===void 0&&(W=d(c()),Y[O]=W),W}function d(x){const I=[],k=[],O=[];for(let X=0;X<t;X++)I[X]=0,k[X]=0,O[X]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:k,attributeDivisors:O,object:x,attributes:{},index:null}}function f(x,I,k,O){const X=s.attributes,Y=I.attributes;let W=0;const J=k.getAttributes();for(const H in J)if(J[H].location>=0){const he=X[H];let ve=Y[H];if(ve===void 0&&(H==="instanceMatrix"&&x.instanceMatrix&&(ve=x.instanceMatrix),H==="instanceColor"&&x.instanceColor&&(ve=x.instanceColor)),he===void 0||he.attribute!==ve||ve&&he.data!==ve.data)return!0;W++}return s.attributesNum!==W||s.index!==O}function g(x,I,k,O){const X={},Y=I.attributes;let W=0;const J=k.getAttributes();for(const H in J)if(J[H].location>=0){let he=Y[H];he===void 0&&(H==="instanceMatrix"&&x.instanceMatrix&&(he=x.instanceMatrix),H==="instanceColor"&&x.instanceColor&&(he=x.instanceColor));const ve={};ve.attribute=he,he&&he.data&&(ve.data=he.data),X[H]=ve,W++}s.attributes=X,s.attributesNum=W,s.index=O}function _(){const x=s.newAttributes;for(let I=0,k=x.length;I<k;I++)x[I]=0}function m(x){p(x,0)}function p(x,I){const k=s.newAttributes,O=s.enabledAttributes,X=s.attributeDivisors;k[x]=1,O[x]===0&&(r.enableVertexAttribArray(x),O[x]=1),X[x]!==I&&(r.vertexAttribDivisor(x,I),X[x]=I)}function M(){const x=s.newAttributes,I=s.enabledAttributes;for(let k=0,O=I.length;k<O;k++)I[k]!==x[k]&&(r.disableVertexAttribArray(k),I[k]=0)}function b(x,I,k,O,X,Y,W){W===!0?r.vertexAttribIPointer(x,I,k,X,Y):r.vertexAttribPointer(x,I,k,O,X,Y)}function v(x,I,k,O){_();const X=O.attributes,Y=k.getAttributes(),W=I.defaultAttributeValues;for(const J in Y){const H=Y[J];if(H.location>=0){let ne=X[J];if(ne===void 0&&(J==="instanceMatrix"&&x.instanceMatrix&&(ne=x.instanceMatrix),J==="instanceColor"&&x.instanceColor&&(ne=x.instanceColor)),ne!==void 0){const he=ne.normalized,ve=ne.itemSize,Be=e.get(ne);if(Be===void 0)continue;const ot=Be.buffer,j=Be.type,ie=Be.bytesPerElement,be=j===r.INT||j===r.UNSIGNED_INT||ne.gpuType===To;if(ne.isInterleavedBufferAttribute){const ue=ne.data,Ee=ue.stride,Je=ne.offset;if(ue.isInstancedInterleavedBuffer){for(let Le=0;Le<H.locationSize;Le++)p(H.location+Le,ue.meshPerAttribute);x.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=ue.meshPerAttribute*ue.count)}else for(let Le=0;Le<H.locationSize;Le++)m(H.location+Le);r.bindBuffer(r.ARRAY_BUFFER,ot);for(let Le=0;Le<H.locationSize;Le++)b(H.location+Le,ve/H.locationSize,j,he,Ee*ie,(Je+ve/H.locationSize*Le)*ie,be)}else{if(ne.isInstancedBufferAttribute){for(let ue=0;ue<H.locationSize;ue++)p(H.location+ue,ne.meshPerAttribute);x.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=ne.meshPerAttribute*ne.count)}else for(let ue=0;ue<H.locationSize;ue++)m(H.location+ue);r.bindBuffer(r.ARRAY_BUFFER,ot);for(let ue=0;ue<H.locationSize;ue++)b(H.location+ue,ve/H.locationSize,j,he,ve*ie,ve/H.locationSize*ue*ie,be)}}else if(W!==void 0){const he=W[J];if(he!==void 0)switch(he.length){case 2:r.vertexAttrib2fv(H.location,he);break;case 3:r.vertexAttrib3fv(H.location,he);break;case 4:r.vertexAttrib4fv(H.location,he);break;default:r.vertexAttrib1fv(H.location,he)}}}}M()}function P(){C();for(const x in n){const I=n[x];for(const k in I){const O=I[k];for(const X in O)h(O[X].object),delete O[X];delete I[k]}delete n[x]}}function R(x){if(n[x.id]===void 0)return;const I=n[x.id];for(const k in I){const O=I[k];for(const X in O)h(O[X].object),delete O[X];delete I[k]}delete n[x.id]}function A(x){for(const I in n){const k=n[I];if(k[x.id]===void 0)continue;const O=k[x.id];for(const X in O)h(O[X].object),delete O[X];delete k[x.id]}}function C(){S(),a=!0,s!==i&&(s=i,l(s.object))}function S(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:o,reset:C,resetDefaultState:S,dispose:P,releaseStatesOfGeometry:R,releaseStatesOfProgram:A,initAttributes:_,enableAttribute:m,disableUnusedAttributes:M}}function ig(r,e,t){let n;function i(l){n=l}function s(l,h){r.drawArrays(n,l,h),t.update(h,n,1)}function a(l,h,u){u!==0&&(r.drawArraysInstanced(n,l,h,u),t.update(h,n,u))}function o(l,h,u){if(u===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,h,0,u);let f=0;for(let g=0;g<u;g++)f+=h[g];t.update(f,n,1)}function c(l,h,u,d){if(u===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let g=0;g<l.length;g++)a(l[g],h[g],d[g]);else{f.multiDrawArraysInstancedWEBGL(n,l,0,h,0,d,0,u);let g=0;for(let _=0;_<u;_++)g+=h[_]*d[_];t.update(g,n,1)}}this.setMode=i,this.render=s,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=c}function sg(r,e,t,n){let i;function s(){if(i!==void 0)return i;if(e.has("EXT_texture_filter_anisotropic")===!0){const A=e.get("EXT_texture_filter_anisotropic");i=r.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function a(A){return!(A!==en&&n.convert(A)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(A){const C=A===Ns&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(A!==Sn&&n.convert(A)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==mn&&!C)}function c(A){if(A==="highp"){if(r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.HIGH_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.MEDIUM_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=t.precision!==void 0?t.precision:"highp";const h=c(l);h!==l&&(console.warn("THREE.WebGLRenderer:",l,"not supported, using",h,"instead."),l=h);const u=t.logarithmicDepthBuffer===!0,d=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control"),f=r.getParameter(r.MAX_TEXTURE_IMAGE_UNITS),g=r.getParameter(r.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=r.getParameter(r.MAX_TEXTURE_SIZE),m=r.getParameter(r.MAX_CUBE_MAP_TEXTURE_SIZE),p=r.getParameter(r.MAX_VERTEX_ATTRIBS),M=r.getParameter(r.MAX_VERTEX_UNIFORM_VECTORS),b=r.getParameter(r.MAX_VARYING_VECTORS),v=r.getParameter(r.MAX_FRAGMENT_UNIFORM_VECTORS),P=g>0,R=r.getParameter(r.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:c,textureFormatReadable:a,textureTypeReadable:o,precision:l,logarithmicDepthBuffer:u,reverseDepthBuffer:d,maxTextures:f,maxVertexTextures:g,maxTextureSize:_,maxCubemapSize:m,maxAttributes:p,maxVertexUniforms:M,maxVaryings:b,maxFragmentUniforms:v,vertexTextures:P,maxSamples:R}}function rg(r){const e=this;let t=null,n=0,i=!1,s=!1;const a=new ui,o=new ze,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){const f=u.length!==0||d||n!==0||i;return i=d,n=u.length,f},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){const g=u.clippingPlanes,_=u.clipIntersection,m=u.clipShadows,p=r.get(u);if(!i||g===null||g.length===0||s&&!m)s?h(null):l();else{const M=s?0:n,b=M*4;let v=p.clippingState||null;c.value=v,v=h(g,d,b,f);for(let P=0;P!==b;++P)v[P]=t[P];p.clippingState=v,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=M}};function l(){c.value!==t&&(c.value=t,c.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,g){const _=u!==null?u.length:0;let m=null;if(_!==0){if(m=c.value,g!==!0||m===null){const p=f+_*4,M=d.matrixWorldInverse;o.getNormalMatrix(M),(m===null||m.length<p)&&(m=new Float32Array(p));for(let b=0,v=f;b!==_;++b,v+=4)a.copy(u[b]).applyMatrix4(M,o),a.normal.toArray(m,v),m[v+3]=a.constant}c.value=m,c.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,m}}function ag(r){let e=new WeakMap;function t(a,o){return o===Oa?a.mapping=Yi:o===Ba&&(a.mapping=Ki),a}function n(a){if(a&&a.isTexture){const o=a.mapping;if(o===Oa||o===Ba)if(e.has(a)){const c=e.get(a).texture;return t(c,a.mapping)}else{const c=a.image;if(c&&c.height>0){const l=new rd(c.height);return l.fromEquirectangularTexture(r,a),e.set(a,l),a.addEventListener("dispose",i),t(l.texture,a.mapping)}else return null}}return a}function i(a){const o=a.target;o.removeEventListener("dispose",i);const c=e.get(o);c!==void 0&&(e.delete(o),c.dispose())}function s(){e=new WeakMap}return{get:n,dispose:s}}const Hi=4,Yc=[.125,.215,.35,.446,.526,.582],mi=20,ga=new Nr,Kc=new Pe;let _a=null,va=0,xa=0,ya=!1;const di=(1+Math.sqrt(5))/2,Fi=1/di,$c=[new T(-di,Fi,0),new T(di,Fi,0),new T(-Fi,0,di),new T(Fi,0,di),new T(0,di,-Fi),new T(0,di,Fi),new T(-1,1,-1),new T(1,1,-1),new T(-1,1,1),new T(1,1,1)],og=new T;class Jc{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,i=100,s={}){const{size:a=256,position:o=og}=s;_a=this._renderer.getRenderTarget(),va=this._renderer.getActiveCubeFace(),xa=this._renderer.getActiveMipmapLevel(),ya=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);const c=this._allocateTargets();return c.depthBuffer=!0,this._sceneToCubeUV(e,n,i,c,o),t>0&&this._blur(c,0,0,t),this._applyPMREM(c),this._cleanup(c),c}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=el(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Qc(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(_a,va,xa),this._renderer.xr.enabled=ya,e.scissorTest=!1,dr(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Yi||e.mapping===Ki?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),_a=this._renderer.getRenderTarget(),va=this._renderer.getActiveCubeFace(),xa=this._renderer.getActiveMipmapLevel(),ya=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Qt,minFilter:Qt,generateMipmaps:!1,type:Ns,format:en,colorSpace:zt,depthBuffer:!1},i=Zc(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Zc(e,t,n);const{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=cg(s)),this._blurMaterial=lg(s,e,t)}return i}_compileMaterial(e){const t=new Wt(this._lodPlanes[0],e);this._renderer.compile(t,ga)}_sceneToCubeUV(e,t,n,i,s){const c=new Gt(90,1,t,n),l=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],u=this._renderer,d=u.autoClear,f=u.toneMapping;u.getClearColor(Kc),u.toneMapping=Qn,u.autoClear=!1;const g=new ke({name:"PMREM.Background",side:Xt,depthWrite:!1,depthTest:!1}),_=new Wt(new bt,g);let m=!1;const p=e.background;p?p.isColor&&(g.color.copy(p),e.background=null,m=!0):(g.color.copy(Kc),m=!0);for(let M=0;M<6;M++){const b=M%3;b===0?(c.up.set(0,l[M],0),c.position.set(s.x,s.y,s.z),c.lookAt(s.x+h[M],s.y,s.z)):b===1?(c.up.set(0,0,l[M]),c.position.set(s.x,s.y,s.z),c.lookAt(s.x,s.y+h[M],s.z)):(c.up.set(0,l[M],0),c.position.set(s.x,s.y,s.z),c.lookAt(s.x,s.y,s.z+h[M]));const v=this._cubeSize;dr(i,b*v,M>2?v:0,v,v),u.setRenderTarget(i),m&&u.render(_,c),u.render(e,c)}_.geometry.dispose(),_.material.dispose(),u.toneMapping=f,u.autoClear=d,e.background=p}_textureToCubeUV(e,t){const n=this._renderer,i=e.mapping===Yi||e.mapping===Ki;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=el()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Qc());const s=i?this._cubemapMaterial:this._equirectMaterial,a=new Wt(this._lodPlanes[0],s),o=s.uniforms;o.envMap.value=e;const c=this._cubeSize;dr(t,0,0,3*c,2*c),n.setRenderTarget(t),n.render(a,ga)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const i=this._lodPlanes.length;for(let s=1;s<i;s++){const a=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),o=$c[(i-s-1)%$c.length];this._blur(e,s-1,s,a,o)}t.autoClear=n}_blur(e,t,n,i,s){const a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,i,"latitudinal",s),this._halfBlur(a,e,n,n,i,"longitudinal",s)}_halfBlur(e,t,n,i,s,a,o){const c=this._renderer,l=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,u=new Wt(this._lodPlanes[i],l),d=l.uniforms,f=this._sizeLods[n]-1,g=isFinite(s)?Math.PI/(2*f):2*Math.PI/(2*mi-1),_=s/g,m=isFinite(s)?1+Math.floor(h*_):mi;m>mi&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${mi}`);const p=[];let M=0;for(let A=0;A<mi;++A){const C=A/_,S=Math.exp(-C*C/2);p.push(S),A===0?M+=S:A<m&&(M+=2*S)}for(let A=0;A<p.length;A++)p[A]=p[A]/M;d.envMap.value=e.texture,d.samples.value=m,d.weights.value=p,d.latitudinal.value=a==="latitudinal",o&&(d.poleAxis.value=o);const{_lodMax:b}=this;d.dTheta.value=g,d.mipInt.value=b-n;const v=this._sizeLods[i],P=3*v*(i>b-Hi?i-b+Hi:0),R=4*(this._cubeSize-v);dr(t,P,R,3*v,2*v),c.setRenderTarget(t),c.render(u,ga)}}function cg(r){const e=[],t=[],n=[];let i=r;const s=r-Hi+1+Yc.length;for(let a=0;a<s;a++){const o=Math.pow(2,i);t.push(o);let c=1/o;a>r-Hi?c=Yc[a-r+Hi-1]:a===0&&(c=0),n.push(c);const l=1/(o-2),h=-l,u=1+l,d=[h,h,u,h,u,u,h,h,u,u,h,u],f=6,g=6,_=3,m=2,p=1,M=new Float32Array(_*g*f),b=new Float32Array(m*g*f),v=new Float32Array(p*g*f);for(let R=0;R<f;R++){const A=R%3*2/3-1,C=R>2?0:-1,S=[A,C,0,A+2/3,C,0,A+2/3,C+1,0,A,C,0,A+2/3,C+1,0,A,C+1,0];M.set(S,_*g*R),b.set(d,m*g*R);const x=[R,R,R,R,R,R];v.set(x,p*g*R)}const P=new yt;P.setAttribute("position",new It(M,_)),P.setAttribute("uv",new It(b,m)),P.setAttribute("faceIndex",new It(v,p)),e.push(P),i>Hi&&i--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Zc(r,e,t){const n=new vi(r,e,t);return n.texture.mapping=Lr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function dr(r,e,t,n,i){r.viewport.set(e,t,n,i),r.scissor.set(e,t,n,i)}function lg(r,e,t){const n=new Float32Array(mi),i=new T(0,1,0);return new ti({name:"SphericalGaussianBlur",defines:{n:mi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:Yo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Qc(){return new ti({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Yo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function el(){return new ti({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Yo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Zn,depthTest:!1,depthWrite:!1})}function Yo(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function hg(r){let e=new WeakMap,t=null;function n(o){if(o&&o.isTexture){const c=o.mapping,l=c===Oa||c===Ba,h=c===Yi||c===Ki;if(l||h){let u=e.get(o);const d=u!==void 0?u.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==d)return t===null&&(t=new Jc(r)),u=l?t.fromEquirectangular(o,u):t.fromCubemap(o,u),u.texture.pmremVersion=o.pmremVersion,e.set(o,u),u.texture;if(u!==void 0)return u.texture;{const f=o.image;return l&&f&&f.height>0||h&&f&&i(f)?(t===null&&(t=new Jc(r)),u=l?t.fromEquirectangular(o):t.fromCubemap(o),u.texture.pmremVersion=o.pmremVersion,e.set(o,u),o.addEventListener("dispose",s),u.texture):null}}}return o}function i(o){let c=0;const l=6;for(let h=0;h<l;h++)o[h]!==void 0&&c++;return c===l}function s(o){const c=o.target;c.removeEventListener("dispose",s);const l=e.get(c);l!==void 0&&(e.delete(c),l.dispose())}function a(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:a}}function ug(r){const e={};function t(n){if(e[n]!==void 0)return e[n];let i;switch(n){case"WEBGL_depth_texture":i=r.getExtension("WEBGL_depth_texture")||r.getExtension("MOZ_WEBGL_depth_texture")||r.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=r.getExtension("EXT_texture_filter_anisotropic")||r.getExtension("MOZ_EXT_texture_filter_anisotropic")||r.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=r.getExtension("WEBGL_compressed_texture_s3tc")||r.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=r.getExtension("WEBGL_compressed_texture_pvrtc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=r.getExtension(n)}return e[n]=i,i}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const i=t(n);return i===null&&Gi("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function dg(r,e,t,n){const i={},s=new WeakMap;function a(u){const d=u.target;d.index!==null&&e.remove(d.index);for(const g in d.attributes)e.remove(d.attributes[g]);d.removeEventListener("dispose",a),delete i[d.id];const f=s.get(d);f&&(e.remove(f),s.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function o(u,d){return i[d.id]===!0||(d.addEventListener("dispose",a),i[d.id]=!0,t.memory.geometries++),d}function c(u){const d=u.attributes;for(const f in d)e.update(d[f],r.ARRAY_BUFFER)}function l(u){const d=[],f=u.index,g=u.attributes.position;let _=0;if(f!==null){const M=f.array;_=f.version;for(let b=0,v=M.length;b<v;b+=3){const P=M[b+0],R=M[b+1],A=M[b+2];d.push(P,R,R,A,A,P)}}else if(g!==void 0){const M=g.array;_=g.version;for(let b=0,v=M.length/3-1;b<v;b+=3){const P=b+0,R=b+1,A=b+2;d.push(P,R,R,A,A,P)}}else return;const m=new(jl(d)?Jl:$l)(d,1);m.version=_;const p=s.get(u);p&&e.remove(p),s.set(u,m)}function h(u){const d=s.get(u);if(d){const f=u.index;f!==null&&d.version<f.version&&l(u)}else l(u);return s.get(u)}return{get:o,update:c,getWireframeAttribute:h}}function fg(r,e,t){let n;function i(d){n=d}let s,a;function o(d){s=d.type,a=d.bytesPerElement}function c(d,f){r.drawElements(n,f,s,d*a),t.update(f,n,1)}function l(d,f,g){g!==0&&(r.drawElementsInstanced(n,f,s,d*a,g),t.update(f,n,g))}function h(d,f,g){if(g===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,f,0,s,d,0,g);let m=0;for(let p=0;p<g;p++)m+=f[p];t.update(m,n,1)}function u(d,f,g,_){if(g===0)return;const m=e.get("WEBGL_multi_draw");if(m===null)for(let p=0;p<d.length;p++)l(d[p]/a,f[p],_[p]);else{m.multiDrawElementsInstancedWEBGL(n,f,0,s,d,0,_,0,g);let p=0;for(let M=0;M<g;M++)p+=f[M]*_[M];t.update(p,n,1)}}this.setMode=i,this.setIndex=o,this.render=c,this.renderInstances=l,this.renderMultiDraw=h,this.renderMultiDrawInstances=u}function pg(r){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,a,o){switch(t.calls++,a){case r.TRIANGLES:t.triangles+=o*(s/3);break;case r.LINES:t.lines+=o*(s/2);break;case r.LINE_STRIP:t.lines+=o*(s-1);break;case r.LINE_LOOP:t.lines+=o*s;break;case r.POINTS:t.points+=o*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function i(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:i,update:n}}function mg(r,e,t){const n=new WeakMap,i=new et;function s(a,o,c){const l=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0;let d=n.get(o);if(d===void 0||d.count!==u){let x=function(){C.dispose(),n.delete(o),o.removeEventListener("dispose",x)};var f=x;d!==void 0&&d.texture.dispose();const g=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,m=o.morphAttributes.color!==void 0,p=o.morphAttributes.position||[],M=o.morphAttributes.normal||[],b=o.morphAttributes.color||[];let v=0;g===!0&&(v=1),_===!0&&(v=2),m===!0&&(v=3);let P=o.attributes.position.count*v,R=1;P>e.maxTextureSize&&(R=Math.ceil(P/e.maxTextureSize),P=e.maxTextureSize);const A=new Float32Array(P*R*4*u),C=new Yl(A,P,R,u);C.type=mn,C.needsUpdate=!0;const S=v*4;for(let I=0;I<u;I++){const k=p[I],O=M[I],X=b[I],Y=P*R*4*I;for(let W=0;W<k.count;W++){const J=W*S;g===!0&&(i.fromBufferAttribute(k,W),A[Y+J+0]=i.x,A[Y+J+1]=i.y,A[Y+J+2]=i.z,A[Y+J+3]=0),_===!0&&(i.fromBufferAttribute(O,W),A[Y+J+4]=i.x,A[Y+J+5]=i.y,A[Y+J+6]=i.z,A[Y+J+7]=0),m===!0&&(i.fromBufferAttribute(X,W),A[Y+J+8]=i.x,A[Y+J+9]=i.y,A[Y+J+10]=i.z,A[Y+J+11]=X.itemSize===4?i.w:1)}}d={count:u,texture:C,size:new me(P,R)},n.set(o,d),o.addEventListener("dispose",x)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)c.getUniforms().setValue(r,"morphTexture",a.morphTexture,t);else{let g=0;for(let m=0;m<l.length;m++)g+=l[m];const _=o.morphTargetsRelative?1:1-g;c.getUniforms().setValue(r,"morphTargetBaseInfluence",_),c.getUniforms().setValue(r,"morphTargetInfluences",l)}c.getUniforms().setValue(r,"morphTargetsTexture",d.texture,t),c.getUniforms().setValue(r,"morphTargetsTextureSize",d.size)}return{update:s}}function gg(r,e,t,n){let i=new WeakMap;function s(c){const l=n.render.frame,h=c.geometry,u=e.get(c,h);if(i.get(u)!==l&&(e.update(u),i.set(u,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",o)===!1&&c.addEventListener("dispose",o),i.get(c)!==l&&(t.update(c.instanceMatrix,r.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,r.ARRAY_BUFFER),i.set(c,l))),c.isSkinnedMesh){const d=c.skeleton;i.get(d)!==l&&(d.update(),i.set(d,l))}return u}function a(){i=new WeakMap}function o(c){const l=c.target;l.removeEventListener("dispose",o),t.remove(l.instanceMatrix),l.instanceColor!==null&&t.remove(l.instanceColor)}return{update:s,dispose:a}}const fh=new At,tl=new ih(1,1),ph=new Yl,mh=new Vu,gh=new eh,nl=[],il=[],sl=new Float32Array(16),rl=new Float32Array(9),al=new Float32Array(4);function rs(r,e,t){const n=r[0];if(n<=0||n>0)return r;const i=e*t;let s=nl[i];if(s===void 0&&(s=new Float32Array(i),nl[i]=s),e!==0){n.toArray(s,0);for(let a=1,o=0;a!==e;++a)o+=t,r[a].toArray(s,o)}return s}function Rt(r,e){if(r.length!==e.length)return!1;for(let t=0,n=r.length;t<n;t++)if(r[t]!==e[t])return!1;return!0}function Ct(r,e){for(let t=0,n=e.length;t<n;t++)r[t]=e[t]}function Ur(r,e){let t=il[e];t===void 0&&(t=new Int32Array(e),il[e]=t);for(let n=0;n!==e;++n)t[n]=r.allocateTextureUnit();return t}function _g(r,e){const t=this.cache;t[0]!==e&&(r.uniform1f(this.addr,e),t[0]=e)}function vg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Rt(t,e))return;r.uniform2fv(this.addr,e),Ct(t,e)}}function xg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(r.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(Rt(t,e))return;r.uniform3fv(this.addr,e),Ct(t,e)}}function yg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Rt(t,e))return;r.uniform4fv(this.addr,e),Ct(t,e)}}function Mg(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(Rt(t,e))return;r.uniformMatrix2fv(this.addr,!1,e),Ct(t,e)}else{if(Rt(t,n))return;al.set(n),r.uniformMatrix2fv(this.addr,!1,al),Ct(t,n)}}function Sg(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(Rt(t,e))return;r.uniformMatrix3fv(this.addr,!1,e),Ct(t,e)}else{if(Rt(t,n))return;rl.set(n),r.uniformMatrix3fv(this.addr,!1,rl),Ct(t,n)}}function bg(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(Rt(t,e))return;r.uniformMatrix4fv(this.addr,!1,e),Ct(t,e)}else{if(Rt(t,n))return;sl.set(n),r.uniformMatrix4fv(this.addr,!1,sl),Ct(t,n)}}function Eg(r,e){const t=this.cache;t[0]!==e&&(r.uniform1i(this.addr,e),t[0]=e)}function Tg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Rt(t,e))return;r.uniform2iv(this.addr,e),Ct(t,e)}}function wg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Rt(t,e))return;r.uniform3iv(this.addr,e),Ct(t,e)}}function Ag(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Rt(t,e))return;r.uniform4iv(this.addr,e),Ct(t,e)}}function Rg(r,e){const t=this.cache;t[0]!==e&&(r.uniform1ui(this.addr,e),t[0]=e)}function Cg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(Rt(t,e))return;r.uniform2uiv(this.addr,e),Ct(t,e)}}function Pg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(Rt(t,e))return;r.uniform3uiv(this.addr,e),Ct(t,e)}}function Ig(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(Rt(t,e))return;r.uniform4uiv(this.addr,e),Ct(t,e)}}function Lg(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i);let s;this.type===r.SAMPLER_2D_SHADOW?(tl.compareFunction=ql,s=tl):s=fh,t.setTexture2D(e||s,i)}function Dg(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTexture3D(e||mh,i)}function Ng(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTextureCube(e||gh,i)}function Ug(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTexture2DArray(e||ph,i)}function Fg(r){switch(r){case 5126:return _g;case 35664:return vg;case 35665:return xg;case 35666:return yg;case 35674:return Mg;case 35675:return Sg;case 35676:return bg;case 5124:case 35670:return Eg;case 35667:case 35671:return Tg;case 35668:case 35672:return wg;case 35669:case 35673:return Ag;case 5125:return Rg;case 36294:return Cg;case 36295:return Pg;case 36296:return Ig;case 35678:case 36198:case 36298:case 36306:case 35682:return Lg;case 35679:case 36299:case 36307:return Dg;case 35680:case 36300:case 36308:case 36293:return Ng;case 36289:case 36303:case 36311:case 36292:return Ug}}function Og(r,e){r.uniform1fv(this.addr,e)}function Bg(r,e){const t=rs(e,this.size,2);r.uniform2fv(this.addr,t)}function kg(r,e){const t=rs(e,this.size,3);r.uniform3fv(this.addr,t)}function zg(r,e){const t=rs(e,this.size,4);r.uniform4fv(this.addr,t)}function Hg(r,e){const t=rs(e,this.size,4);r.uniformMatrix2fv(this.addr,!1,t)}function Vg(r,e){const t=rs(e,this.size,9);r.uniformMatrix3fv(this.addr,!1,t)}function Gg(r,e){const t=rs(e,this.size,16);r.uniformMatrix4fv(this.addr,!1,t)}function Wg(r,e){r.uniform1iv(this.addr,e)}function Xg(r,e){r.uniform2iv(this.addr,e)}function qg(r,e){r.uniform3iv(this.addr,e)}function jg(r,e){r.uniform4iv(this.addr,e)}function Yg(r,e){r.uniform1uiv(this.addr,e)}function Kg(r,e){r.uniform2uiv(this.addr,e)}function $g(r,e){r.uniform3uiv(this.addr,e)}function Jg(r,e){r.uniform4uiv(this.addr,e)}function Zg(r,e,t){const n=this.cache,i=e.length,s=Ur(t,i);Rt(n,s)||(r.uniform1iv(this.addr,s),Ct(n,s));for(let a=0;a!==i;++a)t.setTexture2D(e[a]||fh,s[a])}function Qg(r,e,t){const n=this.cache,i=e.length,s=Ur(t,i);Rt(n,s)||(r.uniform1iv(this.addr,s),Ct(n,s));for(let a=0;a!==i;++a)t.setTexture3D(e[a]||mh,s[a])}function e0(r,e,t){const n=this.cache,i=e.length,s=Ur(t,i);Rt(n,s)||(r.uniform1iv(this.addr,s),Ct(n,s));for(let a=0;a!==i;++a)t.setTextureCube(e[a]||gh,s[a])}function t0(r,e,t){const n=this.cache,i=e.length,s=Ur(t,i);Rt(n,s)||(r.uniform1iv(this.addr,s),Ct(n,s));for(let a=0;a!==i;++a)t.setTexture2DArray(e[a]||ph,s[a])}function n0(r){switch(r){case 5126:return Og;case 35664:return Bg;case 35665:return kg;case 35666:return zg;case 35674:return Hg;case 35675:return Vg;case 35676:return Gg;case 5124:case 35670:return Wg;case 35667:case 35671:return Xg;case 35668:case 35672:return qg;case 35669:case 35673:return jg;case 5125:return Yg;case 36294:return Kg;case 36295:return $g;case 36296:return Jg;case 35678:case 36198:case 36298:case 36306:case 35682:return Zg;case 35679:case 36299:case 36307:return Qg;case 35680:case 36300:case 36308:case 36293:return e0;case 36289:case 36303:case 36311:case 36292:return t0}}class i0{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Fg(t.type)}}class s0{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=n0(t.type)}}class r0{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const i=this.seq;for(let s=0,a=i.length;s!==a;++s){const o=i[s];o.setValue(e,t[o.id],n)}}}const Ma=/(\w+)(\])?(\[|\.)?/g;function ol(r,e){r.seq.push(e),r.map[e.id]=e}function a0(r,e,t){const n=r.name,i=n.length;for(Ma.lastIndex=0;;){const s=Ma.exec(n),a=Ma.lastIndex;let o=s[1];const c=s[2]==="]",l=s[3];if(c&&(o=o|0),l===void 0||l==="["&&a+2===i){ol(t,l===void 0?new i0(o,r,e):new s0(o,r,e));break}else{let u=t.map[o];u===void 0&&(u=new r0(o),ol(t,u)),t=u}}}class br{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){const s=e.getActiveUniform(t,i),a=e.getUniformLocation(t,s.name);a0(s,a,this)}}setValue(e,t,n,i){const s=this.map[t];s!==void 0&&s.setValue(e,n,i)}setOptional(e,t,n){const i=t[n];i!==void 0&&this.setValue(e,n,i)}static upload(e,t,n,i){for(let s=0,a=t.length;s!==a;++s){const o=t[s],c=n[o.id];c.needsUpdate!==!1&&o.setValue(e,c.value,i)}}static seqWithValue(e,t){const n=[];for(let i=0,s=e.length;i!==s;++i){const a=e[i];a.id in t&&n.push(a)}return n}}function cl(r,e,t){const n=r.createShader(e);return r.shaderSource(n,t),r.compileShader(n),n}const o0=37297;let c0=0;function l0(r,e){const t=r.split(`
`),n=[],i=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let a=i;a<s;a++){const o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}const ll=new ze;function h0(r){Ye._getMatrix(ll,Ye.workingColorSpace,r);const e=`mat3( ${ll.elements.map(t=>t.toFixed(4))} )`;switch(Ye.getTransfer(r)){case Ar:return[e,"LinearTransferOETF"];case at:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",r),[e,"LinearTransferOETF"]}}function hl(r,e,t){const n=r.getShaderParameter(e,r.COMPILE_STATUS),i=r.getShaderInfoLog(e).trim();if(n&&i==="")return"";const s=/ERROR: 0:(\d+)/.exec(i);if(s){const a=parseInt(s[1]);return t.toUpperCase()+`

`+i+`

`+l0(r.getShaderSource(e),a)}else return i}function u0(r,e){const t=h0(e);return[`vec4 ${r}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function d0(r,e){let t;switch(e){case Jh:t="Linear";break;case Zh:t="Reinhard";break;case Qh:t="Cineon";break;case Nl:t="ACESFilmic";break;case tu:t="AgX";break;case nu:t="Neutral";break;case eu:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+r+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const fr=new T;function f0(){Ye.getLuminanceCoefficients(fr);const r=fr.x.toFixed(4),e=fr.y.toFixed(4),t=fr.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${r}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function p0(r){return[r.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",r.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(xs).join(`
`)}function m0(r){const e=[];for(const t in r){const n=r[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function g0(r,e){const t={},n=r.getProgramParameter(e,r.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){const s=r.getActiveAttrib(e,i),a=s.name;let o=1;s.type===r.FLOAT_MAT2&&(o=2),s.type===r.FLOAT_MAT3&&(o=3),s.type===r.FLOAT_MAT4&&(o=4),t[a]={type:s.type,location:r.getAttribLocation(e,a),locationSize:o}}return t}function xs(r){return r!==""}function ul(r,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return r.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function dl(r,e){return r.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const _0=/^[ \t]*#include +<([\w\d./]+)>/gm;function yo(r){return r.replace(_0,x0)}const v0=new Map;function x0(r,e){let t=Ve[e];if(t===void 0){const n=v0.get(e);if(n!==void 0)t=Ve[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return yo(t)}const y0=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function fl(r){return r.replace(y0,M0)}function M0(r,e,t,n){let i="";for(let s=parseInt(e);s<parseInt(t);s++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return i}function pl(r){let e=`precision ${r.precision} float;
	precision ${r.precision} int;
	precision ${r.precision} sampler2D;
	precision ${r.precision} samplerCube;
	precision ${r.precision} sampler3D;
	precision ${r.precision} sampler2DArray;
	precision ${r.precision} sampler2DShadow;
	precision ${r.precision} samplerCubeShadow;
	precision ${r.precision} sampler2DArrayShadow;
	precision ${r.precision} isampler2D;
	precision ${r.precision} isampler3D;
	precision ${r.precision} isamplerCube;
	precision ${r.precision} isampler2DArray;
	precision ${r.precision} usampler2D;
	precision ${r.precision} usampler3D;
	precision ${r.precision} usamplerCube;
	precision ${r.precision} usampler2DArray;
	`;return r.precision==="highp"?e+=`
#define HIGH_PRECISION`:r.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:r.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function S0(r){let e="SHADOWMAP_TYPE_BASIC";return r.shadowMapType===Il?e="SHADOWMAP_TYPE_PCF":r.shadowMapType===Ll?e="SHADOWMAP_TYPE_PCF_SOFT":r.shadowMapType===Ln&&(e="SHADOWMAP_TYPE_VSM"),e}function b0(r){let e="ENVMAP_TYPE_CUBE";if(r.envMap)switch(r.envMapMode){case Yi:case Ki:e="ENVMAP_TYPE_CUBE";break;case Lr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function E0(r){let e="ENVMAP_MODE_REFLECTION";return r.envMap&&r.envMapMode===Ki&&(e="ENVMAP_MODE_REFRACTION"),e}function T0(r){let e="ENVMAP_BLENDING_NONE";if(r.envMap)switch(r.combine){case Dl:e="ENVMAP_BLENDING_MULTIPLY";break;case Kh:e="ENVMAP_BLENDING_MIX";break;case $h:e="ENVMAP_BLENDING_ADD";break}return e}function w0(r){const e=r.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function A0(r,e,t,n){const i=r.getContext(),s=t.defines;let a=t.vertexShader,o=t.fragmentShader;const c=S0(t),l=b0(t),h=E0(t),u=T0(t),d=w0(t),f=p0(t),g=m0(s),_=i.createProgram();let m,p,M=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(m=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(xs).join(`
`),m.length>0&&(m+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g].filter(xs).join(`
`),p.length>0&&(p+=`
`)):(m=[pl(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(xs).join(`
`),p=[pl(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,g,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+l:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Qn?"#define TONE_MAPPING":"",t.toneMapping!==Qn?Ve.tonemapping_pars_fragment:"",t.toneMapping!==Qn?d0("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ve.colorspace_pars_fragment,u0("linearToOutputTexel",t.outputColorSpace),f0(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(xs).join(`
`)),a=yo(a),a=ul(a,t),a=dl(a,t),o=yo(o),o=ul(o,t),o=dl(o,t),a=fl(a),o=fl(o),t.isRawShaderMaterial!==!0&&(M=`#version 300 es
`,m=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,p=["#define varying in",t.glslVersion===oc?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===oc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);const b=M+m+a,v=M+p+o,P=cl(i,i.VERTEX_SHADER,b),R=cl(i,i.FRAGMENT_SHADER,v);i.attachShader(_,P),i.attachShader(_,R),t.index0AttributeName!==void 0?i.bindAttribLocation(_,0,t.index0AttributeName):t.morphTargets===!0&&i.bindAttribLocation(_,0,"position"),i.linkProgram(_);function A(I){if(r.debug.checkShaderErrors){const k=i.getProgramInfoLog(_).trim(),O=i.getShaderInfoLog(P).trim(),X=i.getShaderInfoLog(R).trim();let Y=!0,W=!0;if(i.getProgramParameter(_,i.LINK_STATUS)===!1)if(Y=!1,typeof r.debug.onShaderError=="function")r.debug.onShaderError(i,_,P,R);else{const J=hl(i,P,"vertex"),H=hl(i,R,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(_,i.VALIDATE_STATUS)+`

Material Name: `+I.name+`
Material Type: `+I.type+`

Program Info Log: `+k+`
`+J+`
`+H)}else k!==""?console.warn("THREE.WebGLProgram: Program Info Log:",k):(O===""||X==="")&&(W=!1);W&&(I.diagnostics={runnable:Y,programLog:k,vertexShader:{log:O,prefix:m},fragmentShader:{log:X,prefix:p}})}i.deleteShader(P),i.deleteShader(R),C=new br(i,_),S=g0(i,_)}let C;this.getUniforms=function(){return C===void 0&&A(this),C};let S;this.getAttributes=function(){return S===void 0&&A(this),S};let x=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return x===!1&&(x=i.getProgramParameter(_,o0)),x},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(_),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=c0++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=P,this.fragmentShader=R,this}let R0=0;class C0{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,i=this._getShaderStage(t),s=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(i)===!1&&(a.add(i),i.usedTimes++),a.has(s)===!1&&(a.add(s),s.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new P0(e),t.set(e,n)),n}}class P0{constructor(e){this.id=R0++,this.code=e,this.usedTimes=0}}function I0(r,e,t,n,i,s,a){const o=new Fo,c=new C0,l=new Set,h=[],u=i.logarithmicDepthBuffer,d=i.vertexTextures;let f=i.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(S){return l.add(S),S===0?"uv":`uv${S}`}function m(S,x,I,k,O){const X=k.fog,Y=O.geometry,W=S.isMeshStandardMaterial?k.environment:null,J=(S.isMeshStandardMaterial?t:e).get(S.envMap||W),H=J&&J.mapping===Lr?J.image.height:null,ne=g[S.type];S.precision!==null&&(f=i.getMaxPrecision(S.precision),f!==S.precision&&console.warn("THREE.WebGLProgram.getParameters:",S.precision,"not supported, using",f,"instead."));const he=Y.morphAttributes.position||Y.morphAttributes.normal||Y.morphAttributes.color,ve=he!==void 0?he.length:0;let Be=0;Y.morphAttributes.position!==void 0&&(Be=1),Y.morphAttributes.normal!==void 0&&(Be=2),Y.morphAttributes.color!==void 0&&(Be=3);let ot,j,ie,be;if(ne){const it=yn[ne];ot=it.vertexShader,j=it.fragmentShader}else ot=S.vertexShader,j=S.fragmentShader,c.update(S),ie=c.getVertexShaderID(S),be=c.getFragmentShaderID(S);const ue=r.getRenderTarget(),Ee=r.state.buffers.depth.getReversed(),Je=O.isInstancedMesh===!0,Le=O.isBatchedMesh===!0,mt=!!S.map,gt=!!S.matcap,Ze=!!J,L=!!S.aoMap,Ft=!!S.lightMap,Qe=!!S.bumpMap,lt=!!S.normalMap,ye=!!S.displacementMap,Ke=!!S.emissiveMap,Ae=!!S.metalnessMap,He=!!S.roughnessMap,Et=S.anisotropy>0,w=S.clearcoat>0,y=S.dispersion>0,F=S.iridescence>0,q=S.sheen>0,$=S.transmission>0,G=Et&&!!S.anisotropyMap,Me=w&&!!S.clearcoatMap,ae=w&&!!S.clearcoatNormalMap,xe=w&&!!S.clearcoatRoughnessMap,Se=F&&!!S.iridescenceMap,Z=F&&!!S.iridescenceThicknessMap,de=q&&!!S.sheenColorMap,Ie=q&&!!S.sheenRoughnessMap,Ce=!!S.specularMap,se=!!S.specularColorMap,Ue=!!S.specularIntensityMap,D=$&&!!S.transmissionMap,oe=$&&!!S.thicknessMap,Q=!!S.gradientMap,pe=!!S.alphaMap,ee=S.alphaTest>0,K=!!S.alphaHash,ge=!!S.extensions;let Fe=Qn;S.toneMapped&&(ue===null||ue.isXRRenderTarget===!0)&&(Fe=r.toneMapping);const ht={shaderID:ne,shaderType:S.type,shaderName:S.name,vertexShader:ot,fragmentShader:j,defines:S.defines,customVertexShaderID:ie,customFragmentShaderID:be,isRawShaderMaterial:S.isRawShaderMaterial===!0,glslVersion:S.glslVersion,precision:f,batching:Le,batchingColor:Le&&O._colorsTexture!==null,instancing:Je,instancingColor:Je&&O.instanceColor!==null,instancingMorph:Je&&O.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:ue===null?r.outputColorSpace:ue.isXRRenderTarget===!0?ue.texture.colorSpace:zt,alphaToCoverage:!!S.alphaToCoverage,map:mt,matcap:gt,envMap:Ze,envMapMode:Ze&&J.mapping,envMapCubeUVHeight:H,aoMap:L,lightMap:Ft,bumpMap:Qe,normalMap:lt,displacementMap:d&&ye,emissiveMap:Ke,normalMapObjectSpace:lt&&S.normalMapType===lu,normalMapTangentSpace:lt&&S.normalMapType===Do,metalnessMap:Ae,roughnessMap:He,anisotropy:Et,anisotropyMap:G,clearcoat:w,clearcoatMap:Me,clearcoatNormalMap:ae,clearcoatRoughnessMap:xe,dispersion:y,iridescence:F,iridescenceMap:Se,iridescenceThicknessMap:Z,sheen:q,sheenColorMap:de,sheenRoughnessMap:Ie,specularMap:Ce,specularColorMap:se,specularIntensityMap:Ue,transmission:$,transmissionMap:D,thicknessMap:oe,gradientMap:Q,opaque:S.transparent===!1&&S.blending===Vi&&S.alphaToCoverage===!1,alphaMap:pe,alphaTest:ee,alphaHash:K,combine:S.combine,mapUv:mt&&_(S.map.channel),aoMapUv:L&&_(S.aoMap.channel),lightMapUv:Ft&&_(S.lightMap.channel),bumpMapUv:Qe&&_(S.bumpMap.channel),normalMapUv:lt&&_(S.normalMap.channel),displacementMapUv:ye&&_(S.displacementMap.channel),emissiveMapUv:Ke&&_(S.emissiveMap.channel),metalnessMapUv:Ae&&_(S.metalnessMap.channel),roughnessMapUv:He&&_(S.roughnessMap.channel),anisotropyMapUv:G&&_(S.anisotropyMap.channel),clearcoatMapUv:Me&&_(S.clearcoatMap.channel),clearcoatNormalMapUv:ae&&_(S.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:xe&&_(S.clearcoatRoughnessMap.channel),iridescenceMapUv:Se&&_(S.iridescenceMap.channel),iridescenceThicknessMapUv:Z&&_(S.iridescenceThicknessMap.channel),sheenColorMapUv:de&&_(S.sheenColorMap.channel),sheenRoughnessMapUv:Ie&&_(S.sheenRoughnessMap.channel),specularMapUv:Ce&&_(S.specularMap.channel),specularColorMapUv:se&&_(S.specularColorMap.channel),specularIntensityMapUv:Ue&&_(S.specularIntensityMap.channel),transmissionMapUv:D&&_(S.transmissionMap.channel),thicknessMapUv:oe&&_(S.thicknessMap.channel),alphaMapUv:pe&&_(S.alphaMap.channel),vertexTangents:!!Y.attributes.tangent&&(lt||Et),vertexColors:S.vertexColors,vertexAlphas:S.vertexColors===!0&&!!Y.attributes.color&&Y.attributes.color.itemSize===4,pointsUvs:O.isPoints===!0&&!!Y.attributes.uv&&(mt||pe),fog:!!X,useFog:S.fog===!0,fogExp2:!!X&&X.isFogExp2,flatShading:S.flatShading===!0&&S.wireframe===!1,sizeAttenuation:S.sizeAttenuation===!0,logarithmicDepthBuffer:u,reverseDepthBuffer:Ee,skinning:O.isSkinnedMesh===!0,morphTargets:Y.morphAttributes.position!==void 0,morphNormals:Y.morphAttributes.normal!==void 0,morphColors:Y.morphAttributes.color!==void 0,morphTargetsCount:ve,morphTextureStride:Be,numDirLights:x.directional.length,numPointLights:x.point.length,numSpotLights:x.spot.length,numSpotLightMaps:x.spotLightMap.length,numRectAreaLights:x.rectArea.length,numHemiLights:x.hemi.length,numDirLightShadows:x.directionalShadowMap.length,numPointLightShadows:x.pointShadowMap.length,numSpotLightShadows:x.spotShadowMap.length,numSpotLightShadowsWithMaps:x.numSpotLightShadowsWithMaps,numLightProbes:x.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:S.dithering,shadowMapEnabled:r.shadowMap.enabled&&I.length>0,shadowMapType:r.shadowMap.type,toneMapping:Fe,decodeVideoTexture:mt&&S.map.isVideoTexture===!0&&Ye.getTransfer(S.map.colorSpace)===at,decodeVideoTextureEmissive:Ke&&S.emissiveMap.isVideoTexture===!0&&Ye.getTransfer(S.emissiveMap.colorSpace)===at,premultipliedAlpha:S.premultipliedAlpha,doubleSided:S.side===xt,flipSided:S.side===Xt,useDepthPacking:S.depthPacking>=0,depthPacking:S.depthPacking||0,index0AttributeName:S.index0AttributeName,extensionClipCullDistance:ge&&S.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ge&&S.extensions.multiDraw===!0||Le)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:S.customProgramCacheKey()};return ht.vertexUv1s=l.has(1),ht.vertexUv2s=l.has(2),ht.vertexUv3s=l.has(3),l.clear(),ht}function p(S){const x=[];if(S.shaderID?x.push(S.shaderID):(x.push(S.customVertexShaderID),x.push(S.customFragmentShaderID)),S.defines!==void 0)for(const I in S.defines)x.push(I),x.push(S.defines[I]);return S.isRawShaderMaterial===!1&&(M(x,S),b(x,S),x.push(r.outputColorSpace)),x.push(S.customProgramCacheKey),x.join()}function M(S,x){S.push(x.precision),S.push(x.outputColorSpace),S.push(x.envMapMode),S.push(x.envMapCubeUVHeight),S.push(x.mapUv),S.push(x.alphaMapUv),S.push(x.lightMapUv),S.push(x.aoMapUv),S.push(x.bumpMapUv),S.push(x.normalMapUv),S.push(x.displacementMapUv),S.push(x.emissiveMapUv),S.push(x.metalnessMapUv),S.push(x.roughnessMapUv),S.push(x.anisotropyMapUv),S.push(x.clearcoatMapUv),S.push(x.clearcoatNormalMapUv),S.push(x.clearcoatRoughnessMapUv),S.push(x.iridescenceMapUv),S.push(x.iridescenceThicknessMapUv),S.push(x.sheenColorMapUv),S.push(x.sheenRoughnessMapUv),S.push(x.specularMapUv),S.push(x.specularColorMapUv),S.push(x.specularIntensityMapUv),S.push(x.transmissionMapUv),S.push(x.thicknessMapUv),S.push(x.combine),S.push(x.fogExp2),S.push(x.sizeAttenuation),S.push(x.morphTargetsCount),S.push(x.morphAttributeCount),S.push(x.numDirLights),S.push(x.numPointLights),S.push(x.numSpotLights),S.push(x.numSpotLightMaps),S.push(x.numHemiLights),S.push(x.numRectAreaLights),S.push(x.numDirLightShadows),S.push(x.numPointLightShadows),S.push(x.numSpotLightShadows),S.push(x.numSpotLightShadowsWithMaps),S.push(x.numLightProbes),S.push(x.shadowMapType),S.push(x.toneMapping),S.push(x.numClippingPlanes),S.push(x.numClipIntersection),S.push(x.depthPacking)}function b(S,x){o.disableAll(),x.supportsVertexTextures&&o.enable(0),x.instancing&&o.enable(1),x.instancingColor&&o.enable(2),x.instancingMorph&&o.enable(3),x.matcap&&o.enable(4),x.envMap&&o.enable(5),x.normalMapObjectSpace&&o.enable(6),x.normalMapTangentSpace&&o.enable(7),x.clearcoat&&o.enable(8),x.iridescence&&o.enable(9),x.alphaTest&&o.enable(10),x.vertexColors&&o.enable(11),x.vertexAlphas&&o.enable(12),x.vertexUv1s&&o.enable(13),x.vertexUv2s&&o.enable(14),x.vertexUv3s&&o.enable(15),x.vertexTangents&&o.enable(16),x.anisotropy&&o.enable(17),x.alphaHash&&o.enable(18),x.batching&&o.enable(19),x.dispersion&&o.enable(20),x.batchingColor&&o.enable(21),x.gradientMap&&o.enable(22),S.push(o.mask),o.disableAll(),x.fog&&o.enable(0),x.useFog&&o.enable(1),x.flatShading&&o.enable(2),x.logarithmicDepthBuffer&&o.enable(3),x.reverseDepthBuffer&&o.enable(4),x.skinning&&o.enable(5),x.morphTargets&&o.enable(6),x.morphNormals&&o.enable(7),x.morphColors&&o.enable(8),x.premultipliedAlpha&&o.enable(9),x.shadowMapEnabled&&o.enable(10),x.doubleSided&&o.enable(11),x.flipSided&&o.enable(12),x.useDepthPacking&&o.enable(13),x.dithering&&o.enable(14),x.transmission&&o.enable(15),x.sheen&&o.enable(16),x.opaque&&o.enable(17),x.pointsUvs&&o.enable(18),x.decodeVideoTexture&&o.enable(19),x.decodeVideoTextureEmissive&&o.enable(20),x.alphaToCoverage&&o.enable(21),S.push(o.mask)}function v(S){const x=g[S.type];let I;if(x){const k=yn[x];I=td.clone(k.uniforms)}else I=S.uniforms;return I}function P(S,x){let I;for(let k=0,O=h.length;k<O;k++){const X=h[k];if(X.cacheKey===x){I=X,++I.usedTimes;break}}return I===void 0&&(I=new A0(r,x,S,s),h.push(I)),I}function R(S){if(--S.usedTimes===0){const x=h.indexOf(S);h[x]=h[h.length-1],h.pop(),S.destroy()}}function A(S){c.remove(S)}function C(){c.dispose()}return{getParameters:m,getProgramCacheKey:p,getUniforms:v,acquireProgram:P,releaseProgram:R,releaseShaderCache:A,programs:h,dispose:C}}function L0(){let r=new WeakMap;function e(a){return r.has(a)}function t(a){let o=r.get(a);return o===void 0&&(o={},r.set(a,o)),o}function n(a){r.delete(a)}function i(a,o,c){r.get(a)[o]=c}function s(){r=new WeakMap}return{has:e,get:t,remove:n,update:i,dispose:s}}function D0(r,e){return r.groupOrder!==e.groupOrder?r.groupOrder-e.groupOrder:r.renderOrder!==e.renderOrder?r.renderOrder-e.renderOrder:r.material.id!==e.material.id?r.material.id-e.material.id:r.z!==e.z?r.z-e.z:r.id-e.id}function ml(r,e){return r.groupOrder!==e.groupOrder?r.groupOrder-e.groupOrder:r.renderOrder!==e.renderOrder?r.renderOrder-e.renderOrder:r.z!==e.z?e.z-r.z:r.id-e.id}function gl(){const r=[];let e=0;const t=[],n=[],i=[];function s(){e=0,t.length=0,n.length=0,i.length=0}function a(u,d,f,g,_,m){let p=r[e];return p===void 0?(p={id:u.id,object:u,geometry:d,material:f,groupOrder:g,renderOrder:u.renderOrder,z:_,group:m},r[e]=p):(p.id=u.id,p.object=u,p.geometry=d,p.material=f,p.groupOrder=g,p.renderOrder=u.renderOrder,p.z=_,p.group=m),e++,p}function o(u,d,f,g,_,m){const p=a(u,d,f,g,_,m);f.transmission>0?n.push(p):f.transparent===!0?i.push(p):t.push(p)}function c(u,d,f,g,_,m){const p=a(u,d,f,g,_,m);f.transmission>0?n.unshift(p):f.transparent===!0?i.unshift(p):t.unshift(p)}function l(u,d){t.length>1&&t.sort(u||D0),n.length>1&&n.sort(d||ml),i.length>1&&i.sort(d||ml)}function h(){for(let u=e,d=r.length;u<d;u++){const f=r[u];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:n,transparent:i,init:s,push:o,unshift:c,finish:h,sort:l}}function N0(){let r=new WeakMap;function e(n,i){const s=r.get(n);let a;return s===void 0?(a=new gl,r.set(n,[a])):i>=s.length?(a=new gl,s.push(a)):a=s[i],a}function t(){r=new WeakMap}return{get:e,dispose:t}}function U0(){const r={};return{get:function(e){if(r[e.id]!==void 0)return r[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new T,color:new Pe};break;case"SpotLight":t={position:new T,direction:new T,color:new Pe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new T,color:new Pe,distance:0,decay:0};break;case"HemisphereLight":t={direction:new T,skyColor:new Pe,groundColor:new Pe};break;case"RectAreaLight":t={color:new Pe,position:new T,halfWidth:new T,halfHeight:new T};break}return r[e.id]=t,t}}}function F0(){const r={};return{get:function(e){if(r[e.id]!==void 0)return r[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new me};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new me};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new me,shadowCameraNear:1,shadowCameraFar:1e3};break}return r[e.id]=t,t}}}let O0=0;function B0(r,e){return(e.castShadow?2:0)-(r.castShadow?2:0)+(e.map?1:0)-(r.map?1:0)}function k0(r){const e=new U0,t=F0(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new T);const i=new T,s=new Oe,a=new Oe;function o(l){let h=0,u=0,d=0;for(let S=0;S<9;S++)n.probe[S].set(0,0,0);let f=0,g=0,_=0,m=0,p=0,M=0,b=0,v=0,P=0,R=0,A=0;l.sort(B0);for(let S=0,x=l.length;S<x;S++){const I=l[S],k=I.color,O=I.intensity,X=I.distance,Y=I.shadow&&I.shadow.map?I.shadow.map.texture:null;if(I.isAmbientLight)h+=k.r*O,u+=k.g*O,d+=k.b*O;else if(I.isLightProbe){for(let W=0;W<9;W++)n.probe[W].addScaledVector(I.sh.coefficients[W],O);A++}else if(I.isDirectionalLight){const W=e.get(I);if(W.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){const J=I.shadow,H=t.get(I);H.shadowIntensity=J.intensity,H.shadowBias=J.bias,H.shadowNormalBias=J.normalBias,H.shadowRadius=J.radius,H.shadowMapSize=J.mapSize,n.directionalShadow[f]=H,n.directionalShadowMap[f]=Y,n.directionalShadowMatrix[f]=I.shadow.matrix,M++}n.directional[f]=W,f++}else if(I.isSpotLight){const W=e.get(I);W.position.setFromMatrixPosition(I.matrixWorld),W.color.copy(k).multiplyScalar(O),W.distance=X,W.coneCos=Math.cos(I.angle),W.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),W.decay=I.decay,n.spot[_]=W;const J=I.shadow;if(I.map&&(n.spotLightMap[P]=I.map,P++,J.updateMatrices(I),I.castShadow&&R++),n.spotLightMatrix[_]=J.matrix,I.castShadow){const H=t.get(I);H.shadowIntensity=J.intensity,H.shadowBias=J.bias,H.shadowNormalBias=J.normalBias,H.shadowRadius=J.radius,H.shadowMapSize=J.mapSize,n.spotShadow[_]=H,n.spotShadowMap[_]=Y,v++}_++}else if(I.isRectAreaLight){const W=e.get(I);W.color.copy(k).multiplyScalar(O),W.halfWidth.set(I.width*.5,0,0),W.halfHeight.set(0,I.height*.5,0),n.rectArea[m]=W,m++}else if(I.isPointLight){const W=e.get(I);if(W.color.copy(I.color).multiplyScalar(I.intensity),W.distance=I.distance,W.decay=I.decay,I.castShadow){const J=I.shadow,H=t.get(I);H.shadowIntensity=J.intensity,H.shadowBias=J.bias,H.shadowNormalBias=J.normalBias,H.shadowRadius=J.radius,H.shadowMapSize=J.mapSize,H.shadowCameraNear=J.camera.near,H.shadowCameraFar=J.camera.far,n.pointShadow[g]=H,n.pointShadowMap[g]=Y,n.pointShadowMatrix[g]=I.shadow.matrix,b++}n.point[g]=W,g++}else if(I.isHemisphereLight){const W=e.get(I);W.skyColor.copy(I.color).multiplyScalar(O),W.groundColor.copy(I.groundColor).multiplyScalar(O),n.hemi[p]=W,p++}}m>0&&(r.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=re.LTC_FLOAT_1,n.rectAreaLTC2=re.LTC_FLOAT_2):(n.rectAreaLTC1=re.LTC_HALF_1,n.rectAreaLTC2=re.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;const C=n.hash;(C.directionalLength!==f||C.pointLength!==g||C.spotLength!==_||C.rectAreaLength!==m||C.hemiLength!==p||C.numDirectionalShadows!==M||C.numPointShadows!==b||C.numSpotShadows!==v||C.numSpotMaps!==P||C.numLightProbes!==A)&&(n.directional.length=f,n.spot.length=_,n.rectArea.length=m,n.point.length=g,n.hemi.length=p,n.directionalShadow.length=M,n.directionalShadowMap.length=M,n.pointShadow.length=b,n.pointShadowMap.length=b,n.spotShadow.length=v,n.spotShadowMap.length=v,n.directionalShadowMatrix.length=M,n.pointShadowMatrix.length=b,n.spotLightMatrix.length=v+P-R,n.spotLightMap.length=P,n.numSpotLightShadowsWithMaps=R,n.numLightProbes=A,C.directionalLength=f,C.pointLength=g,C.spotLength=_,C.rectAreaLength=m,C.hemiLength=p,C.numDirectionalShadows=M,C.numPointShadows=b,C.numSpotShadows=v,C.numSpotMaps=P,C.numLightProbes=A,n.version=O0++)}function c(l,h){let u=0,d=0,f=0,g=0,_=0;const m=h.matrixWorldInverse;for(let p=0,M=l.length;p<M;p++){const b=l[p];if(b.isDirectionalLight){const v=n.directional[u];v.direction.setFromMatrixPosition(b.matrixWorld),i.setFromMatrixPosition(b.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(m),u++}else if(b.isSpotLight){const v=n.spot[f];v.position.setFromMatrixPosition(b.matrixWorld),v.position.applyMatrix4(m),v.direction.setFromMatrixPosition(b.matrixWorld),i.setFromMatrixPosition(b.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(m),f++}else if(b.isRectAreaLight){const v=n.rectArea[g];v.position.setFromMatrixPosition(b.matrixWorld),v.position.applyMatrix4(m),a.identity(),s.copy(b.matrixWorld),s.premultiply(m),a.extractRotation(s),v.halfWidth.set(b.width*.5,0,0),v.halfHeight.set(0,b.height*.5,0),v.halfWidth.applyMatrix4(a),v.halfHeight.applyMatrix4(a),g++}else if(b.isPointLight){const v=n.point[d];v.position.setFromMatrixPosition(b.matrixWorld),v.position.applyMatrix4(m),d++}else if(b.isHemisphereLight){const v=n.hemi[_];v.direction.setFromMatrixPosition(b.matrixWorld),v.direction.transformDirection(m),_++}}}return{setup:o,setupView:c,state:n}}function _l(r){const e=new k0(r),t=[],n=[];function i(h){l.camera=h,t.length=0,n.length=0}function s(h){t.push(h)}function a(h){n.push(h)}function o(){e.setup(t)}function c(h){e.setupView(t,h)}const l={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:i,state:l,setupLights:o,setupLightsView:c,pushLight:s,pushShadow:a}}function z0(r){let e=new WeakMap;function t(i,s=0){const a=e.get(i);let o;return a===void 0?(o=new _l(r),e.set(i,[o])):s>=a.length?(o=new _l(r),a.push(o)):o=a[s],o}function n(){e=new WeakMap}return{get:t,dispose:n}}const H0=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,V0=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function G0(r,e,t){let n=new Ho;const i=new me,s=new me,a=new et,o=new Fd({depthPacking:cu}),c=new Od,l={},h=t.maxTextureSize,u={[Mn]:Xt,[Xt]:Mn,[xt]:xt},d=new ti({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new me},radius:{value:4}},vertexShader:H0,fragmentShader:V0}),f=d.clone();f.defines.HORIZONTAL_PASS=1;const g=new yt;g.setAttribute("position",new It(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new Wt(g,d),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Il;let p=this.type;this.render=function(R,A,C){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||R.length===0)return;const S=r.getRenderTarget(),x=r.getActiveCubeFace(),I=r.getActiveMipmapLevel(),k=r.state;k.setBlending(Zn),k.buffers.color.setClear(1,1,1,1),k.buffers.depth.setTest(!0),k.setScissorTest(!1);const O=p!==Ln&&this.type===Ln,X=p===Ln&&this.type!==Ln;for(let Y=0,W=R.length;Y<W;Y++){const J=R[Y],H=J.shadow;if(H===void 0){console.warn("THREE.WebGLShadowMap:",J,"has no shadow.");continue}if(H.autoUpdate===!1&&H.needsUpdate===!1)continue;i.copy(H.mapSize);const ne=H.getFrameExtents();if(i.multiply(ne),s.copy(H.mapSize),(i.x>h||i.y>h)&&(i.x>h&&(s.x=Math.floor(h/ne.x),i.x=s.x*ne.x,H.mapSize.x=s.x),i.y>h&&(s.y=Math.floor(h/ne.y),i.y=s.y*ne.y,H.mapSize.y=s.y)),H.map===null||O===!0||X===!0){const ve=this.type!==Ln?{minFilter:Dt,magFilter:Dt}:{};H.map!==null&&H.map.dispose(),H.map=new vi(i.x,i.y,ve),H.map.texture.name=J.name+".shadowMap",H.camera.updateProjectionMatrix()}r.setRenderTarget(H.map),r.clear();const he=H.getViewportCount();for(let ve=0;ve<he;ve++){const Be=H.getViewport(ve);a.set(s.x*Be.x,s.y*Be.y,s.x*Be.z,s.y*Be.w),k.viewport(a),H.updateMatrices(J,ve),n=H.getFrustum(),v(A,C,H.camera,J,this.type)}H.isPointLightShadow!==!0&&this.type===Ln&&M(H,C),H.needsUpdate=!1}p=this.type,m.needsUpdate=!1,r.setRenderTarget(S,x,I)};function M(R,A){const C=e.update(_);d.defines.VSM_SAMPLES!==R.blurSamples&&(d.defines.VSM_SAMPLES=R.blurSamples,f.defines.VSM_SAMPLES=R.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),R.mapPass===null&&(R.mapPass=new vi(i.x,i.y)),d.uniforms.shadow_pass.value=R.map.texture,d.uniforms.resolution.value=R.mapSize,d.uniforms.radius.value=R.radius,r.setRenderTarget(R.mapPass),r.clear(),r.renderBufferDirect(A,null,C,d,_,null),f.uniforms.shadow_pass.value=R.mapPass.texture,f.uniforms.resolution.value=R.mapSize,f.uniforms.radius.value=R.radius,r.setRenderTarget(R.map),r.clear(),r.renderBufferDirect(A,null,C,f,_,null)}function b(R,A,C,S){let x=null;const I=C.isPointLight===!0?R.customDistanceMaterial:R.customDepthMaterial;if(I!==void 0)x=I;else if(x=C.isPointLight===!0?c:o,r.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0||A.alphaToCoverage===!0){const k=x.uuid,O=A.uuid;let X=l[k];X===void 0&&(X={},l[k]=X);let Y=X[O];Y===void 0&&(Y=x.clone(),X[O]=Y,A.addEventListener("dispose",P)),x=Y}if(x.visible=A.visible,x.wireframe=A.wireframe,S===Ln?x.side=A.shadowSide!==null?A.shadowSide:A.side:x.side=A.shadowSide!==null?A.shadowSide:u[A.side],x.alphaMap=A.alphaMap,x.alphaTest=A.alphaToCoverage===!0?.5:A.alphaTest,x.map=A.map,x.clipShadows=A.clipShadows,x.clippingPlanes=A.clippingPlanes,x.clipIntersection=A.clipIntersection,x.displacementMap=A.displacementMap,x.displacementScale=A.displacementScale,x.displacementBias=A.displacementBias,x.wireframeLinewidth=A.wireframeLinewidth,x.linewidth=A.linewidth,C.isPointLight===!0&&x.isMeshDistanceMaterial===!0){const k=r.properties.get(x);k.light=C}return x}function v(R,A,C,S,x){if(R.visible===!1)return;if(R.layers.test(A.layers)&&(R.isMesh||R.isLine||R.isPoints)&&(R.castShadow||R.receiveShadow&&x===Ln)&&(!R.frustumCulled||n.intersectsObject(R))){R.modelViewMatrix.multiplyMatrices(C.matrixWorldInverse,R.matrixWorld);const O=e.update(R),X=R.material;if(Array.isArray(X)){const Y=O.groups;for(let W=0,J=Y.length;W<J;W++){const H=Y[W],ne=X[H.materialIndex];if(ne&&ne.visible){const he=b(R,ne,S,x);R.onBeforeShadow(r,R,A,C,O,he,H),r.renderBufferDirect(C,null,O,he,R,H),R.onAfterShadow(r,R,A,C,O,he,H)}}}else if(X.visible){const Y=b(R,X,S,x);R.onBeforeShadow(r,R,A,C,O,Y,null),r.renderBufferDirect(C,null,O,Y,R,null),R.onAfterShadow(r,R,A,C,O,Y,null)}}const k=R.children;for(let O=0,X=k.length;O<X;O++)v(k[O],A,C,S,x)}function P(R){R.target.removeEventListener("dispose",P);for(const C in l){const S=l[C],x=R.target.uuid;x in S&&(S[x].dispose(),delete S[x])}}}const W0={[Pa]:Ia,[La]:Ua,[Da]:Fa,[ji]:Na,[Ia]:Pa,[Ua]:La,[Fa]:Da,[Na]:ji};function X0(r,e){function t(){let D=!1;const oe=new et;let Q=null;const pe=new et(0,0,0,0);return{setMask:function(ee){Q!==ee&&!D&&(r.colorMask(ee,ee,ee,ee),Q=ee)},setLocked:function(ee){D=ee},setClear:function(ee,K,ge,Fe,ht){ht===!0&&(ee*=Fe,K*=Fe,ge*=Fe),oe.set(ee,K,ge,Fe),pe.equals(oe)===!1&&(r.clearColor(ee,K,ge,Fe),pe.copy(oe))},reset:function(){D=!1,Q=null,pe.set(-1,0,0,0)}}}function n(){let D=!1,oe=!1,Q=null,pe=null,ee=null;return{setReversed:function(K){if(oe!==K){const ge=e.get("EXT_clip_control");K?ge.clipControlEXT(ge.LOWER_LEFT_EXT,ge.ZERO_TO_ONE_EXT):ge.clipControlEXT(ge.LOWER_LEFT_EXT,ge.NEGATIVE_ONE_TO_ONE_EXT),oe=K;const Fe=ee;ee=null,this.setClear(Fe)}},getReversed:function(){return oe},setTest:function(K){K?ue(r.DEPTH_TEST):Ee(r.DEPTH_TEST)},setMask:function(K){Q!==K&&!D&&(r.depthMask(K),Q=K)},setFunc:function(K){if(oe&&(K=W0[K]),pe!==K){switch(K){case Pa:r.depthFunc(r.NEVER);break;case Ia:r.depthFunc(r.ALWAYS);break;case La:r.depthFunc(r.LESS);break;case ji:r.depthFunc(r.LEQUAL);break;case Da:r.depthFunc(r.EQUAL);break;case Na:r.depthFunc(r.GEQUAL);break;case Ua:r.depthFunc(r.GREATER);break;case Fa:r.depthFunc(r.NOTEQUAL);break;default:r.depthFunc(r.LEQUAL)}pe=K}},setLocked:function(K){D=K},setClear:function(K){ee!==K&&(oe&&(K=1-K),r.clearDepth(K),ee=K)},reset:function(){D=!1,Q=null,pe=null,ee=null,oe=!1}}}function i(){let D=!1,oe=null,Q=null,pe=null,ee=null,K=null,ge=null,Fe=null,ht=null;return{setTest:function(it){D||(it?ue(r.STENCIL_TEST):Ee(r.STENCIL_TEST))},setMask:function(it){oe!==it&&!D&&(r.stencilMask(it),oe=it)},setFunc:function(it,on,Tn){(Q!==it||pe!==on||ee!==Tn)&&(r.stencilFunc(it,on,Tn),Q=it,pe=on,ee=Tn)},setOp:function(it,on,Tn){(K!==it||ge!==on||Fe!==Tn)&&(r.stencilOp(it,on,Tn),K=it,ge=on,Fe=Tn)},setLocked:function(it){D=it},setClear:function(it){ht!==it&&(r.clearStencil(it),ht=it)},reset:function(){D=!1,oe=null,Q=null,pe=null,ee=null,K=null,ge=null,Fe=null,ht=null}}}const s=new t,a=new n,o=new i,c=new WeakMap,l=new WeakMap;let h={},u={},d=new WeakMap,f=[],g=null,_=!1,m=null,p=null,M=null,b=null,v=null,P=null,R=null,A=new Pe(0,0,0),C=0,S=!1,x=null,I=null,k=null,O=null,X=null;const Y=r.getParameter(r.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let W=!1,J=0;const H=r.getParameter(r.VERSION);H.indexOf("WebGL")!==-1?(J=parseFloat(/^WebGL (\d)/.exec(H)[1]),W=J>=1):H.indexOf("OpenGL ES")!==-1&&(J=parseFloat(/^OpenGL ES (\d)/.exec(H)[1]),W=J>=2);let ne=null,he={};const ve=r.getParameter(r.SCISSOR_BOX),Be=r.getParameter(r.VIEWPORT),ot=new et().fromArray(ve),j=new et().fromArray(Be);function ie(D,oe,Q,pe){const ee=new Uint8Array(4),K=r.createTexture();r.bindTexture(D,K),r.texParameteri(D,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(D,r.TEXTURE_MAG_FILTER,r.NEAREST);for(let ge=0;ge<Q;ge++)D===r.TEXTURE_3D||D===r.TEXTURE_2D_ARRAY?r.texImage3D(oe,0,r.RGBA,1,1,pe,0,r.RGBA,r.UNSIGNED_BYTE,ee):r.texImage2D(oe+ge,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,ee);return K}const be={};be[r.TEXTURE_2D]=ie(r.TEXTURE_2D,r.TEXTURE_2D,1),be[r.TEXTURE_CUBE_MAP]=ie(r.TEXTURE_CUBE_MAP,r.TEXTURE_CUBE_MAP_POSITIVE_X,6),be[r.TEXTURE_2D_ARRAY]=ie(r.TEXTURE_2D_ARRAY,r.TEXTURE_2D_ARRAY,1,1),be[r.TEXTURE_3D]=ie(r.TEXTURE_3D,r.TEXTURE_3D,1,1),s.setClear(0,0,0,1),a.setClear(1),o.setClear(0),ue(r.DEPTH_TEST),a.setFunc(ji),Qe(!1),lt(nc),ue(r.CULL_FACE),L(Zn);function ue(D){h[D]!==!0&&(r.enable(D),h[D]=!0)}function Ee(D){h[D]!==!1&&(r.disable(D),h[D]=!1)}function Je(D,oe){return u[D]!==oe?(r.bindFramebuffer(D,oe),u[D]=oe,D===r.DRAW_FRAMEBUFFER&&(u[r.FRAMEBUFFER]=oe),D===r.FRAMEBUFFER&&(u[r.DRAW_FRAMEBUFFER]=oe),!0):!1}function Le(D,oe){let Q=f,pe=!1;if(D){Q=d.get(oe),Q===void 0&&(Q=[],d.set(oe,Q));const ee=D.textures;if(Q.length!==ee.length||Q[0]!==r.COLOR_ATTACHMENT0){for(let K=0,ge=ee.length;K<ge;K++)Q[K]=r.COLOR_ATTACHMENT0+K;Q.length=ee.length,pe=!0}}else Q[0]!==r.BACK&&(Q[0]=r.BACK,pe=!0);pe&&r.drawBuffers(Q)}function mt(D){return g!==D?(r.useProgram(D),g=D,!0):!1}const gt={[fi]:r.FUNC_ADD,[Lh]:r.FUNC_SUBTRACT,[Dh]:r.FUNC_REVERSE_SUBTRACT};gt[Nh]=r.MIN,gt[Uh]=r.MAX;const Ze={[Fh]:r.ZERO,[Oh]:r.ONE,[Bh]:r.SRC_COLOR,[Ra]:r.SRC_ALPHA,[Wh]:r.SRC_ALPHA_SATURATE,[Vh]:r.DST_COLOR,[zh]:r.DST_ALPHA,[kh]:r.ONE_MINUS_SRC_COLOR,[Ca]:r.ONE_MINUS_SRC_ALPHA,[Gh]:r.ONE_MINUS_DST_COLOR,[Hh]:r.ONE_MINUS_DST_ALPHA,[Xh]:r.CONSTANT_COLOR,[qh]:r.ONE_MINUS_CONSTANT_COLOR,[jh]:r.CONSTANT_ALPHA,[Yh]:r.ONE_MINUS_CONSTANT_ALPHA};function L(D,oe,Q,pe,ee,K,ge,Fe,ht,it){if(D===Zn){_===!0&&(Ee(r.BLEND),_=!1);return}if(_===!1&&(ue(r.BLEND),_=!0),D!==Ih){if(D!==m||it!==S){if((p!==fi||v!==fi)&&(r.blendEquation(r.FUNC_ADD),p=fi,v=fi),it)switch(D){case Vi:r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case $t:r.blendFunc(r.ONE,r.ONE);break;case ic:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case sc:r.blendFuncSeparate(r.DST_COLOR,r.ONE_MINUS_SRC_ALPHA,r.ZERO,r.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",D);break}else switch(D){case Vi:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case $t:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE,r.ONE,r.ONE);break;case ic:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case sc:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",D);break}M=null,b=null,P=null,R=null,A.set(0,0,0),C=0,m=D,S=it}return}ee=ee||oe,K=K||Q,ge=ge||pe,(oe!==p||ee!==v)&&(r.blendEquationSeparate(gt[oe],gt[ee]),p=oe,v=ee),(Q!==M||pe!==b||K!==P||ge!==R)&&(r.blendFuncSeparate(Ze[Q],Ze[pe],Ze[K],Ze[ge]),M=Q,b=pe,P=K,R=ge),(Fe.equals(A)===!1||ht!==C)&&(r.blendColor(Fe.r,Fe.g,Fe.b,ht),A.copy(Fe),C=ht),m=D,S=!1}function Ft(D,oe){D.side===xt?Ee(r.CULL_FACE):ue(r.CULL_FACE);let Q=D.side===Xt;oe&&(Q=!Q),Qe(Q),D.blending===Vi&&D.transparent===!1?L(Zn):L(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),a.setFunc(D.depthFunc),a.setTest(D.depthTest),a.setMask(D.depthWrite),s.setMask(D.colorWrite);const pe=D.stencilWrite;o.setTest(pe),pe&&(o.setMask(D.stencilWriteMask),o.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),o.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),Ke(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?ue(r.SAMPLE_ALPHA_TO_COVERAGE):Ee(r.SAMPLE_ALPHA_TO_COVERAGE)}function Qe(D){x!==D&&(D?r.frontFace(r.CW):r.frontFace(r.CCW),x=D)}function lt(D){D!==Ch?(ue(r.CULL_FACE),D!==I&&(D===nc?r.cullFace(r.BACK):D===Ph?r.cullFace(r.FRONT):r.cullFace(r.FRONT_AND_BACK))):Ee(r.CULL_FACE),I=D}function ye(D){D!==k&&(W&&r.lineWidth(D),k=D)}function Ke(D,oe,Q){D?(ue(r.POLYGON_OFFSET_FILL),(O!==oe||X!==Q)&&(r.polygonOffset(oe,Q),O=oe,X=Q)):Ee(r.POLYGON_OFFSET_FILL)}function Ae(D){D?ue(r.SCISSOR_TEST):Ee(r.SCISSOR_TEST)}function He(D){D===void 0&&(D=r.TEXTURE0+Y-1),ne!==D&&(r.activeTexture(D),ne=D)}function Et(D,oe,Q){Q===void 0&&(ne===null?Q=r.TEXTURE0+Y-1:Q=ne);let pe=he[Q];pe===void 0&&(pe={type:void 0,texture:void 0},he[Q]=pe),(pe.type!==D||pe.texture!==oe)&&(ne!==Q&&(r.activeTexture(Q),ne=Q),r.bindTexture(D,oe||be[D]),pe.type=D,pe.texture=oe)}function w(){const D=he[ne];D!==void 0&&D.type!==void 0&&(r.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function y(){try{r.compressedTexImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function F(){try{r.compressedTexImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function q(){try{r.texSubImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function $(){try{r.texSubImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function G(){try{r.compressedTexSubImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Me(){try{r.compressedTexSubImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function ae(){try{r.texStorage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function xe(){try{r.texStorage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Se(){try{r.texImage2D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Z(){try{r.texImage3D(...arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function de(D){ot.equals(D)===!1&&(r.scissor(D.x,D.y,D.z,D.w),ot.copy(D))}function Ie(D){j.equals(D)===!1&&(r.viewport(D.x,D.y,D.z,D.w),j.copy(D))}function Ce(D,oe){let Q=l.get(oe);Q===void 0&&(Q=new WeakMap,l.set(oe,Q));let pe=Q.get(D);pe===void 0&&(pe=r.getUniformBlockIndex(oe,D.name),Q.set(D,pe))}function se(D,oe){const pe=l.get(oe).get(D);c.get(oe)!==pe&&(r.uniformBlockBinding(oe,pe,D.__bindingPointIndex),c.set(oe,pe))}function Ue(){r.disable(r.BLEND),r.disable(r.CULL_FACE),r.disable(r.DEPTH_TEST),r.disable(r.POLYGON_OFFSET_FILL),r.disable(r.SCISSOR_TEST),r.disable(r.STENCIL_TEST),r.disable(r.SAMPLE_ALPHA_TO_COVERAGE),r.blendEquation(r.FUNC_ADD),r.blendFunc(r.ONE,r.ZERO),r.blendFuncSeparate(r.ONE,r.ZERO,r.ONE,r.ZERO),r.blendColor(0,0,0,0),r.colorMask(!0,!0,!0,!0),r.clearColor(0,0,0,0),r.depthMask(!0),r.depthFunc(r.LESS),a.setReversed(!1),r.clearDepth(1),r.stencilMask(4294967295),r.stencilFunc(r.ALWAYS,0,4294967295),r.stencilOp(r.KEEP,r.KEEP,r.KEEP),r.clearStencil(0),r.cullFace(r.BACK),r.frontFace(r.CCW),r.polygonOffset(0,0),r.activeTexture(r.TEXTURE0),r.bindFramebuffer(r.FRAMEBUFFER,null),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),r.bindFramebuffer(r.READ_FRAMEBUFFER,null),r.useProgram(null),r.lineWidth(1),r.scissor(0,0,r.canvas.width,r.canvas.height),r.viewport(0,0,r.canvas.width,r.canvas.height),h={},ne=null,he={},u={},d=new WeakMap,f=[],g=null,_=!1,m=null,p=null,M=null,b=null,v=null,P=null,R=null,A=new Pe(0,0,0),C=0,S=!1,x=null,I=null,k=null,O=null,X=null,ot.set(0,0,r.canvas.width,r.canvas.height),j.set(0,0,r.canvas.width,r.canvas.height),s.reset(),a.reset(),o.reset()}return{buffers:{color:s,depth:a,stencil:o},enable:ue,disable:Ee,bindFramebuffer:Je,drawBuffers:Le,useProgram:mt,setBlending:L,setMaterial:Ft,setFlipSided:Qe,setCullFace:lt,setLineWidth:ye,setPolygonOffset:Ke,setScissorTest:Ae,activeTexture:He,bindTexture:Et,unbindTexture:w,compressedTexImage2D:y,compressedTexImage3D:F,texImage2D:Se,texImage3D:Z,updateUBOMapping:Ce,uniformBlockBinding:se,texStorage2D:ae,texStorage3D:xe,texSubImage2D:q,texSubImage3D:$,compressedTexSubImage2D:G,compressedTexSubImage3D:Me,scissor:de,viewport:Ie,reset:Ue}}function q0(r,e,t,n,i,s,a){const o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new me,h=new WeakMap;let u;const d=new WeakMap;let f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(w,y){return f?new OffscreenCanvas(w,y):Ds("canvas")}function _(w,y,F){let q=1;const $=Et(w);if(($.width>F||$.height>F)&&(q=F/Math.max($.width,$.height)),q<1)if(typeof HTMLImageElement<"u"&&w instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&w instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&w instanceof ImageBitmap||typeof VideoFrame<"u"&&w instanceof VideoFrame){const G=Math.floor(q*$.width),Me=Math.floor(q*$.height);u===void 0&&(u=g(G,Me));const ae=y?g(G,Me):u;return ae.width=G,ae.height=Me,ae.getContext("2d").drawImage(w,0,0,G,Me),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+$.width+"x"+$.height+") to ("+G+"x"+Me+")."),ae}else return"data"in w&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+$.width+"x"+$.height+")."),w;return w}function m(w){return w.generateMipmaps}function p(w){r.generateMipmap(w)}function M(w){return w.isWebGLCubeRenderTarget?r.TEXTURE_CUBE_MAP:w.isWebGL3DRenderTarget?r.TEXTURE_3D:w.isWebGLArrayRenderTarget||w.isCompressedArrayTexture?r.TEXTURE_2D_ARRAY:r.TEXTURE_2D}function b(w,y,F,q,$=!1){if(w!==null){if(r[w]!==void 0)return r[w];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+w+"'")}let G=y;if(y===r.RED&&(F===r.FLOAT&&(G=r.R32F),F===r.HALF_FLOAT&&(G=r.R16F),F===r.UNSIGNED_BYTE&&(G=r.R8)),y===r.RED_INTEGER&&(F===r.UNSIGNED_BYTE&&(G=r.R8UI),F===r.UNSIGNED_SHORT&&(G=r.R16UI),F===r.UNSIGNED_INT&&(G=r.R32UI),F===r.BYTE&&(G=r.R8I),F===r.SHORT&&(G=r.R16I),F===r.INT&&(G=r.R32I)),y===r.RG&&(F===r.FLOAT&&(G=r.RG32F),F===r.HALF_FLOAT&&(G=r.RG16F),F===r.UNSIGNED_BYTE&&(G=r.RG8)),y===r.RG_INTEGER&&(F===r.UNSIGNED_BYTE&&(G=r.RG8UI),F===r.UNSIGNED_SHORT&&(G=r.RG16UI),F===r.UNSIGNED_INT&&(G=r.RG32UI),F===r.BYTE&&(G=r.RG8I),F===r.SHORT&&(G=r.RG16I),F===r.INT&&(G=r.RG32I)),y===r.RGB_INTEGER&&(F===r.UNSIGNED_BYTE&&(G=r.RGB8UI),F===r.UNSIGNED_SHORT&&(G=r.RGB16UI),F===r.UNSIGNED_INT&&(G=r.RGB32UI),F===r.BYTE&&(G=r.RGB8I),F===r.SHORT&&(G=r.RGB16I),F===r.INT&&(G=r.RGB32I)),y===r.RGBA_INTEGER&&(F===r.UNSIGNED_BYTE&&(G=r.RGBA8UI),F===r.UNSIGNED_SHORT&&(G=r.RGBA16UI),F===r.UNSIGNED_INT&&(G=r.RGBA32UI),F===r.BYTE&&(G=r.RGBA8I),F===r.SHORT&&(G=r.RGBA16I),F===r.INT&&(G=r.RGBA32I)),y===r.RGB&&F===r.UNSIGNED_INT_5_9_9_9_REV&&(G=r.RGB9_E5),y===r.RGBA){const Me=$?Ar:Ye.getTransfer(q);F===r.FLOAT&&(G=r.RGBA32F),F===r.HALF_FLOAT&&(G=r.RGBA16F),F===r.UNSIGNED_BYTE&&(G=Me===at?r.SRGB8_ALPHA8:r.RGBA8),F===r.UNSIGNED_SHORT_4_4_4_4&&(G=r.RGBA4),F===r.UNSIGNED_SHORT_5_5_5_1&&(G=r.RGB5_A1)}return(G===r.R16F||G===r.R32F||G===r.RG16F||G===r.RG32F||G===r.RGBA16F||G===r.RGBA32F)&&e.get("EXT_color_buffer_float"),G}function v(w,y){let F;return w?y===null||y===_i||y===Rs?F=r.DEPTH24_STENCIL8:y===mn?F=r.DEPTH32F_STENCIL8:y===As&&(F=r.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):y===null||y===_i||y===Rs?F=r.DEPTH_COMPONENT24:y===mn?F=r.DEPTH_COMPONENT32F:y===As&&(F=r.DEPTH_COMPONENT16),F}function P(w,y){return m(w)===!0||w.isFramebufferTexture&&w.minFilter!==Dt&&w.minFilter!==Qt?Math.log2(Math.max(y.width,y.height))+1:w.mipmaps!==void 0&&w.mipmaps.length>0?w.mipmaps.length:w.isCompressedTexture&&Array.isArray(w.image)?y.mipmaps.length:1}function R(w){const y=w.target;y.removeEventListener("dispose",R),C(y),y.isVideoTexture&&h.delete(y)}function A(w){const y=w.target;y.removeEventListener("dispose",A),x(y)}function C(w){const y=n.get(w);if(y.__webglInit===void 0)return;const F=w.source,q=d.get(F);if(q){const $=q[y.__cacheKey];$.usedTimes--,$.usedTimes===0&&S(w),Object.keys(q).length===0&&d.delete(F)}n.remove(w)}function S(w){const y=n.get(w);r.deleteTexture(y.__webglTexture);const F=w.source,q=d.get(F);delete q[y.__cacheKey],a.memory.textures--}function x(w){const y=n.get(w);if(w.depthTexture&&(w.depthTexture.dispose(),n.remove(w.depthTexture)),w.isWebGLCubeRenderTarget)for(let q=0;q<6;q++){if(Array.isArray(y.__webglFramebuffer[q]))for(let $=0;$<y.__webglFramebuffer[q].length;$++)r.deleteFramebuffer(y.__webglFramebuffer[q][$]);else r.deleteFramebuffer(y.__webglFramebuffer[q]);y.__webglDepthbuffer&&r.deleteRenderbuffer(y.__webglDepthbuffer[q])}else{if(Array.isArray(y.__webglFramebuffer))for(let q=0;q<y.__webglFramebuffer.length;q++)r.deleteFramebuffer(y.__webglFramebuffer[q]);else r.deleteFramebuffer(y.__webglFramebuffer);if(y.__webglDepthbuffer&&r.deleteRenderbuffer(y.__webglDepthbuffer),y.__webglMultisampledFramebuffer&&r.deleteFramebuffer(y.__webglMultisampledFramebuffer),y.__webglColorRenderbuffer)for(let q=0;q<y.__webglColorRenderbuffer.length;q++)y.__webglColorRenderbuffer[q]&&r.deleteRenderbuffer(y.__webglColorRenderbuffer[q]);y.__webglDepthRenderbuffer&&r.deleteRenderbuffer(y.__webglDepthRenderbuffer)}const F=w.textures;for(let q=0,$=F.length;q<$;q++){const G=n.get(F[q]);G.__webglTexture&&(r.deleteTexture(G.__webglTexture),a.memory.textures--),n.remove(F[q])}n.remove(w)}let I=0;function k(){I=0}function O(){const w=I;return w>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+w+" texture units while this GPU supports only "+i.maxTextures),I+=1,w}function X(w){const y=[];return y.push(w.wrapS),y.push(w.wrapT),y.push(w.wrapR||0),y.push(w.magFilter),y.push(w.minFilter),y.push(w.anisotropy),y.push(w.internalFormat),y.push(w.format),y.push(w.type),y.push(w.generateMipmaps),y.push(w.premultiplyAlpha),y.push(w.flipY),y.push(w.unpackAlignment),y.push(w.colorSpace),y.join()}function Y(w,y){const F=n.get(w);if(w.isVideoTexture&&Ae(w),w.isRenderTargetTexture===!1&&w.version>0&&F.__version!==w.version){const q=w.image;if(q===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(q.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{be(F,w,y);return}}t.bindTexture(r.TEXTURE_2D,F.__webglTexture,r.TEXTURE0+y)}function W(w,y){const F=n.get(w);if(w.version>0&&F.__version!==w.version){be(F,w,y);return}t.bindTexture(r.TEXTURE_2D_ARRAY,F.__webglTexture,r.TEXTURE0+y)}function J(w,y){const F=n.get(w);if(w.version>0&&F.__version!==w.version){be(F,w,y);return}t.bindTexture(r.TEXTURE_3D,F.__webglTexture,r.TEXTURE0+y)}function H(w,y){const F=n.get(w);if(w.version>0&&F.__version!==w.version){ue(F,w,y);return}t.bindTexture(r.TEXTURE_CUBE_MAP,F.__webglTexture,r.TEXTURE0+y)}const ne={[ei]:r.REPEAT,[$n]:r.CLAMP_TO_EDGE,[Tr]:r.MIRRORED_REPEAT},he={[Dt]:r.NEAREST,[Fl]:r.NEAREST_MIPMAP_NEAREST,[vs]:r.NEAREST_MIPMAP_LINEAR,[Qt]:r.LINEAR,[_r]:r.LINEAR_MIPMAP_NEAREST,[Nn]:r.LINEAR_MIPMAP_LINEAR},ve={[hu]:r.NEVER,[gu]:r.ALWAYS,[uu]:r.LESS,[ql]:r.LEQUAL,[du]:r.EQUAL,[mu]:r.GEQUAL,[fu]:r.GREATER,[pu]:r.NOTEQUAL};function Be(w,y){if(y.type===mn&&e.has("OES_texture_float_linear")===!1&&(y.magFilter===Qt||y.magFilter===_r||y.magFilter===vs||y.magFilter===Nn||y.minFilter===Qt||y.minFilter===_r||y.minFilter===vs||y.minFilter===Nn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),r.texParameteri(w,r.TEXTURE_WRAP_S,ne[y.wrapS]),r.texParameteri(w,r.TEXTURE_WRAP_T,ne[y.wrapT]),(w===r.TEXTURE_3D||w===r.TEXTURE_2D_ARRAY)&&r.texParameteri(w,r.TEXTURE_WRAP_R,ne[y.wrapR]),r.texParameteri(w,r.TEXTURE_MAG_FILTER,he[y.magFilter]),r.texParameteri(w,r.TEXTURE_MIN_FILTER,he[y.minFilter]),y.compareFunction&&(r.texParameteri(w,r.TEXTURE_COMPARE_MODE,r.COMPARE_REF_TO_TEXTURE),r.texParameteri(w,r.TEXTURE_COMPARE_FUNC,ve[y.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(y.magFilter===Dt||y.minFilter!==vs&&y.minFilter!==Nn||y.type===mn&&e.has("OES_texture_float_linear")===!1)return;if(y.anisotropy>1||n.get(y).__currentAnisotropy){const F=e.get("EXT_texture_filter_anisotropic");r.texParameterf(w,F.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(y.anisotropy,i.getMaxAnisotropy())),n.get(y).__currentAnisotropy=y.anisotropy}}}function ot(w,y){let F=!1;w.__webglInit===void 0&&(w.__webglInit=!0,y.addEventListener("dispose",R));const q=y.source;let $=d.get(q);$===void 0&&($={},d.set(q,$));const G=X(y);if(G!==w.__cacheKey){$[G]===void 0&&($[G]={texture:r.createTexture(),usedTimes:0},a.memory.textures++,F=!0),$[G].usedTimes++;const Me=$[w.__cacheKey];Me!==void 0&&($[w.__cacheKey].usedTimes--,Me.usedTimes===0&&S(y)),w.__cacheKey=G,w.__webglTexture=$[G].texture}return F}function j(w,y,F){return Math.floor(Math.floor(w/F)/y)}function ie(w,y,F,q){const G=w.updateRanges;if(G.length===0)t.texSubImage2D(r.TEXTURE_2D,0,0,0,y.width,y.height,F,q,y.data);else{G.sort((Z,de)=>Z.start-de.start);let Me=0;for(let Z=1;Z<G.length;Z++){const de=G[Me],Ie=G[Z],Ce=de.start+de.count,se=j(Ie.start,y.width,4),Ue=j(de.start,y.width,4);Ie.start<=Ce+1&&se===Ue&&j(Ie.start+Ie.count-1,y.width,4)===se?de.count=Math.max(de.count,Ie.start+Ie.count-de.start):(++Me,G[Me]=Ie)}G.length=Me+1;const ae=r.getParameter(r.UNPACK_ROW_LENGTH),xe=r.getParameter(r.UNPACK_SKIP_PIXELS),Se=r.getParameter(r.UNPACK_SKIP_ROWS);r.pixelStorei(r.UNPACK_ROW_LENGTH,y.width);for(let Z=0,de=G.length;Z<de;Z++){const Ie=G[Z],Ce=Math.floor(Ie.start/4),se=Math.ceil(Ie.count/4),Ue=Ce%y.width,D=Math.floor(Ce/y.width),oe=se,Q=1;r.pixelStorei(r.UNPACK_SKIP_PIXELS,Ue),r.pixelStorei(r.UNPACK_SKIP_ROWS,D),t.texSubImage2D(r.TEXTURE_2D,0,Ue,D,oe,Q,F,q,y.data)}w.clearUpdateRanges(),r.pixelStorei(r.UNPACK_ROW_LENGTH,ae),r.pixelStorei(r.UNPACK_SKIP_PIXELS,xe),r.pixelStorei(r.UNPACK_SKIP_ROWS,Se)}}function be(w,y,F){let q=r.TEXTURE_2D;(y.isDataArrayTexture||y.isCompressedArrayTexture)&&(q=r.TEXTURE_2D_ARRAY),y.isData3DTexture&&(q=r.TEXTURE_3D);const $=ot(w,y),G=y.source;t.bindTexture(q,w.__webglTexture,r.TEXTURE0+F);const Me=n.get(G);if(G.version!==Me.__version||$===!0){t.activeTexture(r.TEXTURE0+F);const ae=Ye.getPrimaries(Ye.workingColorSpace),xe=y.colorSpace===Kn?null:Ye.getPrimaries(y.colorSpace),Se=y.colorSpace===Kn||ae===xe?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,y.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,y.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,Se);let Z=_(y.image,!1,i.maxTextureSize);Z=He(y,Z);const de=s.convert(y.format,y.colorSpace),Ie=s.convert(y.type);let Ce=b(y.internalFormat,de,Ie,y.colorSpace,y.isVideoTexture);Be(q,y);let se;const Ue=y.mipmaps,D=y.isVideoTexture!==!0,oe=Me.__version===void 0||$===!0,Q=G.dataReady,pe=P(y,Z);if(y.isDepthTexture)Ce=v(y.format===Ps,y.type),oe&&(D?t.texStorage2D(r.TEXTURE_2D,1,Ce,Z.width,Z.height):t.texImage2D(r.TEXTURE_2D,0,Ce,Z.width,Z.height,0,de,Ie,null));else if(y.isDataTexture)if(Ue.length>0){D&&oe&&t.texStorage2D(r.TEXTURE_2D,pe,Ce,Ue[0].width,Ue[0].height);for(let ee=0,K=Ue.length;ee<K;ee++)se=Ue[ee],D?Q&&t.texSubImage2D(r.TEXTURE_2D,ee,0,0,se.width,se.height,de,Ie,se.data):t.texImage2D(r.TEXTURE_2D,ee,Ce,se.width,se.height,0,de,Ie,se.data);y.generateMipmaps=!1}else D?(oe&&t.texStorage2D(r.TEXTURE_2D,pe,Ce,Z.width,Z.height),Q&&ie(y,Z,de,Ie)):t.texImage2D(r.TEXTURE_2D,0,Ce,Z.width,Z.height,0,de,Ie,Z.data);else if(y.isCompressedTexture)if(y.isCompressedArrayTexture){D&&oe&&t.texStorage3D(r.TEXTURE_2D_ARRAY,pe,Ce,Ue[0].width,Ue[0].height,Z.depth);for(let ee=0,K=Ue.length;ee<K;ee++)if(se=Ue[ee],y.format!==en)if(de!==null)if(D){if(Q)if(y.layerUpdates.size>0){const ge=jc(se.width,se.height,y.format,y.type);for(const Fe of y.layerUpdates){const ht=se.data.subarray(Fe*ge/se.data.BYTES_PER_ELEMENT,(Fe+1)*ge/se.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,ee,0,0,Fe,se.width,se.height,1,de,ht)}y.clearLayerUpdates()}else t.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,ee,0,0,0,se.width,se.height,Z.depth,de,se.data)}else t.compressedTexImage3D(r.TEXTURE_2D_ARRAY,ee,Ce,se.width,se.height,Z.depth,0,se.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else D?Q&&t.texSubImage3D(r.TEXTURE_2D_ARRAY,ee,0,0,0,se.width,se.height,Z.depth,de,Ie,se.data):t.texImage3D(r.TEXTURE_2D_ARRAY,ee,Ce,se.width,se.height,Z.depth,0,de,Ie,se.data)}else{D&&oe&&t.texStorage2D(r.TEXTURE_2D,pe,Ce,Ue[0].width,Ue[0].height);for(let ee=0,K=Ue.length;ee<K;ee++)se=Ue[ee],y.format!==en?de!==null?D?Q&&t.compressedTexSubImage2D(r.TEXTURE_2D,ee,0,0,se.width,se.height,de,se.data):t.compressedTexImage2D(r.TEXTURE_2D,ee,Ce,se.width,se.height,0,se.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):D?Q&&t.texSubImage2D(r.TEXTURE_2D,ee,0,0,se.width,se.height,de,Ie,se.data):t.texImage2D(r.TEXTURE_2D,ee,Ce,se.width,se.height,0,de,Ie,se.data)}else if(y.isDataArrayTexture)if(D){if(oe&&t.texStorage3D(r.TEXTURE_2D_ARRAY,pe,Ce,Z.width,Z.height,Z.depth),Q)if(y.layerUpdates.size>0){const ee=jc(Z.width,Z.height,y.format,y.type);for(const K of y.layerUpdates){const ge=Z.data.subarray(K*ee/Z.data.BYTES_PER_ELEMENT,(K+1)*ee/Z.data.BYTES_PER_ELEMENT);t.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,K,Z.width,Z.height,1,de,Ie,ge)}y.clearLayerUpdates()}else t.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,0,Z.width,Z.height,Z.depth,de,Ie,Z.data)}else t.texImage3D(r.TEXTURE_2D_ARRAY,0,Ce,Z.width,Z.height,Z.depth,0,de,Ie,Z.data);else if(y.isData3DTexture)D?(oe&&t.texStorage3D(r.TEXTURE_3D,pe,Ce,Z.width,Z.height,Z.depth),Q&&t.texSubImage3D(r.TEXTURE_3D,0,0,0,0,Z.width,Z.height,Z.depth,de,Ie,Z.data)):t.texImage3D(r.TEXTURE_3D,0,Ce,Z.width,Z.height,Z.depth,0,de,Ie,Z.data);else if(y.isFramebufferTexture){if(oe)if(D)t.texStorage2D(r.TEXTURE_2D,pe,Ce,Z.width,Z.height);else{let ee=Z.width,K=Z.height;for(let ge=0;ge<pe;ge++)t.texImage2D(r.TEXTURE_2D,ge,Ce,ee,K,0,de,Ie,null),ee>>=1,K>>=1}}else if(Ue.length>0){if(D&&oe){const ee=Et(Ue[0]);t.texStorage2D(r.TEXTURE_2D,pe,Ce,ee.width,ee.height)}for(let ee=0,K=Ue.length;ee<K;ee++)se=Ue[ee],D?Q&&t.texSubImage2D(r.TEXTURE_2D,ee,0,0,de,Ie,se):t.texImage2D(r.TEXTURE_2D,ee,Ce,de,Ie,se);y.generateMipmaps=!1}else if(D){if(oe){const ee=Et(Z);t.texStorage2D(r.TEXTURE_2D,pe,Ce,ee.width,ee.height)}Q&&t.texSubImage2D(r.TEXTURE_2D,0,0,0,de,Ie,Z)}else t.texImage2D(r.TEXTURE_2D,0,Ce,de,Ie,Z);m(y)&&p(q),Me.__version=G.version,y.onUpdate&&y.onUpdate(y)}w.__version=y.version}function ue(w,y,F){if(y.image.length!==6)return;const q=ot(w,y),$=y.source;t.bindTexture(r.TEXTURE_CUBE_MAP,w.__webglTexture,r.TEXTURE0+F);const G=n.get($);if($.version!==G.__version||q===!0){t.activeTexture(r.TEXTURE0+F);const Me=Ye.getPrimaries(Ye.workingColorSpace),ae=y.colorSpace===Kn?null:Ye.getPrimaries(y.colorSpace),xe=y.colorSpace===Kn||Me===ae?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,y.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,y.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,y.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,xe);const Se=y.isCompressedTexture||y.image[0].isCompressedTexture,Z=y.image[0]&&y.image[0].isDataTexture,de=[];for(let K=0;K<6;K++)!Se&&!Z?de[K]=_(y.image[K],!0,i.maxCubemapSize):de[K]=Z?y.image[K].image:y.image[K],de[K]=He(y,de[K]);const Ie=de[0],Ce=s.convert(y.format,y.colorSpace),se=s.convert(y.type),Ue=b(y.internalFormat,Ce,se,y.colorSpace),D=y.isVideoTexture!==!0,oe=G.__version===void 0||q===!0,Q=$.dataReady;let pe=P(y,Ie);Be(r.TEXTURE_CUBE_MAP,y);let ee;if(Se){D&&oe&&t.texStorage2D(r.TEXTURE_CUBE_MAP,pe,Ue,Ie.width,Ie.height);for(let K=0;K<6;K++){ee=de[K].mipmaps;for(let ge=0;ge<ee.length;ge++){const Fe=ee[ge];y.format!==en?Ce!==null?D?Q&&t.compressedTexSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge,0,0,Fe.width,Fe.height,Ce,Fe.data):t.compressedTexImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge,Ue,Fe.width,Fe.height,0,Fe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):D?Q&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge,0,0,Fe.width,Fe.height,Ce,se,Fe.data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge,Ue,Fe.width,Fe.height,0,Ce,se,Fe.data)}}}else{if(ee=y.mipmaps,D&&oe){ee.length>0&&pe++;const K=Et(de[0]);t.texStorage2D(r.TEXTURE_CUBE_MAP,pe,Ue,K.width,K.height)}for(let K=0;K<6;K++)if(Z){D?Q&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,0,0,de[K].width,de[K].height,Ce,se,de[K].data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,Ue,de[K].width,de[K].height,0,Ce,se,de[K].data);for(let ge=0;ge<ee.length;ge++){const ht=ee[ge].image[K].image;D?Q&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge+1,0,0,ht.width,ht.height,Ce,se,ht.data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge+1,Ue,ht.width,ht.height,0,Ce,se,ht.data)}}else{D?Q&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,0,0,Ce,se,de[K]):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,Ue,Ce,se,de[K]);for(let ge=0;ge<ee.length;ge++){const Fe=ee[ge];D?Q&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge+1,0,0,Ce,se,Fe.image[K]):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+K,ge+1,Ue,Ce,se,Fe.image[K])}}}m(y)&&p(r.TEXTURE_CUBE_MAP),G.__version=$.version,y.onUpdate&&y.onUpdate(y)}w.__version=y.version}function Ee(w,y,F,q,$,G){const Me=s.convert(F.format,F.colorSpace),ae=s.convert(F.type),xe=b(F.internalFormat,Me,ae,F.colorSpace),Se=n.get(y),Z=n.get(F);if(Z.__renderTarget=y,!Se.__hasExternalTextures){const de=Math.max(1,y.width>>G),Ie=Math.max(1,y.height>>G);$===r.TEXTURE_3D||$===r.TEXTURE_2D_ARRAY?t.texImage3D($,G,xe,de,Ie,y.depth,0,Me,ae,null):t.texImage2D($,G,xe,de,Ie,0,Me,ae,null)}t.bindFramebuffer(r.FRAMEBUFFER,w),Ke(y)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,q,$,Z.__webglTexture,0,ye(y)):($===r.TEXTURE_2D||$>=r.TEXTURE_CUBE_MAP_POSITIVE_X&&$<=r.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&r.framebufferTexture2D(r.FRAMEBUFFER,q,$,Z.__webglTexture,G),t.bindFramebuffer(r.FRAMEBUFFER,null)}function Je(w,y,F){if(r.bindRenderbuffer(r.RENDERBUFFER,w),y.depthBuffer){const q=y.depthTexture,$=q&&q.isDepthTexture?q.type:null,G=v(y.stencilBuffer,$),Me=y.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,ae=ye(y);Ke(y)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,ae,G,y.width,y.height):F?r.renderbufferStorageMultisample(r.RENDERBUFFER,ae,G,y.width,y.height):r.renderbufferStorage(r.RENDERBUFFER,G,y.width,y.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,Me,r.RENDERBUFFER,w)}else{const q=y.textures;for(let $=0;$<q.length;$++){const G=q[$],Me=s.convert(G.format,G.colorSpace),ae=s.convert(G.type),xe=b(G.internalFormat,Me,ae,G.colorSpace),Se=ye(y);F&&Ke(y)===!1?r.renderbufferStorageMultisample(r.RENDERBUFFER,Se,xe,y.width,y.height):Ke(y)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,Se,xe,y.width,y.height):r.renderbufferStorage(r.RENDERBUFFER,xe,y.width,y.height)}}r.bindRenderbuffer(r.RENDERBUFFER,null)}function Le(w,y){if(y&&y.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(r.FRAMEBUFFER,w),!(y.depthTexture&&y.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const q=n.get(y.depthTexture);q.__renderTarget=y,(!q.__webglTexture||y.depthTexture.image.width!==y.width||y.depthTexture.image.height!==y.height)&&(y.depthTexture.image.width=y.width,y.depthTexture.image.height=y.height,y.depthTexture.needsUpdate=!0),Y(y.depthTexture,0);const $=q.__webglTexture,G=ye(y);if(y.depthTexture.format===Cs)Ke(y)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,$,0,G):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,$,0);else if(y.depthTexture.format===Ps)Ke(y)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,$,0,G):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,$,0);else throw new Error("Unknown depthTexture format")}function mt(w){const y=n.get(w),F=w.isWebGLCubeRenderTarget===!0;if(y.__boundDepthTexture!==w.depthTexture){const q=w.depthTexture;if(y.__depthDisposeCallback&&y.__depthDisposeCallback(),q){const $=()=>{delete y.__boundDepthTexture,delete y.__depthDisposeCallback,q.removeEventListener("dispose",$)};q.addEventListener("dispose",$),y.__depthDisposeCallback=$}y.__boundDepthTexture=q}if(w.depthTexture&&!y.__autoAllocateDepthBuffer){if(F)throw new Error("target.depthTexture not supported in Cube render targets");const q=w.texture.mipmaps;q&&q.length>0?Le(y.__webglFramebuffer[0],w):Le(y.__webglFramebuffer,w)}else if(F){y.__webglDepthbuffer=[];for(let q=0;q<6;q++)if(t.bindFramebuffer(r.FRAMEBUFFER,y.__webglFramebuffer[q]),y.__webglDepthbuffer[q]===void 0)y.__webglDepthbuffer[q]=r.createRenderbuffer(),Je(y.__webglDepthbuffer[q],w,!1);else{const $=w.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,G=y.__webglDepthbuffer[q];r.bindRenderbuffer(r.RENDERBUFFER,G),r.framebufferRenderbuffer(r.FRAMEBUFFER,$,r.RENDERBUFFER,G)}}else{const q=w.texture.mipmaps;if(q&&q.length>0?t.bindFramebuffer(r.FRAMEBUFFER,y.__webglFramebuffer[0]):t.bindFramebuffer(r.FRAMEBUFFER,y.__webglFramebuffer),y.__webglDepthbuffer===void 0)y.__webglDepthbuffer=r.createRenderbuffer(),Je(y.__webglDepthbuffer,w,!1);else{const $=w.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,G=y.__webglDepthbuffer;r.bindRenderbuffer(r.RENDERBUFFER,G),r.framebufferRenderbuffer(r.FRAMEBUFFER,$,r.RENDERBUFFER,G)}}t.bindFramebuffer(r.FRAMEBUFFER,null)}function gt(w,y,F){const q=n.get(w);y!==void 0&&Ee(q.__webglFramebuffer,w,w.texture,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,0),F!==void 0&&mt(w)}function Ze(w){const y=w.texture,F=n.get(w),q=n.get(y);w.addEventListener("dispose",A);const $=w.textures,G=w.isWebGLCubeRenderTarget===!0,Me=$.length>1;if(Me||(q.__webglTexture===void 0&&(q.__webglTexture=r.createTexture()),q.__version=y.version,a.memory.textures++),G){F.__webglFramebuffer=[];for(let ae=0;ae<6;ae++)if(y.mipmaps&&y.mipmaps.length>0){F.__webglFramebuffer[ae]=[];for(let xe=0;xe<y.mipmaps.length;xe++)F.__webglFramebuffer[ae][xe]=r.createFramebuffer()}else F.__webglFramebuffer[ae]=r.createFramebuffer()}else{if(y.mipmaps&&y.mipmaps.length>0){F.__webglFramebuffer=[];for(let ae=0;ae<y.mipmaps.length;ae++)F.__webglFramebuffer[ae]=r.createFramebuffer()}else F.__webglFramebuffer=r.createFramebuffer();if(Me)for(let ae=0,xe=$.length;ae<xe;ae++){const Se=n.get($[ae]);Se.__webglTexture===void 0&&(Se.__webglTexture=r.createTexture(),a.memory.textures++)}if(w.samples>0&&Ke(w)===!1){F.__webglMultisampledFramebuffer=r.createFramebuffer(),F.__webglColorRenderbuffer=[],t.bindFramebuffer(r.FRAMEBUFFER,F.__webglMultisampledFramebuffer);for(let ae=0;ae<$.length;ae++){const xe=$[ae];F.__webglColorRenderbuffer[ae]=r.createRenderbuffer(),r.bindRenderbuffer(r.RENDERBUFFER,F.__webglColorRenderbuffer[ae]);const Se=s.convert(xe.format,xe.colorSpace),Z=s.convert(xe.type),de=b(xe.internalFormat,Se,Z,xe.colorSpace,w.isXRRenderTarget===!0),Ie=ye(w);r.renderbufferStorageMultisample(r.RENDERBUFFER,Ie,de,w.width,w.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+ae,r.RENDERBUFFER,F.__webglColorRenderbuffer[ae])}r.bindRenderbuffer(r.RENDERBUFFER,null),w.depthBuffer&&(F.__webglDepthRenderbuffer=r.createRenderbuffer(),Je(F.__webglDepthRenderbuffer,w,!0)),t.bindFramebuffer(r.FRAMEBUFFER,null)}}if(G){t.bindTexture(r.TEXTURE_CUBE_MAP,q.__webglTexture),Be(r.TEXTURE_CUBE_MAP,y);for(let ae=0;ae<6;ae++)if(y.mipmaps&&y.mipmaps.length>0)for(let xe=0;xe<y.mipmaps.length;xe++)Ee(F.__webglFramebuffer[ae][xe],w,y,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+ae,xe);else Ee(F.__webglFramebuffer[ae],w,y,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+ae,0);m(y)&&p(r.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Me){for(let ae=0,xe=$.length;ae<xe;ae++){const Se=$[ae],Z=n.get(Se);t.bindTexture(r.TEXTURE_2D,Z.__webglTexture),Be(r.TEXTURE_2D,Se),Ee(F.__webglFramebuffer,w,Se,r.COLOR_ATTACHMENT0+ae,r.TEXTURE_2D,0),m(Se)&&p(r.TEXTURE_2D)}t.unbindTexture()}else{let ae=r.TEXTURE_2D;if((w.isWebGL3DRenderTarget||w.isWebGLArrayRenderTarget)&&(ae=w.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),t.bindTexture(ae,q.__webglTexture),Be(ae,y),y.mipmaps&&y.mipmaps.length>0)for(let xe=0;xe<y.mipmaps.length;xe++)Ee(F.__webglFramebuffer[xe],w,y,r.COLOR_ATTACHMENT0,ae,xe);else Ee(F.__webglFramebuffer,w,y,r.COLOR_ATTACHMENT0,ae,0);m(y)&&p(ae),t.unbindTexture()}w.depthBuffer&&mt(w)}function L(w){const y=w.textures;for(let F=0,q=y.length;F<q;F++){const $=y[F];if(m($)){const G=M(w),Me=n.get($).__webglTexture;t.bindTexture(G,Me),p(G),t.unbindTexture()}}}const Ft=[],Qe=[];function lt(w){if(w.samples>0){if(Ke(w)===!1){const y=w.textures,F=w.width,q=w.height;let $=r.COLOR_BUFFER_BIT;const G=w.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,Me=n.get(w),ae=y.length>1;if(ae)for(let Se=0;Se<y.length;Se++)t.bindFramebuffer(r.FRAMEBUFFER,Me.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+Se,r.RENDERBUFFER,null),t.bindFramebuffer(r.FRAMEBUFFER,Me.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+Se,r.TEXTURE_2D,null,0);t.bindFramebuffer(r.READ_FRAMEBUFFER,Me.__webglMultisampledFramebuffer);const xe=w.texture.mipmaps;xe&&xe.length>0?t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Me.__webglFramebuffer[0]):t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Me.__webglFramebuffer);for(let Se=0;Se<y.length;Se++){if(w.resolveDepthBuffer&&(w.depthBuffer&&($|=r.DEPTH_BUFFER_BIT),w.stencilBuffer&&w.resolveStencilBuffer&&($|=r.STENCIL_BUFFER_BIT)),ae){r.framebufferRenderbuffer(r.READ_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.RENDERBUFFER,Me.__webglColorRenderbuffer[Se]);const Z=n.get(y[Se]).__webglTexture;r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,Z,0)}r.blitFramebuffer(0,0,F,q,0,0,F,q,$,r.NEAREST),c===!0&&(Ft.length=0,Qe.length=0,Ft.push(r.COLOR_ATTACHMENT0+Se),w.depthBuffer&&w.resolveDepthBuffer===!1&&(Ft.push(G),Qe.push(G),r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,Qe)),r.invalidateFramebuffer(r.READ_FRAMEBUFFER,Ft))}if(t.bindFramebuffer(r.READ_FRAMEBUFFER,null),t.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),ae)for(let Se=0;Se<y.length;Se++){t.bindFramebuffer(r.FRAMEBUFFER,Me.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+Se,r.RENDERBUFFER,Me.__webglColorRenderbuffer[Se]);const Z=n.get(y[Se]).__webglTexture;t.bindFramebuffer(r.FRAMEBUFFER,Me.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+Se,r.TEXTURE_2D,Z,0)}t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Me.__webglMultisampledFramebuffer)}else if(w.depthBuffer&&w.resolveDepthBuffer===!1&&c){const y=w.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,[y])}}}function ye(w){return Math.min(i.maxSamples,w.samples)}function Ke(w){const y=n.get(w);return w.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&y.__useRenderToTexture!==!1}function Ae(w){const y=a.render.frame;h.get(w)!==y&&(h.set(w,y),w.update())}function He(w,y){const F=w.colorSpace,q=w.format,$=w.type;return w.isCompressedTexture===!0||w.isVideoTexture===!0||F!==zt&&F!==Kn&&(Ye.getTransfer(F)===at?(q!==en||$!==Sn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",F)),y}function Et(w){return typeof HTMLImageElement<"u"&&w instanceof HTMLImageElement?(l.width=w.naturalWidth||w.width,l.height=w.naturalHeight||w.height):typeof VideoFrame<"u"&&w instanceof VideoFrame?(l.width=w.displayWidth,l.height=w.displayHeight):(l.width=w.width,l.height=w.height),l}this.allocateTextureUnit=O,this.resetTextureUnits=k,this.setTexture2D=Y,this.setTexture2DArray=W,this.setTexture3D=J,this.setTextureCube=H,this.rebindTextures=gt,this.setupRenderTarget=Ze,this.updateRenderTargetMipmap=L,this.updateMultisampleRenderTarget=lt,this.setupDepthRenderbuffer=mt,this.setupFrameBufferTexture=Ee,this.useMultisampledRTT=Ke}function j0(r,e){function t(n,i=Kn){let s;const a=Ye.getTransfer(i);if(n===Sn)return r.UNSIGNED_BYTE;if(n===wo)return r.UNSIGNED_SHORT_4_4_4_4;if(n===Ao)return r.UNSIGNED_SHORT_5_5_5_1;if(n===kl)return r.UNSIGNED_INT_5_9_9_9_REV;if(n===Ol)return r.BYTE;if(n===Bl)return r.SHORT;if(n===As)return r.UNSIGNED_SHORT;if(n===To)return r.INT;if(n===_i)return r.UNSIGNED_INT;if(n===mn)return r.FLOAT;if(n===Ns)return r.HALF_FLOAT;if(n===zl)return r.ALPHA;if(n===Hl)return r.RGB;if(n===en)return r.RGBA;if(n===Cs)return r.DEPTH_COMPONENT;if(n===Ps)return r.DEPTH_STENCIL;if(n===Ro)return r.RED;if(n===Co)return r.RED_INTEGER;if(n===Vl)return r.RG;if(n===Po)return r.RG_INTEGER;if(n===Io)return r.RGBA_INTEGER;if(n===vr||n===xr||n===yr||n===Mr)if(a===at)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===vr)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===xr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===yr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Mr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===vr)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===xr)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===yr)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Mr)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===ka||n===za||n===Ha||n===Va)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===ka)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===za)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Ha)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Va)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Ga||n===Wa||n===Xa)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(n===Ga||n===Wa)return a===at?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===Xa)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===qa||n===ja||n===Ya||n===Ka||n===$a||n===Ja||n===Za||n===Qa||n===eo||n===to||n===no||n===io||n===so||n===ro)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(n===qa)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===ja)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Ya)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Ka)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===$a)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Ja)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Za)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Qa)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===eo)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===to)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===no)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===io)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===so)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===ro)return a===at?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Sr||n===ao||n===oo)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(n===Sr)return a===at?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===ao)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===oo)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Gl||n===co||n===lo||n===ho)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(n===Sr)return s.COMPRESSED_RED_RGTC1_EXT;if(n===co)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===lo)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===ho)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Rs?r.UNSIGNED_INT_24_8:r[n]!==void 0?r[n]:null}return{convert:t}}const Y0=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,K0=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class $0{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){const i=new At,s=e.properties.get(i);s.__webglTexture=t.texture,(t.depthNear!==n.depthNear||t.depthFar!==n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new ti({vertexShader:Y0,fragmentShader:K0,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Wt(new gi(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class J0 extends xi{constructor(e,t){super();const n=this;let i=null,s=1,a=null,o="local-floor",c=1,l=null,h=null,u=null,d=null,f=null,g=null;const _=new $0,m=t.getContextAttributes();let p=null,M=null;const b=[],v=[],P=new me;let R=null;const A=new Gt;A.viewport=new et;const C=new Gt;C.viewport=new et;const S=[A,C],x=new nf;let I=null,k=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(j){let ie=b[j];return ie===void 0&&(ie=new ra,b[j]=ie),ie.getTargetRaySpace()},this.getControllerGrip=function(j){let ie=b[j];return ie===void 0&&(ie=new ra,b[j]=ie),ie.getGripSpace()},this.getHand=function(j){let ie=b[j];return ie===void 0&&(ie=new ra,b[j]=ie),ie.getHandSpace()};function O(j){const ie=v.indexOf(j.inputSource);if(ie===-1)return;const be=b[ie];be!==void 0&&(be.update(j.inputSource,j.frame,l||a),be.dispatchEvent({type:j.type,data:j.inputSource}))}function X(){i.removeEventListener("select",O),i.removeEventListener("selectstart",O),i.removeEventListener("selectend",O),i.removeEventListener("squeeze",O),i.removeEventListener("squeezestart",O),i.removeEventListener("squeezeend",O),i.removeEventListener("end",X),i.removeEventListener("inputsourceschange",Y);for(let j=0;j<b.length;j++){const ie=v[j];ie!==null&&(v[j]=null,b[j].disconnect(ie))}I=null,k=null,_.reset(),e.setRenderTarget(p),f=null,d=null,u=null,i=null,M=null,ot.stop(),n.isPresenting=!1,e.setPixelRatio(R),e.setSize(P.width,P.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(j){s=j,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(j){o=j,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||a},this.setReferenceSpace=function(j){l=j},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u},this.getFrame=function(){return g},this.getSession=function(){return i},this.setSession=async function(j){if(i=j,i!==null){if(p=e.getRenderTarget(),i.addEventListener("select",O),i.addEventListener("selectstart",O),i.addEventListener("selectend",O),i.addEventListener("squeeze",O),i.addEventListener("squeezestart",O),i.addEventListener("squeezeend",O),i.addEventListener("end",X),i.addEventListener("inputsourceschange",Y),m.xrCompatible!==!0&&await t.makeXRCompatible(),R=e.getPixelRatio(),e.getSize(P),typeof XRWebGLBinding<"u"&&"createProjectionLayer"in XRWebGLBinding.prototype){let be=null,ue=null,Ee=null;m.depth&&(Ee=m.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,be=m.stencil?Ps:Cs,ue=m.stencil?Rs:_i);const Je={colorFormat:t.RGBA8,depthFormat:Ee,scaleFactor:s};u=new XRWebGLBinding(i,t),d=u.createProjectionLayer(Je),i.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),M=new vi(d.textureWidth,d.textureHeight,{format:en,type:Sn,depthTexture:new ih(d.textureWidth,d.textureHeight,ue,void 0,void 0,void 0,void 0,void 0,void 0,be),stencilBuffer:m.stencil,colorSpace:e.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{const be={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(i,t,be),i.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),M=new vi(f.framebufferWidth,f.framebufferHeight,{format:en,type:Sn,colorSpace:e.outputColorSpace,stencilBuffer:m.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}M.isXRRenderTarget=!0,this.setFoveation(c),l=null,a=await i.requestReferenceSpace(o),ot.setContext(i),ot.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function Y(j){for(let ie=0;ie<j.removed.length;ie++){const be=j.removed[ie],ue=v.indexOf(be);ue>=0&&(v[ue]=null,b[ue].disconnect(be))}for(let ie=0;ie<j.added.length;ie++){const be=j.added[ie];let ue=v.indexOf(be);if(ue===-1){for(let Je=0;Je<b.length;Je++)if(Je>=v.length){v.push(be),ue=Je;break}else if(v[Je]===null){v[Je]=be,ue=Je;break}if(ue===-1)break}const Ee=b[ue];Ee&&Ee.connect(be)}}const W=new T,J=new T;function H(j,ie,be){W.setFromMatrixPosition(ie.matrixWorld),J.setFromMatrixPosition(be.matrixWorld);const ue=W.distanceTo(J),Ee=ie.projectionMatrix.elements,Je=be.projectionMatrix.elements,Le=Ee[14]/(Ee[10]-1),mt=Ee[14]/(Ee[10]+1),gt=(Ee[9]+1)/Ee[5],Ze=(Ee[9]-1)/Ee[5],L=(Ee[8]-1)/Ee[0],Ft=(Je[8]+1)/Je[0],Qe=Le*L,lt=Le*Ft,ye=ue/(-L+Ft),Ke=ye*-L;if(ie.matrixWorld.decompose(j.position,j.quaternion,j.scale),j.translateX(Ke),j.translateZ(ye),j.matrixWorld.compose(j.position,j.quaternion,j.scale),j.matrixWorldInverse.copy(j.matrixWorld).invert(),Ee[10]===-1)j.projectionMatrix.copy(ie.projectionMatrix),j.projectionMatrixInverse.copy(ie.projectionMatrixInverse);else{const Ae=Le+ye,He=mt+ye,Et=Qe-Ke,w=lt+(ue-Ke),y=gt*mt/He*Ae,F=Ze*mt/He*Ae;j.projectionMatrix.makePerspective(Et,w,y,F,Ae,He),j.projectionMatrixInverse.copy(j.projectionMatrix).invert()}}function ne(j,ie){ie===null?j.matrixWorld.copy(j.matrix):j.matrixWorld.multiplyMatrices(ie.matrixWorld,j.matrix),j.matrixWorldInverse.copy(j.matrixWorld).invert()}this.updateCamera=function(j){if(i===null)return;let ie=j.near,be=j.far;_.texture!==null&&(_.depthNear>0&&(ie=_.depthNear),_.depthFar>0&&(be=_.depthFar)),x.near=C.near=A.near=ie,x.far=C.far=A.far=be,(I!==x.near||k!==x.far)&&(i.updateRenderState({depthNear:x.near,depthFar:x.far}),I=x.near,k=x.far),A.layers.mask=j.layers.mask|2,C.layers.mask=j.layers.mask|4,x.layers.mask=A.layers.mask|C.layers.mask;const ue=j.parent,Ee=x.cameras;ne(x,ue);for(let Je=0;Je<Ee.length;Je++)ne(Ee[Je],ue);Ee.length===2?H(x,A,C):x.projectionMatrix.copy(A.projectionMatrix),he(j,x,ue)};function he(j,ie,be){be===null?j.matrix.copy(ie.matrixWorld):(j.matrix.copy(be.matrixWorld),j.matrix.invert(),j.matrix.multiply(ie.matrixWorld)),j.matrix.decompose(j.position,j.quaternion,j.scale),j.updateMatrixWorld(!0),j.projectionMatrix.copy(ie.projectionMatrix),j.projectionMatrixInverse.copy(ie.projectionMatrixInverse),j.isPerspectiveCamera&&(j.fov=$i*2*Math.atan(1/j.projectionMatrix.elements[5]),j.zoom=1)}this.getCamera=function(){return x},this.getFoveation=function(){if(!(d===null&&f===null))return c},this.setFoveation=function(j){c=j,d!==null&&(d.fixedFoveation=j),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=j)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(x)};let ve=null;function Be(j,ie){if(h=ie.getViewerPose(l||a),g=ie,h!==null){const be=h.views;f!==null&&(e.setRenderTargetFramebuffer(M,f.framebuffer),e.setRenderTarget(M));let ue=!1;be.length!==x.cameras.length&&(x.cameras.length=0,ue=!0);for(let Le=0;Le<be.length;Le++){const mt=be[Le];let gt=null;if(f!==null)gt=f.getViewport(mt);else{const L=u.getViewSubImage(d,mt);gt=L.viewport,Le===0&&(e.setRenderTargetTextures(M,L.colorTexture,L.depthStencilTexture),e.setRenderTarget(M))}let Ze=S[Le];Ze===void 0&&(Ze=new Gt,Ze.layers.enable(Le),Ze.viewport=new et,S[Le]=Ze),Ze.matrix.fromArray(mt.transform.matrix),Ze.matrix.decompose(Ze.position,Ze.quaternion,Ze.scale),Ze.projectionMatrix.fromArray(mt.projectionMatrix),Ze.projectionMatrixInverse.copy(Ze.projectionMatrix).invert(),Ze.viewport.set(gt.x,gt.y,gt.width,gt.height),Le===0&&(x.matrix.copy(Ze.matrix),x.matrix.decompose(x.position,x.quaternion,x.scale)),ue===!0&&x.cameras.push(Ze)}const Ee=i.enabledFeatures;if(Ee&&Ee.includes("depth-sensing")&&i.depthUsage=="gpu-optimized"&&u){const Le=u.getDepthInformation(be[0]);Le&&Le.isValid&&Le.texture&&_.init(e,Le,i.renderState)}}for(let be=0;be<b.length;be++){const ue=v[be],Ee=b[be];ue!==null&&Ee!==void 0&&Ee.update(ue,ie,l||a)}ve&&ve(j,ie),ie.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ie}),g=null}const ot=new dh;ot.setAnimationLoop(Be),this.setAnimationLoop=function(j){ve=j},this.dispose=function(){}}}const li=new Tt,Z0=new Oe;function Q0(r,e){function t(m,p){m.matrixAutoUpdate===!0&&m.updateMatrix(),p.value.copy(m.matrix)}function n(m,p){p.color.getRGB(m.fogColor.value,Zl(r)),p.isFog?(m.fogNear.value=p.near,m.fogFar.value=p.far):p.isFogExp2&&(m.fogDensity.value=p.density)}function i(m,p,M,b,v){p.isMeshBasicMaterial||p.isMeshLambertMaterial?s(m,p):p.isMeshToonMaterial?(s(m,p),u(m,p)):p.isMeshPhongMaterial?(s(m,p),h(m,p)):p.isMeshStandardMaterial?(s(m,p),d(m,p),p.isMeshPhysicalMaterial&&f(m,p,v)):p.isMeshMatcapMaterial?(s(m,p),g(m,p)):p.isMeshDepthMaterial?s(m,p):p.isMeshDistanceMaterial?(s(m,p),_(m,p)):p.isMeshNormalMaterial?s(m,p):p.isLineBasicMaterial?(a(m,p),p.isLineDashedMaterial&&o(m,p)):p.isPointsMaterial?c(m,p,M,b):p.isSpriteMaterial?l(m,p):p.isShadowMaterial?(m.color.value.copy(p.color),m.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function s(m,p){m.opacity.value=p.opacity,p.color&&m.diffuse.value.copy(p.color),p.emissive&&m.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.bumpMap&&(m.bumpMap.value=p.bumpMap,t(p.bumpMap,m.bumpMapTransform),m.bumpScale.value=p.bumpScale,p.side===Xt&&(m.bumpScale.value*=-1)),p.normalMap&&(m.normalMap.value=p.normalMap,t(p.normalMap,m.normalMapTransform),m.normalScale.value.copy(p.normalScale),p.side===Xt&&m.normalScale.value.negate()),p.displacementMap&&(m.displacementMap.value=p.displacementMap,t(p.displacementMap,m.displacementMapTransform),m.displacementScale.value=p.displacementScale,m.displacementBias.value=p.displacementBias),p.emissiveMap&&(m.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,m.emissiveMapTransform)),p.specularMap&&(m.specularMap.value=p.specularMap,t(p.specularMap,m.specularMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest);const M=e.get(p),b=M.envMap,v=M.envMapRotation;b&&(m.envMap.value=b,li.copy(v),li.x*=-1,li.y*=-1,li.z*=-1,b.isCubeTexture&&b.isRenderTargetTexture===!1&&(li.y*=-1,li.z*=-1),m.envMapRotation.value.setFromMatrix4(Z0.makeRotationFromEuler(li)),m.flipEnvMap.value=b.isCubeTexture&&b.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=p.reflectivity,m.ior.value=p.ior,m.refractionRatio.value=p.refractionRatio),p.lightMap&&(m.lightMap.value=p.lightMap,m.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,m.lightMapTransform)),p.aoMap&&(m.aoMap.value=p.aoMap,m.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,m.aoMapTransform))}function a(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform))}function o(m,p){m.dashSize.value=p.dashSize,m.totalSize.value=p.dashSize+p.gapSize,m.scale.value=p.scale}function c(m,p,M,b){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.size.value=p.size*M,m.scale.value=b*.5,p.map&&(m.map.value=p.map,t(p.map,m.uvTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function l(m,p){m.diffuse.value.copy(p.color),m.opacity.value=p.opacity,m.rotation.value=p.rotation,p.map&&(m.map.value=p.map,t(p.map,m.mapTransform)),p.alphaMap&&(m.alphaMap.value=p.alphaMap,t(p.alphaMap,m.alphaMapTransform)),p.alphaTest>0&&(m.alphaTest.value=p.alphaTest)}function h(m,p){m.specular.value.copy(p.specular),m.shininess.value=Math.max(p.shininess,1e-4)}function u(m,p){p.gradientMap&&(m.gradientMap.value=p.gradientMap)}function d(m,p){m.metalness.value=p.metalness,p.metalnessMap&&(m.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,m.metalnessMapTransform)),m.roughness.value=p.roughness,p.roughnessMap&&(m.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,m.roughnessMapTransform)),p.envMap&&(m.envMapIntensity.value=p.envMapIntensity)}function f(m,p,M){m.ior.value=p.ior,p.sheen>0&&(m.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),m.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(m.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,m.sheenColorMapTransform)),p.sheenRoughnessMap&&(m.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,m.sheenRoughnessMapTransform))),p.clearcoat>0&&(m.clearcoat.value=p.clearcoat,m.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(m.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,m.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(m.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Xt&&m.clearcoatNormalScale.value.negate())),p.dispersion>0&&(m.dispersion.value=p.dispersion),p.iridescence>0&&(m.iridescence.value=p.iridescence,m.iridescenceIOR.value=p.iridescenceIOR,m.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(m.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,m.iridescenceMapTransform)),p.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),p.transmission>0&&(m.transmission.value=p.transmission,m.transmissionSamplerMap.value=M.texture,m.transmissionSamplerSize.value.set(M.width,M.height),p.transmissionMap&&(m.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,m.transmissionMapTransform)),m.thickness.value=p.thickness,p.thicknessMap&&(m.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=p.attenuationDistance,m.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(m.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(m.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=p.specularIntensity,m.specularColor.value.copy(p.specularColor),p.specularColorMap&&(m.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,m.specularColorMapTransform)),p.specularIntensityMap&&(m.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,p){p.matcap&&(m.matcap.value=p.matcap)}function _(m,p){const M=e.get(p).light;m.referencePosition.value.setFromMatrixPosition(M.matrixWorld),m.nearDistance.value=M.shadow.camera.near,m.farDistance.value=M.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function e_(r,e,t,n){let i={},s={},a=[];const o=r.getParameter(r.MAX_UNIFORM_BUFFER_BINDINGS);function c(M,b){const v=b.program;n.uniformBlockBinding(M,v)}function l(M,b){let v=i[M.id];v===void 0&&(g(M),v=h(M),i[M.id]=v,M.addEventListener("dispose",m));const P=b.program;n.updateUBOMapping(M,P);const R=e.render.frame;s[M.id]!==R&&(d(M),s[M.id]=R)}function h(M){const b=u();M.__bindingPointIndex=b;const v=r.createBuffer(),P=M.__size,R=M.usage;return r.bindBuffer(r.UNIFORM_BUFFER,v),r.bufferData(r.UNIFORM_BUFFER,P,R),r.bindBuffer(r.UNIFORM_BUFFER,null),r.bindBufferBase(r.UNIFORM_BUFFER,b,v),v}function u(){for(let M=0;M<o;M++)if(a.indexOf(M)===-1)return a.push(M),M;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(M){const b=i[M.id],v=M.uniforms,P=M.__cache;r.bindBuffer(r.UNIFORM_BUFFER,b);for(let R=0,A=v.length;R<A;R++){const C=Array.isArray(v[R])?v[R]:[v[R]];for(let S=0,x=C.length;S<x;S++){const I=C[S];if(f(I,R,S,P)===!0){const k=I.__offset,O=Array.isArray(I.value)?I.value:[I.value];let X=0;for(let Y=0;Y<O.length;Y++){const W=O[Y],J=_(W);typeof W=="number"||typeof W=="boolean"?(I.__data[0]=W,r.bufferSubData(r.UNIFORM_BUFFER,k+X,I.__data)):W.isMatrix3?(I.__data[0]=W.elements[0],I.__data[1]=W.elements[1],I.__data[2]=W.elements[2],I.__data[3]=0,I.__data[4]=W.elements[3],I.__data[5]=W.elements[4],I.__data[6]=W.elements[5],I.__data[7]=0,I.__data[8]=W.elements[6],I.__data[9]=W.elements[7],I.__data[10]=W.elements[8],I.__data[11]=0):(W.toArray(I.__data,X),X+=J.storage/Float32Array.BYTES_PER_ELEMENT)}r.bufferSubData(r.UNIFORM_BUFFER,k,I.__data)}}}r.bindBuffer(r.UNIFORM_BUFFER,null)}function f(M,b,v,P){const R=M.value,A=b+"_"+v;if(P[A]===void 0)return typeof R=="number"||typeof R=="boolean"?P[A]=R:P[A]=R.clone(),!0;{const C=P[A];if(typeof R=="number"||typeof R=="boolean"){if(C!==R)return P[A]=R,!0}else if(C.equals(R)===!1)return C.copy(R),!0}return!1}function g(M){const b=M.uniforms;let v=0;const P=16;for(let A=0,C=b.length;A<C;A++){const S=Array.isArray(b[A])?b[A]:[b[A]];for(let x=0,I=S.length;x<I;x++){const k=S[x],O=Array.isArray(k.value)?k.value:[k.value];for(let X=0,Y=O.length;X<Y;X++){const W=O[X],J=_(W),H=v%P,ne=H%J.boundary,he=H+ne;v+=ne,he!==0&&P-he<J.storage&&(v+=P-he),k.__data=new Float32Array(J.storage/Float32Array.BYTES_PER_ELEMENT),k.__offset=v,v+=J.storage}}}const R=v%P;return R>0&&(v+=P-R),M.__size=v,M.__cache={},this}function _(M){const b={boundary:0,storage:0};return typeof M=="number"||typeof M=="boolean"?(b.boundary=4,b.storage=4):M.isVector2?(b.boundary=8,b.storage=8):M.isVector3||M.isColor?(b.boundary=16,b.storage=12):M.isVector4?(b.boundary=16,b.storage=16):M.isMatrix3?(b.boundary=48,b.storage=48):M.isMatrix4?(b.boundary=64,b.storage=64):M.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",M),b}function m(M){const b=M.target;b.removeEventListener("dispose",m);const v=a.indexOf(b.__bindingPointIndex);a.splice(v,1),r.deleteBuffer(i[b.id]),delete i[b.id],delete s[b.id]}function p(){for(const M in i)r.deleteBuffer(i[M]);a=[],i={},s={}}return{bind:c,update:l,dispose:p}}class t_{constructor(e={}){const{canvas:t=Du(),context:n=null,depth:i=!0,stencil:s=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reverseDepthBuffer:d=!1}=e;this.isWebGLRenderer=!0;let f;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");f=n.getContextAttributes().alpha}else f=a;const g=new Uint32Array(4),_=new Int32Array(4);let m=null,p=null;const M=[],b=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Qn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const v=this;let P=!1;this._outputColorSpace=wt;let R=0,A=0,C=null,S=-1,x=null;const I=new et,k=new et;let O=null;const X=new Pe(0);let Y=0,W=t.width,J=t.height,H=1,ne=null,he=null;const ve=new et(0,0,W,J),Be=new et(0,0,W,J);let ot=!1;const j=new Ho;let ie=!1,be=!1;const ue=new Oe,Ee=new Oe,Je=new T,Le=new et,mt={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let gt=!1;function Ze(){return C===null?H:1}let L=n;function Ft(E,N){return t.getContext(E,N)}try{const E={alpha:!0,depth:i,stencil:s,antialias:o,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Eo}`),t.addEventListener("webglcontextlost",pe,!1),t.addEventListener("webglcontextrestored",ee,!1),t.addEventListener("webglcontextcreationerror",K,!1),L===null){const N="webgl2";if(L=Ft(N,E),L===null)throw Ft(N)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(E){throw console.error("THREE.WebGLRenderer: "+E.message),E}let Qe,lt,ye,Ke,Ae,He,Et,w,y,F,q,$,G,Me,ae,xe,Se,Z,de,Ie,Ce,se,Ue,D;function oe(){Qe=new ug(L),Qe.init(),se=new j0(L,Qe),lt=new sg(L,Qe,e,se),ye=new X0(L,Qe),lt.reverseDepthBuffer&&d&&ye.buffers.depth.setReversed(!0),Ke=new pg(L),Ae=new L0,He=new q0(L,Qe,ye,Ae,lt,se,Ke),Et=new ag(v),w=new hg(v),y=new yf(L),Ue=new ng(L,y),F=new dg(L,y,Ke,Ue),q=new gg(L,F,y,Ke),de=new mg(L,lt,He),xe=new rg(Ae),$=new I0(v,Et,w,Qe,lt,Ue,xe),G=new Q0(v,Ae),Me=new N0,ae=new z0(Qe),Z=new tg(v,Et,w,ye,q,f,c),Se=new G0(v,q,lt),D=new e_(L,Ke,lt,ye),Ie=new ig(L,Qe,Ke),Ce=new fg(L,Qe,Ke),Ke.programs=$.programs,v.capabilities=lt,v.extensions=Qe,v.properties=Ae,v.renderLists=Me,v.shadowMap=Se,v.state=ye,v.info=Ke}oe();const Q=new J0(v,L);this.xr=Q,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){const E=Qe.get("WEBGL_lose_context");E&&E.loseContext()},this.forceContextRestore=function(){const E=Qe.get("WEBGL_lose_context");E&&E.restoreContext()},this.getPixelRatio=function(){return H},this.setPixelRatio=function(E){E!==void 0&&(H=E,this.setSize(W,J,!1))},this.getSize=function(E){return E.set(W,J)},this.setSize=function(E,N,B=!0){if(Q.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}W=E,J=N,t.width=Math.floor(E*H),t.height=Math.floor(N*H),B===!0&&(t.style.width=E+"px",t.style.height=N+"px"),this.setViewport(0,0,E,N)},this.getDrawingBufferSize=function(E){return E.set(W*H,J*H).floor()},this.setDrawingBufferSize=function(E,N,B){W=E,J=N,H=B,t.width=Math.floor(E*B),t.height=Math.floor(N*B),this.setViewport(0,0,E,N)},this.getCurrentViewport=function(E){return E.copy(I)},this.getViewport=function(E){return E.copy(ve)},this.setViewport=function(E,N,B,z){E.isVector4?ve.set(E.x,E.y,E.z,E.w):ve.set(E,N,B,z),ye.viewport(I.copy(ve).multiplyScalar(H).round())},this.getScissor=function(E){return E.copy(Be)},this.setScissor=function(E,N,B,z){E.isVector4?Be.set(E.x,E.y,E.z,E.w):Be.set(E,N,B,z),ye.scissor(k.copy(Be).multiplyScalar(H).round())},this.getScissorTest=function(){return ot},this.setScissorTest=function(E){ye.setScissorTest(ot=E)},this.setOpaqueSort=function(E){ne=E},this.setTransparentSort=function(E){he=E},this.getClearColor=function(E){return E.copy(Z.getClearColor())},this.setClearColor=function(){Z.setClearColor(...arguments)},this.getClearAlpha=function(){return Z.getClearAlpha()},this.setClearAlpha=function(){Z.setClearAlpha(...arguments)},this.clear=function(E=!0,N=!0,B=!0){let z=0;if(E){let U=!1;if(C!==null){const te=C.texture.format;U=te===Io||te===Po||te===Co}if(U){const te=C.texture.type,ce=te===Sn||te===_i||te===As||te===Rs||te===wo||te===Ao,_e=Z.getClearColor(),fe=Z.getClearAlpha(),De=_e.r,Ne=_e.g,Te=_e.b;ce?(g[0]=De,g[1]=Ne,g[2]=Te,g[3]=fe,L.clearBufferuiv(L.COLOR,0,g)):(_[0]=De,_[1]=Ne,_[2]=Te,_[3]=fe,L.clearBufferiv(L.COLOR,0,_))}else z|=L.COLOR_BUFFER_BIT}N&&(z|=L.DEPTH_BUFFER_BIT),B&&(z|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),L.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",pe,!1),t.removeEventListener("webglcontextrestored",ee,!1),t.removeEventListener("webglcontextcreationerror",K,!1),Z.dispose(),Me.dispose(),ae.dispose(),Ae.dispose(),Et.dispose(),w.dispose(),q.dispose(),Ue.dispose(),D.dispose(),$.dispose(),Q.dispose(),Q.removeEventListener("sessionstart",Ko),Q.removeEventListener("sessionend",$o),ni.stop()};function pe(E){E.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),P=!0}function ee(){console.log("THREE.WebGLRenderer: Context Restored."),P=!1;const E=Ke.autoReset,N=Se.enabled,B=Se.autoUpdate,z=Se.needsUpdate,U=Se.type;oe(),Ke.autoReset=E,Se.enabled=N,Se.autoUpdate=B,Se.needsUpdate=z,Se.type=U}function K(E){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",E.statusMessage)}function ge(E){const N=E.target;N.removeEventListener("dispose",ge),Fe(N)}function Fe(E){ht(E),Ae.remove(E)}function ht(E){const N=Ae.get(E).programs;N!==void 0&&(N.forEach(function(B){$.releaseProgram(B)}),E.isShaderMaterial&&$.releaseShaderCache(E))}this.renderBufferDirect=function(E,N,B,z,U,te){N===null&&(N=mt);const ce=U.isMesh&&U.matrixWorld.determinant()<0,_e=bh(E,N,B,z,U);ye.setMaterial(z,ce);let fe=B.index,De=1;if(z.wireframe===!0){if(fe=F.getWireframeAttribute(B),fe===void 0)return;De=2}const Ne=B.drawRange,Te=B.attributes.position;let qe=Ne.start*De,rt=(Ne.start+Ne.count)*De;te!==null&&(qe=Math.max(qe,te.start*De),rt=Math.min(rt,(te.start+te.count)*De)),fe!==null?(qe=Math.max(qe,0),rt=Math.min(rt,fe.count)):Te!=null&&(qe=Math.max(qe,0),rt=Math.min(rt,Te.count));const vt=rt-qe;if(vt<0||vt===1/0)return;Ue.setup(U,z,_e,B,fe);let ut,ct=Ie;if(fe!==null&&(ut=y.get(fe),ct=Ce,ct.setIndex(ut)),U.isMesh)z.wireframe===!0?(ye.setLineWidth(z.wireframeLinewidth*Ze()),ct.setMode(L.LINES)):ct.setMode(L.TRIANGLES);else if(U.isLine){let Re=z.linewidth;Re===void 0&&(Re=1),ye.setLineWidth(Re*Ze()),U.isLineSegments?ct.setMode(L.LINES):U.isLineLoop?ct.setMode(L.LINE_LOOP):ct.setMode(L.LINE_STRIP)}else U.isPoints?ct.setMode(L.POINTS):U.isSprite&&ct.setMode(L.TRIANGLES);if(U.isBatchedMesh)if(U._multiDrawInstances!==null)Gi("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),ct.renderMultiDrawInstances(U._multiDrawStarts,U._multiDrawCounts,U._multiDrawCount,U._multiDrawInstances);else if(Qe.get("WEBGL_multi_draw"))ct.renderMultiDraw(U._multiDrawStarts,U._multiDrawCounts,U._multiDrawCount);else{const Re=U._multiDrawStarts,_t=U._multiDrawCounts,$e=U._multiDrawCount,qt=fe?y.get(fe).bytesPerElement:1,yi=Ae.get(z).currentProgram.getUniforms();for(let jt=0;jt<$e;jt++)yi.setValue(L,"_gl_DrawID",jt),ct.render(Re[jt]/qt,_t[jt])}else if(U.isInstancedMesh)ct.renderInstances(qe,vt,U.count);else if(B.isInstancedBufferGeometry){const Re=B._maxInstanceCount!==void 0?B._maxInstanceCount:1/0,_t=Math.min(B.instanceCount,Re);ct.renderInstances(qe,vt,_t)}else ct.render(qe,vt)};function it(E,N,B){E.transparent===!0&&E.side===xt&&E.forceSinglePass===!1?(E.side=Xt,E.needsUpdate=!0,ks(E,N,B),E.side=Mn,E.needsUpdate=!0,ks(E,N,B),E.side=xt):ks(E,N,B)}this.compile=function(E,N,B=null){B===null&&(B=E),p=ae.get(B),p.init(N),b.push(p),B.traverseVisible(function(U){U.isLight&&U.layers.test(N.layers)&&(p.pushLight(U),U.castShadow&&p.pushShadow(U))}),E!==B&&E.traverseVisible(function(U){U.isLight&&U.layers.test(N.layers)&&(p.pushLight(U),U.castShadow&&p.pushShadow(U))}),p.setupLights();const z=new Set;return E.traverse(function(U){if(!(U.isMesh||U.isPoints||U.isLine||U.isSprite))return;const te=U.material;if(te)if(Array.isArray(te))for(let ce=0;ce<te.length;ce++){const _e=te[ce];it(_e,B,U),z.add(_e)}else it(te,B,U),z.add(te)}),p=b.pop(),z},this.compileAsync=function(E,N,B=null){const z=this.compile(E,N,B);return new Promise(U=>{function te(){if(z.forEach(function(ce){Ae.get(ce).currentProgram.isReady()&&z.delete(ce)}),z.size===0){U(E);return}setTimeout(te,10)}Qe.get("KHR_parallel_shader_compile")!==null?te():setTimeout(te,10)})};let on=null;function Tn(E){on&&on(E)}function Ko(){ni.stop()}function $o(){ni.start()}const ni=new dh;ni.setAnimationLoop(Tn),typeof self<"u"&&ni.setContext(self),this.setAnimationLoop=function(E){on=E,Q.setAnimationLoop(E),E===null?ni.stop():ni.start()},Q.addEventListener("sessionstart",Ko),Q.addEventListener("sessionend",$o),this.render=function(E,N){if(N!==void 0&&N.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;if(E.matrixWorldAutoUpdate===!0&&E.updateMatrixWorld(),N.parent===null&&N.matrixWorldAutoUpdate===!0&&N.updateMatrixWorld(),Q.enabled===!0&&Q.isPresenting===!0&&(Q.cameraAutoUpdate===!0&&Q.updateCamera(N),N=Q.getCamera()),E.isScene===!0&&E.onBeforeRender(v,E,N,C),p=ae.get(E,b.length),p.init(N),b.push(p),Ee.multiplyMatrices(N.projectionMatrix,N.matrixWorldInverse),j.setFromProjectionMatrix(Ee),be=this.localClippingEnabled,ie=xe.init(this.clippingPlanes,be),m=Me.get(E,M.length),m.init(),M.push(m),Q.enabled===!0&&Q.isPresenting===!0){const te=v.xr.getDepthSensingMesh();te!==null&&Fr(te,N,-1/0,v.sortObjects)}Fr(E,N,0,v.sortObjects),m.finish(),v.sortObjects===!0&&m.sort(ne,he),gt=Q.enabled===!1||Q.isPresenting===!1||Q.hasDepthSensing()===!1,gt&&Z.addToRenderList(m,E),this.info.render.frame++,ie===!0&&xe.beginShadows();const B=p.state.shadowsArray;Se.render(B,E,N),ie===!0&&xe.endShadows(),this.info.autoReset===!0&&this.info.reset();const z=m.opaque,U=m.transmissive;if(p.setupLights(),N.isArrayCamera){const te=N.cameras;if(U.length>0)for(let ce=0,_e=te.length;ce<_e;ce++){const fe=te[ce];Zo(z,U,E,fe)}gt&&Z.render(E);for(let ce=0,_e=te.length;ce<_e;ce++){const fe=te[ce];Jo(m,E,fe,fe.viewport)}}else U.length>0&&Zo(z,U,E,N),gt&&Z.render(E),Jo(m,E,N);C!==null&&A===0&&(He.updateMultisampleRenderTarget(C),He.updateRenderTargetMipmap(C)),E.isScene===!0&&E.onAfterRender(v,E,N),Ue.resetDefaultState(),S=-1,x=null,b.pop(),b.length>0?(p=b[b.length-1],ie===!0&&xe.setGlobalState(v.clippingPlanes,p.state.camera)):p=null,M.pop(),M.length>0?m=M[M.length-1]:m=null};function Fr(E,N,B,z){if(E.visible===!1)return;if(E.layers.test(N.layers)){if(E.isGroup)B=E.renderOrder;else if(E.isLOD)E.autoUpdate===!0&&E.update(N);else if(E.isLight)p.pushLight(E),E.castShadow&&p.pushShadow(E);else if(E.isSprite){if(!E.frustumCulled||j.intersectsSprite(E)){z&&Le.setFromMatrixPosition(E.matrixWorld).applyMatrix4(Ee);const ce=q.update(E),_e=E.material;_e.visible&&m.push(E,ce,_e,B,Le.z,null)}}else if((E.isMesh||E.isLine||E.isPoints)&&(!E.frustumCulled||j.intersectsObject(E))){const ce=q.update(E),_e=E.material;if(z&&(E.boundingSphere!==void 0?(E.boundingSphere===null&&E.computeBoundingSphere(),Le.copy(E.boundingSphere.center)):(ce.boundingSphere===null&&ce.computeBoundingSphere(),Le.copy(ce.boundingSphere.center)),Le.applyMatrix4(E.matrixWorld).applyMatrix4(Ee)),Array.isArray(_e)){const fe=ce.groups;for(let De=0,Ne=fe.length;De<Ne;De++){const Te=fe[De],qe=_e[Te.materialIndex];qe&&qe.visible&&m.push(E,ce,qe,B,Le.z,Te)}}else _e.visible&&m.push(E,ce,_e,B,Le.z,null)}}const te=E.children;for(let ce=0,_e=te.length;ce<_e;ce++)Fr(te[ce],N,B,z)}function Jo(E,N,B,z){const U=E.opaque,te=E.transmissive,ce=E.transparent;p.setupLightsView(B),ie===!0&&xe.setGlobalState(v.clippingPlanes,B),z&&ye.viewport(I.copy(z)),U.length>0&&Bs(U,N,B),te.length>0&&Bs(te,N,B),ce.length>0&&Bs(ce,N,B),ye.buffers.depth.setTest(!0),ye.buffers.depth.setMask(!0),ye.buffers.color.setMask(!0),ye.setPolygonOffset(!1)}function Zo(E,N,B,z){if((B.isScene===!0?B.overrideMaterial:null)!==null)return;p.state.transmissionRenderTarget[z.id]===void 0&&(p.state.transmissionRenderTarget[z.id]=new vi(1,1,{generateMipmaps:!0,type:Qe.has("EXT_color_buffer_half_float")||Qe.has("EXT_color_buffer_float")?Ns:Sn,minFilter:Nn,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Ye.workingColorSpace}));const te=p.state.transmissionRenderTarget[z.id],ce=z.viewport||I;te.setSize(ce.z*v.transmissionResolutionScale,ce.w*v.transmissionResolutionScale);const _e=v.getRenderTarget(),fe=v.getActiveCubeFace(),De=v.getActiveMipmapLevel();v.setRenderTarget(te),v.getClearColor(X),Y=v.getClearAlpha(),Y<1&&v.setClearColor(16777215,.5),v.clear(),gt&&Z.render(B);const Ne=v.toneMapping;v.toneMapping=Qn;const Te=z.viewport;if(z.viewport!==void 0&&(z.viewport=void 0),p.setupLightsView(z),ie===!0&&xe.setGlobalState(v.clippingPlanes,z),Bs(E,B,z),He.updateMultisampleRenderTarget(te),He.updateRenderTargetMipmap(te),Qe.has("WEBGL_multisampled_render_to_texture")===!1){let qe=!1;for(let rt=0,vt=N.length;rt<vt;rt++){const ut=N[rt],ct=ut.object,Re=ut.geometry,_t=ut.material,$e=ut.group;if(_t.side===xt&&ct.layers.test(z.layers)){const qt=_t.side;_t.side=Xt,_t.needsUpdate=!0,Qo(ct,B,z,Re,_t,$e),_t.side=qt,_t.needsUpdate=!0,qe=!0}}qe===!0&&(He.updateMultisampleRenderTarget(te),He.updateRenderTargetMipmap(te))}v.setRenderTarget(_e,fe,De),v.setClearColor(X,Y),Te!==void 0&&(z.viewport=Te),v.toneMapping=Ne}function Bs(E,N,B){const z=N.isScene===!0?N.overrideMaterial:null;for(let U=0,te=E.length;U<te;U++){const ce=E[U],_e=ce.object,fe=ce.geometry,De=ce.group;let Ne=ce.material;Ne.allowOverride===!0&&z!==null&&(Ne=z),_e.layers.test(B.layers)&&Qo(_e,N,B,fe,Ne,De)}}function Qo(E,N,B,z,U,te){E.onBeforeRender(v,N,B,z,U,te),E.modelViewMatrix.multiplyMatrices(B.matrixWorldInverse,E.matrixWorld),E.normalMatrix.getNormalMatrix(E.modelViewMatrix),U.onBeforeRender(v,N,B,z,E,te),U.transparent===!0&&U.side===xt&&U.forceSinglePass===!1?(U.side=Xt,U.needsUpdate=!0,v.renderBufferDirect(B,N,z,U,E,te),U.side=Mn,U.needsUpdate=!0,v.renderBufferDirect(B,N,z,U,E,te),U.side=xt):v.renderBufferDirect(B,N,z,U,E,te),E.onAfterRender(v,N,B,z,U,te)}function ks(E,N,B){N.isScene!==!0&&(N=mt);const z=Ae.get(E),U=p.state.lights,te=p.state.shadowsArray,ce=U.state.version,_e=$.getParameters(E,U.state,te,N,B),fe=$.getProgramCacheKey(_e);let De=z.programs;z.environment=E.isMeshStandardMaterial?N.environment:null,z.fog=N.fog,z.envMap=(E.isMeshStandardMaterial?w:Et).get(E.envMap||z.environment),z.envMapRotation=z.environment!==null&&E.envMap===null?N.environmentRotation:E.envMapRotation,De===void 0&&(E.addEventListener("dispose",ge),De=new Map,z.programs=De);let Ne=De.get(fe);if(Ne!==void 0){if(z.currentProgram===Ne&&z.lightsStateVersion===ce)return tc(E,_e),Ne}else _e.uniforms=$.getUniforms(E),E.onBeforeCompile(_e,v),Ne=$.acquireProgram(_e,fe),De.set(fe,Ne),z.uniforms=_e.uniforms;const Te=z.uniforms;return(!E.isShaderMaterial&&!E.isRawShaderMaterial||E.clipping===!0)&&(Te.clippingPlanes=xe.uniform),tc(E,_e),z.needsLights=Th(E),z.lightsStateVersion=ce,z.needsLights&&(Te.ambientLightColor.value=U.state.ambient,Te.lightProbe.value=U.state.probe,Te.directionalLights.value=U.state.directional,Te.directionalLightShadows.value=U.state.directionalShadow,Te.spotLights.value=U.state.spot,Te.spotLightShadows.value=U.state.spotShadow,Te.rectAreaLights.value=U.state.rectArea,Te.ltc_1.value=U.state.rectAreaLTC1,Te.ltc_2.value=U.state.rectAreaLTC2,Te.pointLights.value=U.state.point,Te.pointLightShadows.value=U.state.pointShadow,Te.hemisphereLights.value=U.state.hemi,Te.directionalShadowMap.value=U.state.directionalShadowMap,Te.directionalShadowMatrix.value=U.state.directionalShadowMatrix,Te.spotShadowMap.value=U.state.spotShadowMap,Te.spotLightMatrix.value=U.state.spotLightMatrix,Te.spotLightMap.value=U.state.spotLightMap,Te.pointShadowMap.value=U.state.pointShadowMap,Te.pointShadowMatrix.value=U.state.pointShadowMatrix),z.currentProgram=Ne,z.uniformsList=null,Ne}function ec(E){if(E.uniformsList===null){const N=E.currentProgram.getUniforms();E.uniformsList=br.seqWithValue(N.seq,E.uniforms)}return E.uniformsList}function tc(E,N){const B=Ae.get(E);B.outputColorSpace=N.outputColorSpace,B.batching=N.batching,B.batchingColor=N.batchingColor,B.instancing=N.instancing,B.instancingColor=N.instancingColor,B.instancingMorph=N.instancingMorph,B.skinning=N.skinning,B.morphTargets=N.morphTargets,B.morphNormals=N.morphNormals,B.morphColors=N.morphColors,B.morphTargetsCount=N.morphTargetsCount,B.numClippingPlanes=N.numClippingPlanes,B.numIntersection=N.numClipIntersection,B.vertexAlphas=N.vertexAlphas,B.vertexTangents=N.vertexTangents,B.toneMapping=N.toneMapping}function bh(E,N,B,z,U){N.isScene!==!0&&(N=mt),He.resetTextureUnits();const te=N.fog,ce=z.isMeshStandardMaterial?N.environment:null,_e=C===null?v.outputColorSpace:C.isXRRenderTarget===!0?C.texture.colorSpace:zt,fe=(z.isMeshStandardMaterial?w:Et).get(z.envMap||ce),De=z.vertexColors===!0&&!!B.attributes.color&&B.attributes.color.itemSize===4,Ne=!!B.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),Te=!!B.morphAttributes.position,qe=!!B.morphAttributes.normal,rt=!!B.morphAttributes.color;let vt=Qn;z.toneMapped&&(C===null||C.isXRRenderTarget===!0)&&(vt=v.toneMapping);const ut=B.morphAttributes.position||B.morphAttributes.normal||B.morphAttributes.color,ct=ut!==void 0?ut.length:0,Re=Ae.get(z),_t=p.state.lights;if(ie===!0&&(be===!0||E!==x)){const Ot=E===x&&z.id===S;xe.setState(z,E,Ot)}let $e=!1;z.version===Re.__version?(Re.needsLights&&Re.lightsStateVersion!==_t.state.version||Re.outputColorSpace!==_e||U.isBatchedMesh&&Re.batching===!1||!U.isBatchedMesh&&Re.batching===!0||U.isBatchedMesh&&Re.batchingColor===!0&&U.colorTexture===null||U.isBatchedMesh&&Re.batchingColor===!1&&U.colorTexture!==null||U.isInstancedMesh&&Re.instancing===!1||!U.isInstancedMesh&&Re.instancing===!0||U.isSkinnedMesh&&Re.skinning===!1||!U.isSkinnedMesh&&Re.skinning===!0||U.isInstancedMesh&&Re.instancingColor===!0&&U.instanceColor===null||U.isInstancedMesh&&Re.instancingColor===!1&&U.instanceColor!==null||U.isInstancedMesh&&Re.instancingMorph===!0&&U.morphTexture===null||U.isInstancedMesh&&Re.instancingMorph===!1&&U.morphTexture!==null||Re.envMap!==fe||z.fog===!0&&Re.fog!==te||Re.numClippingPlanes!==void 0&&(Re.numClippingPlanes!==xe.numPlanes||Re.numIntersection!==xe.numIntersection)||Re.vertexAlphas!==De||Re.vertexTangents!==Ne||Re.morphTargets!==Te||Re.morphNormals!==qe||Re.morphColors!==rt||Re.toneMapping!==vt||Re.morphTargetsCount!==ct)&&($e=!0):($e=!0,Re.__version=z.version);let qt=Re.currentProgram;$e===!0&&(qt=ks(z,N,U));let yi=!1,jt=!1,as=!1;const dt=qt.getUniforms(),tn=Re.uniforms;if(ye.useProgram(qt.program)&&(yi=!0,jt=!0,as=!0),z.id!==S&&(S=z.id,jt=!0),yi||x!==E){ye.buffers.depth.getReversed()?(ue.copy(E.projectionMatrix),Uu(ue),Fu(ue),dt.setValue(L,"projectionMatrix",ue)):dt.setValue(L,"projectionMatrix",E.projectionMatrix),dt.setValue(L,"viewMatrix",E.matrixWorldInverse);const Ht=dt.map.cameraPosition;Ht!==void 0&&Ht.setValue(L,Je.setFromMatrixPosition(E.matrixWorld)),lt.logarithmicDepthBuffer&&dt.setValue(L,"logDepthBufFC",2/(Math.log(E.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&dt.setValue(L,"isOrthographic",E.isOrthographicCamera===!0),x!==E&&(x=E,jt=!0,as=!0)}if(U.isSkinnedMesh){dt.setOptional(L,U,"bindMatrix"),dt.setOptional(L,U,"bindMatrixInverse");const Ot=U.skeleton;Ot&&(Ot.boneTexture===null&&Ot.computeBoneTexture(),dt.setValue(L,"boneTexture",Ot.boneTexture,He))}U.isBatchedMesh&&(dt.setOptional(L,U,"batchingTexture"),dt.setValue(L,"batchingTexture",U._matricesTexture,He),dt.setOptional(L,U,"batchingIdTexture"),dt.setValue(L,"batchingIdTexture",U._indirectTexture,He),dt.setOptional(L,U,"batchingColorTexture"),U._colorsTexture!==null&&dt.setValue(L,"batchingColorTexture",U._colorsTexture,He));const nn=B.morphAttributes;if((nn.position!==void 0||nn.normal!==void 0||nn.color!==void 0)&&de.update(U,B,qt),(jt||Re.receiveShadow!==U.receiveShadow)&&(Re.receiveShadow=U.receiveShadow,dt.setValue(L,"receiveShadow",U.receiveShadow)),z.isMeshGouraudMaterial&&z.envMap!==null&&(tn.envMap.value=fe,tn.flipEnvMap.value=fe.isCubeTexture&&fe.isRenderTargetTexture===!1?-1:1),z.isMeshStandardMaterial&&z.envMap===null&&N.environment!==null&&(tn.envMapIntensity.value=N.environmentIntensity),jt&&(dt.setValue(L,"toneMappingExposure",v.toneMappingExposure),Re.needsLights&&Eh(tn,as),te&&z.fog===!0&&G.refreshFogUniforms(tn,te),G.refreshMaterialUniforms(tn,z,H,J,p.state.transmissionRenderTarget[E.id]),br.upload(L,ec(Re),tn,He)),z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&(br.upload(L,ec(Re),tn,He),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&dt.setValue(L,"center",U.center),dt.setValue(L,"modelViewMatrix",U.modelViewMatrix),dt.setValue(L,"normalMatrix",U.normalMatrix),dt.setValue(L,"modelMatrix",U.matrixWorld),z.isShaderMaterial||z.isRawShaderMaterial){const Ot=z.uniformsGroups;for(let Ht=0,Or=Ot.length;Ht<Or;Ht++){const ii=Ot[Ht];D.update(ii,qt),D.bind(ii,qt)}}return qt}function Eh(E,N){E.ambientLightColor.needsUpdate=N,E.lightProbe.needsUpdate=N,E.directionalLights.needsUpdate=N,E.directionalLightShadows.needsUpdate=N,E.pointLights.needsUpdate=N,E.pointLightShadows.needsUpdate=N,E.spotLights.needsUpdate=N,E.spotLightShadows.needsUpdate=N,E.rectAreaLights.needsUpdate=N,E.hemisphereLights.needsUpdate=N}function Th(E){return E.isMeshLambertMaterial||E.isMeshToonMaterial||E.isMeshPhongMaterial||E.isMeshStandardMaterial||E.isShadowMaterial||E.isShaderMaterial&&E.lights===!0}this.getActiveCubeFace=function(){return R},this.getActiveMipmapLevel=function(){return A},this.getRenderTarget=function(){return C},this.setRenderTargetTextures=function(E,N,B){const z=Ae.get(E);z.__autoAllocateDepthBuffer=E.resolveDepthBuffer===!1,z.__autoAllocateDepthBuffer===!1&&(z.__useRenderToTexture=!1),Ae.get(E.texture).__webglTexture=N,Ae.get(E.depthTexture).__webglTexture=z.__autoAllocateDepthBuffer?void 0:B,z.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(E,N){const B=Ae.get(E);B.__webglFramebuffer=N,B.__useDefaultFramebuffer=N===void 0};const wh=L.createFramebuffer();this.setRenderTarget=function(E,N=0,B=0){C=E,R=N,A=B;let z=!0,U=null,te=!1,ce=!1;if(E){const fe=Ae.get(E);if(fe.__useDefaultFramebuffer!==void 0)ye.bindFramebuffer(L.FRAMEBUFFER,null),z=!1;else if(fe.__webglFramebuffer===void 0)He.setupRenderTarget(E);else if(fe.__hasExternalTextures)He.rebindTextures(E,Ae.get(E.texture).__webglTexture,Ae.get(E.depthTexture).__webglTexture);else if(E.depthBuffer){const Te=E.depthTexture;if(fe.__boundDepthTexture!==Te){if(Te!==null&&Ae.has(Te)&&(E.width!==Te.image.width||E.height!==Te.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");He.setupDepthRenderbuffer(E)}}const De=E.texture;(De.isData3DTexture||De.isDataArrayTexture||De.isCompressedArrayTexture)&&(ce=!0);const Ne=Ae.get(E).__webglFramebuffer;E.isWebGLCubeRenderTarget?(Array.isArray(Ne[N])?U=Ne[N][B]:U=Ne[N],te=!0):E.samples>0&&He.useMultisampledRTT(E)===!1?U=Ae.get(E).__webglMultisampledFramebuffer:Array.isArray(Ne)?U=Ne[B]:U=Ne,I.copy(E.viewport),k.copy(E.scissor),O=E.scissorTest}else I.copy(ve).multiplyScalar(H).floor(),k.copy(Be).multiplyScalar(H).floor(),O=ot;if(B!==0&&(U=wh),ye.bindFramebuffer(L.FRAMEBUFFER,U)&&z&&ye.drawBuffers(E,U),ye.viewport(I),ye.scissor(k),ye.setScissorTest(O),te){const fe=Ae.get(E.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+N,fe.__webglTexture,B)}else if(ce){const fe=Ae.get(E.texture),De=N;L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,fe.__webglTexture,B,De)}else if(E!==null&&B!==0){const fe=Ae.get(E.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,fe.__webglTexture,B)}S=-1},this.readRenderTargetPixels=function(E,N,B,z,U,te,ce,_e=0){if(!(E&&E.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let fe=Ae.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&ce!==void 0&&(fe=fe[ce]),fe){ye.bindFramebuffer(L.FRAMEBUFFER,fe);try{const De=E.textures[_e],Ne=De.format,Te=De.type;if(!lt.textureFormatReadable(Ne)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!lt.textureTypeReadable(Te)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}N>=0&&N<=E.width-z&&B>=0&&B<=E.height-U&&(E.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+_e),L.readPixels(N,B,z,U,se.convert(Ne),se.convert(Te),te))}finally{const De=C!==null?Ae.get(C).__webglFramebuffer:null;ye.bindFramebuffer(L.FRAMEBUFFER,De)}}},this.readRenderTargetPixelsAsync=async function(E,N,B,z,U,te,ce,_e=0){if(!(E&&E.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let fe=Ae.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&ce!==void 0&&(fe=fe[ce]),fe)if(N>=0&&N<=E.width-z&&B>=0&&B<=E.height-U){ye.bindFramebuffer(L.FRAMEBUFFER,fe);const De=E.textures[_e],Ne=De.format,Te=De.type;if(!lt.textureFormatReadable(Ne))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!lt.textureTypeReadable(Te))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const qe=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,qe),L.bufferData(L.PIXEL_PACK_BUFFER,te.byteLength,L.STREAM_READ),E.textures.length>1&&L.readBuffer(L.COLOR_ATTACHMENT0+_e),L.readPixels(N,B,z,U,se.convert(Ne),se.convert(Te),0);const rt=C!==null?Ae.get(C).__webglFramebuffer:null;ye.bindFramebuffer(L.FRAMEBUFFER,rt);const vt=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await Nu(L,vt,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,qe),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,te),L.deleteBuffer(qe),L.deleteSync(vt),te}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(E,N=null,B=0){const z=Math.pow(2,-B),U=Math.floor(E.image.width*z),te=Math.floor(E.image.height*z),ce=N!==null?N.x:0,_e=N!==null?N.y:0;He.setTexture2D(E,0),L.copyTexSubImage2D(L.TEXTURE_2D,B,0,0,ce,_e,U,te),ye.unbindTexture()};const Ah=L.createFramebuffer(),Rh=L.createFramebuffer();this.copyTextureToTexture=function(E,N,B=null,z=null,U=0,te=null){te===null&&(U!==0?(Gi("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),te=U,U=0):te=0);let ce,_e,fe,De,Ne,Te,qe,rt,vt;const ut=E.isCompressedTexture?E.mipmaps[te]:E.image;if(B!==null)ce=B.max.x-B.min.x,_e=B.max.y-B.min.y,fe=B.isBox3?B.max.z-B.min.z:1,De=B.min.x,Ne=B.min.y,Te=B.isBox3?B.min.z:0;else{const nn=Math.pow(2,-U);ce=Math.floor(ut.width*nn),_e=Math.floor(ut.height*nn),E.isDataArrayTexture?fe=ut.depth:E.isData3DTexture?fe=Math.floor(ut.depth*nn):fe=1,De=0,Ne=0,Te=0}z!==null?(qe=z.x,rt=z.y,vt=z.z):(qe=0,rt=0,vt=0);const ct=se.convert(N.format),Re=se.convert(N.type);let _t;N.isData3DTexture?(He.setTexture3D(N,0),_t=L.TEXTURE_3D):N.isDataArrayTexture||N.isCompressedArrayTexture?(He.setTexture2DArray(N,0),_t=L.TEXTURE_2D_ARRAY):(He.setTexture2D(N,0),_t=L.TEXTURE_2D),L.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,N.flipY),L.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,N.premultiplyAlpha),L.pixelStorei(L.UNPACK_ALIGNMENT,N.unpackAlignment);const $e=L.getParameter(L.UNPACK_ROW_LENGTH),qt=L.getParameter(L.UNPACK_IMAGE_HEIGHT),yi=L.getParameter(L.UNPACK_SKIP_PIXELS),jt=L.getParameter(L.UNPACK_SKIP_ROWS),as=L.getParameter(L.UNPACK_SKIP_IMAGES);L.pixelStorei(L.UNPACK_ROW_LENGTH,ut.width),L.pixelStorei(L.UNPACK_IMAGE_HEIGHT,ut.height),L.pixelStorei(L.UNPACK_SKIP_PIXELS,De),L.pixelStorei(L.UNPACK_SKIP_ROWS,Ne),L.pixelStorei(L.UNPACK_SKIP_IMAGES,Te);const dt=E.isDataArrayTexture||E.isData3DTexture,tn=N.isDataArrayTexture||N.isData3DTexture;if(E.isDepthTexture){const nn=Ae.get(E),Ot=Ae.get(N),Ht=Ae.get(nn.__renderTarget),Or=Ae.get(Ot.__renderTarget);ye.bindFramebuffer(L.READ_FRAMEBUFFER,Ht.__webglFramebuffer),ye.bindFramebuffer(L.DRAW_FRAMEBUFFER,Or.__webglFramebuffer);for(let ii=0;ii<fe;ii++)dt&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Ae.get(E).__webglTexture,U,Te+ii),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Ae.get(N).__webglTexture,te,vt+ii)),L.blitFramebuffer(De,Ne,ce,_e,qe,rt,ce,_e,L.DEPTH_BUFFER_BIT,L.NEAREST);ye.bindFramebuffer(L.READ_FRAMEBUFFER,null),ye.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(U!==0||E.isRenderTargetTexture||Ae.has(E)){const nn=Ae.get(E),Ot=Ae.get(N);ye.bindFramebuffer(L.READ_FRAMEBUFFER,Ah),ye.bindFramebuffer(L.DRAW_FRAMEBUFFER,Rh);for(let Ht=0;Ht<fe;Ht++)dt?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,nn.__webglTexture,U,Te+Ht):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,nn.__webglTexture,U),tn?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Ot.__webglTexture,te,vt+Ht):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,Ot.__webglTexture,te),U!==0?L.blitFramebuffer(De,Ne,ce,_e,qe,rt,ce,_e,L.COLOR_BUFFER_BIT,L.NEAREST):tn?L.copyTexSubImage3D(_t,te,qe,rt,vt+Ht,De,Ne,ce,_e):L.copyTexSubImage2D(_t,te,qe,rt,De,Ne,ce,_e);ye.bindFramebuffer(L.READ_FRAMEBUFFER,null),ye.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else tn?E.isDataTexture||E.isData3DTexture?L.texSubImage3D(_t,te,qe,rt,vt,ce,_e,fe,ct,Re,ut.data):N.isCompressedArrayTexture?L.compressedTexSubImage3D(_t,te,qe,rt,vt,ce,_e,fe,ct,ut.data):L.texSubImage3D(_t,te,qe,rt,vt,ce,_e,fe,ct,Re,ut):E.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,te,qe,rt,ce,_e,ct,Re,ut.data):E.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,te,qe,rt,ut.width,ut.height,ct,ut.data):L.texSubImage2D(L.TEXTURE_2D,te,qe,rt,ce,_e,ct,Re,ut);L.pixelStorei(L.UNPACK_ROW_LENGTH,$e),L.pixelStorei(L.UNPACK_IMAGE_HEIGHT,qt),L.pixelStorei(L.UNPACK_SKIP_PIXELS,yi),L.pixelStorei(L.UNPACK_SKIP_ROWS,jt),L.pixelStorei(L.UNPACK_SKIP_IMAGES,as),te===0&&N.generateMipmaps&&L.generateMipmap(_t),ye.unbindTexture()},this.copyTextureToTexture3D=function(E,N,B=null,z=null,U=0){return Gi('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(E,N,B,z,U)},this.initRenderTarget=function(E){Ae.get(E).__webglFramebuffer===void 0&&He.setupRenderTarget(E)},this.initTexture=function(E){E.isCubeTexture?He.setTextureCube(E,0):E.isData3DTexture?He.setTexture3D(E,0):E.isDataArrayTexture||E.isCompressedArrayTexture?He.setTexture2DArray(E,0):He.setTexture2D(E,0),ye.unbindTexture()},this.resetState=function(){R=0,A=0,C=null,ye.reset(),Ue.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return Un}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=Ye._getDrawingBufferColorSpace(e),t.unpackColorSpace=Ye._getUnpackColorSpace()}}function vl(r,e){if(e===au)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),r;if(e===fo||e===Xl){let t=r.getIndex();if(t===null){const a=[],o=r.getAttribute("position");if(o!==void 0){for(let c=0;c<o.count;c++)a.push(c);r.setIndex(a),t=r.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),r}const n=t.count-2,i=[];if(e===fo)for(let a=1;a<=n;a++)i.push(t.getX(0)),i.push(t.getX(a)),i.push(t.getX(a+1));else for(let a=0;a<n;a++)a%2===0?(i.push(t.getX(a)),i.push(t.getX(a+1)),i.push(t.getX(a+2))):(i.push(t.getX(a+2)),i.push(t.getX(a+1)),i.push(t.getX(a)));i.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const s=r.clone();return s.setIndex(i),s.clearGroups(),s}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),r}class n_ extends ss{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new o_(t)}),this.register(function(t){return new c_(t)}),this.register(function(t){return new __(t)}),this.register(function(t){return new v_(t)}),this.register(function(t){return new x_(t)}),this.register(function(t){return new h_(t)}),this.register(function(t){return new u_(t)}),this.register(function(t){return new d_(t)}),this.register(function(t){return new f_(t)}),this.register(function(t){return new a_(t)}),this.register(function(t){return new p_(t)}),this.register(function(t){return new l_(t)}),this.register(function(t){return new g_(t)}),this.register(function(t){return new m_(t)}),this.register(function(t){return new s_(t)}),this.register(function(t){return new y_(t)}),this.register(function(t){return new M_(t)})}load(e,t,n,i){const s=this;let a;if(this.resourcePath!=="")a=this.resourcePath;else if(this.path!==""){const l=ws.extractUrlBase(e);a=ws.resolveURL(l,this.path)}else a=ws.extractUrlBase(e);this.manager.itemStart(e);const o=function(l){i?i(l):console.error(l),s.manager.itemError(e),s.manager.itemEnd(e)},c=new hh(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{s.parse(l,a,function(h){t(h),s.manager.itemEnd(e)},o)}catch(h){o(h)}},n,o)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,i){let s;const a={},o={},c=new TextDecoder;if(typeof e=="string")s=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===_h){try{a[Xe.KHR_BINARY_GLTF]=new S_(e)}catch(u){i&&i(u);return}s=JSON.parse(a[Xe.KHR_BINARY_GLTF].content)}else s=JSON.parse(c.decode(e));else s=e;if(s.asset===void 0||s.asset.version[0]<2){i&&i(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const l=new U_(s,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){const u=this.pluginCallbacks[h](l);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),o[u.name]=u,a[u.name]=!0}if(s.extensionsUsed)for(let h=0;h<s.extensionsUsed.length;++h){const u=s.extensionsUsed[h],d=s.extensionsRequired||[];switch(u){case Xe.KHR_MATERIALS_UNLIT:a[u]=new r_;break;case Xe.KHR_DRACO_MESH_COMPRESSION:a[u]=new b_(s,this.dracoLoader);break;case Xe.KHR_TEXTURE_TRANSFORM:a[u]=new E_;break;case Xe.KHR_MESH_QUANTIZATION:a[u]=new T_;break;default:d.indexOf(u)>=0&&o[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}l.setExtensions(a),l.setPlugins(o),l.parse(n,i)}parseAsync(e,t){const n=this;return new Promise(function(i,s){n.parse(e,t,i,s)})}}function i_(){let r={};return{get:function(e){return r[e]},add:function(e,t){r[e]=t},remove:function(e){delete r[e]},removeAll:function(){r={}}}}const Xe={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class s_{constructor(e){this.parser=e,this.name=Xe.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let n=0,i=t.length;n<i;n++){const s=t[n];s.extensions&&s.extensions[this.name]&&s.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,s.extensions[this.name].light)}}_loadLight(e){const t=this.parser,n="light:"+e;let i=t.cache.get(n);if(i)return i;const s=t.json,c=((s.extensions&&s.extensions[this.name]||{}).lights||[])[e];let l;const h=new Pe(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],zt);const u=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new uh(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new vo(h),l.distance=u;break;case"spot":l=new Zd(h),l.distance=u,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),Dn(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),i=Promise.resolve(l),t.cache.add(n,i),i}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,n=this.parser,s=n.json.nodes[e],o=(s.extensions&&s.extensions[this.name]||{}).light;return o===void 0?null:this._loadLight(o).then(function(c){return n._getNodeRef(t.cache,o,c)})}}class r_{constructor(){this.name=Xe.KHR_MATERIALS_UNLIT}getMaterialType(){return ke}extendParams(e,t,n){const i=[];e.color=new Pe(1,1,1),e.opacity=1;const s=t.pbrMetallicRoughness;if(s){if(Array.isArray(s.baseColorFactor)){const a=s.baseColorFactor;e.color.setRGB(a[0],a[1],a[2],zt),e.opacity=a[3]}s.baseColorTexture!==void 0&&i.push(n.assignTexture(e,"map",s.baseColorTexture,wt))}return Promise.all(i)}}class a_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name].emissiveStrength;return s!==void 0&&(t.emissiveIntensity=s),Promise.resolve()}}class o_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];if(a.clearcoatFactor!==void 0&&(t.clearcoat=a.clearcoatFactor),a.clearcoatTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatMap",a.clearcoatTexture)),a.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=a.clearcoatRoughnessFactor),a.clearcoatRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatRoughnessMap",a.clearcoatRoughnessTexture)),a.clearcoatNormalTexture!==void 0&&(s.push(n.assignTexture(t,"clearcoatNormalMap",a.clearcoatNormalTexture)),a.clearcoatNormalTexture.scale!==void 0)){const o=a.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new me(o,o)}return Promise.all(s)}}class c_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_DISPERSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name];return t.dispersion=s.dispersion!==void 0?s.dispersion:0,Promise.resolve()}}class l_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return a.iridescenceFactor!==void 0&&(t.iridescence=a.iridescenceFactor),a.iridescenceTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceMap",a.iridescenceTexture)),a.iridescenceIor!==void 0&&(t.iridescenceIOR=a.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),a.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=a.iridescenceThicknessMinimum),a.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=a.iridescenceThicknessMaximum),a.iridescenceThicknessTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceThicknessMap",a.iridescenceThicknessTexture)),Promise.all(s)}}class h_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_SHEEN}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[];t.sheenColor=new Pe(0,0,0),t.sheenRoughness=0,t.sheen=1;const a=i.extensions[this.name];if(a.sheenColorFactor!==void 0){const o=a.sheenColorFactor;t.sheenColor.setRGB(o[0],o[1],o[2],zt)}return a.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=a.sheenRoughnessFactor),a.sheenColorTexture!==void 0&&s.push(n.assignTexture(t,"sheenColorMap",a.sheenColorTexture,wt)),a.sheenRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"sheenRoughnessMap",a.sheenRoughnessTexture)),Promise.all(s)}}class u_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return a.transmissionFactor!==void 0&&(t.transmission=a.transmissionFactor),a.transmissionTexture!==void 0&&s.push(n.assignTexture(t,"transmissionMap",a.transmissionTexture)),Promise.all(s)}}class d_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_VOLUME}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];t.thickness=a.thicknessFactor!==void 0?a.thicknessFactor:0,a.thicknessTexture!==void 0&&s.push(n.assignTexture(t,"thicknessMap",a.thicknessTexture)),t.attenuationDistance=a.attenuationDistance||1/0;const o=a.attenuationColor||[1,1,1];return t.attenuationColor=new Pe().setRGB(o[0],o[1],o[2],zt),Promise.all(s)}}class f_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_IOR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name];return t.ior=s.ior!==void 0?s.ior:1.5,Promise.resolve()}}class p_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_SPECULAR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];t.specularIntensity=a.specularFactor!==void 0?a.specularFactor:1,a.specularTexture!==void 0&&s.push(n.assignTexture(t,"specularIntensityMap",a.specularTexture));const o=a.specularColorFactor||[1,1,1];return t.specularColor=new Pe().setRGB(o[0],o[1],o[2],zt),a.specularColorTexture!==void 0&&s.push(n.assignTexture(t,"specularColorMap",a.specularColorTexture,wt)),Promise.all(s)}}class m_{constructor(e){this.parser=e,this.name=Xe.EXT_MATERIALS_BUMP}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return t.bumpScale=a.bumpFactor!==void 0?a.bumpFactor:1,a.bumpTexture!==void 0&&s.push(n.assignTexture(t,"bumpMap",a.bumpTexture)),Promise.all(s)}}class g_{constructor(e){this.parser=e,this.name=Xe.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:En}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return a.anisotropyStrength!==void 0&&(t.anisotropy=a.anisotropyStrength),a.anisotropyRotation!==void 0&&(t.anisotropyRotation=a.anisotropyRotation),a.anisotropyTexture!==void 0&&s.push(n.assignTexture(t,"anisotropyMap",a.anisotropyTexture)),Promise.all(s)}}class __{constructor(e){this.parser=e,this.name=Xe.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,n=t.json,i=n.textures[e];if(!i.extensions||!i.extensions[this.name])return null;const s=i.extensions[this.name],a=t.options.ktx2Loader;if(!a){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,s.source,a)}}class v_{constructor(e){this.parser=e,this.name=Xe.EXT_TEXTURE_WEBP}loadTexture(e){const t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;const a=s.extensions[t],o=i.images[a.source];let c=n.textureLoader;if(o.uri){const l=n.options.manager.getHandler(o.uri);l!==null&&(c=l)}return n.loadTextureImage(e,a.source,c)}}class x_{constructor(e){this.parser=e,this.name=Xe.EXT_TEXTURE_AVIF}loadTexture(e){const t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;const a=s.extensions[t],o=i.images[a.source];let c=n.textureLoader;if(o.uri){const l=n.options.manager.getHandler(o.uri);l!==null&&(c=l)}return n.loadTextureImage(e,a.source,c)}}class y_{constructor(e){this.name=Xe.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){const i=n.extensions[this.name],s=this.parser.getDependency("buffer",i.buffer),a=this.parser.options.meshoptDecoder;if(!a||!a.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return s.then(function(o){const c=i.byteOffset||0,l=i.byteLength||0,h=i.count,u=i.byteStride,d=new Uint8Array(o,c,l);return a.decodeGltfBufferAsync?a.decodeGltfBufferAsync(h,u,d,i.mode,i.filter).then(function(f){return f.buffer}):a.ready.then(function(){const f=new ArrayBuffer(h*u);return a.decodeGltfBuffer(new Uint8Array(f),h,u,d,i.mode,i.filter),f})})}else return null}}class M_{constructor(e){this.name=Xe.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;const i=t.meshes[n.mesh];for(const l of i.primitives)if(l.mode!==an.TRIANGLES&&l.mode!==an.TRIANGLE_STRIP&&l.mode!==an.TRIANGLE_FAN&&l.mode!==void 0)return null;const a=n.extensions[this.name].attributes,o=[],c={};for(const l in a)o.push(this.parser.getDependency("accessor",a[l]).then(h=>(c[l]=h,c[l])));return o.length<1?null:(o.push(this.parser.createNodeMesh(e)),Promise.all(o).then(l=>{const h=l.pop(),u=h.isGroup?h.children:[h],d=l[0].count,f=[];for(const g of u){const _=new Oe,m=new T,p=new _n,M=new T(1,1,1),b=new fd(g.geometry,g.material,d);for(let v=0;v<d;v++)c.TRANSLATION&&m.fromBufferAttribute(c.TRANSLATION,v),c.ROTATION&&p.fromBufferAttribute(c.ROTATION,v),c.SCALE&&M.fromBufferAttribute(c.SCALE,v),b.setMatrixAt(v,_.compose(m,p,M));for(const v in c)if(v==="_COLOR_0"){const P=c[v];b.instanceColor=new mo(P.array,P.itemSize,P.normalized)}else v!=="TRANSLATION"&&v!=="ROTATION"&&v!=="SCALE"&&g.geometry.setAttribute(v,c[v]);pt.prototype.copy.call(b,g),this.parser.assignFinalMaterial(b),f.push(b)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}}const _h="glTF",ms=12,xl={JSON:1313821514,BIN:5130562};class S_{constructor(e){this.name=Xe.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,ms),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==_h)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const i=this.header.length-ms,s=new DataView(e,ms);let a=0;for(;a<i;){const o=s.getUint32(a,!0);a+=4;const c=s.getUint32(a,!0);if(a+=4,c===xl.JSON){const l=new Uint8Array(e,ms+a,o);this.content=n.decode(l)}else if(c===xl.BIN){const l=ms+a;this.body=e.slice(l,l+o)}a+=o}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class b_{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=Xe.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const n=this.json,i=this.dracoLoader,s=e.extensions[this.name].bufferView,a=e.extensions[this.name].attributes,o={},c={},l={};for(const h in a){const u=Mo[h]||h.toLowerCase();o[u]=a[h]}for(const h in e.attributes){const u=Mo[h]||h.toLowerCase();if(a[h]!==void 0){const d=n.accessors[e.attributes[h]],f=qi[d.componentType];l[u]=f.name,c[u]=d.normalized===!0}}return t.getDependency("bufferView",s).then(function(h){return new Promise(function(u,d){i.decodeDracoFile(h,function(f){for(const g in f.attributes){const _=f.attributes[g],m=c[g];m!==void 0&&(_.normalized=m)}u(f)},o,l,zt,d)})})}}class E_{constructor(){this.name=Xe.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class T_{constructor(){this.name=Xe.KHR_MESH_QUANTIZATION}}class vh extends Os{constructor(e,t,n,i){super(e,t,n,i)}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i*3+i;for(let a=0;a!==i;a++)t[a]=n[s+a];return t}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,c=o*2,l=o*3,h=i-t,u=(n-t)/h,d=u*u,f=d*u,g=e*l,_=g-l,m=-2*f+3*d,p=f-d,M=1-m,b=p-d+u;for(let v=0;v!==o;v++){const P=a[_+v+o],R=a[_+v+c]*h,A=a[g+v+o],C=a[g+v]*h;s[v]=M*P+b*R+m*A+p*C}return s}}const w_=new _n;class A_ extends vh{interpolate_(e,t,n,i){const s=super.interpolate_(e,t,n,i);return w_.fromArray(s).normalize().toArray(s),s}}const an={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},qi={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},yl={9728:Dt,9729:Qt,9984:Fl,9985:_r,9986:vs,9987:Nn},Ml={33071:$n,33648:Tr,10497:ei},Sa={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Mo={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},qn={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},R_={CUBICSPLINE:void 0,LINEAR:Ls,STEP:Is},ba={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function C_(r){return r.DefaultMaterial===void 0&&(r.DefaultMaterial=new Fs({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:Mn})),r.DefaultMaterial}function hi(r,e,t){for(const n in t.extensions)r[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function Dn(r,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(r.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function P_(r,e,t){let n=!1,i=!1,s=!1;for(let l=0,h=e.length;l<h;l++){const u=e[l];if(u.POSITION!==void 0&&(n=!0),u.NORMAL!==void 0&&(i=!0),u.COLOR_0!==void 0&&(s=!0),n&&i&&s)break}if(!n&&!i&&!s)return Promise.resolve(r);const a=[],o=[],c=[];for(let l=0,h=e.length;l<h;l++){const u=e[l];if(n){const d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):r.attributes.position;a.push(d)}if(i){const d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):r.attributes.normal;o.push(d)}if(s){const d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):r.attributes.color;c.push(d)}}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(c)]).then(function(l){const h=l[0],u=l[1],d=l[2];return n&&(r.morphAttributes.position=h),i&&(r.morphAttributes.normal=u),s&&(r.morphAttributes.color=d),r.morphTargetsRelative=!0,r})}function I_(r,e){if(r.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)r.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(r.morphTargetInfluences.length===t.length){r.morphTargetDictionary={};for(let n=0,i=t.length;n<i;n++)r.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function L_(r){let e;const t=r.extensions&&r.extensions[Xe.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+Ea(t.attributes):e=r.indices+":"+Ea(r.attributes)+":"+r.mode,r.targets!==void 0)for(let n=0,i=r.targets.length;n<i;n++)e+=":"+Ea(r.targets[n]);return e}function Ea(r){let e="";const t=Object.keys(r).sort();for(let n=0,i=t.length;n<i;n++)e+=t[n]+":"+r[t[n]]+";";return e}function So(r){switch(r){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function D_(r){return r.search(/\.jpe?g($|\?)/i)>0||r.search(/^data\:image\/jpeg/)===0?"image/jpeg":r.search(/\.webp($|\?)/i)>0||r.search(/^data\:image\/webp/)===0?"image/webp":r.search(/\.ktx2($|\?)/i)>0||r.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const N_=new Oe;class U_{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new i_,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,i=-1,s=!1,a=-1;if(typeof navigator<"u"){const o=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(o)===!0;const c=o.match(/Version\/(\d+)/);i=n&&c?parseInt(c[1],10):-1,s=o.indexOf("Firefox")>-1,a=s?o.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&i<17||s&&a<98?this.textureLoader=new Kd(this.options.manager):this.textureLoader=new tf(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new hh(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const n=this,i=this.json,s=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(a){return a._markDefs&&a._markDefs()}),Promise.all(this._invokeAll(function(a){return a.beforeRoot&&a.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(a){const o={scene:a[0][i.scene||0],scenes:a[0],animations:a[1],cameras:a[2],asset:i.asset,parser:n,userData:{}};return hi(s,o,i),Dn(o,i),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(o)})).then(function(){for(const c of o.scenes)c.updateMatrixWorld();e(o)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let i=0,s=t.length;i<s;i++){const a=t[i].joints;for(let o=0,c=a.length;o<c;o++)e[a[o]].isBone=!0}for(let i=0,s=e.length;i<s;i++){const a=e[i];a.mesh!==void 0&&(this._addNodeRef(this.meshCache,a.mesh),a.skin!==void 0&&(n[a.mesh].isSkinnedMesh=!0)),a.camera!==void 0&&this._addNodeRef(this.cameraCache,a.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;const i=n.clone(),s=(a,o)=>{const c=this.associations.get(a);c!=null&&this.associations.set(o,c);for(const[l,h]of a.children.entries())s(h,o.children[l])};return s(n,i),i.name+="_instance_"+e.uses[t]++,i}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){const i=e(t[n]);if(i)return i}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const n=[];for(let i=0;i<t.length;i++){const s=e(t[i]);s&&n.push(s)}return n}getDependency(e,t){const n=e+":"+t;let i=this.cache.get(n);if(!i){switch(e){case"scene":i=this.loadScene(t);break;case"node":i=this._invokeOne(function(s){return s.loadNode&&s.loadNode(t)});break;case"mesh":i=this._invokeOne(function(s){return s.loadMesh&&s.loadMesh(t)});break;case"accessor":i=this.loadAccessor(t);break;case"bufferView":i=this._invokeOne(function(s){return s.loadBufferView&&s.loadBufferView(t)});break;case"buffer":i=this.loadBuffer(t);break;case"material":i=this._invokeOne(function(s){return s.loadMaterial&&s.loadMaterial(t)});break;case"texture":i=this._invokeOne(function(s){return s.loadTexture&&s.loadTexture(t)});break;case"skin":i=this.loadSkin(t);break;case"animation":i=this._invokeOne(function(s){return s.loadAnimation&&s.loadAnimation(t)});break;case"camera":i=this.loadCamera(t);break;default:if(i=this._invokeOne(function(s){return s!=this&&s.getDependency&&s.getDependency(e,t)}),!i)throw new Error("Unknown type: "+e);break}this.cache.add(n,i)}return i}getDependencies(e){let t=this.cache.get(e);if(!t){const n=this,i=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(i.map(function(s,a){return n.getDependency(e,a)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[Xe.KHR_BINARY_GLTF].body);const i=this.options;return new Promise(function(s,a){n.load(ws.resolveURL(t.uri,i.path),s,void 0,function(){a(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){const i=t.byteLength||0,s=t.byteOffset||0;return n.slice(s,s+i)})}loadAccessor(e){const t=this,n=this.json,i=this.json.accessors[e];if(i.bufferView===void 0&&i.sparse===void 0){const a=Sa[i.type],o=qi[i.componentType],c=i.normalized===!0,l=new o(i.count*a);return Promise.resolve(new It(l,a,c))}const s=[];return i.bufferView!==void 0?s.push(this.getDependency("bufferView",i.bufferView)):s.push(null),i.sparse!==void 0&&(s.push(this.getDependency("bufferView",i.sparse.indices.bufferView)),s.push(this.getDependency("bufferView",i.sparse.values.bufferView))),Promise.all(s).then(function(a){const o=a[0],c=Sa[i.type],l=qi[i.componentType],h=l.BYTES_PER_ELEMENT,u=h*c,d=i.byteOffset||0,f=i.bufferView!==void 0?n.bufferViews[i.bufferView].byteStride:void 0,g=i.normalized===!0;let _,m;if(f&&f!==u){const p=Math.floor(d/f),M="InterleavedBuffer:"+i.bufferView+":"+i.componentType+":"+p+":"+i.count;let b=t.cache.get(M);b||(_=new l(o,p*f,i.count*f/h),b=new cd(_,f/h),t.cache.add(M,b)),m=new Bo(b,c,d%f/h,g)}else o===null?_=new l(i.count*c):_=new l(o,d,i.count*c),m=new It(_,c,g);if(i.sparse!==void 0){const p=Sa.SCALAR,M=qi[i.sparse.indices.componentType],b=i.sparse.indices.byteOffset||0,v=i.sparse.values.byteOffset||0,P=new M(a[1],b,i.sparse.count*p),R=new l(a[2],v,i.sparse.count*c);o!==null&&(m=new It(m.array.slice(),m.itemSize,m.normalized)),m.normalized=!1;for(let A=0,C=P.length;A<C;A++){const S=P[A];if(m.setX(S,R[A*c]),c>=2&&m.setY(S,R[A*c+1]),c>=3&&m.setZ(S,R[A*c+2]),c>=4&&m.setW(S,R[A*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}m.normalized=g}return m})}loadTexture(e){const t=this.json,n=this.options,s=t.textures[e].source,a=t.images[s];let o=this.textureLoader;if(a.uri){const c=n.manager.getHandler(a.uri);c!==null&&(o=c)}return this.loadTextureImage(e,s,o)}loadTextureImage(e,t,n){const i=this,s=this.json,a=s.textures[e],o=s.images[t],c=(o.uri||o.bufferView)+":"+a.sampler;if(this.textureCache[c])return this.textureCache[c];const l=this.loadImageSource(t,n).then(function(h){h.flipY=!1,h.name=a.name||o.name||"",h.name===""&&typeof o.uri=="string"&&o.uri.startsWith("data:image/")===!1&&(h.name=o.uri);const d=(s.samplers||{})[a.sampler]||{};return h.magFilter=yl[d.magFilter]||Qt,h.minFilter=yl[d.minFilter]||Nn,h.wrapS=Ml[d.wrapS]||ei,h.wrapT=Ml[d.wrapT]||ei,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==Dt&&h.minFilter!==Qt,i.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){const n=this,i=this.json,s=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(u=>u.clone());const a=i.images[e],o=self.URL||self.webkitURL;let c=a.uri||"",l=!1;if(a.bufferView!==void 0)c=n.getDependency("bufferView",a.bufferView).then(function(u){l=!0;const d=new Blob([u],{type:a.mimeType});return c=o.createObjectURL(d),c});else if(a.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const h=Promise.resolve(c).then(function(u){return new Promise(function(d,f){let g=d;t.isImageBitmapLoader===!0&&(g=function(_){const m=new At(_);m.needsUpdate=!0,d(m)}),t.load(ws.resolveURL(u,s.path),g,void 0,f)})}).then(function(u){return l===!0&&o.revokeObjectURL(c),Dn(u,a),u.userData.mimeType=a.mimeType||D_(a.uri),u}).catch(function(u){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),u});return this.sourceCache[e]=h,h}assignTexture(e,t,n,i){const s=this;return this.getDependency("texture",n.index).then(function(a){if(!a)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(a=a.clone(),a.channel=n.texCoord),s.extensions[Xe.KHR_TEXTURE_TRANSFORM]){const o=n.extensions!==void 0?n.extensions[Xe.KHR_TEXTURE_TRANSFORM]:void 0;if(o){const c=s.associations.get(a);a=s.extensions[Xe.KHR_TEXTURE_TRANSFORM].extendTexture(a,o),s.associations.set(a,c)}}return i!==void 0&&(a.colorSpace=i),e[t]=a,a})}assignFinalMaterial(e){const t=e.geometry;let n=e.material;const i=t.attributes.tangent===void 0,s=t.attributes.color!==void 0,a=t.attributes.normal===void 0;if(e.isPoints){const o="PointsMaterial:"+n.uuid;let c=this.cache.get(o);c||(c=new Vo,vn.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(o,c)),n=c}else if(e.isLine){const o="LineBasicMaterial:"+n.uuid;let c=this.cache.get(o);c||(c=new Ss,vn.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(o,c)),n=c}if(i||s||a){let o="ClonedMaterial:"+n.uuid+":";i&&(o+="derivative-tangents:"),s&&(o+="vertex-colors:"),a&&(o+="flat-shading:");let c=this.cache.get(o);c||(c=n.clone(),s&&(c.vertexColors=!0),a&&(c.flatShading=!0),i&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(o,c),this.associations.set(c,this.associations.get(n))),n=c}e.material=n}getMaterialType(){return Fs}loadMaterial(e){const t=this,n=this.json,i=this.extensions,s=n.materials[e];let a;const o={},c=s.extensions||{},l=[];if(c[Xe.KHR_MATERIALS_UNLIT]){const u=i[Xe.KHR_MATERIALS_UNLIT];a=u.getMaterialType(),l.push(u.extendParams(o,s,t))}else{const u=s.pbrMetallicRoughness||{};if(o.color=new Pe(1,1,1),o.opacity=1,Array.isArray(u.baseColorFactor)){const d=u.baseColorFactor;o.color.setRGB(d[0],d[1],d[2],zt),o.opacity=d[3]}u.baseColorTexture!==void 0&&l.push(t.assignTexture(o,"map",u.baseColorTexture,wt)),o.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,o.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(o,"metalnessMap",u.metallicRoughnessTexture)),l.push(t.assignTexture(o,"roughnessMap",u.metallicRoughnessTexture))),a=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,o)})))}s.doubleSided===!0&&(o.side=xt);const h=s.alphaMode||ba.OPAQUE;if(h===ba.BLEND?(o.transparent=!0,o.depthWrite=!1):(o.transparent=!1,h===ba.MASK&&(o.alphaTest=s.alphaCutoff!==void 0?s.alphaCutoff:.5)),s.normalTexture!==void 0&&a!==ke&&(l.push(t.assignTexture(o,"normalMap",s.normalTexture)),o.normalScale=new me(1,1),s.normalTexture.scale!==void 0)){const u=s.normalTexture.scale;o.normalScale.set(u,u)}if(s.occlusionTexture!==void 0&&a!==ke&&(l.push(t.assignTexture(o,"aoMap",s.occlusionTexture)),s.occlusionTexture.strength!==void 0&&(o.aoMapIntensity=s.occlusionTexture.strength)),s.emissiveFactor!==void 0&&a!==ke){const u=s.emissiveFactor;o.emissive=new Pe().setRGB(u[0],u[1],u[2],zt)}return s.emissiveTexture!==void 0&&a!==ke&&l.push(t.assignTexture(o,"emissiveMap",s.emissiveTexture,wt)),Promise.all(l).then(function(){const u=new a(o);return s.name&&(u.name=s.name),Dn(u,s),t.associations.set(u,{materials:e}),s.extensions&&hi(i,u,s),u})}createUniqueName(e){const t=tt.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,n=this.extensions,i=this.primitiveCache;function s(o){return n[Xe.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(o,t).then(function(c){return Sl(c,o,t)})}const a=[];for(let o=0,c=e.length;o<c;o++){const l=e[o],h=L_(l),u=i[h];if(u)a.push(u.promise);else{let d;l.extensions&&l.extensions[Xe.KHR_DRACO_MESH_COMPRESSION]?d=s(l):d=Sl(new yt,l,t),i[h]={primitive:l,promise:d},a.push(d)}}return Promise.all(a)}loadMesh(e){const t=this,n=this.json,i=this.extensions,s=n.meshes[e],a=s.primitives,o=[];for(let c=0,l=a.length;c<l;c++){const h=a[c].material===void 0?C_(this.cache):this.getDependency("material",a[c].material);o.push(h)}return o.push(t.loadGeometries(a)),Promise.all(o).then(function(c){const l=c.slice(0,c.length-1),h=c[c.length-1],u=[];for(let f=0,g=h.length;f<g;f++){const _=h[f],m=a[f];let p;const M=l[f];if(m.mode===an.TRIANGLES||m.mode===an.TRIANGLE_STRIP||m.mode===an.TRIANGLE_FAN||m.mode===void 0)p=s.isSkinnedMesh===!0?new hd(_,M):new Wt(_,M),p.isSkinnedMesh===!0&&p.normalizeSkinWeights(),m.mode===an.TRIANGLE_STRIP?p.geometry=vl(p.geometry,Xl):m.mode===an.TRIANGLE_FAN&&(p.geometry=vl(p.geometry,fo));else if(m.mode===an.LINES)p=new _d(_,M);else if(m.mode===an.LINE_STRIP)p=new Xi(_,M);else if(m.mode===an.LINE_LOOP)p=new vd(_,M);else if(m.mode===an.POINTS)p=new nh(_,M);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+m.mode);Object.keys(p.geometry.morphAttributes).length>0&&I_(p,s),p.name=t.createUniqueName(s.name||"mesh_"+e),Dn(p,s),m.extensions&&hi(i,p,m),t.assignFinalMaterial(p),u.push(p)}for(let f=0,g=u.length;f<g;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return s.extensions&&hi(i,u[0],s),u[0];const d=new je;s.extensions&&hi(i,d,s),t.associations.set(d,{meshes:e});for(let f=0,g=u.length;f<g;f++)d.add(u[f]);return d})}loadCamera(e){let t;const n=this.json.cameras[e],i=n[n.type];if(!i){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new Gt(ft.radToDeg(i.yfov),i.aspectRatio||1,i.znear||1,i.zfar||2e6):n.type==="orthographic"&&(t=new Nr(-i.xmag,i.xmag,i.ymag,-i.ymag,i.znear,i.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),Dn(t,n),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],n=[];for(let i=0,s=t.joints.length;i<s;i++)n.push(this._loadNodeShallow(t.joints[i]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(i){const s=i.pop(),a=i,o=[],c=[];for(let l=0,h=a.length;l<h;l++){const u=a[l];if(u){o.push(u);const d=new Oe;s!==null&&d.fromArray(s.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new zo(o,c)})}loadAnimation(e){const t=this.json,n=this,i=t.animations[e],s=i.name?i.name:"animation_"+e,a=[],o=[],c=[],l=[],h=[];for(let u=0,d=i.channels.length;u<d;u++){const f=i.channels[u],g=i.samplers[f.sampler],_=f.target,m=_.node,p=i.parameters!==void 0?i.parameters[g.input]:g.input,M=i.parameters!==void 0?i.parameters[g.output]:g.output;_.node!==void 0&&(a.push(this.getDependency("node",m)),o.push(this.getDependency("accessor",p)),c.push(this.getDependency("accessor",M)),l.push(g),h.push(_))}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(u){const d=u[0],f=u[1],g=u[2],_=u[3],m=u[4],p=[];for(let M=0,b=d.length;M<b;M++){const v=d[M],P=f[M],R=g[M],A=_[M],C=m[M];if(v===void 0)continue;v.updateMatrix&&v.updateMatrix();const S=n._createAnimationTracks(v,P,R,A,C);if(S)for(let x=0;x<S.length;x++)p.push(S[x])}return new _o(s,void 0,p)})}createNodeMesh(e){const t=this.json,n=this,i=t.nodes[e];return i.mesh===void 0?null:n.getDependency("mesh",i.mesh).then(function(s){const a=n._getNodeRef(n.meshCache,i.mesh,s);return i.weights!==void 0&&a.traverse(function(o){if(o.isMesh)for(let c=0,l=i.weights.length;c<l;c++)o.morphTargetInfluences[c]=i.weights[c]}),a})}loadNode(e){const t=this.json,n=this,i=t.nodes[e],s=n._loadNodeShallow(e),a=[],o=i.children||[];for(let l=0,h=o.length;l<h;l++)a.push(n.getDependency("node",o[l]));const c=i.skin===void 0?Promise.resolve(null):n.getDependency("skin",i.skin);return Promise.all([s,Promise.all(a),c]).then(function(l){const h=l[0],u=l[1],d=l[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,N_)});for(let f=0,g=u.length;f<g;f++)h.add(u[f]);return h})}_loadNodeShallow(e){const t=this.json,n=this.extensions,i=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const s=t.nodes[e],a=s.name?i.createUniqueName(s.name):"",o=[],c=i._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&o.push(c),s.camera!==void 0&&o.push(i.getDependency("camera",s.camera).then(function(l){return i._getNodeRef(i.cameraCache,s.camera,l)})),i._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){o.push(l)}),this.nodeCache[e]=Promise.all(o).then(function(l){let h;if(s.isBone===!0?h=new th:l.length>1?h=new je:l.length===1?h=l[0]:h=new pt,h!==l[0])for(let u=0,d=l.length;u<d;u++)h.add(l[u]);if(s.name&&(h.userData.name=s.name,h.name=a),Dn(h,s),s.extensions&&hi(n,h,s),s.matrix!==void 0){const u=new Oe;u.fromArray(s.matrix),h.applyMatrix4(u)}else s.translation!==void 0&&h.position.fromArray(s.translation),s.rotation!==void 0&&h.quaternion.fromArray(s.rotation),s.scale!==void 0&&h.scale.fromArray(s.scale);if(!i.associations.has(h))i.associations.set(h,{});else if(s.mesh!==void 0&&i.meshCache.refs[s.mesh]>1){const u=i.associations.get(h);i.associations.set(h,{...u})}return i.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){const t=this.extensions,n=this.json.scenes[e],i=this,s=new je;n.name&&(s.name=i.createUniqueName(n.name)),Dn(s,n),n.extensions&&hi(t,s,n);const a=n.nodes||[],o=[];for(let c=0,l=a.length;c<l;c++)o.push(i.getDependency("node",a[c]));return Promise.all(o).then(function(c){for(let h=0,u=c.length;h<u;h++)s.add(c[h]);const l=h=>{const u=new Map;for(const[d,f]of i.associations)(d instanceof vn||d instanceof At)&&u.set(d,f);return h.traverse(d=>{const f=i.associations.get(d);f!=null&&u.set(d,f)}),u};return i.associations=l(s),s})}_createAnimationTracks(e,t,n,i,s){const a=[],o=e.name?e.name:e.uuid,c=[];qn[s.path]===qn.weights?e.traverse(function(d){d.morphTargetInfluences&&c.push(d.name?d.name:d.uuid)}):c.push(o);let l;switch(qn[s.path]){case qn.weights:l=Zi;break;case qn.rotation:l=Qi;break;case qn.translation:case qn.scale:l=es;break;default:n.itemSize===1?l=Zi:l=es;break}const h=i.interpolation!==void 0?R_[i.interpolation]:Ls,u=this._getArrayFromAccessor(n);for(let d=0,f=c.length;d<f;d++){const g=new l(c[d]+"."+qn[s.path],t.array,u,h);i.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(g),a.push(g)}return a}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const n=So(t.constructor),i=new Float32Array(t.length);for(let s=0,a=t.length;s<a;s++)i[s]=t[s]*n;t=i}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){const i=this instanceof Qi?A_:vh;return new i(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function F_(r,e,t){const n=e.attributes,i=new Bn;if(n.POSITION!==void 0){const o=t.json.accessors[n.POSITION],c=o.min,l=o.max;if(c!==void 0&&l!==void 0){if(i.set(new T(c[0],c[1],c[2]),new T(l[0],l[1],l[2])),o.normalized){const h=So(qi[o.componentType]);i.min.multiplyScalar(h),i.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const s=e.targets;if(s!==void 0){const o=new T,c=new T;for(let l=0,h=s.length;l<h;l++){const u=s[l];if(u.POSITION!==void 0){const d=t.json.accessors[u.POSITION],f=d.min,g=d.max;if(f!==void 0&&g!==void 0){if(c.setX(Math.max(Math.abs(f[0]),Math.abs(g[0]))),c.setY(Math.max(Math.abs(f[1]),Math.abs(g[1]))),c.setZ(Math.max(Math.abs(f[2]),Math.abs(g[2]))),d.normalized){const _=So(qi[d.componentType]);c.multiplyScalar(_)}o.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}i.expandByVector(o)}r.boundingBox=i;const a=new bn;i.getCenter(a.center),a.radius=i.min.distanceTo(i.max)/2,r.boundingSphere=a}function Sl(r,e,t){const n=e.attributes,i=[];function s(a,o){return t.getDependency("accessor",a).then(function(c){r.setAttribute(o,c)})}for(const a in n){const o=Mo[a]||a.toLowerCase();o in r.attributes||i.push(s(n[a],o))}if(e.indices!==void 0&&!r.index){const a=t.getDependency("accessor",e.indices).then(function(o){r.setIndex(o)});i.push(a)}return Ye.workingColorSpace!==zt&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Ye.workingColorSpace}" not supported.`),Dn(r,e),F_(r,e,t),Promise.all(i).then(function(){return e.targets!==void 0?P_(r,e.targets,t):r})}function bl(r){const e=new Map,t=new Map,n=r.clone();return xh(r,n,function(i,s){e.set(s,i),t.set(i,s)}),n.traverse(function(i){if(!i.isSkinnedMesh)return;const s=i,a=e.get(i),o=a.skeleton.bones;s.skeleton=a.skeleton.clone(),s.bindMatrix.copy(a.bindMatrix),s.skeleton.bones=o.map(function(c){return t.get(c)}),s.bind(s.skeleton,s.bindMatrix)}),n}function xh(r,e,t){t(r,e);for(let n=0;n<r.children.length;n++)xh(r.children[n],e.children[n],t)}const pr=Object.freeze({kills:Object.freeze({crawler:80,wisp:100,ranger:130,brute:160,boss:1200}),waveBase:300,waveMultiplier:50,chapterClear:2e3,wavesPerChapter:3});function Ta(){return{kills:{crawler:0,wisp:0,ranger:0,brute:0,boss:0},wavesCleared:0,chaptersCleared:0,bestWave:1}}function Ir(r={}){const e=r.kills??{};return{kills:{crawler:jn(e.crawler),wisp:jn(e.wisp),ranger:jn(e.ranger),brute:jn(e.brute),boss:jn(e.boss)},wavesCleared:jn(r.wavesCleared),chaptersCleared:jn(r.chaptersCleared),bestWave:Math.max(1,jn(r.bestWave))}}function Er(r){const e=Ir(r),t=Object.entries(e.kills).reduce((a,[o,c])=>a+c*pr.kills[o],0),n=e.wavesCleared,i=n*pr.waveBase+pr.waveMultiplier*(n*(n+1)/2),s=e.chaptersCleared*pr.chapterClear;return{total:Math.round(t+i+s),killScore:t,waveScore:i,chapterScore:s,kills:Object.values(e.kills).reduce((a,o)=>a+o,0),stats:e}}function mr(r){return new Intl.NumberFormat("zh-CN").format(Math.max(0,Number(r)||0))}function jn(r){return Math.max(0,Math.floor(Number(r)||0))}const wa="emberfall-player-profile-v1",yh="emberfall-local-leaderboard-v1",gs="".replace(/\/$/,"");class O_{constructor(){this.profile=this.loadProfile(),this.mode=gs?"online":"local"}getProfile(){return{...this.profile}}setPlayerName(e){return this.profile.name=El(e),localStorage.setItem(wa,JSON.stringify(this.profile)),this.getProfile()}createRunId(){return globalThis.crypto?.randomUUID?.()??`run-${Date.now()}-${Math.random().toString(36).slice(2,10)}`}async submit(e,t){const n=Ir(t),i={runId:e,playerId:this.profile.id,playerName:this.profile.name,stats:n},s=this.submitLocal(i);if(!gs)return{...s,mode:"local"};try{const a=await fetch(`${gs}/api/leaderboard`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(i)});if(!a.ok)throw new Error(`HTTP ${a.status}`);const o=await a.json();return this.mode="online",{...o,mode:"online"}}catch(a){return this.mode="local",{...s,mode:"local",fallback:!0,error:a instanceof Error?a.message:"network_error"}}}async list(e="score",t=20){if(gs)try{const n=await fetch(`${gs}/api/leaderboard?type=${encodeURIComponent(e)}&limit=${t}`,{headers:{Accept:"application/json"}});if(!n.ok)throw new Error(`HTTP ${n.status}`);const i=await n.json();return this.mode="online",{entries:i.entries??[],mode:"online"}}catch{this.mode="local"}return{entries:this.listLocal(e,t),mode:"local"}}loadProfile(){try{const t=JSON.parse(localStorage.getItem(wa));if(t?.id)return{id:String(t.id),name:El(t.name)}}catch{}const e={id:globalThis.crypto?.randomUUID?.()??`player-${Date.now()}-${Math.random().toString(36).slice(2,10)}`,name:`旅者${Math.floor(1e3+Math.random()*9e3)}`};return localStorage.setItem(wa,JSON.stringify(e)),e}submitLocal(e){const t=Tl(),n=Er(e.stats),i=Number(t.runs[e.runId]??0),s=Math.max(0,n.total-i);t.runs[e.runId]=Math.max(i,n.total);const a=t.players[e.playerId]??{id:e.playerId,name:e.playerName,bestScore:0,totalPoints:0,bestWave:1,kills:0,updatedAt:new Date().toISOString()};return a.name=e.playerName,a.totalPoints+=s,n.total>=a.bestScore&&(a.bestScore=n.total,a.bestWave=n.stats.bestWave,a.kills=n.kills),a.updatedAt=new Date().toISOString(),t.players[e.playerId]=a,localStorage.setItem(yh,JSON.stringify(t)),{accepted:s>0,score:n.total,pointsAdded:s,totalPoints:a.totalPoints}}listLocal(e,t){const n=Tl(),i=e==="points"?"totalPoints":"bestScore";return Object.values(n.players).sort((s,a)=>a[i]-s[i]||s.updatedAt.localeCompare(a.updatedAt)).slice(0,t).map((s,a)=>({rank:a+1,playerId:s.id,playerName:s.name,value:s[i],bestWave:s.bestWave,kills:s.kills,isCurrentPlayer:s.id===this.profile.id}))}}function El(r){return String(r||"").replace(/[<>{}[\]\\/"'`]/g,"").replace(/\s+/g," ").trim().slice(0,12)||"无名旅者"}function Tl(){try{const r=JSON.parse(localStorage.getItem(yh));if(r?.players&&r?.runs)return r}catch{}return{players:{},runs:{}}}const wl="emberfall-audio-muted-v1",_s=r=>440*2**((r-69)/12);class B_{constructor(){this.context=null,this.master=null,this.music=null,this.effects=null,this.compressor=null,this.noiseBuffer=null,this.musicTimer=null,this.nextStepTime=0,this.musicStep=0,this.muted=localStorage.getItem(wl)==="1",this.lastPlayed=new Map}async unlock(){return this.ensureContext(),this.context.state==="suspended"&&await this.context.resume(),this.musicTimer||this.startMusic(),!this.muted}toggle(){this.muted=!this.muted,localStorage.setItem(wl,this.muted?"1":"0"),this.ensureContext();const e=this.context.currentTime;return this.master.gain.cancelScheduledValues(e),this.master.gain.setTargetAtTime(this.muted?0:.72,e,.025),this.muted||this.unlock(),!this.muted}isEnabled(){return!this.muted}play(e,t=1){if(this.muted||(this.ensureContext(),this.context.state==="suspended"))return;const n=this.context.currentTime,s={attackHit:.055,magicHit:.07,enemyPhysicalShot:.12,enemyMagicShot:.12,playerPhysicalHit:.12,playerMagicHit:.12,pickup:.06}[e]??0;if(n-(this.lastPlayed.get(e)??-1/0)<s)return;this.lastPlayed.set(e,n);const a=Math.max(.25,Math.min(2,t));switch(e){case"attackCast":this.sweep(210,480,.13,.055*a,"triangle");break;case"attackRelease":this.sweep(620,280,.1,.07*a,"sawtooth"),this.noise(.08,.025*a,1900);break;case"attackHit":this.tone(118,.09,.075*a,"square"),this.noise(.075,.05*a,720);break;case"magicHit":this.tone(420,.13,.05*a,"sine",12),this.tone(630,.11,.035*a,"triangle",-7);break;case"novaCast":this.chord([50,57,62],.58,.032*a,"sine",.08),this.sweep(120,260,.65,.035*a,"triangle");break;case"novaRelease":this.tone(54,.55,.16*a,"sine"),this.sweep(180,760,.35,.095*a,"sawtooth"),this.noise(.42,.11*a,520);break;case"dash":this.sweep(980,150,.22,.08*a,"sine"),this.noise(.2,.07*a,2600);break;case"wardCast":this.chord([57,64,69],.48,.027*a,"triangle",.05);break;case"wardRelease":this.chord([62,69,74,78],.7,.04*a,"sine",.045),this.sweep(240,520,.32,.04*a,"triangle");break;case"potion":[69,74,81].forEach((o,c)=>{this.tone(_s(o),.22,.04*a,"sine",0,n+c*.07)});break;case"enemyPhysicalShot":this.sweep(340,155,.13,.04*a,"square"),this.noise(.09,.035*a,1300);break;case"enemyMagicShot":this.sweep(350,780,.21,.035*a,"sine");break;case"playerPhysicalHit":this.tone(72,.18,.12*a,"square"),this.noise(.13,.09*a,480);break;case"playerMagicHit":this.tone(92,.25,.105*a,"sine"),this.sweep(520,170,.24,.07*a,"triangle");break;case"enemyDeath":this.sweep(180,48,.3,.075*a,"sawtooth"),this.noise(.23,.055*a,850);break;case"pickup":this.tone(740,.12,.035*a,"sine"),this.tone(980,.16,.025*a,"sine",0,n+.045);break;case"gear":[62,69,74,81].forEach((o,c)=>{this.tone(_s(o),.34,.035*a,"triangle",0,n+c*.065)});break;case"levelUp":[57,62,66,69,74].forEach((o,c)=>{this.tone(_s(o),.42,.045*a,"sine",0,n+c*.075)});break;case"bossPhysicalWarning":this.tone(55,.72,.16*a,"sawtooth"),this.tone(55,.22,.13*a,"square",0,n+.5);break;case"bossMagicWarning":this.chord([40,46,53],1.25,.07*a,"sawtooth",.07),this.sweep(160,520,1.12,.045*a,"sine");break;case"bossPhysicalImpact":this.tone(42,.62,.21*a,"sine"),this.noise(.48,.16*a,310);break;case"bossMagicImpact":this.chord([35,41,47],.75,.11*a,"sawtooth"),this.noise(.6,.11*a,980);break;case"regionClear":this.chord([50,57,62,66],1.1,.045*a,"triangle",.08);break}}ensureContext(){if(this.context)return;const e=window.AudioContext||window.webkitAudioContext;this.context=new e,this.master=this.context.createGain(),this.music=this.context.createGain(),this.effects=this.context.createGain(),this.compressor=this.context.createDynamicsCompressor(),this.master.gain.value=this.muted?0:.72,this.music.gain.value=.19,this.effects.gain.value=.82,this.compressor.threshold.value=-18,this.compressor.knee.value=14,this.compressor.ratio.value=5,this.compressor.attack.value=.004,this.compressor.release.value=.18,this.music.connect(this.master),this.effects.connect(this.master),this.master.connect(this.compressor),this.compressor.connect(this.context.destination),this.noiseBuffer=this.createNoiseBuffer()}startMusic(){this.nextStepTime=this.context.currentTime+.08,this.musicStep=0,this.musicTimer=window.setInterval(()=>this.scheduleMusic(),35),this.scheduleMusic()}scheduleMusic(){if(!this.context||this.context.state!=="running")return;const e=60/76/2;for(;this.nextStepTime<this.context.currentTime+.18;)this.scheduleMusicStep(this.musicStep,this.nextStepTime),this.musicStep=(this.musicStep+1)%64,this.nextStepTime+=e}scheduleMusicStep(e,t){const n=[43,41,38,40],i=Math.floor(e/16),s=n[i],a=e%16;if(a===0&&(this.musicChord([s,s+7,s+12],t,5.8,.018),this.musicTone(s-12,t,1.8,.06,"sine")),[0,6,8,14].includes(a)){const o=a===6?7:a===14?5:0;this.musicTone(s-12+o,t,.72,.044,"triangle")}if(a%2===0){const o=[0,7,12,14,12,7,5,7][a/2];this.musicTone(s+12+o,t,.52,.015,"sine")}(a===0||a===8)&&this.noise(.16,.024,170,t,this.music),(a===4||a===12)&&this.noise(.08,.014,2300,t,this.music)}musicTone(e,t,n,i,s){this.tone(_s(e),n,i,s,0,t,this.music)}musicChord(e,t,n,i){e.forEach((s,a)=>{this.musicTone(s,t+a*.035,n,i,"sine")})}tone(e,t,n,i="sine",s=0,a=this.context.currentTime,o=this.effects){const c=this.context.createOscillator(),l=this.context.createGain(),h=this.context.createBiquadFilter();c.type=i,c.frequency.setValueAtTime(Math.max(20,e),a),c.detune.setValueAtTime(s,a),h.type="lowpass",h.frequency.value=o===this.music?1600:4200,l.gain.setValueAtTime(1e-4,a),l.gain.exponentialRampToValueAtTime(Math.max(2e-4,n),a+.018),l.gain.exponentialRampToValueAtTime(1e-4,a+t),c.connect(h),h.connect(l),l.connect(o),c.start(a),c.stop(a+t+.04)}sweep(e,t,n,i,s="sine"){const a=this.context.currentTime,o=this.context.createOscillator(),c=this.context.createGain();o.type=s,o.frequency.setValueAtTime(Math.max(20,e),a),o.frequency.exponentialRampToValueAtTime(Math.max(20,t),a+n),c.gain.setValueAtTime(1e-4,a),c.gain.exponentialRampToValueAtTime(Math.max(2e-4,i),a+.012),c.gain.exponentialRampToValueAtTime(1e-4,a+n),o.connect(c),c.connect(this.effects),o.start(a),o.stop(a+n+.04)}chord(e,t,n,i="sine",s=0){const a=this.context.currentTime;e.forEach((o,c)=>{this.tone(_s(o),t,n,i,0,a+s*c)})}noise(e,t,n,i=this.context.currentTime,s=this.effects){const a=this.context.createBufferSource(),o=this.context.createBiquadFilter(),c=this.context.createGain();a.buffer=this.noiseBuffer,o.type="lowpass",o.frequency.value=n,c.gain.setValueAtTime(Math.max(2e-4,t),i),c.gain.exponentialRampToValueAtTime(1e-4,i+e),a.connect(o),o.connect(c),c.connect(s),a.start(i),a.stop(i+e)}createNoiseBuffer(){const e=Math.floor(this.context.sampleRate*1.2),t=this.context.createBuffer(1,e,this.context.sampleRate),n=t.getChannelData(0);let i=0;for(let s=0;s<e;s+=1){const a=Math.random()*2-1;i=i*.86+a*.14,n[s]=i}return t}}const Mh=96,Jn=42,k_=12,z_=21,Al=Object.freeze([Object.freeze({id:"verdigris",name:"铜绿苔原",subtitle:"游荡幽魂与腐弦猎手盘踞的湿冷地带",accent:6408374,enemyBias:["wisp","ranger","crawler","wisp","ranger"]}),Object.freeze({id:"rust",name:"赤锈荒原",subtitle:"重甲蛮兵在灼热铁砂中巡猎",accent:15036216,enemyBias:["brute","crawler","ranger","brute","crawler"]}),Object.freeze({id:"glass",name:"蚀光晶原",subtitle:"魔法抗性更高的幽光生物在此繁衍",accent:11110399,enemyBias:["wisp","wisp","ranger","crawler","wisp"]}),Object.freeze({id:"slag",name:"黑渣裂谷",subtitle:"高威胁近战族群守卫着稀有战利品",accent:16757087,enemyBias:["brute","brute","crawler","ranger","brute"]})]);function H_(r,e,t=Mh){const n=r*r+e*e,i=Math.min(n,t*t*.92);return Math.sqrt(t*t-i)-t}function Rl(r,e){return{x:Math.floor((r+Jn*.5)/Jn),z:Math.floor((e+Jn*.5)/Jn)}}function Sh(r,e){return`${r}:${e}`}function V_(r,e){return Al[Math.abs(W_(r,e))%Al.length]}function bo(r,e,t=0,n=1){const i=Math.floor(Math.hypot(r,e)*.72),s=Math.floor(Math.max(0,t)/3),a=Math.max(0,n-1),o=Math.floor(a*.72+Math.max(0,n-10)*.12);return Math.max(1,1+i+s+o)}function G_(r,e,t=0,n=1){return{key:Sh(r,e),x:r,z:e,biome:V_(r,e),threat:bo(r,e,t,n),active:!1,defeated:0,enemyCount:0,clears:0,respawnAt:0,hasBoss:!1,event:null,eventCycle:-1,eventTimeLeft:0}}function W_(r,e){let t=Math.imul(r^2654435769,2246822507);return t=Math.imul(t^e,3266489909),t^=t>>>16,t|0}const Oi="emberfall-save-v1",Cl=34,Pl=Object.freeze([{id:"attack_chain",skill:"火矢",glyph:"⌁",name:"连锁余火",maxRank:3,description:r=>`命中后跳跃至附近 ${r} 个目标，造成 ${30+r*10}% 伤害。`},{id:"attack_burst",skill:"火矢",glyph:"✹",name:"破片火种",maxRank:3,description:r=>`命中产生 ${1.25+r*.25} 米爆炸，造成 ${20+r*8}% 范围伤害。`},{id:"attack_haste",skill:"火矢",glyph:"»",name:"炽热连发",maxRank:3,description:r=>`火矢攻击间隔缩短 ${r*12}%。`},{id:"nova_echo",skill:"震环",glyph:"◎",name:"余震回响",maxRank:3,description:r=>`震环后追加一次 ${36+r*12}% 威力的回响。`},{id:"nova_vortex",skill:"震环",glyph:"◉",name:"熔心引力",maxRank:3,description:r=>`吟唱完成时将 ${7+r} 米内敌人拉向震环中心。`},{id:"nova_overload",skill:"震环",glyph:"✺",name:"过载震波",maxRank:3,description:r=>`震环伤害提高 ${r*18}%，半径扩大 ${(r*.45).toFixed(2)} 米。`},{id:"dash_blast",skill:"裂隙步",glyph:"◇",name:"裂隙爆点",maxRank:3,description:r=>`落点爆炸，对附近敌人造成 ${55+r*20}% 术强伤害。`},{id:"dash_phase",skill:"裂隙步",glyph:"↯",name:"相位折返",maxRank:3,description:r=>`裂隙步冷却缩短 ${(r*.55).toFixed(2)} 秒。`},{id:"dash_guard",skill:"裂隙步",glyph:"⬡",name:"迁跃护壳",maxRank:3,description:r=>`落地获得最大生命 ${r*7}% 的护盾。`},{id:"ward_heal",skill:"结界",glyph:"✦",name:"复苏铜纹",maxRank:3,description:r=>`结界完成时恢复最大生命 ${r*7}%。`},{id:"ward_thorns",skill:"结界",glyph:"♢",name:"反噬棘面",maxRank:3,description:r=>`护盾吸收伤害时，向攻击者反射 ${35+r*15}% 术强伤害。`},{id:"ward_pulse",skill:"结界",glyph:"◌",name:"守御脉冲",maxRank:3,description:r=>`结界展开时对 4 米内敌人造成 ${45+r*20}% 术强伤害。`}]),Aa=Object.freeze({elite:Object.freeze({id:"elite",name:"精英悬赏",description:"一名强化精英统领族群，击杀后必得高阶战利品",color:"#ffbd72"}),rush:Object.freeze({id:"rush",name:"限时猎杀",description:"45 秒内完成净化可获得额外装备与余烬",color:"#6fdbc7"}),volatile:Object.freeze({id:"volatile",name:"爆裂感染",description:"腐化物死亡时爆炸，净化奖励大幅提升",color:"#e782ff"})}),V={shell:document.querySelector("#game-shell"),startScreen:document.querySelector("#start-screen"),pauseScreen:document.querySelector("#pause-screen"),deathScreen:document.querySelector("#death-screen"),victoryScreen:document.querySelector("#victory-screen"),startButton:document.querySelector("#start-button"),startButtonLabel:document.querySelector("#start-button-label"),newRunButton:document.querySelector("#new-run-button"),pauseButton:document.querySelector("#pause-button"),audioButton:document.querySelector("#audio-button"),resumeButton:document.querySelector("#resume-button"),restartButton:document.querySelector("#restart-button"),retryButton:document.querySelector("#retry-button"),continueButton:document.querySelector("#continue-button"),victoryRestartButton:document.querySelector("#victory-restart-button"),potionButton:document.querySelector("#potion-button"),healthLabel:document.querySelector("#health-label"),healthFill:document.querySelector("#health-fill"),shieldFill:document.querySelector("#shield-fill"),xpLabel:document.querySelector("#xp-label"),xpFill:document.querySelector("#xp-fill"),levelLabel:document.querySelector("#level-label"),waveLabel:document.querySelector("#wave-label"),zoneLabel:document.querySelector("#zone-label"),objectiveTitle:document.querySelector("#objective-title"),objectiveText:document.querySelector("#objective-text"),objectivePercent:document.querySelector("#objective-percent"),objectiveFill:document.querySelector("#objective-fill"),damageStat:document.querySelector("#damage-stat"),skillStat:document.querySelector("#skill-stat"),armorStat:document.querySelector("#armor-stat"),resistStat:document.querySelector("#resist-stat"),threatStat:document.querySelector("#threat-stat"),regionEvent:document.querySelector("#region-event"),regionStatus:document.querySelector("#region-status"),shardStat:document.querySelector("#shard-stat"),currentScore:document.querySelector("#current-score"),potionCount:document.querySelector("#potion-count"),relicToggle:document.querySelector("#relic-toggle"),relicDrawer:document.querySelector("#relic-drawer"),relicSlots:document.querySelector("#relic-slots"),relicCount:document.querySelector("#relic-count"),lootFeed:document.querySelector("#loot-feed"),bossBar:document.querySelector("#boss-bar"),bossName:document.querySelector("#boss-name"),bossFill:document.querySelector("#boss-fill"),interactPrompt:document.querySelector("#interact-prompt"),runeScreen:document.querySelector("#rune-screen"),runeChoices:document.querySelector("#rune-choices"),runeProgress:document.querySelector("#rune-progress"),deathWave:document.querySelector("#death-wave"),deathSummary:document.querySelector("#death-summary"),victorySummary:document.querySelector("#victory-summary"),deathScore:document.querySelector("#death-score"),victoryScore:document.querySelector("#victory-score"),deathSubmitStatus:document.querySelector("#death-submit-status"),victorySubmitStatus:document.querySelector("#victory-submit-status"),playerNameInput:document.querySelector("#player-name-input"),rankingButton:document.querySelector("#ranking-button"),startRankingButton:document.querySelector("#start-ranking-button"),rankingPanel:document.querySelector("#ranking-panel"),rankingClose:document.querySelector("#ranking-close"),rankingPlayerName:document.querySelector("#ranking-player-name"),rankingMode:document.querySelector("#ranking-mode"),rankingList:document.querySelector("#ranking-list"),rankingValueLabel:document.querySelector("#ranking-value-label"),rankingTabs:[...document.querySelectorAll("[data-ranking-type]")],minimap:document.querySelector("#minimap"),skillButtons:[...document.querySelectorAll("[data-skill]")]},rn=(r,e,t)=>Math.max(e,Math.min(t,r)),we=(r,e)=>r+Math.random()*(e-r),gr=r=>r[Math.floor(Math.random()*r.length)],Lt=(r,e)=>Math.hypot(r.x-e.x,r.z-e.z);function We(r,e={}){return new Fs({color:r,roughness:e.roughness??.78,metalness:e.metalness??.08,emissive:e.emissive??0,emissiveIntensity:e.emissiveIntensity??0,transparent:e.transparent??!1,opacity:e.opacity??1,side:e.side??Mn})}function le(r,e,t=!0,n=!1){const i=new Wt(r,e);return i.castShadow=t,i.receiveShadow=n,i}function X_(){const r=document.createElement("canvas");r.width=512,r.height=512;const e=r.getContext("2d");e.fillStyle="#173234",e.fillRect(0,0,512,512);for(let n=0;n<16;n+=1)for(let i=0;i<16;i+=1){const s=Math.floor(we(22,39));e.fillStyle=`rgb(${s-4}, ${s+14}, ${s+13})`,e.fillRect(i*32+1,n*32+1,30,30),e.strokeStyle="rgba(3, 14, 15, .32)",e.strokeRect(i*32+.5,n*32+.5,31,31)}e.lineWidth=1;for(let n=0;n<85;n+=1){const i=we(0,512),s=we(0,512);e.beginPath(),e.moveTo(i,s),e.lineTo(i+we(-12,12),s+we(4,18)),e.lineTo(i+we(-20,20),s+we(18,34)),e.strokeStyle=`rgba(2, 9, 10, ${we(.16,.38)})`,e.stroke()}for(let n=0;n<2600;n+=1){const i=we(.015,.07);e.fillStyle=`rgba(220, 225, 201, ${i})`,e.fillRect(we(0,512),we(0,512),1,1)}const t=new xd(r);return t.wrapS=ei,t.wrapT=ei,t.repeat.set(4,4),t.colorSpace=wt,t.anisotropy=8,t}class q_{constructor(){this.canvas=document.querySelector("#game-canvas"),this.clock=new sf,this.scene=new od,this.scene.background=new Pe(463637),this.scene.fog=new Oo(463637,.027),this.renderer=new t_({canvas:this.canvas,antialias:!0,powerPreference:"high-performance"}),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75)),this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=Ll,this.renderer.outputColorSpace=wt,this.renderer.toneMapping=Nl,this.renderer.toneMappingExposure=1.08,this.camera=new Nr(-16,16,10,-10,.1,140),this.cameraOffset=new T(12.5,16.5,12.5),this.cameraTarget=new T,this.raycaster=new vf,this.pointer=new me,this.pointerWorld=new T(0,0,-4),this.keys=new Set,this.state="start",this.elapsed=0,this.wave=1,this.waveTotal=0,this.waveDefeated=0,this.waveActive=!1,this.nextWaveTimer=-1,this.kills=0,this.victorySeen=!1,this.lastSaveAt=0,this.cameraShake=0,this.audio=new B_,this.planetRadius=Mh,this.worldOffset=new me,this.regionStates=new Map,this.currentRegionKey=null,this.regionsCleared=0,this.lastRegionUpdate=0,this.leaderboard=new O_,this.runStats=Ta(),this.runId=this.leaderboard.createRunId(),this.rankingType="score",this.scoreSubmission=null,this.enemies=[],this.projectiles=[],this.drops=[],this.effects=[],this.damageNumbers=[],this.delayedActions=[],this.runeRanks={},this.pendingRuneDrafts=0,this.cursedChest=null,this.cursedChallenge=null,this.phase2Assets={loader:new n_,hero:null,jackal:null,toonGradient:this.createToonGradient(),ready:!1},this.skillState={attack:{cooldown:0,max:.42},nova:{cooldown:0,max:6},dash:{cooldown:0,max:4.2},ward:{cooldown:0,max:12}},this.player={group:null,body:null,target:null,attackTarget:null,speed:7.2,hp:130,maxHp:130,shield:0,damage:20,skillPower:26,armor:5,magicResist:5,attackSpeed:0,critChance:.08,gearScore:0,level:1,xp:0,xpNeeded:100,shards:0,potions:3,relics:[],invulnerable:0,moving:!1,running:!1,action:null,aimDirection:new T(0,0,-1),velocity:new T},this.floatLayer=document.createElement("div"),this.floatLayer.className="float-layer",V.shell.append(this.floatLayer),this.createWorld(),this.createPlayer(),this.loadPhase2Assets(),this.createCursor(),this.bindEvents(),this.resize(),this.refreshSaveState(),this.initializeLeaderboard(),this.syncAudioButton(),this.updateUI(),this.animate()}surfaceHeight(e,t,n=0){return H_(e,t,this.planetRadius)+n}snapToSurface(e,t=0){e.position.y=this.surfaceHeight(e.position.x,e.position.z,t)}getPlayerWorldPosition(){return new me(this.worldOffset.x+this.player.group.position.x,this.worldOffset.y+this.player.group.position.z)}createWorld(){const e=new $d(8239533,528916,1.3);this.scene.add(e);const t=new uh(12313560,2.35);t.position.set(-12,24,9),t.castShadow=!0,t.shadow.mapSize.set(2048,2048),t.shadow.camera.left=-30,t.shadow.camera.right=30,t.shadow.camera.top=30,t.shadow.camera.bottom=-30,t.shadow.camera.near=1,t.shadow.camera.far=70,t.shadow.bias=-4e-4,this.scene.add(t);const n=new vo(15034413,58,22,1.8);n.position.set(0,5,0),this.scene.add(n),this.emberLight=n;const i=new Fs({color:5468266,map:X_(),roughness:.96,metalness:.03}),s=le(new un(this.planetRadius,96,72),i,!1,!0);s.position.y=-this.planetRadius,s.rotation.y=Math.PI*.18,s.userData.isGround=!0,this.scene.add(s),this.ground=s,this.planet=s,this.decor=new je;const a=We(2442053,{roughness:1}),o=We(3104853,{roughness:1});for(let h=0;h<42;h+=1){const u=we(0,Math.PI*2),d=we(19.8,24.6),f=le(new Zt(we(.3,.85),0),Math.random()>.78?o:a),g=Math.cos(u)*d,_=Math.sin(u)*d;f.position.set(g,this.surfaceHeight(g,_)+we(.05,.22),_),f.scale.y=we(.45,1.1),f.rotation.set(we(0,1),we(0,Math.PI),we(0,1)),this.decor.add(f)}this.scene.add(this.decor),this.landmarks=new je,this.scene.add(this.landmarks),this.createCenterForge(),this.createBraziers();const c=new yt,l=new Float32Array(660);for(let h=0;h<220;h+=1)l[h*3]=we(-28,28),l[h*3+1]=we(.2,8),l[h*3+2]=we(-28,28);c.setAttribute("position",new It(l,3)),this.dust=new nh(c,new Vo({color:7780521,size:.045,transparent:!0,opacity:.28,depthWrite:!1})),this.scene.add(this.dust)}createCenterForge(){const e=new je,t=We(8606268,{roughness:.48,metalness:.55,emissive:4921096,emissiveIntensity:.24}),n=We(1520694,{roughness:.9}),i=le(new St(4.4,4.65,.25,12),n,!1,!0);i.position.y=.03,e.add(i);const s=le(new dn(3.45,.09,8,64),t,!1);s.rotation.x=Math.PI/2,s.position.y=.2,e.add(s);for(let o=0;o<8;o+=1){const c=o/8*Math.PI*2,l=le(new bt(.13,.05,2.3),t,!1);l.position.set(Math.sin(c)*1.75,.22,Math.cos(c)*1.75),l.rotation.y=c,e.add(l)}const a=le(new Vt(.52,0),We(14904113,{emissive:14904113,emissiveIntensity:2.4,roughness:.28}),!1);a.position.y=.82,e.add(a),this.forgeCore=a,this.landmarks.add(e)}createBraziers(){this.flames=[];const e=We(4932667,{metalness:.65,roughness:.45}),t=We(16741428,{emissive:16731416,emissiveIntensity:3,roughness:.2});for(let n=0;n<6;n+=1){const i=n/6*Math.PI*2+Math.PI/6,s=new je;s.position.set(Math.cos(i)*16.8,0,Math.sin(i)*16.8),s.position.y=this.surfaceHeight(s.position.x,s.position.z);const a=le(new St(.12,.19,1.5,8),e);a.position.y=.75,s.add(a);const o=le(new St(.62,.3,.35,8),e);o.position.y=1.55,s.add(o);const c=le(new Jt(.28,.85,7),t,!1);c.position.y=2.13,s.add(c),this.flames.push(c);const l=new vo(16739629,8,7,2);l.position.y=2.25,s.add(l),this.landmarks.add(s)}}createPlayer(){const e=new je,t=new je;e.add(t);const n=We(2251865,{roughness:.86}),i=We(1060657,{roughness:.9}),s=We(10446148,{roughness:.42,metalness:.5}),a=We(4860963,{roughness:.82}),o=We(2693912,{roughness:.94}),c=We(1709845,{roughness:1}),l=We(16751700,{emissive:16738861,emissiveIntensity:2.8,roughness:.25}),h=new je;t.add(h);const u=le(new Jt(.72,1.8,7),n);u.position.y=1.2,u.rotation.y=Math.PI/7,h.add(u);const d=le(new St(.43,.55,1.15,7),i);d.position.y=1.55,h.add(d);const f=le(new bt(.56,.5,.12),s);f.position.set(0,1.62,-.45),f.rotation.x=-.08,h.add(f);const g=le(new bt(.72,1.05,.08),We(1657416,{roughness:.92,side:xt}));g.position.set(0,.82,.45),g.rotation.x=-.12,h.add(g);const _=new je;_.position.y=2.25,h.add(_);const m=le(new un(.48,12,10,0,Math.PI*2,0,Math.PI*.78),n);m.scale.z=.9,_.add(m);const p=le(new un(.31,10,8),c,!1);p.position.set(0,-.06,-.27),p.scale.set(.9,.8,.35),_.add(p);const M=le(new bt(.17,.035,.03),l,!1);M.position.set(0,-.02,-.385),_.add(M);const b=le(new dn(.46,.055,6,20),s);b.rotation.x=Math.PI/2,b.position.y=1.25,h.add(b);const v=H=>{const ne=new je;ne.position.set(H*.23,.82,0);const he=le(new St(.13,.16,.72,7),a);he.position.y=-.34,ne.add(he);const ve=le(new bt(.3,.28,.48),o);return ve.position.set(0,-.77,-.1),ne.add(ve),t.add(ne),ne},P=v(-1),R=v(1),A=H=>{const ne=new je;ne.position.set(H*.54,1.87,0);const he=le(new St(.13,.17,.66,7),n);he.position.y=-.29,ne.add(he);const ve=le(new un(.15,8,6),a);ve.position.y=-.67,ne.add(ve);const Be=le(new Zt(.25,0),s);return Be.position.y=-.02,Be.scale.set(1.2,.7,1),ne.add(Be),h.add(ne),ne},C=A(-1),S=A(1),x=new je,I=le(new St(.055,.065,2.5,7),a);I.position.y=.2,x.add(I);const k=le(new dn(.25,.045,7,20),s);k.position.y=1.44,k.rotation.x=Math.PI/2,x.add(k);const O=le(new Vt(.18,0),l,!1);O.position.y=1.44,x.add(O);const X=le(new Jt(.045,.42,5),s);X.position.set(-.16,1.28,0),X.rotation.z=-.6,x.add(X);const Y=X.clone();Y.position.x=.16,Y.rotation.z=.6,x.add(Y),x.position.set(.04,-.68,.03),x.rotation.z=-.08,S.add(x),this.playerStaff=x,this.playerStaffGem=O;const W=le(new bs(.78,24),new ke({color:0,transparent:!0,opacity:.32,depthWrite:!1}),!1);W.rotation.x=-Math.PI/2,W.position.y=.015,e.add(W);const J=le(new pi(.82,.92,32),new ke({color:6474169,transparent:!0,opacity:.3,depthWrite:!1,side:xt}),!1);J.rotation.x=-Math.PI/2,J.position.y=.025,e.add(J),this.playerRing=J,e.position.set(0,0,6),this.scene.add(e),this.player.group=e,this.player.body=t,this.player.proceduralBodyChildren=[...t.children],this.player.rig={torso:h,hoodPivot:_,cloak:u,cloakTail:g,leftArm:C,rightArm:S,leftLeg:P,rightLeg:R,staff:x,staffGem:O,eye:M}}createToonGradient(){const e=new Uint8Array([54,54,54,255,116,116,116,255,188,188,188,255,255,255,255,255]),t=new ko(e,4,1,en);return t.minFilter=Dt,t.magFilter=Dt,t.generateMipmaps=!1,t.needsUpdate=!0,t}createImportedToonMaterial(e){const t=new Ud({color:e.color?.clone()??new Pe(16777215),map:e.map??null,gradientMap:this.phase2Assets.toonGradient,emissive:e.emissive?.clone()??new Pe(0),emissiveMap:e.emissiveMap??null,emissiveIntensity:e.emissiveIntensity??1,transparent:e.transparent,opacity:e.opacity,alphaTest:e.alphaTest,side:e.side,depthWrite:e.depthWrite,vertexColors:e.vertexColors});return t.name=`${e.name||"Phase2"}_Toon`,t.userData.baseEmissive=t.emissive.getHex(),t.userData.baseIntensity=t.emissiveIntensity,t}prepareImportedModel(e,t){const n=new Map;return e.scale.setScalar(t),e.traverse(i=>{if(!i.isMesh)return;i.castShadow=!0,i.receiveShadow=!0,i.frustumCulled=!1;const s=a=>(n.has(a.uuid)||n.set(a.uuid,this.createImportedToonMaterial(a)),n.get(a.uuid));i.material=Array.isArray(i.material)?i.material.map(s):s(i.material)}),[...n.values()]}createAnimationController(e,t,n=[]){const i=new _f(e),s=new Map,a=new Set(n);return t.forEach(o=>{const c=i.clipAction(o);a.has(o.name)&&(c.setLoop(uo,1),c.clampWhenFinished=!0),s.set(o.name,c)}),{mixer:i,actions:s,current:null,currentName:null,oneShots:a}}switchAnimation(e,t,n=.12){if(!e)return;const i=e.actions.has(t)?t:"Idle";if(e.currentName===i)return;const s=e.actions.get(i);if(!s)return;const a=e.current;e.oneShots.has(i)?(s.setLoop(uo,1),s.clampWhenFinished=!0):(s.setLoop(Wl,1/0),s.clampWhenFinished=!1),s.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play(),a&&a!==s&&a.fadeOut(n),s.fadeIn(n),e.current=s,e.currentName=i}async loadPhase2Assets(){const[t,n]=await Promise.allSettled([this.phase2Assets.loader.loadAsync("./assets/models/starforge-traveler-v1.glb"),this.phase2Assets.loader.loadAsync("./assets/models/verdigris-lantern-jackal-v1.glb")]);t.status==="fulfilled"?(this.phase2Assets.hero=t.value,this.attachPhase2PlayerModel()):console.warn("Phase 2 hero asset unavailable; procedural player retained.",t.reason),n.status==="fulfilled"?(this.phase2Assets.jackal=n.value,this.enemies.filter(i=>i.type==="wisp"&&!i.dead).forEach(i=>this.attachPhase2EnemyModel(i))):console.warn("Phase 2 monster asset unavailable; procedural wisps retained.",n.reason),this.phase2Assets.ready=t.status==="fulfilled"&&n.status==="fulfilled",document.body.dataset.phase2Assets=this.phase2Assets.ready?"ready":"fallback"}attachPhase2PlayerModel(){if(!this.phase2Assets.hero||this.player.phase2Model)return;const e=bl(this.phase2Assets.hero.scene);e.name="StarforgeTraveler_Runtime",this.prepareImportedModel(e,1.16),this.player.proceduralBodyChildren.forEach(t=>{t.visible=!1}),this.player.body.position.y=0,this.player.body.rotation.x=0,this.player.body.rotation.z=0,this.player.body.scale.setScalar(1),this.player.body.add(e),this.player.phase2Model=e,this.player.animation=this.createAnimationController(e,this.phase2Assets.hero.animations,["Attack_Cast","Nova_Cast","Dash","Ward_Cast","Hit","Death"]),this.player.rig.staffGem=e.getObjectByName("StaffGem")??this.player.rig.staffGem,this.switchAnimation(this.player.animation,"Idle",0)}attachPhase2EnemyModel(e){if(!this.phase2Assets.jackal||e.phase2Model||e.dead)return;const t=bl(this.phase2Assets.jackal.scene);t.name="VerdigrisLanternJackal_Runtime";const n=this.prepareImportedModel(t,.88);e.proceduralBodyChildren=[...e.body.children],e.proceduralBodyChildren.forEach(i=>{i.visible=!1}),e.body.add(t),e.phase2Model=t,e.materials.push(...n),e.animation=this.createAnimationController(t,this.phase2Assets.jackal.animations,["Attack_Aim","Attack_Volley","Hit","Armor_Break","Death"]),this.switchAnimation(e.animation,"Idle",0)}createCursor(){const e=new ke({color:15104061,transparent:!0,opacity:.7,depthWrite:!1,side:xt});this.cursor=le(new pi(.28,.38,4),e,!1),this.cursor.rotation.x=-Math.PI/2,this.cursor.rotation.z=Math.PI/4,this.cursor.position.y=.04,this.scene.add(this.cursor)}bindEvents(){window.addEventListener("resize",()=>this.resize()),this.canvas.addEventListener("pointermove",e=>{const t=this.canvas.getBoundingClientRect();this.pointer.x=(e.clientX-t.left)/t.width*2-1,this.pointer.y=-((e.clientY-t.top)/t.height)*2+1,this.updatePointerWorld()}),this.canvas.addEventListener("pointerdown",e=>{if(this.audio.unlock(),e.button!==0||this.state!=="running")return;this.updatePointerWorld();const t=this.pickEnemy();t?(this.player.attackTarget=t,this.player.target=null,this.tryAttack(t)):(this.player.attackTarget=null,this.player.target=this.pointerWorld.clone(),this.spawnClickMarker(this.player.target))}),window.addEventListener("keydown",e=>{if(["KeyW","KeyA","KeyS","KeyD","Space","KeyQ","KeyE","KeyF","KeyG","KeyR","Escape"].includes(e.code)&&e.preventDefault(),e.code==="Escape"){if(V.rankingPanel.classList.contains("open")){this.closeRanking();return}this.state==="running"?this.pause():this.state==="paused"&&this.resume();return}this.keys.add(e.code),this.state==="running"&&this.audio.unlock(),!(e.repeat||this.state!=="running")&&(e.code==="Space"&&this.tryAttack(),e.code==="KeyQ"&&this.castNova(),e.code==="KeyE"&&this.castDash(),e.code==="KeyF"&&this.castWard(),e.code==="KeyG"&&this.interactWithChest(),e.code==="KeyR"&&this.usePotion())}),window.addEventListener("keyup",e=>this.keys.delete(e.code)),V.startButton.addEventListener("click",()=>{this.audio.unlock(),this.syncPlayerName(),this.startRun(this.hasSave())}),V.newRunButton.addEventListener("click",()=>{this.audio.unlock(),this.syncPlayerName(),this.submitCurrentScore(),this.startRun(!1)}),V.pauseButton.addEventListener("click",()=>this.pause()),V.resumeButton.addEventListener("click",()=>this.resume()),V.restartButton.addEventListener("click",()=>{this.submitCurrentScore(),this.startRun(!1)}),V.retryButton.addEventListener("click",()=>this.startRun(!1)),V.continueButton.addEventListener("click",()=>this.continueAfterVictory()),V.victoryRestartButton.addEventListener("click",()=>{this.audio.unlock(),this.submitCurrentScore(),this.startRun(!1)}),V.potionButton.addEventListener("click",()=>this.usePotion()),V.interactPrompt.addEventListener("click",()=>this.interactWithChest()),V.audioButton.addEventListener("click",()=>{this.audio.toggle(),this.syncAudioButton()}),V.relicToggle.addEventListener("click",()=>V.relicDrawer.classList.toggle("collapsed")),V.playerNameInput.addEventListener("change",()=>this.syncPlayerName()),V.rankingButton.addEventListener("click",()=>this.openRanking()),V.startRankingButton.addEventListener("click",()=>this.openRanking()),V.rankingClose.addEventListener("click",()=>this.closeRanking()),V.rankingTabs.forEach(e=>{e.addEventListener("click",()=>this.loadRanking(e.dataset.rankingType))}),V.skillButtons.forEach(e=>{e.addEventListener("click",()=>{const t=e.dataset.skill;t==="attack"&&this.tryAttack(),t==="nova"&&this.castNova(),t==="dash"&&this.castDash(),t==="ward"&&this.castWard()})})}initializeLeaderboard(){const e=this.leaderboard.getProfile();V.playerNameInput.value=e.name,V.rankingPlayerName.textContent=e.name,V.rankingMode.textContent=this.leaderboard.mode==="online"?"全服榜":"本地榜"}syncAudioButton(){const e=this.audio.isEnabled();V.audioButton.classList.toggle("muted",!e),V.audioButton.setAttribute("aria-pressed",String(e)),V.audioButton.setAttribute("aria-label",e?"关闭声音":"开启声音"),V.audioButton.title=e?"关闭音乐与音效":"开启音乐与音效"}syncPlayerName(){const e=this.leaderboard.setPlayerName(V.playerNameInput.value);V.playerNameInput.value=e.name,V.rankingPlayerName.textContent=e.name}openRanking(){this.syncPlayerName(),this.resumeAfterRanking=this.state==="running",this.resumeAfterRanking&&(this.state="paused"),V.rankingPanel.classList.add("open"),this.loadRanking(this.rankingType)}closeRanking(){V.rankingPanel.classList.remove("open"),this.resumeAfterRanking&&this.state==="paused"&&(this.state="running",this.clock.getDelta()),this.resumeAfterRanking=!1}async loadRanking(e="score"){this.rankingType=e==="points"?"points":"score",V.rankingTabs.forEach(n=>{const i=n.dataset.rankingType===this.rankingType;n.classList.toggle("active",i),n.setAttribute("aria-selected",String(i))}),V.rankingValueLabel.textContent=this.rankingType==="points"?"累计积分":"最高分",V.rankingList.innerHTML='<li class="ranking-empty">正在读取试炼记录…</li>';const t=await this.leaderboard.list(this.rankingType,20);this.renderRanking(t.entries,t.mode)}renderRanking(e,t){if(V.rankingMode.textContent=t==="online"?"全服在线":"当前设备",V.rankingList.replaceChildren(),!e.length){const i=document.createElement("li");i.className="ranking-empty",i.textContent=this.rankingType==="points"?"还没有累计积分，完成一次试炼即可上榜。":"还没有成绩，成为第一位试炼者。",V.rankingList.append(i);return}const n=this.leaderboard.getProfile().id;e.forEach((i,s)=>{const a=document.createElement("li"),o=i.isCurrentPlayer||i.playerId===n;a.className=`ranking-entry${o?" current":""}`;const c=document.createElement("span");c.className="rank",c.textContent=String(i.rank??s+1).padStart(2,"0");const l=document.createElement("span");l.className="ranking-identity";const h=document.createElement("strong");h.textContent=i.playerName||"无名旅者";const u=document.createElement("small");u.textContent=`最高第 ${i.bestWave??1} 波 · ${i.kills??0} 次击杀`,l.append(h,u);const d=document.createElement("strong");d.className="ranking-value",d.textContent=mr(i.value),a.append(c,l,d),V.rankingList.append(a)})}async submitCurrentScore(e){return Er(this.runStats).total<=0?(e&&(e.textContent="尚未获得积分"),null):(e&&(e.textContent="正在同步成绩…"),this.scoreSubmission?this.scoreSubmission:(this.scoreSubmission=this.leaderboard.submit(this.runId,this.runStats).then(n=>{const i=n.mode==="online"?"已同步全服榜":n.fallback?"网络不可用，已保存本地榜":"已保存本地榜",s=n.pointsAdded>0?` · 新增 ${mr(n.pointsAdded)} 分`:" · 成绩已记录";return e&&(e.textContent=`${i}${s}`),V.rankingPanel.classList.contains("open")&&this.loadRanking(this.rankingType),n}).finally(()=>{this.scoreSubmission=null}),this.scoreSubmission))}resize(){const e=window.innerWidth,t=window.innerHeight;this.renderer.setSize(e,t,!1);const n=e/t,i=e<700?23:20;this.camera.left=-i*n/2,this.camera.right=i*n/2,this.camera.top=i/2,this.camera.bottom=-i/2,this.camera.updateProjectionMatrix()}updatePointerWorld(){this.raycaster.setFromCamera(this.pointer,this.camera);const e=this.raycaster.intersectObject(this.ground,!1)[0];e&&(this.pointerWorld.copy(e.point),this.cursor.position.x=this.pointerWorld.x,this.cursor.position.y=this.pointerWorld.y+.04,this.cursor.position.z=this.pointerWorld.z)}pickEnemy(){const e=this.enemies.filter(n=>!n.dead).map(n=>n.hitbox);return this.raycaster.intersectObjects(e,!1)[0]?.object?.userData?.enemy??null}startRun(e){this.clearRuntimeObjects(),this.resetPlayerStats(),this.wave=1,this.kills=0,this.victorySeen=!1,this.runStats=Ta(),this.runId=this.leaderboard.createRunId(),this.scoreSubmission=null,this.worldOffset.set(0,0),this.regionStates.clear(),this.currentRegionKey=null,this.regionsCleared=0,this.runeRanks={},this.pendingRuneDrafts=0,this.cursedChallenge=null,e&&this.loadSave(),this.player.group.position.set(0,this.surfaceHeight(0,6),6),this.landmarks.position.set(-this.worldOffset.x,0,-this.worldOffset.y),this.planet.rotation.x=this.worldOffset.y/this.planetRadius,this.planet.rotation.z=-this.worldOffset.x/this.planetRadius,this.player.target=null,this.player.attackTarget=null,this.player.action=null,this.player.invulnerable=1.8,this.state="running",this.nextWaveTimer=-1,this.skillState.attack.cooldown=0,this.skillState.nova.cooldown=0,this.skillState.dash.cooldown=0,this.skillState.ward.cooldown=0,document.body.classList.add("game-started"),V.startScreen.classList.remove("active"),V.pauseScreen.classList.remove("active"),V.deathScreen.classList.remove("active"),V.victoryScreen.classList.remove("active"),V.runeScreen.classList.remove("active"),this.updateCurrentRegion(!0),this.updateUI(),this.pendingRuneDrafts>0&&this.openNextRuneDraft()}resetPlayerStats(){Object.assign(this.player,{hp:130,maxHp:130,shield:0,damage:20,skillPower:26,armor:5,magicResist:5,attackSpeed:0,critChance:.08,gearScore:0,level:1,xp:0,xpNeeded:100,shards:0,potions:3,relics:[],invulnerable:0,speed:7.2,moving:!1,running:!1,action:null}),this.player.velocity.set(0,0,0),this.runeRanks={},this.pendingRuneDrafts=0}clearRuntimeObjects(){this.enemies.forEach(e=>{e.telegraph&&(this.scene.remove(e.telegraph.ring),this.scene.remove(e.telegraph.disc))}),[...this.enemies,...this.projectiles,...this.drops].forEach(e=>{e.group&&this.scene.remove(e.group),e.mesh&&this.scene.remove(e.mesh),e.trailLine&&this.scene.remove(e.trailLine)}),this.effects.forEach(e=>{e.object&&this.scene.remove(e.object)}),this.cursedChest?.group&&this.scene.remove(this.cursedChest.group),this.enemies=[],this.projectiles=[],this.drops=[],this.effects=[],this.delayedActions=[],this.cursedChest=null,this.cursedChallenge=null,this.floatLayer.replaceChildren(),V.bossBar.classList.add("hidden"),V.interactPrompt.classList.add("hidden")}spawnWave(){const e=this.regionStates.get(this.currentRegionKey);e&&this.spawnRegionPack(e)}chooseEnemyType(e){const t=Math.random(),n=gr(e?.biome?.enemyBias??["crawler","wisp","ranger","brute"]);return(e?.threat??1)<2&&n==="brute"&&t<.68?"crawler":t>.82&&(e?.threat??1)>=2?"brute":n}assignRegionEvent(e){if(e.eventCycle===e.clears)return;e.eventCycle=e.clears,e.eventTimeLeft=0;const t=Math.random();e.event=t<.26?null:t<.51?Aa.elite:t<.76?Aa.rush:Aa.volatile}applyRegionEventToEnemy(e,t,n=!1){!e||!t.event||(t.event.id==="rush"&&(e.eventSpeedMultiplier*=1.18,e.eventDamageMultiplier*=1.08,e.speed*=1.18,e.damage=Math.round(e.damage*1.08)),t.event.id==="volatile"&&(e.volatile=!0,e.xp=Math.round(e.xp*1.2)),t.event.id==="elite"&&n&&(e.elite=!0,e.eventSpeedMultiplier*=1.08,e.eventDamageMultiplier*=1.5,e.name=`悬赏 · ${e.name}`,e.maxHp=Math.round(e.maxHp*2.35),e.hp=e.maxHp,e.damage=Math.round(e.damage*1.5),e.speed*=1.08,e.xp=Math.round(e.xp*2.4),e.group.scale.multiplyScalar(1.18),e.materials.forEach(i=>{i.emissive.setHex(7285768),i.emissiveIntensity=Math.max(i.emissiveIntensity,.65)}),e.threatAura||this.createEnemyThreatAura(e)))}syncRegionEvent(e){if(!e?.event){V.regionEvent.classList.remove("active"),V.regionEvent.style.removeProperty("--event-color"),V.regionEvent.innerHTML="<span>区域异象</span><strong>无异常规则</strong>";return}let t="";e.event.id==="rush"&&e.active&&(t=` · ${Math.max(0,Math.ceil(e.eventTimeLeft))}s`),V.regionEvent.classList.add("active"),V.regionEvent.style.setProperty("--event-color",e.event.color),V.regionEvent.innerHTML=`<span>${e.event.name}${t}</span><strong>${e.event.description}</strong>`}updateCurrentRegion(e=!1){const t=this.getPlayerWorldPosition(),n=Rl(t.x,t.y),i=Sh(n.x,n.z);if(!e&&i===this.currentRegionKey)return;if(!e&&this.currentRegionKey){const a=this.regionStates.get(this.currentRegionKey),o=.62;if(a&&Math.abs(t.x-a.x*Jn)<Jn*o&&Math.abs(t.y-a.z*Jn)<Jn*o)return}this.currentRegionKey=i;let s=this.regionStates.get(i);s||(s=G_(n.x,n.z,this.regionsCleared,this.player.level),this.regionStates.set(i,s)),s.threat=bo(s.x,s.z,this.regionsCleared+s.clears,this.player.level),this.wave=s.threat,V.zoneLabel.textContent=s.biome.name,V.objectiveTitle.textContent=s.biome.subtitle,this.despawnDistantRegions(),!s.active&&Date.now()>=s.respawnAt?this.spawnRegionPack(s):this.syncRegionObjective(s),this.addFeed(`<b>${s.biome.name}</b> · 威胁 ${s.threat} · 球面区域 ${s.x}, ${s.z}`)}spawnRegionPack(e){this.assignRegionEvent(e),e.active=!0,e.defeated=0,e.threat=bo(e.x,e.z,this.regionsCleared+e.clears,this.player.level);const t=Math.abs(e.x*5+e.z*7+e.clears+this.regionsCleared);e.hasBoss=e.threat>=2&&t%2===1;const n=e.event?.id==="rush"?2:e.event?.id==="volatile"||e.event?.id==="elite"?1:0,i=Math.floor(Math.max(0,this.player.level-8)/8),s=Math.min(20,5+Math.floor(e.threat*.72)+i+(e.hasBoss?1:0)+n);e.enemyCount=s,e.event?.id==="rush"&&(e.eventTimeLeft=45),this.waveActive=!0,this.waveDefeated=0,this.waveTotal=s,this.wave=e.threat;let a=0,o=!1;const c=Math.min(s-1,Math.ceil(s*.64),2+Math.floor(Math.max(0,e.threat-1)*.72)+Math.floor(Math.max(0,this.player.level-10)/10));for(let l=0;l<s;l+=1){let h=e.hasBoss&&l===0?"boss":this.chooseEnemyType(e);["wisp","ranger"].includes(h)&&(a>=c?h=e.threat>=2&&Math.random()>.55?"brute":"crawler":a+=1);const u=l/s*Math.PI*2+we(-.42,.42),d=we(14.5,z_),f=this.player.group.position.clone().add(new T(Math.cos(u)*d,0,Math.sin(u)*d));f.y=this.surfaceHeight(f.x,f.z);const g=this.spawnEnemy(h,f,{regionKey:e.key,threat:e.threat,biome:e.biome}),_=e.event?.id==="elite"&&!o&&h!=="boss";this.applyRegionEventToEnemy(g,e,_),o||=_}V.bossBar.classList.toggle("hidden",!e.hasBoss),this.addFeed(e.event?`<b>${e.event.name}</b> · ${e.event.description}`:e.hasBoss?"<b>区域霸主苏醒</b> · 红色为物理冲击，紫色为魔法风暴":`<b>${e.biome.name}</b> · 腐化族群重新出现`),e.hasBoss&&e.event&&this.addFeed("<b>区域霸主苏醒</b> · 红色为物理冲击，紫色为魔法风暴"),this.syncRegionObjective(e),this.updateUI()}syncRegionObjective(e){if(e)if(this.syncRegionEvent(e),e.active){const t=Math.max(0,e.enemyCount-e.defeated);V.objectiveText.textContent=`区域敌人 ${t} · 刷新随机`,V.objectivePercent.textContent=`${Math.round(e.defeated/Math.max(1,e.enemyCount)*100)}%`,V.objectiveFill.style.width=`${e.defeated/Math.max(1,e.enemyCount)*100}%`}else{const t=Math.max(0,Math.ceil((e.respawnAt-Date.now())/1e3));V.objectiveText.textContent=t>0?`腐化将在 ${t} 秒后重聚`:"腐化正在重新聚集",V.objectivePercent.textContent="探索",V.objectiveFill.style.width="0%"}}despawnDistantRegions(){const e=new Set;this.enemies.forEach(t=>{!t.dead&&t.regionKey!==this.currentRegionKey&&Lt(t.group.position,this.player.group.position)>28&&e.add(t.regionKey)}),e.forEach(t=>{this.enemies.filter(i=>i.regionKey===t).forEach(i=>{i.telegraph&&(this.scene.remove(i.telegraph.ring),this.scene.remove(i.telegraph.disc)),this.scene.remove(i.group)}),this.enemies=this.enemies.filter(i=>i.regionKey!==t);const n=this.regionStates.get(t);n&&(n.active=!1,n.defeated=0,n.respawnAt=0)})}createCursedChestModel(){const e=new je,t=We(1972265,{roughness:.42,metalness:.72,emissive:2229816,emissiveIntensity:.55}),n=We(8211093,{roughness:.28,metalness:.65,emissive:9251794,emissiveIntensity:2.2}),i=le(new bt(1.45,.68,1.02),t);i.position.y=.38,e.add(i);const s=le(new bt(1.52,.16,1.08),n);s.position.y=.48,e.add(s);const a=new je;a.position.set(0,.72,-.46);const o=le(new bt(1.48,.34,1.04),t);o.position.set(0,.12,.46),a.add(o);const c=le(new bt(.22,.39,1.1),n);c.position.set(0,.13,.46),a.add(c),e.add(a);const l=le(new Vt(.2,0),We(14125823,{emissive:11351551,emissiveIntensity:4.2,roughness:.12}),!1);return l.position.set(0,1.12,.08),e.add(l),{group:e,lidPivot:a,core:l}}spawnCursedChest(e){if(this.cursedChallenge||this.cursedChest?.status==="sealed")return;this.cursedChest?.group&&this.scene.remove(this.cursedChest.group);const t=this.createCursedChestModel(),n=we(0,Math.PI*2),i=this.player.group.position.clone().add(new T(Math.cos(n)*2.5,0,Math.sin(n)*2.5)),s=this.surfaceHeight(i.x,i.z,.04);t.group.position.set(i.x,s,i.z),t.group.rotation.y=we(-.4,.4),this.scene.add(t.group),this.cursedChest={...t,status:"sealed",regionKey:e.key,threat:e.threat,baseY:s,life:1/0},this.spawnEnergyColumn(t.group.position.clone(),10501340,.45,3.2),this.addFeed("<b>诅咒宝箱出现</b> · 靠近后按 G 开启高风险挑战")}interactWithChest(){const e=this.cursedChest;this.state!=="running"||!e||e.status!=="sealed"||Lt(e.group.position,this.player.group.position)>2.8||this.startCursedChallenge(e)}startCursedChallenge(e){e.status="active",e.lidPivot.rotation.x=-.78;const t=Math.min(8,4+Math.floor(e.threat*.75));this.cursedChallenge={chest:e,kills:0,required:t,timer:30,maxTimer:30};const n=this.regionStates.get(e.regionKey);n&&(n.respawnAt=Math.max(n.respawnAt,Date.now()+7e4)),this.audio.play("bossMagicWarning",1.18),this.spawnRing(e.group.position.clone(),6.8,10832082,.7),this.spawnEnergyColumn(e.group.position.clone(),10832082,.68,6.4);for(let i=0;i<t;i+=1){const s=i/t*Math.PI*2+we(-.24,.24),a=we(7.5,11),o=e.group.position.clone().add(new T(Math.cos(s)*a,0,Math.sin(s)*a));o.y=this.surfaceHeight(o.x,o.z);const c=this.spawnEnemy(gr(["crawler","wisp","ranger","brute"]),o,{regionKey:"__cursed__",threat:e.threat+1,cursed:!0});c.maxHp=Math.round(c.maxHp*1.22),c.hp=c.maxHp,c.damage=Math.round(c.damage*1.16),c.xp=Math.round(c.xp*1.35),c.materials.forEach(l=>{l.emissive.setHex(5574776),l.emissiveIntensity=Math.max(.7,l.emissiveIntensity)})}this.addFeed(`<b>诅咒试炼</b> · 30 秒内击败 ${t} 名强化敌人`)}resolveCursedChallenge(e){const t=this.cursedChallenge;if(!t)return;const{chest:n}=t;if(this.cursedChallenge=null,e){n.status="opened",n.life=9;const i=n.group.position.clone();this.spawnDrop("gear",i,{level:n.threat+1,boss:!0}),this.spawnDrop("gear",i.clone().add(new T(.75,0,.35)),{level:n.threat+1,boss:!1}),this.spawnDrop("shard",i.clone().add(new T(-.65,0,.25)),30+n.threat*8),this.audio.play("regionClear",1.45),this.spawnBurst(i.clone().add(new T(0,1,0)),28,14059007,7),this.addFeed("<b>诅咒破除</b> · 获得双重装备、余烬与一次额外符文选择"),this.scheduleAction(.75,()=>this.queueRuneDraft())}else n.status="failed",n.life=5,this.enemies.filter(s=>s.cursed&&!s.dead).forEach(s=>{s.dead=!0,this.scene.remove(s.group)}),this.enemies=this.enemies.filter(s=>!s.cursed||s.dead===!1),this.spawnRing(n.group.position.clone(),9,10368455,.72),this.damagePlayer(Math.round(this.player.maxHp*.38),{group:n.group,type:"curse",damageType:"magic"},"magic"),this.audio.play("bossMagicImpact",1.25),this.addFeed("<b>诅咒反噬</b> · 挑战失败，损失大量生命且没有奖励")}updateCursedChest(e){const t=this.cursedChest;if(!t){V.interactPrompt.classList.add("hidden");return}t.group.position.y=t.baseY+Math.sin(this.elapsed*2.6)*.06,t.core.rotation.y+=e*2.8,t.core.position.y=1.12+Math.sin(this.elapsed*5.2)*.08;const n=Lt(t.group.position,this.player.group.position);t.status==="sealed"&&n<=2.8?(V.interactPrompt.classList.remove("hidden","challenge"),V.interactPrompt.querySelector("small").textContent="高风险交互",V.interactPrompt.querySelector("strong").textContent="开启诅咒宝箱"):t.status==="active"&&this.cursedChallenge?(this.cursedChallenge.timer-=e,V.interactPrompt.classList.remove("hidden"),V.interactPrompt.classList.add("challenge"),V.interactPrompt.querySelector("small").textContent=`${this.cursedChallenge.kills} / ${this.cursedChallenge.required} 击杀`,V.interactPrompt.querySelector("strong").textContent=`诅咒倒计时 ${Math.ceil(this.cursedChallenge.timer)} 秒`,this.cursedChallenge.timer<=0&&this.resolveCursedChallenge(!1)):V.interactPrompt.classList.add("hidden"),Number.isFinite(t.life)&&(t.life-=e,t.life<=0&&(this.scene.remove(t.group),this.cursedChest=null,V.interactPrompt.classList.add("hidden")))}spawnEnemy(e,t,n={}){const s={crawler:{name:"锈牙爬兽",hp:42,speed:3.45,damage:6,range:1.25,xp:18,radius:.62,armor:2,magicResist:1,damageType:"physical"},wisp:{name:"蚀光幽魂",hp:34,speed:3.15,damage:6,range:9,preferredRange:7,xp:22,radius:.5,armor:1,magicResist:8,ranged:!0,damageType:"magic"},ranger:{name:"腐弦猎手",hp:52,speed:2.7,damage:8,range:11,preferredRange:8.5,xp:27,radius:.7,armor:5,magicResist:3,ranged:!0,damageType:"physical"},brute:{name:"铸渣蛮兵",hp:92,speed:2.15,damage:12,range:1.65,xp:34,radius:.9,armor:10,magicResist:2,damageType:"physical"},boss:{name:(n.threat??this.wave)>3?"再铸暴君":"熔铸暴君",hp:520,speed:1.72,damage:21,range:2.05,xp:190,radius:1.4,armor:16,magicResist:12,damageType:"physical"}}[e],a=Math.max(1,n.threat??this.wave),o=Math.max(0,a-1),c=this.getEnemyHealthScale(a,e==="boss"),l=this.getThreatDamageMultiplier(a,e==="boss"),h=this.getEnemyAttackRate(a),u=this.getEnemyDefensePenetration(a),d=this.getEnemyMovementMultiplier(a,e==="boss"),f=this.getEnemyProjectileSpeedMultiplier(a),g=s.ranged?Math.min(3.5,o*.08+Math.max(0,this.player.level-1)*.075):0,_=this.getAdaptiveEnemyDamage(s.damage,a,e==="boss",s.damageType,u),m=a*.06+Math.max(0,this.player.level-1)*.04,p={type:e,name:s.name,group:new je,body:new je,hitbox:null,hp:Math.round(s.hp*c),maxHp:Math.round(s.hp*c),baseDamage:s.damage,baseSpeed:s.speed,speed:s.speed*d,damage:_,range:s.range+g,preferredRange:(s.preferredRange??s.range)+g*.72,xp:Math.round(s.xp*c),radius:s.radius,armor:Math.round(s.armor*(1+Math.max(0,a-1)*.12)),magicResist:Math.round(s.magicResist*(1+Math.max(0,a-1)*.12)),ranged:!!s.ranged,damageType:s.damageType,damageScale:l,attackRate:h,defensePenetration:u,movementScale:d,projectileSpeedScale:f,volleySize:this.getEnemyVolleySize(e,a),eventDamageMultiplier:1,eventSpeedMultiplier:1,threat:a,regionKey:n.regionKey??this.currentRegionKey,biome:n.biome,attackCooldown:(s.ranged?we(.7,1.7):we(.3,.9))/h+we(0,s.ranged?.55:.35),specialCooldown:e==="boss"?2.8/h:1/0,specialIndex:0,aggroDelay:e==="boss"?we(.65,1.15)/d:we(Math.max(.35,1.65-m*.65),Math.max(.8,2.6-m*.82)),attackAnim:0,hitAnim:0,telegraph:null,flash:0,dead:!1,materials:[],phase:we(0,Math.PI*2)};p.group.position.copy(t),this.snapToSurface(p.group),p.group.add(p.body),this.buildEnemyModel(p);const M=le(new St(s.radius,s.radius,e==="boss"?3.8:2.2,8),new ke({transparent:!0,opacity:0,depthWrite:!1}),!1);return M.position.y=e==="boss"?1.9:1.1,M.userData.enemy=p,p.group.add(M),p.hitbox=M,this.createEnemyHealthBar(p),this.createEnemyThreatAura(p),this.scene.add(p.group),this.enemies.push(p),e==="boss"&&(V.bossBar.classList.remove("hidden"),V.bossName.textContent=p.name,V.bossFill.style.transform="scaleX(1)"),p.cursed=!!n.cursed,p}createEnemyThreatAura(e){if(e.threat<3&&!e.elite)return;const t=e.elite?16761965:e.damageType==="magic"?11824383:e.threat>=7?16727857:15104066,n=new je,i=le(new dn(e.radius*1.42,.028+Math.min(.035,e.threat*.004),6,36),new ke({color:t,transparent:!0,opacity:.46,depthWrite:!1,blending:$t}),!1);i.rotation.x=Math.PI/2,n.add(i);const s=Math.min(6,2+Math.floor(e.threat/2)),a=[];for(let o=0;o<s;o+=1){const c=o/s*Math.PI*2,l=le(new Yn(.065+e.threat*.004,0),new ke({color:t,transparent:!0,opacity:.62,depthWrite:!1}),!1);l.position.set(Math.cos(c)*e.radius*1.42,.08,Math.sin(c)*e.radius*1.42),a.push(l),n.add(l)}n.position.y=.06,e.group.add(n),e.threatAura={group:n,ring:i,nodes:a}}buildEnemyModel(e){const t=(i,s,a,o,c)=>{const l=le(i,s);return s.userData.baseEmissive===void 0&&(s.userData.baseEmissive=s.emissive.getHex(),s.userData.baseIntensity=s.emissiveIntensity),l.position.copy(a),o&&l.rotation.set(o.x,o.y,o.z),c&&l.scale.copy(c),e.body.add(l),e.materials.push(s),l};if(e.type==="crawler"){const i=We(7224109,{roughness:.9}),s=We(2497819,{roughness:1}),a=We(15751981,{emissive:15220505,emissiveIntensity:2.2});t(new Zt(.58,0),i,new T(0,.62,0),null,new T(1.25,.75,1.45)),t(new un(.36,8,6),s,new T(0,.62,-.62)),[-1,1].forEach(o=>{t(new Jt(.08,.48,5),i,new T(o*.22,.72,-.93),new Tt(Math.PI/2,0,o*.14)),t(new un(.06,6,5),a,new T(o*.13,.76,-.91))});for(const o of[-1,1])for(let c=0;c<3;c+=1)t(new St(.035,.045,.75,5),s,new T(o*(.58+c*.03),.35,-.35+c*.35),new Tt(0,0,o*-1.05))}if(e.type==="wisp"){const i=We(3306351,{roughness:.72,transparent:!0,opacity:.86}),s=We(7332297,{emissive:4048564,emissiveIntensity:2.4});t(new Jt(.55,1.45,7,1,!0),i,new T(0,.84,0)),t(new un(.36,10,8),i,new T(0,1.48,0)),t(new Vt(.17,0),s,new T(0,1.45,-.28));for(let a=0;a<3;a+=1){const o=t(new Jt(.09,.72,5),i,new T((a-1)*.23,.05,.1),new Tt(0,0,(a-1)*.22));o.userData.ribbon=!0}}if(e.type==="ranger"){const i=We(5649702,{roughness:.9}),s=We(2571578,{roughness:.96}),a=We(11965803,{roughness:.78}),o=We(10212186,{emissive:6268460,emissiveIntensity:2.1,roughness:.3});t(new Jt(.56,1.55,7),i,new T(0,.86,0)),t(new un(.39,9,7),s,new T(0,1.66,0)),t(new bt(.44,.08,.05),o,new T(0,1.65,-.37));const c=t(new dn(.58,.045,5,18,Math.PI*1.5),a,new T(-.66,1.08,-.12),new Tt(0,.28,Math.PI*.2));c.userData.weapon=!0,t(new St(.025,.025,1.18,5),o,new T(.34,1.15,-.45),new Tt(Math.PI/2,0,.12))}if(e.type==="brute"){const i=We(4408641,{roughness:.97}),s=We(5719612,{roughness:.58,metalness:.48}),a=We(16741173,{emissive:15288861,emissiveIntensity:2.5});t(new Zt(.86,0),i,new T(0,1.1,0),null,new T(1,1.2,.82)),t(new bt(1.5,.22,.28),s,new T(0,1.55,-.2)),t(new Zt(.48,0),i,new T(0,2,-.04)),t(new bt(.48,.11,.06),a,new T(0,2.04,-.47)),[-1,1].forEach(o=>{t(new Zt(.42,0),i,new T(o*.88,1.32,0)),t(new St(.2,.25,.95,6),s,new T(o*.96,.7,0),new Tt(0,0,o*-.08))})}if(e.type==="boss"){const i=We(5131077,{roughness:.62,metalness:.44}),s=We(7419430,{roughness:.72,metalness:.24}),a=We(16739118,{emissive:16728856,emissiveIntensity:3.2}),o=We(2104089,{roughness:.9});t(new St(1.1,1.34,2.1,7),i,new T(0,1.52,0)),t(new Zt(.78,0),o,new T(0,2.92,0)),t(new bt(1.15,.24,.14),a,new T(0,2.9,-.7)),t(new St(.32,.44,2.2,7),s,new T(-1.35,1.42,0),new Tt(0,0,-.18)),t(new St(.32,.44,2.2,7),s,new T(1.35,1.42,0),new Tt(0,0,.18)),[-1,1].forEach(c=>{t(new Jt(.22,1.18,6),s,new T(c*.54,3.65,0),new Tt(0,0,c*-.45)),t(new Zt(.48,0),i,new T(c*1.34,2.26,0))}),t(new Vt(.55,0),a,new T(0,1.62,-1.05)),e.body.scale.setScalar(1.16)}const n=le(new bs(e.radius*1.1,20),new ke({color:0,transparent:!0,opacity:.28,depthWrite:!1}),!1);n.rotation.x=-Math.PI/2,n.position.y=.02,e.group.add(n),e.type==="wisp"&&this.phase2Assets.jackal&&this.attachPhase2EnemyModel(e)}createEnemyHealthBar(e){if(e.type==="boss")return;const t=new je;t.position.y=e.type==="brute"?2.9:2.25;const n=le(new gi(1.28,.1),new ke({color:1248010,transparent:!0,opacity:.8,depthTest:!1}),!1);t.add(n);const i=le(new gi(1.2,.055),new ke({color:15032119,depthTest:!1}),!1);i.position.z=.01,t.add(i),e.healthFill=i,e.healthBar=t,e.group.add(t)}updatePlayer(e){const t=this.player,n=t.group.position,i=n.clone(),a=!!this.updatePlayerAction(e)?.lockMovement,o=new T((this.keys.has("KeyD")?1:0)-(this.keys.has("KeyA")?1:0),0,(this.keys.has("KeyS")?1:0)-(this.keys.has("KeyW")?1:0)),c=this.keys.has("ShiftLeft")||this.keys.has("ShiftRight");if(t.moving=!1,t.running=!1,!a&&o.lengthSq()>0)o.normalize(),t.running=c,n.addScaledVector(o,t.speed*(t.running?1.55:1)*e),t.aimDirection.lerp(o,.22).normalize(),t.target=null,t.attackTarget=null,t.moving=!0;else if(!a&&t.attackTarget&&!t.attackTarget.dead){const h=t.attackTarget.group.position,u=Lt(n,h),d=h.clone().sub(n).setY(0).normalize();t.aimDirection.lerp(d,.28).normalize(),u>11.2?(t.running=u>12||c,n.addScaledVector(d,t.speed*(t.running?1.42:1)*e),t.moving=!0):this.tryAttack(t.attackTarget)}else if(!a&&t.target){const h=t.target.clone().sub(n).setY(0),u=h.length();if(u>.18){h.normalize(),t.running=c||u>7;const d=t.speed*(t.running?1.48:1);n.addScaledVector(h,Math.min(d*e,u)),t.aimDirection.lerp(h,.22).normalize(),t.moving=!0}else t.target=null}t.velocity.copy(n).sub(i).setY(0).divideScalar(Math.max(e,.001)),this.snapToSurface(t.group),this.recenterWorldIfNeeded();const l=Math.atan2(t.aimDirection.x,t.aimDirection.z);t.body.rotation.y=this.lerpAngle(t.body.rotation.y,l,1-Math.pow(.001,e)),this.animatePlayerRig(e),this.playerRing.material.opacity=.26+Math.sin(this.elapsed*3)*.08,t.invulnerable=Math.max(0,t.invulnerable-e),t.invulnerable>0?t.body.visible=Math.floor(t.invulnerable*18)%2===0:t.body.visible=!0}recenterWorldIfNeeded(){const e=this.player.group.position;if(Math.hypot(e.x,e.z)<k_)return;const t=new T(e.x,0,e.z);this.worldOffset.x+=t.x,this.worldOffset.y+=t.z,e.x=0,e.z=0,this.snapToSurface(this.player.group);const n=new Set;this.enemies.forEach(i=>{i.group.position.sub(t),this.snapToSurface(i.group),n.add(i.group),i.telegraph&&(i.telegraph.origin.sub(t),i.telegraph.ring.position.sub(t),i.telegraph.disc?.position.sub(t))}),this.drops.forEach(i=>i.mesh.position.sub(t)),this.projectiles.forEach(i=>{i.mesh.position.sub(t),i.trailPositions?.forEach(s=>s.sub(t))}),this.effects.forEach(i=>{i.object&&!n.has(i.object)&&i.object.position.sub(t)}),this.cursedChest?.group&&(this.cursedChest.group.position.sub(t),this.cursedChest.baseY=this.surfaceHeight(this.cursedChest.group.position.x,this.cursedChest.group.position.z,.04)),this.landmarks.position.sub(t),this.decor.position.sub(t),Math.hypot(this.decor.position.x,this.decor.position.z)>42&&this.decor.position.set(0,0,0),this.player.target?.sub(t),this.pointerWorld.sub(t),this.cursor.position.sub(t),this.camera.position.sub(t),this.cameraTarget.sub(t),this.planet.rotation.x+=t.z/this.planetRadius,this.planet.rotation.z-=t.x/this.planetRadius,this.updateCurrentRegion()}beginPlayerAction(e,t,n,i=.58,s=!0){return this.player.action?!1:(this.player.action={name:e,time:0,duration:t,releaseAt:i,released:!1,onRelease:n,lockMovement:s},!0)}updatePlayerAction(e){const t=this.player.action;return t?(t.time+=e,!t.released&&t.time>=t.duration*t.releaseAt&&(t.released=!0,t.onRelease?.()),t.time>=t.duration&&(this.player.action=null),t):null}animatePlayerRig(e){const t=this.player;if(t.animation){const C=t.action?{attack:"Attack_Cast",nova:"Nova_Cast",dash:"Dash",ward:"Ward_Cast"}[t.action.name]??"Idle":t.moving?t.running?"Run":"Walk":"Idle";this.switchAnimation(t.animation,C),t.animation.mixer.update(e),t.body.position.y=ft.lerp(t.body.position.y,.015+Math.sin(this.elapsed*2.2)*.008,Math.min(1,e*12)),t.body.rotation.x=ft.lerp(t.body.rotation.x,0,Math.min(1,e*12)),t.body.rotation.z=ft.lerp(t.body.rotation.z,0,Math.min(1,e*12)),t.body.scale.lerp(new T(1,1,1),Math.min(1,e*14));return}const n=t.rig;if(!n)return;const i=t.action,s=t.running?14:9,a=this.elapsed*s,o=t.moving?Math.sin(a):0,c=t.moving?Math.abs(Math.sin(a))*(t.running?.11:.065):Math.sin(this.elapsed*2.2)*.022,l=1-Math.pow(8e-5,e),h=(C,S=0,x=0,I=0)=>{C.rotation.x=ft.lerp(C.rotation.x,S,l),C.rotation.y=ft.lerp(C.rotation.y,x,l),C.rotation.z=ft.lerp(C.rotation.z,I,l)};let u=t.running&&t.moving?-.16:0,d=t.moving?o*(t.running?.045:.025):0,f=t.moving?o*(t.running?.78:.42):.06,g=t.moving?-o*(t.running?.5:.26):-.04,_=.08,m=-.1,p=t.moving?-o*(t.running?.86:.48):0,M=t.moving?o*(t.running?.86:.48):0,b=t.running&&t.moving?.12:0,v=t.moving?.18+Math.abs(o)*(t.running?.42:.18):-.12,P=1,R=1,A=1;if(i){const C=rn(i.time/i.duration,0,1),S=Math.sin(C*Math.PI);if(i.name==="attack"){const x=C<.38?C/.38:(C-.38)/.62;g=C<.38?ft.lerp(-.05,1.05,x):ft.lerp(1.05,-1.12,Math.sin(x*Math.PI*.5)),m=-.42*S,f=-.4*S,_=.34*S,u=-.12*S,d=-.16*S,v=.34*S}if(i.name==="nova"){const x=Math.sin(Math.min(1,C/.72)*Math.PI*.5);f=-1.34*x,g=-1.18*x,_=.72*x,m=-.72*x,u=-.18*x,d=Math.sin(C*Math.PI*6)*.025*x,v=.48*x,R=1+S*.045}if(i.name==="ward"){const x=Math.sin(Math.min(1,C/.68)*Math.PI*.5);f=-1.48*x,_=.18*x,g=-.74*x,m=-.3*x,u=-.1*x,v=.28*x}i.name==="dash"&&(u=-.56*S,f=1.05*S,g=.9*S,p=-.38*S,M=.38*S,v=.95*S,P=1-S*.08,R=1-S*.12,A=1+S*.3)}t.body.position.y=ft.lerp(t.body.position.y,c+.02,l),t.body.rotation.z=ft.lerp(t.body.rotation.z,d*.35,l),t.body.scale.x=ft.lerp(t.body.scale.x,P,l),t.body.scale.y=ft.lerp(t.body.scale.y,R,l),t.body.scale.z=ft.lerp(t.body.scale.z,A,l),h(n.torso,u,0,d),h(n.leftArm,f,0,_),h(n.rightArm,g,0,m),h(n.leftLeg,p),h(n.rightLeg,M),n.cloak.rotation.x=ft.lerp(n.cloak.rotation.x,b,l),n.cloakTail.rotation.x=ft.lerp(n.cloakTail.rotation.x,v,l),n.hoodPivot.rotation.y=ft.lerp(n.hoodPivot.rotation.y,t.moving?-o*.045:Math.sin(this.elapsed*.8)*.08,l),n.staff.rotation.z=ft.lerp(n.staff.rotation.z,-.08+(t.running?o*.045:0),l),n.staffGem.rotation.y+=e*(i?6:1.2),n.eye.material.emissiveIntensity=2.4+Math.sin(this.elapsed*(i?11:3))*(i?1.1:.25)}lerpAngle(e,t,n){let i=(t-e)%(Math.PI*2);return i>Math.PI&&(i-=Math.PI*2),i<-Math.PI&&(i+=Math.PI*2),e+i*n}getRuneRank(e){return Math.max(0,Number(this.runeRanks[e])||0)}getPlayerOffenseRatio(){const e=Math.max(0,this.player.level-1),t=20+e*3,n=26+e*4;return Math.max(1,this.player.damage/t,this.player.skillPower/n)}getThreatDamageMultiplier(e=this.wave,t=!1){const n=Math.max(0,e-1),i=Math.max(0,this.player.level-1),s=1+n*(t?.11:.14)+Math.pow(n,1.28)*(t?.018:.025),a=1+i*.045+Math.pow(i,1.16)*.008,o=Math.min(1.6,Math.max(0,this.getPlayerOffenseRatio()-1)*.32+this.player.gearScore/1800),c=Math.min(.62,this.getActiveRuneCount()*.035);return s*a*(1+o+c)}getEnemyHealthScale(e=this.wave,t=!1){const n=Math.max(0,e-1),i=1+Math.min(5,Math.max(0,Math.sqrt(this.getPlayerOffenseRatio())-1)*1.1+this.player.gearScore/1500);return(1+n*(t?.34:.25)+Math.pow(n,1.18)*(t?.045:.032))*i}getEnemyAttackRate(e=this.wave){const t=Math.max(0,e-1),n=Math.max(0,this.player.level-1);return Math.min(2.1,1+t*.045+Math.pow(t,1.12)*.012+n*.018+this.getActiveRuneCount()*.008+Math.max(0,this.getPlayerOffenseRatio()-1)*.055)}getEnemyDefensePenetration(e=this.wave){const t=Math.max(0,e-1),n=Math.max(0,this.player.level-1);return Math.min(.68,t*.025+Math.pow(t,1.08)*.006+n*.005+this.getActiveRuneCount()*.006)}getEnemyMovementMultiplier(e=this.wave,t=!1){const n=Math.max(0,e-1),i=Math.max(0,this.player.level-1);return Math.min(t?1.78:2.2,1+n*.024+i*.018+Math.max(0,this.getPlayerOffenseRatio()-1)*.04)}getEnemyProjectileSpeedMultiplier(e=this.wave){const t=Math.max(0,e-1),n=Math.max(0,this.player.level-1);return Math.min(2.7,1+t*.065+n*.032+Math.max(0,this.getPlayerOffenseRatio()-1)*.08)}getEnemyVolleySize(e,t=this.wave){if(!["wisp","ranger"].includes(e))return 1;const n=Math.max(0,t-1),i=Math.max(0,this.player.level-1),s=Math.floor(n/4)+Math.floor(i/12)+(this.getPlayerOffenseRatio()>=2.2?1:0);return Math.min(e==="wisp"?6:5,1+s)}getAdaptiveEnemyDamage(e,t,n,i,s){const a=e*this.getThreatDamageMultiplier(t,n),o=Math.max(0,this.player.level-1),c=Math.max(0,t-1),l=rn(.72+e/18,.9,1.6),h=Math.min(n?.16:.1,(.018+o*.0017+c*.0022)*l),u=i==="magic"?this.player.magicResist:this.player.armor,f=100/(100+Math.max(0,u*(1-s))*5),g=this.player.maxHp*h/Math.sqrt(f);return Math.max(1,Math.round(Math.max(a,g)))}refreshEnemyDifficulty(){this.enemies.forEach(e=>{e.dead||(e.attackRate=this.getEnemyAttackRate(e.threat),e.defensePenetration=this.getEnemyDefensePenetration(e.threat),e.movementScale=this.getEnemyMovementMultiplier(e.threat,e.type==="boss"),e.projectileSpeedScale=this.getEnemyProjectileSpeedMultiplier(e.threat),e.volleySize=this.getEnemyVolleySize(e.type,e.threat),e.damageScale=this.getThreatDamageMultiplier(e.threat,e.type==="boss"),e.damage=this.getAdaptiveEnemyDamage(e.baseDamage,e.threat,e.type==="boss",e.damageType,e.defensePenetration)*(e.eventDamageMultiplier??1),e.damage=Math.round(e.damage),e.speed=e.baseSpeed*e.movementScale*(e.eventSpeedMultiplier??1))})}getActiveRuneCount(){return Object.values(this.runeRanks).reduce((e,t)=>e+Math.max(0,Number(t)||0),0)}queueRuneDraft(e=1){this.pendingRuneDrafts+=Math.max(1,e),this.state==="running"&&this.openNextRuneDraft()}openNextRuneDraft(){if(this.pendingRuneDrafts<=0)return;const e=Pl.filter(i=>this.getRuneRank(i.id)<i.maxRank);if(!e.length){this.pendingRuneDrafts=0,this.player.shards+=80,this.addFeed("<b>符文图谱圆满</b> · 多余灵火化为 80 枚余烬");return}this.state==="running"&&this.saveGame(),this.state="drafting",V.runeChoices.replaceChildren();const t=[...e],n=[];for(;n.length<Math.min(3,t.length);)n.push(t.splice(Math.floor(Math.random()*t.length),1)[0]);n.forEach(i=>{const s=this.getRuneRank(i.id),a=s+1,o=document.createElement("button");o.className=`rune-card rune-${i.skill==="火矢"?"attack":i.skill==="震环"?"nova":i.skill==="裂隙步"?"dash":"ward"}`,o.type="button",o.innerHTML=`
        <span class="rune-glyph" aria-hidden="true">${i.glyph}</span>
        <span class="rune-skill">${i.skill}符文</span>
        <strong>${i.name}</strong>
        <p>${i.description(a)}</p>
        <small>${s?`升级至 ${a} / ${i.maxRank}`:`激活 · 1 / ${i.maxRank}`}</small>
      `,o.addEventListener("click",()=>this.chooseRune(i)),V.runeChoices.append(o)}),V.runeProgress.textContent=`已激活 ${this.getActiveRuneCount()} 层符文 · 尚有 ${this.pendingRuneDrafts} 次选择`,V.runeScreen.classList.add("active")}chooseRune(e){if(this.state!=="drafting")return;const t=Math.min(e.maxRank,this.getRuneRank(e.id)+1);if(this.runeRanks[e.id]=t,this.pendingRuneDrafts=Math.max(0,this.pendingRuneDrafts-1),this.audio.play("gear",1.35+t*.08),this.addFeed(`<b>${e.name} · ${t} 级</b> ｜ ${e.description(t)}`),this.pendingRuneDrafts>0){this.openNextRuneDraft();return}V.runeScreen.classList.remove("active"),this.state="running",this.clock.getDelta(),this.updateUI(),this.saveGame()}scheduleAction(e,t){this.delayedActions.push({time:Math.max(0,e),callback:t})}updateDelayedActions(e){for(let t=this.delayedActions.length-1;t>=0;t-=1){const n=this.delayedActions[t];n.time-=e,!(n.time>0)&&(this.delayedActions.splice(t,1),n.callback?.())}}tryAttack(e){const t=this.getRuneRank("attack_haste");if(this.skillState.attack.max=Math.max(.16,.42/(1+this.player.attackSpeed+t*.12)),this.state!=="running"||this.skillState.attack.cooldown>0||this.player.action)return;let n=e;if((!n||n.dead||Lt(this.player.group.position,n.group.position)>13)&&(n=this.findNearestEnemy(13)),!n){this.addFeed("射程内没有目标");return}this.beginPlayerAction("attack",.38,()=>this.fireProjectile(n),.46,!0)&&(this.audio.play("attackCast"),this.skillState.attack.cooldown=this.skillState.attack.max,this.player.aimDirection.copy(n.group.position).sub(this.player.group.position).setY(0).normalize())}fireProjectile(e){if((!e||e.dead)&&(e=this.findNearestEnemy(13)),!e)return;this.audio.play("attackRelease"),this.player.rig.staffGem.updateWorldMatrix(!0,!1);const t=this.player.rig.staffGem.getWorldPosition(new T),n=this.getRuneRank("attack_chain"),i=this.getRuneRank("attack_burst"),s=this.getRuneRank("attack_haste"),a=n>0?16764775:s>0?7397830:i>0?16740674:16753759,o=new je;o.position.copy(t);const c=le(i>0?new Zt(.21+i*.018,0):s>0?new Vt(.2,0):new zi(.17,1),We(a,{emissive:a,emissiveIntensity:4.2,roughness:.12}),!1);o.add(c);const l=new ke({color:a,transparent:!0,opacity:.72,depthWrite:!1,side:xt}),h=le(new dn(.27,.018,5,24),l,!1),u=h.clone();h.rotation.x=Math.PI/2,u.rotation.y=Math.PI/2,o.add(h,u);const d=[];if(n>0)for(let p=0;p<2+n;p+=1){const M=le(new Yn(.075+n*.008,0),new ke({color:16769178,transparent:!0,opacity:.9,depthWrite:!1}),!1),b=p/(2+n)*Math.PI*2;M.position.set(Math.cos(b)*.37,Math.sin(b*2)*.12,Math.sin(b)*.37),M.userData.orbitAngle=b,M.userData.orbitRadius=.37,d.push(M),o.add(M)}if(i>0)for(let p=0;p<3+i;p+=1){const M=le(new Jt(.065,.32+i*.04,5),new ke({color:p%2?16756815:16735287,transparent:!0,opacity:.82,depthWrite:!1}),!1),b=p/(3+i)*Math.PI*2;M.position.set(Math.cos(b)*.3,Math.sin(b*1.5)*.16,Math.sin(b)*.3),M.rotation.z=b,M.userData.spin=p%2?1:-1,d.push(M),o.add(M)}if(s>0)for(let p=-1;p<=1;p+=2){const M=le(new Jt(.08,.62+s*.08,5),new ke({color:9175012,transparent:!0,opacity:.68,depthWrite:!1,blending:$t}),!1);M.position.set(p*.18,0,.34),M.rotation.x=Math.PI/2,M.userData.hasteFin=!0,d.push(M),o.add(M)}this.scene.add(o);const f=Array.from({length:9},()=>t.clone()),g=new Float32Array(f.length*3),_=new yt;_.setAttribute("position",new It(g,3));const m=new Xi(_,new Ss({color:a,transparent:!0,opacity:.72,depthWrite:!1}));this.scene.add(m),this.projectiles.push({mesh:o,core:c,haloA:h,haloB:u,runeOrnaments:d,chainRank:n,burstRank:i,hasteRank:s,trailLine:m,trailPositions:f,trailGeometry:_,target:e,speed:19+s*1.4,damage:this.player.damage,damageType:"physical",critical:Math.random()<this.player.critChance,life:1.4}),this.createMuzzleBurst(t,a,4+n+i+s),n>0&&this.spawnRing(t.clone(),.55+n*.08,16764775,.18),i>0&&this.spawnRuneExplosion(t.clone(),.5,16740416,.2,3+i)}castNova(){const e=this.skillState.nova;this.state!=="running"||e.cooldown>0||this.player.action||!this.beginPlayerAction("nova",.86,()=>this.releaseNova(),.7,!0)||(this.audio.play("novaCast"),e.cooldown=e.max,this.spawnCastingEffect(16742456,.86,"nova"),this.addFeed("<b>余烬震环</b> · 正在吟唱"))}releaseNova(){this.releaseNovaPulse(!1,1)}releaseNovaPulse(e=!1,t=1){this.audio.play("novaRelease",1.12);const n=this.player.group.position.clone(),i=this.getRuneRank("nova_overload"),s=this.getRuneRank("nova_vortex"),a=5.2+i*.45,o=Math.round((this.player.skillPower*1.65+this.player.damage*.35)*(1+i*.18)*t);if(s>0&&!e&&(this.spawnVortexEffect(n,6.4+s*.55,11693311,.82),this.enemies.forEach(c=>{if(c.dead||Lt(n,c.group.position)>7+s)return;const l=n.clone().sub(c.group.position).setY(0);l.lengthSq()>.01&&c.group.position.addScaledVector(l.normalize(),c.type==="boss"?.7+s*.15:1.5+s*.45)})),this.spawnRing(n,a,e?16757351:15167284,e?.36:.55),i>0){for(let c=1;c<=i;c+=1)this.spawnRing(n.clone(),a*(.45+c*.17),c%2?16731441:16761183,.34+c*.08);this.spawnRuneExplosion(n.clone(),2.1+i*.42,16734773,.55,8+i*3)}if(e&&this.spawnRuneExplosion(n.clone(),1.45+this.getRuneRank("nova_echo")*.25,16760952,.36,5+this.getRuneRank("nova_echo")),this.spawnEnergyColumn(n,s>0?11889919:e?16757351:16742200,.42,4.8+i*.7),this.spawnBurst(n.clone().add(new T(0,.35,0)),e?12:22,16747334,7),this.cameraShake=Math.max(this.cameraShake,e?.12:.24),this.enemies.forEach(c=>{if(!c.dead&&Lt(n,c.group.position)<=a+.2){this.damageEnemy(c,o,!0,"magic");const l=c.group.position.clone().sub(n).setY(0).normalize();c.group.position.addScaledVector(l,c.type==="boss"?.45:e?.65:1.4)}}),!e){this.addFeed("<b>余烬震环</b> · 腐化被震退");const c=this.getRuneRank("nova_echo");c>0&&this.scheduleAction(.58,()=>this.releaseNovaPulse(!0,.36+c*.12))}}castDash(){const e=this.skillState.dash;if(e.max=Math.max(2.1,4.2-this.getRuneRank("dash_phase")*.55),this.state!=="running"||e.cooldown>0||this.player.action||!this.beginPlayerAction("dash",.34,null,.2,!0))return;this.audio.play("dash"),e.cooldown=e.max;const n=this.player.group.position.clone();let i=this.pointerWorld.clone().sub(n).setY(0);i.lengthSq()<.2&&i.copy(this.player.aimDirection),i.normalize();const s=n.clone().addScaledVector(i,6.2);s.y=this.surfaceHeight(s.x,s.z),this.player.group.position.copy(s),this.player.aimDirection.copy(i),this.player.invulnerable=.38,this.spawnDashTrail(n,s),this.spawnAfterimages(n,s),this.spawnBurst(n.clone().add(new T(0,.8,0)),10,6935747,4),this.spawnRing(s,1.4,6080955,.32);const a=this.getRuneRank("dash_phase");a>0&&(this.spawnPortalEffect(n.clone(),5760975,.38+a*.05),this.spawnPortalEffect(s.clone(),8847336,.46+a*.06),this.spawnDashTrail(n.clone().add(new T(.18,0,-.18)),s.clone().add(new T(.18,0,-.18)),9175016,.34));const o=this.getRuneRank("dash_guard");o>0&&(this.player.shield=Math.max(this.player.shield,Math.round(this.player.maxHp*o*.07)),this.spawnGuardShell(9109471,1.8+o*.55),this.spawnRuneExplosion(s.clone(),1+o*.18,7595728,.32,4+o));const c=this.getRuneRank("dash_blast");if(c>0){const l=Math.round(this.player.skillPower*(.55+c*.2));this.spawnRing(s,2.6+c*.2,9268202,.36),this.spawnRuneExplosion(s.clone(),2.2+c*.32,10315248,.48,7+c*3),this.enemies.forEach(h=>{!h.dead&&Lt(s,h.group.position)<=2.8+c*.2&&this.damageEnemy(h,l,!1,"magic")})}this.cameraShake=Math.max(this.cameraShake,.08),this.updateUI()}castWard(){const e=this.skillState.ward;this.state!=="running"||e.cooldown>0||this.player.action||!this.beginPlayerAction("ward",.74,()=>this.releaseWard(),.66,!0)||(this.audio.play("wardCast"),e.cooldown=e.max,this.spawnCastingEffect(7656910,.74,"ward"),this.addFeed("<b>铜卫结界</b> · 正在构筑"))}releaseWard(){this.audio.play("wardRelease"),this.player.shield=Math.round(this.player.maxHp*.38);const e=this.getRuneRank("ward_heal");if(e>0){const l=Math.min(Math.round(this.player.maxHp*e*.07),this.player.maxHp-this.player.hp);this.player.hp+=l,l>0&&this.spawnDamageNumber(this.player.group.position,`+${l}`,"#8ee1ba"),this.spawnEnergyColumn(this.player.group.position.clone(),6874791,.5,3.4+e*.65),this.spawnVortexEffect(this.player.group.position.clone(),1.4+e*.22,7726770,.52)}const t=this.getRuneRank("ward_pulse");if(t>0){const l=Math.round(this.player.skillPower*(.45+t*.2));this.enemies.forEach(h=>{!h.dead&&Lt(this.player.group.position,h.group.position)<=4&&this.damageEnemy(h,l,!1,"magic")}),this.spawnRuneExplosion(this.player.group.position.clone(),2.2+t*.35,7660501,.5,8+t*2),this.spawnRing(this.player.group.position.clone(),4,9631207,.52)}const n=this.getRuneRank("ward_thorns"),i=new je,s=le(new zi(1.12,2),new ke({color:7985362,transparent:!0,opacity:.12,wireframe:!0,depthWrite:!1}),!1);i.add(s);const a=new ke({color:9430492,transparent:!0,opacity:.42,depthWrite:!1}),o=le(new dn(1.15,.018,5,40),a,!1),c=o.clone();o.rotation.x=Math.PI/2,c.rotation.y=Math.PI/2,i.add(o,c);for(let l=0;l<6;l+=1){const h=l/6*Math.PI*2,u=le(new bt(.18,.34,.035),new ke({color:11661030,transparent:!0,opacity:.48,depthWrite:!1}),!1);u.position.set(Math.cos(h)*1.22,Math.sin(h*2)*.35,Math.sin(h)*1.22),u.lookAt(0,0,0),i.add(u)}if(n>0){const l=6+n*2,h=new T(0,1,0);for(let u=0;u<l;u+=1){const d=u/l*Math.PI*2,f=u%2?.42:-.2,g=new T(Math.cos(d),f,Math.sin(d)).normalize(),_=le(new Jt(.075+n*.012,.46+n*.08,5),new ke({color:12427775,transparent:!0,opacity:.72,depthWrite:!1}),!1);_.position.copy(g).multiplyScalar(1.22),_.quaternion.setFromUnitVectors(h,g),i.add(_)}}i.position.copy(this.player.group.position).add(new T(0,1.12,0)),this.scene.add(i),this.spawnRing(this.player.group.position.clone(),2.25,7657679,.45),this.spawnBurst(this.player.group.position.clone().add(new T(0,1,0)),14,9298135,4),this.effects.push({object:i,life:8,maxLife:8,update:(l,h)=>{l.object.position.copy(this.player.group.position).add(new T(0,1.1,0)),l.object.rotation.y+=h*.72,l.object.rotation.x=Math.sin(this.elapsed*.8)*.08,s.material.opacity=Math.min(.14,l.life*.05)*(this.player.shield>0?1:0),o.rotation.z+=h*.5,c.rotation.z-=h*.38,this.player.shield<=0&&(l.life=0)}}),this.addFeed(`<b>铜卫结界</b> · 获得 ${this.player.shield} 点护盾`),this.updateUI()}usePotion(){if(this.state!=="running"||this.player.potions<=0||this.player.hp>=this.player.maxHp)return;this.player.potions-=1;const e=Math.min(Math.round(this.player.maxHp*.45),this.player.maxHp-this.player.hp);this.player.hp+=e,this.audio.play("potion"),this.spawnRing(this.player.group.position.clone(),1.8,8115894,.45),this.spawnDamageNumber(this.player.group.position,`+${e}`,"#8ee1ba"),this.updateUI(),this.saveGame()}findNearestEnemy(e=1/0){let t=null,n=e;return this.enemies.forEach(i=>{if(i.dead)return;const s=Lt(this.player.group.position,i.group.position);s<n&&(t=i,n=s)}),t}fireEnemyProjectile(e){if(!e||e.dead)return;const t=e.damageType==="magic";this.audio.play(t?"enemyMagicShot":"enemyPhysicalShot",.7);const n=t?11042047:14267247,i=this.projectiles.reduce((f,g)=>f+(g.hostile?1:0),0),s=Math.min(e.volleySize??1,Math.max(0,56-i));if(s<=0)return;const a=e.group.position.clone().add(new T(0,e.type==="wisp"?1.45:1.2,0)),o=(t?11.5:15.5)*(e.projectileSpeedScale??1),c=a.distanceTo(this.player.group.position),l=Math.min(.82,c/o*.72),u=this.player.group.position.clone().add(new T(0,1.1,0)).addScaledVector(this.player.velocity,l).sub(a).normalize(),d=t?.14:.09;for(let f=0;f<s;f+=1){const g=new je;g.position.copy(a);const _=le(t?new Vt(.2,0):new St(.045,.045,.72,6),We(n,{emissive:n,emissiveIntensity:t?3.6:1.5,roughness:.25}),!1);t||(_.rotation.x=Math.PI/2),g.add(_);const m=le(new dn(t?.31:.17,.018,5,20),new ke({color:n,transparent:!0,opacity:.68,depthWrite:!1}),!1);m.rotation.x=Math.PI/2,g.add(m),this.scene.add(g);const p=(f-(s-1)*.5)*d,M=u.clone().applyAxisAngle(new T(0,1,0),p).multiplyScalar(o*(1-Math.abs(p)*.08)),b=Array.from({length:7},()=>g.position.clone()),v=new yt;v.setAttribute("position",new It(new Float32Array(b.length*3),3));const P=new Xi(v,new Ss({color:n,transparent:!0,opacity:.62,depthWrite:!1}));this.scene.add(P),this.projectiles.push({hostile:!0,source:e,mesh:g,core:_,haloA:m,haloB:m,trailLine:P,trailPositions:b,trailGeometry:v,velocity:M,damage:e.damage,damageType:e.damageType,life:2.6})}}removeProjectile(e){const t=this.projectiles[e];t&&(this.scene.remove(t.mesh),this.scene.remove(t.trailLine),this.projectiles.splice(e,1))}updateProjectiles(e){for(let t=this.projectiles.length-1;t>=0;t-=1){const n=this.projectiles[t];if(n.life-=e,n.hostile){if(n.life<=0||n.source?.dead){this.removeProjectile(t);continue}if(n.mesh.position.addScaledVector(n.velocity,e),n.core.rotation.y+=e*8,n.haloA.rotation.z+=e*7,n.mesh.position.distanceTo(this.player.group.position.clone().add(new T(0,1.05,0)))<.78){this.damagePlayer(n.damage,n.source,n.damageType),this.spawnBurst(n.mesh.position.clone(),7,n.damageType==="magic"?11042047:14267247,4),this.removeProjectile(t);continue}n.trailPositions.unshift(n.mesh.position.clone()),n.trailPositions.length=7;const o=n.trailGeometry.getAttribute("position");n.trailPositions.forEach((c,l)=>{o.setXYZ(l,c.x,c.y,c.z)}),o.needsUpdate=!0;continue}if(n.life<=0||n.target.dead){this.removeProjectile(t);continue}const s=n.target.group.position.clone().add(new T(0,n.target.type==="boss"?1.9:1,0)).sub(n.mesh.position);if(s.length()<.45){const o=n.target.group.position.clone(),c=o.clone().add(new T(0,n.target.type==="boss"?1.7:.9,0));this.damageEnemy(n.target,n.damage,n.critical,n.damageType);const l=n.burstRank??0;if(l>0){const u=1.25+l*.25,d=Math.round(n.damage*(.2+l*.08));this.spawnRing(o,u,16751954,.24),this.spawnRuneExplosion(o.clone(),u,16737848,.42,6+l*2),this.enemies.forEach(f=>{f!==n.target&&!f.dead&&Lt(o,f.group.position)<=u&&this.damageEnemy(f,d,!1,"physical")})}const h=n.chainRank??0;h>0&&this.enemies.filter(d=>d!==n.target&&!d.dead&&Lt(o,d.group.position)<=4.5).sort((d,f)=>Lt(o,d.group.position)-Lt(o,f.group.position)).slice(0,h).forEach((d,f)=>{const g=Math.round(n.damage*(.3+h*.1)*(1-f*.12));this.damageEnemy(d,g,!1,"magic"),this.spawnEnergyArc(c,d.group.position.clone().add(new T(0,d.type==="boss"?1.7:.9,0)),16765806,.32,Math.min(3,1+h)),this.spawnRing(d.group.position.clone(),.46,16760943,.17)}),(n.hasteRank??0)>0&&this.spawnEnergyArc(n.mesh.position.clone(),c,7598800,.18,1),this.spawnBurst(n.mesh.position.clone(),7,16742456,4),this.spawnRing(n.target.group.position.clone(),.72,16747081,.2),this.removeProjectile(t)}else{n.mesh.position.addScaledVector(s.normalize(),n.speed*e),n.core.scale.setScalar(.88+Math.sin(this.elapsed*28)*.14),n.haloA.rotation.z+=e*8,n.haloB.rotation.x+=e*7,n.runeOrnaments?.forEach((c,l)=>{c.userData.orbitAngle!==void 0&&(c.userData.orbitAngle+=e*(8+(n.chainRank??0)*1.8),c.position.x=Math.cos(c.userData.orbitAngle)*c.userData.orbitRadius,c.position.z=Math.sin(c.userData.orbitAngle)*c.userData.orbitRadius,c.position.y=Math.sin(c.userData.orbitAngle*2+l)*.13),c.userData.hasteFin&&(c.scale.y=.8+Math.sin(this.elapsed*36+l)*.24),c.rotation.x+=e*(5+l),c.rotation.y+=e*(7+l*.7)}),n.trailPositions.unshift(n.mesh.position.clone()),n.trailPositions.length=9;const o=n.trailGeometry.getAttribute("position");n.trailPositions.forEach((c,l)=>{o.setXYZ(l,c.x,c.y,c.z)}),o.needsUpdate=!0,n.trailLine.material.opacity=rn(n.life*.8,0,.68)}}}updateEnemies(e){const t=this.player.group.position;for(let n=0;n<this.enemies.length;n+=1){const i=this.enemies[n];if(i.dead)continue;const s=i.group.position.clone();i.attackCooldown-=e,i.specialCooldown-=e,i.aggroDelay-=e,i.attackAnim=Math.max(0,i.attackAnim-e),i.hitAnim=Math.max(0,i.hitAnim-e),i.flash=Math.max(0,i.flash-e),i.materials.forEach(_=>{_.emissive&&(i.flash>0?(_.emissive.setHex(16757878),_.emissiveIntensity=Math.max(_.emissiveIntensity,1.7)):(_.emissive.setHex(_.userData.baseEmissive),_.emissiveIntensity=_.userData.baseIntensity))}),i.threatAura&&(i.threatAura.group.rotation.y+=e*(.7+Math.min(1.8,i.threat*.08)),i.threatAura.ring.material.opacity=.34+Math.sin(this.elapsed*4.2+i.phase)*.14,i.threatAura.nodes.forEach((_,m)=>{_.position.y=.08+Math.sin(this.elapsed*5.5+m*1.7+i.phase)*.07,_.rotation.x+=e*3.2,_.rotation.y+=e*4.4}));const a=t.clone().sub(i.group.position).setY(0),o=a.length(),c=a.normalize(),l=new T;for(let _=0;_<this.enemies.length;_+=1){if(n===_||this.enemies[_].dead)continue;const m=this.enemies[_],p=i.group.position.clone().sub(m.group.position).setY(0),M=i.radius+m.radius,b=p.length();b>0&&b<M&&l.add(p.normalize().multiplyScalar((M-b)*.75))}if(i.telegraph)this.updateBossTelegraph(i,e);else if(i.type==="boss"&&i.specialCooldown<=0&&o<18)this.startBossTelegraph(i);else if(i.ranged)if(i.aggroDelay>0||o>i.range)c.add(l).normalize(),i.group.position.addScaledVector(c,i.speed*e*(i.aggroDelay>0?.42:1));else if(o<i.preferredRange*.68)c.multiplyScalar(-1).add(l).normalize(),i.group.position.addScaledVector(c,i.speed*e);else{const _=new T(-c.z,0,c.x).multiplyScalar(Math.sin(this.elapsed*1.6+i.phase)*.42).add(l).normalize();i.group.position.addScaledVector(_,i.speed*e*.48),i.attackCooldown<=0&&(i.attackCooldown=(i.type==="wisp"?we(1.05,1.42):we(.86,1.18))/(i.attackRate??1),i.attackAnim=.44,this.fireEnemyProjectile(i))}else o>i.range||i.aggroDelay>0?(c.add(l).normalize(),i.group.position.addScaledVector(c,i.speed*e*(i.aggroDelay>0?.48:1))):i.attackCooldown<=0&&(i.attackCooldown=(i.type==="boss"?1.25:we(.78,1.16))/(i.attackRate??1),i.attackAnim=i.type==="boss"?.52:.34,this.damagePlayer(i.damage,i,i.damageType),i.body.scale.y=.84);this.snapToSurface(i.group),i.body.rotation.y=this.lerpAngle(i.body.rotation.y,Math.atan2(c.x,c.z),1-Math.pow(.004,e));const h=i.type==="wisp"&&!i.phase2Model,u=h?4.5:i.type==="ranger"?5.4:7,d=h?.18:i.type==="ranger"?.065:.045,f=i.type==="boss"?.52:i.ranged?.44:.34,g=i.attackAnim>0?Math.sin((1-i.attackAnim/f)*Math.PI):0;i.body.position.y=Math.sin(this.elapsed*u+i.phase)*d+(h?.34:0),i.animation?(i.body.position.z=ft.lerp(i.body.position.z,0,Math.min(1,e*14)),i.body.rotation.x=ft.lerp(i.body.rotation.x,0,Math.min(1,e*12)),i.body.scale.lerp(new T(1,1,1),Math.min(1,e*12)),this.updatePhase2EnemyAnimation(i,s,c,e)):(i.body.position.z=ft.lerp(i.body.position.z,-g*(i.type==="boss"?.7:.34),Math.min(1,e*14)),i.body.rotation.x=ft.lerp(i.body.rotation.x,-g*.2,Math.min(1,e*12)),i.body.scale.z=ft.lerp(i.body.scale.z,1+g*.18,Math.min(1,e*12)),i.body.scale.y+=(1-i.body.scale.y)*Math.min(1,e*10)),i.healthBar&&i.healthBar.quaternion.copy(this.camera.quaternion)}}updatePhase2EnemyAnimation(e,t,n,i){const s=e.group.position.clone().sub(t).setY(0);let a="Idle";if(e.hitAnim>0)a="Hit";else if(e.attackAnim>0)a="Attack_Volley";else if(s.lengthSq()>1e-5){s.normalize();const o=n.x*s.z-n.z*s.x,c=n.dot(s);Math.abs(o)>Math.abs(c)*.72?a=o>0?"Strafe_Right":"Strafe_Left":a=e.aggroDelay>0?"Walk":"Run"}this.switchAnimation(e.animation,a,.1),e.animation.mixer.update(i)}startBossTelegraph(e){const t=e.specialIndex%2===1;e.specialIndex+=1;const n=t?14.5:8.4,i=t?1.55:1.16,s=t?10771711:14895661,a=t?this.player.group.position.clone():e.group.position.clone(),o=le(new pi(.92,1,48),new ke({color:s,transparent:!0,opacity:.72,depthWrite:!1,side:xt}),!1);o.rotation.x=-Math.PI/2,o.position.copy(a),o.position.y=this.surfaceHeight(a.x,a.z,.055),o.scale.setScalar(n);const c=le(new bs(1,48),new ke({color:s,transparent:!0,opacity:.08,depthWrite:!1,side:xt,blending:$t}),!1);c.rotation.x=-Math.PI/2,c.position.copy(o.position),c.scale.setScalar(n),this.scene.add(o),this.scene.add(c),e.telegraph={ring:o,disc:c,timer:i,max:i,origin:a,radius:n,damageType:t?"magic":"physical",kind:t?"虚空风暴":"熔炉震击"};const l=1-e.hp/e.maxHp;e.specialCooldown=Math.max(2.4,5.7-l*1.8)/Math.min(1.45,e.attackRate??1),this.addFeed(t?"<b>虚空风暴</b> · 全屏魔法伤害，冲刺或结界可抵挡":"<b>熔炉震击</b> · 大范围物理伤害，立即离开红圈"),this.audio.play(t?"bossMagicWarning":"bossPhysicalWarning",1.15)}updateBossTelegraph(e,t){e.telegraph.timer-=t;const n=1-e.telegraph.timer/e.telegraph.max,i=.42+Math.sin(n*Math.PI*14)*.27;if(e.telegraph.ring.material.opacity=i,e.telegraph.ring.scale.setScalar(e.telegraph.radius*(1-n*.045)),e.telegraph.disc.material.opacity=.045+n*.16,e.telegraph.disc.rotation.z+=t*(e.telegraph.damageType==="magic"?1.4:-.45),e.body.rotation.y+=t*(e.telegraph.damageType==="magic"?3.4:2),e.telegraph.timer<=0){const s=e.telegraph.origin;if(Lt(this.player.group.position,s)<e.telegraph.radius){const o=e.telegraph.damageType==="magic"?1.38:1.72;this.damagePlayer(Math.round(e.damage*o),e,e.telegraph.damageType)}const a=e.telegraph.damageType==="magic"?10902783:15749676;this.spawnRing(s,e.telegraph.radius,a,.58),this.spawnEnergyColumn(s,a,.42,e.telegraph.damageType==="magic"?7.5:4.5),this.spawnBurst(s.clone().add(new T(0,.2,0)),e.telegraph.damageType==="magic"?32:24,a,e.telegraph.damageType==="magic"?9:7),this.cameraShake=Math.max(this.cameraShake,e.telegraph.damageType==="magic"?.42:.34),this.audio.play(e.telegraph.damageType==="magic"?"bossMagicImpact":"bossPhysicalImpact",1.2),this.scene.remove(e.telegraph.ring),this.scene.remove(e.telegraph.disc),e.telegraph=null}}damageEnemy(e,t,n=!1,i="physical"){if(!e||e.dead)return;const s=we(.92,1.08),a=i==="magic"?e.magicResist:e.armor,o=100/(100+Math.max(0,a)*3.5),c=Math.max(1,Math.round(t*s*o*(n?1.15:1)));e.hp-=c,this.audio.play(i==="magic"?"magicHit":"attackHit",n?1.25:1),e.flash=.09,e.hitAnim=.24,this.spawnDamageNumber(e.group.position.clone().add(new T(0,e.type==="boss"?3.4:2.2,0)),n?`${c}!`:`${c}`,n?"#ffcf77":i==="magic"?"#c7a0ff":"#e8dfc8",n);const l=rn(e.hp/e.maxHp,0,1);e.healthFill&&(e.healthFill.scale.x=l,e.healthFill.position.x=-.6*(1-l)),e.type==="boss"&&(V.bossFill.style.transform=`scaleX(${l})`),e.hp<=0&&this.killEnemy(e)}killEnemy(e){e.dead=!0,this.switchAnimation(e.animation,"Death",.06),this.audio.play("enemyDeath",e.type==="boss"?1.8:.9);const t=this.regionStates.get(e.regionKey);t&&(t.defeated+=1),e.regionKey===this.currentRegionKey&&(this.waveDefeated=t?.defeated??this.waveDefeated+1),e.volatile&&(this.spawnRing(e.group.position.clone(),2.7,11816928,.38),this.spawnBurst(e.group.position.clone().add(new T(0,.5,0)),14,12082147,5),Lt(e.group.position,this.player.group.position)<=2.7&&this.damagePlayer(Math.round(e.damage*.72),e,"magic")),e.cursed&&this.cursedChallenge&&(this.cursedChallenge.kills+=1,this.cursedChallenge.kills>=this.cursedChallenge.required&&this.resolveCursedChallenge(!0)),this.kills+=1,Object.hasOwn(this.runStats.kills,e.type)&&(this.runStats.kills[e.type]+=1),this.runStats.bestWave=Math.max(this.runStats.bestWave,this.regionsCleared+1),this.player.attackTarget=null,e.telegraph&&(this.scene.remove(e.telegraph.ring),this.scene.remove(e.telegraph.disc)),this.spawnBurst(e.group.position.clone().add(new T(0,.65,0)),e.type==="boss"?36:12,e.type==="wisp"?5883577:14837554,e.type==="boss"?9:5),this.spawnDrop("xp",e.group.position,e.xp),Math.random()<.76&&this.spawnDrop("shard",e.group.position,e.type==="boss"?22+e.threat*3:Math.ceil(we(2,6)+e.threat*.35)),(Math.random()<.09||e.type==="boss")&&this.spawnDrop("potion",e.group.position,1);const n=Math.min(.34,.13+e.threat*.018);(Math.random()<n||e.type==="boss")&&this.spawnDrop("gear",e.group.position,{level:e.threat,boss:e.type==="boss"}),e.elite&&(this.spawnDrop("gear",e.group.position.clone().add(new T(.55,0,-.35)),{level:e.threat+1,boss:!0}),this.addFeed("<b>悬赏目标已击杀</b> · 精英战利品已掉落")),e.type==="boss"&&(V.bossBar.classList.add("hidden"),this.spawnDrop("gear",e.group.position.clone().add(new T(.8,0,.4)),{level:e.threat+1,boss:!0}));const i=e.group.scale.clone();this.effects.push({object:e.group,life:.42,maxLife:.42,remove:!1,update:(s,a)=>{e.animation?.mixer.update(a);const o=s.life/s.maxLife;s.object.scale.copy(i).multiplyScalar(Math.max(.01,o)),s.object.rotation.y+=.22,s.object.position.y=(1-o)*.8},onEnd:()=>{this.scene.remove(e.group);const s=this.enemies.indexOf(e);s>=0&&this.enemies.splice(s,1)}}),this.updateUI()}damagePlayer(e,t,n=t?.damageType??"physical"){if(this.player.invulnerable>0||this.state!=="running")return;const i=n==="magic"?this.player.magicResist:this.player.armor,s=rn(t?.defensePenetration??0,0,.75),a=Math.max(0,i*(1-s)),o=Math.max(1,Math.round(e*(100/(100+a*5))));let c=o,l=0;this.player.shield>0&&(l=Math.min(this.player.shield,c),this.player.shield-=l,c-=l),this.player.hp-=c;const h=this.getRuneRank("ward_thorns");if(l>0&&h>0&&t?.hp>0&&!t.dead){const u=Math.round(this.player.skillPower*(.35+h*.15));this.damageEnemy(t,u,!1,"magic"),this.spawnEnergyArc(this.player.group.position.clone().add(new T(0,1.1,0)),t.group.position.clone().add(new T(0,t.type==="boss"?1.8:.9,0)),12427775,.3,Math.min(3,1+h)),this.spawnRuneExplosion(t.group.position.clone(),.7+h*.12,11111157,.28,4+h),this.spawnRing(t.group.position.clone(),.8,9363672,.2)}if(this.audio.play(n==="magic"?"playerMagicHit":"playerPhysicalHit",t?.type==="boss"?1.35:.9),this.player.invulnerable=.38,this.cameraShake=Math.max(this.cameraShake,t?.type==="boss"?.24:.1),this.spawnDamageNumber(this.player.group.position.clone().add(new T(0,2.5,0)),`-${o}`,n==="magic"?"#c884ff":"#ff7454"),this.spawnRing(this.player.group.position.clone(),1.1,n==="magic"?10310620:13057323,.24),t){const u=this.player.group.position.clone().sub(t.group.position).setY(0).normalize();this.player.group.position.addScaledVector(u,n==="magic"?.22:t.type==="boss"?1.2:.45)}this.updateUI(),this.player.hp<=0&&this.die()}spawnDrop(e,t,n){const i={xp:6934717,shard:15760446,potion:15224133,relic:16762221,gear:n?.boss?13142527:7983074},s=e==="xp"?new Vt(.18,0):e==="shard"?new Yn(.22,0):e==="potion"?new un(.24,8,6):e==="gear"?new zi(n?.boss?.42:.34,0):new Zt(.33,0),a=le(s,We(i[e],{emissive:i[e],emissiveIntensity:e==="relic"||e==="gear"?2.8:1.7,roughness:.3}),!1);a.position.copy(t).add(new T(we(-.45,.45),.38,we(-.45,.45))),this.scene.add(a),this.drops.push({type:e,value:n,mesh:a,life:18,phase:we(0,Math.PI*2)})}updateDrops(e){for(let t=this.drops.length-1;t>=0;t-=1){const n=this.drops[t];n.life-=e,n.mesh.rotation.y+=e*2.3,n.mesh.position.y=this.surfaceHeight(n.mesh.position.x,n.mesh.position.z,.42)+Math.sin(this.elapsed*4+n.phase)*.12;const i=Lt(n.mesh.position,this.player.group.position);if(i<4.2){const s=this.player.group.position.clone().add(new T(0,1,0)).sub(n.mesh.position);n.mesh.position.addScaledVector(s.normalize(),e*(8+(4.2-i)*4))}i<.9?(this.collectDrop(n),this.scene.remove(n.mesh),this.drops.splice(t,1)):n.life<=0&&(this.scene.remove(n.mesh),this.drops.splice(t,1))}}collectDrop(e){this.audio.play("pickup",e.type==="gear"?1.25:.75),e.type==="xp"&&this.addXP(e.value),e.type==="shard"&&(this.player.shards+=e.value,this.addFeed(`收集 <b>${e.value} 枚余烬</b>`)),e.type==="potion"&&(this.player.potions=Math.min(5,this.player.potions+e.value),this.addFeed("拾取 <b>疗愈药剂</b>")),e.type==="relic"&&this.acquireRelic(),e.type==="gear"&&this.acquireGear(e.value),this.spawnRing(e.mesh.position.clone().setY(.06),.8,e.type==="xp"?6475195:15302723,.22),this.updateUI()}addXP(e){this.player.xp+=e;let t=0;for(;this.player.xp>=this.player.xpNeeded;)this.player.xp-=this.player.xpNeeded,this.player.level+=1,this.player.xpNeeded=80+this.player.level*40,this.player.maxHp+=15,this.player.hp=this.player.maxHp,this.player.damage+=3,this.player.skillPower+=4,this.player.armor+=1,this.player.level%2===0&&(this.player.magicResist+=1),this.audio.play("levelUp",1.3),this.spawnRing(this.player.group.position.clone(),3.2,16756069,.7),this.spawnBurst(this.player.group.position.clone().add(new T(0,1,0)),18,16757611,6),this.addFeed(`<b>灵火升阶</b> · 当前等级 ${this.player.level}`),t+=1;t>0&&(this.refreshEnemyDifficulty(),this.queueRuneDraft(t))}acquireRelic(){const t={...gr([{name:"裂纹齿轮",glyph:"⚙",stat:"damage",value:5,text:"伤害 +5"},{name:"青铜甲片",glyph:"◇",stat:"armor",value:3,text:"护甲 +3"},{name:"余温玻璃",glyph:"◈",stat:"maxHp",value:22,text:"生命 +22"},{name:"疾行轴承",glyph:"⌁",stat:"speed",value:.5,text:"移速 +0.5"}])};if(this.player.relics.length>=3){this.player.shards+=15,this.addFeed(`<b>${t.name}</b> 化作 15 枚余烬`);return}this.player.relics.push(t),this.player[t.stat]+=t.value,t.stat==="maxHp"&&(this.player.hp+=t.value),this.addFeed(`获得遗物 <b>${t.name}</b> · ${t.text}`),this.updateRelics()}acquireGear(e={}){const t=Math.max(1,Math.floor(e.level||this.wave||1)),n=Math.random()+(e.boss?.22:0)+t*.012,i=n>1.08?{id:"legendary",name:"传说",multiplier:2.35,color:"#ffd17c"}:n>.82?{id:"epic",name:"史诗",multiplier:1.72,color:"#cda3ff"}:n>.5?{id:"rare",name:"稀有",multiplier:1.3,color:"#8de3ef"}:{id:"common",name:"精良",multiplier:1,color:"#e8dfc8"},s=Math.max(1,Math.round((2.2+t*.72)*i.multiplier)),a=[{name:"猎炉刃芯",glyph:"✦",stat:"damage",value:s,text:`普通攻击 +${s}`},{name:"秘焰透镜",glyph:"◉",stat:"skillPower",value:Math.round(s*1.18),text:`技能强度 +${Math.round(s*1.18)}`},{name:"活性心核",glyph:"◆",stat:"maxHp",value:Math.round(s*4.4),text:`生命上限 +${Math.round(s*4.4)}`},{name:"重铸甲片",glyph:"◇",stat:"armor",value:Math.max(1,Math.round(s*.62)),text:`物理护甲 +${Math.max(1,Math.round(s*.62))}`},{name:"虚空护符",glyph:"⬡",stat:"magicResist",value:Math.max(1,Math.round(s*.58)),text:`魔法抗性 +${Math.max(1,Math.round(s*.58))}`},{name:"连发轴承",glyph:"⌁",stat:"attackSpeed",value:Math.min(.12,.025+t*.0025*i.multiplier),text:`攻击速度 +${Math.round(Math.min(.12,.025+t*.0025*i.multiplier)*100)}%`}],o={...gr(a),rarity:i.id,rarityName:i.name,level:t};this.player[o.stat]+=o.value,o.stat==="maxHp"&&(this.player.hp+=o.value),this.player.gearScore+=Math.round(s*i.multiplier*8),this.player.relics.unshift(o),this.player.relics=this.player.relics.slice(0,6),this.audio.play("gear",i.id==="legendary"?1.8:i.id==="epic"?1.35:1),this.spawnEnergyColumn(this.player.group.position.clone(),Number.parseInt(i.color.slice(1),16),.34,i.id==="legendary"?5.2:3.5),this.addFeed(`<b>${i.name} · ${o.name}</b> · ${o.text}（区域 Lv.${t}）`),this.updateRelics(),this.saveGame()}updateRelics(){V.relicSlots.innerHTML="";for(let e=0;e<6;e+=1){const t=this.player.relics[e],n=document.createElement("div");n.className=`relic-slot${t?"":" empty"}`,t?.rarity&&(n.dataset.rarity=t.rarity),n.title=t?`${t.name}：${t.text}`:"空槽",n.innerHTML=t?`<span>${t.glyph}</span><small>${t.rarityName?`${t.rarityName}·`:""}${t.name}</small>`:`<span>${["Ⅰ","Ⅱ","Ⅲ","Ⅳ","Ⅴ","Ⅵ"][e]}</span><small>等待掉落</small>`,V.relicSlots.append(n)}V.relicCount.textContent=`战力 ${this.player.gearScore}`}spawnCastingEffect(e,t,n){const i=new je;i.position.copy(this.player.group.position),i.position.y=.055;const s=new ke({color:e,transparent:!0,opacity:.72,side:xt,depthWrite:!1,blending:$t}),a=[];[[.72,.76],[1.08,1.11],[1.48,1.52]].forEach(([u,d],f)=>{const g=le(new pi(u,d,48),s.clone(),!1);g.rotation.x=-Math.PI/2,g.rotation.z=f*.37,i.add(g),a.push(g)});const o=[];for(let u=0;u<10;u+=1){const d=u/10*Math.PI*2,f=le(u%2===0?new bt(.07,.02,.28):new Yn(.1,0),s.clone(),!1);f.position.set(Math.cos(d)*1.3,.025,Math.sin(d)*1.3),f.rotation.y=-d,i.add(f),o.push(f)}const c=[],l=We(e,{emissive:e,emissiveIntensity:3.4,roughness:.12,transparent:!0,opacity:.9});for(let u=0;u<6;u+=1){const d=le(new Vt(.07+u%2*.025,0),l.clone(),!1);i.add(d),c.push(d)}const h=le(new St(n==="nova"?.15:.28,.72,2.8,16,1,!0),new ke({color:e,transparent:!0,opacity:.08,side:xt,depthWrite:!1,blending:$t}),!1);h.position.y=1.4,i.add(h),this.scene.add(i),this.effects.push({object:i,life:t,maxLife:t,update:(u,d)=>{const f=rn(1-u.life/u.maxLife,0,1);u.object.position.x=this.player.group.position.x,u.object.position.z=this.player.group.position.z,a.forEach((g,_)=>{g.rotation.z+=d*(_%2===0?1.4:-1.1)*(1+_*.2),g.scale.setScalar(.55+f*(.78+_*.13)),g.material.opacity=(.28+f*.58)*Math.sin(f*Math.PI)}),o.forEach((g,_)=>{g.rotation.y+=d*(_%2?-2:2),g.position.y=.04+Math.sin(this.elapsed*8+_)*.025,g.material.opacity=Math.sin(f*Math.PI)*.68}),c.forEach((g,_)=>{const m=this.elapsed*(n==="nova"?4.8:3.2)+_/c.length*Math.PI*2,p=ft.lerp(1.45,.34,f);g.position.set(Math.cos(m)*p,.35+f*1.75+Math.sin(m*2)*.16,Math.sin(m)*p),g.rotation.y+=d*7,g.material.opacity=Math.sin(f*Math.PI)*.9}),h.scale.set(.6+f*.5,.4+f*.7,.6+f*.5),h.material.opacity=Math.sin(f*Math.PI)*.11}})}spawnEnergyColumn(e,t,n,i){const s=le(new St(.32,1.7,i,28,1,!0),new ke({color:t,transparent:!0,opacity:.32,side:xt,depthWrite:!1,blending:$t}),!1);s.position.copy(e),s.position.y=i/2,s.scale.set(.18,.12,.18),this.scene.add(s),this.effects.push({object:s,life:n,maxLife:n,update:(a,o)=>{const c=1-a.life/a.maxLife,l=.18+Math.sin(c*Math.PI)*1.15;a.object.scale.set(l,.12+c*1.18,l),a.object.rotation.y+=o*3.4,a.object.material.opacity=(1-c)*.32}})}spawnAfterimages(e,t){const n=this.player.body.rotation.clone();for(let i=0;i<4;i+=1){const s=this.player.body.clone(!0);s.traverse(a=>{a.isMesh&&(a.castShadow=!1,a.receiveShadow=!1,a.material=a.material.clone(),a.material.transparent=!0,a.material.opacity=.14-i*.018,a.material.depthWrite=!1,a.material.emissive&&(a.material.emissive.setHex(5228215),a.material.emissiveIntensity=1.2))}),s.position.copy(e).lerp(t,.14+i*.18),s.position.y=.02,s.rotation.copy(n),this.scene.add(s),this.effects.push({object:s,life:.28+i*.035,maxLife:.28+i*.035,update:a=>{const o=a.life/a.maxLife;a.object.position.y+=.006,a.object.traverse(c=>{c.isMesh&&(c.material.opacity=o*(.12-i*.015))})}})}}spawnRing(e,t,n,i){const s=le(new pi(.82,1,48),new ke({color:n,transparent:!0,opacity:.78,side:xt,depthWrite:!1}),!1);s.position.copy(e),s.position.y=Math.max(.045,e.y),s.rotation.x=-Math.PI/2,s.scale.setScalar(.15),this.scene.add(s),this.effects.push({object:s,life:i,maxLife:i,update:a=>{const o=1-a.life/a.maxLife;a.object.scale.setScalar(.15+o*t),a.object.material.opacity=(1-o)*.7}})}spawnEnergyArc(e,t,n=16761194,i=.28,s=2){const a=new je,o=e.clone().lerp(t,.5),c=e.distanceTo(t),l=t.clone().sub(e).normalize(),h=new T(-l.z,0,l.x);for(let d=0;d<s;d+=1){const f=[e.clone()];for(let m=1;m<5;m+=1){const p=m/5,M=e.clone().lerp(t,p);M.y+=Math.sin(p*Math.PI)*(.25+d*.08),M.addScaledVector(h,Math.sin(p*Math.PI*(3+d))*c*.035*(d%2?-1:1)),f.push(M)}f.push(t.clone());const g=new rh(f),_=le(new Wo(g,18,d===0?.035:.018,5,!1),new ke({color:n,transparent:!0,opacity:d===0?.92:.52,depthWrite:!1,blending:$t}),!1);a.add(_)}const u=le(new Vt(.11,0),new ke({color:n,transparent:!0,opacity:.9,depthWrite:!1}),!1);u.position.copy(o),a.add(u),this.scene.add(a),this.effects.push({object:a,life:i,maxLife:i,update:(d,f)=>{const g=rn(d.life/d.maxLife,0,1);d.object.children.forEach(_=>{_.material&&(_.material.opacity=g*(_===u?.9:.72))}),u.rotation.x+=f*10,u.rotation.y+=f*13,u.scale.setScalar(1+(1-g)*1.8)}})}spawnRuneExplosion(e,t,n,i=.48,s=8){const a=new je;a.position.copy(e),a.position.y+=.12;const o=le(new zi(1,1),new ke({color:n,transparent:!0,opacity:.28,wireframe:!0,depthWrite:!1,blending:$t}),!1);a.add(o);const c=[];for(let l=0;l<s;l+=1){const h=l/s*Math.PI*2,u=le(new Yn(.12+l%3*.025,0),new ke({color:n,transparent:!0,opacity:.82,depthWrite:!1}),!1);u.position.set(Math.cos(h)*.45,.15+l%2*.2,Math.sin(h)*.45),u.userData.velocity=new T(Math.cos(h),.24+l%3*.12,Math.sin(h)).multiplyScalar(t*(.65+l%2*.16)),c.push(u),a.add(u)}this.scene.add(a),this.effects.push({object:a,life:i,maxLife:i,update:(l,h)=>{const u=1-l.life/l.maxLife,d=1-u;o.scale.setScalar(.12+u*t),o.rotation.x+=h*3.2,o.rotation.y-=h*4.1,o.material.opacity=d*.28,c.forEach(f=>{f.position.addScaledVector(f.userData.velocity,h),f.rotation.x+=h*9,f.rotation.y+=h*7,f.material.opacity=d*.82})}})}spawnVortexEffect(e,t,n=12020479,i=.7){const s=[];for(let l=0;l<64;l+=1){const h=l/63,u=h*Math.PI*2*3.25,d=.2+h*t;s.push(new T(Math.cos(u)*d,h*.12,Math.sin(u)*d))}const o=new Xi(new yt().setFromPoints(s),new Ss({color:n,transparent:!0,opacity:.82,depthWrite:!1,blending:$t})),c=new je;c.position.copy(e),c.position.y+=.08,c.add(o);for(let l=0;l<7;l+=1){const h=le(new Vt(.08,0),new ke({color:n,transparent:!0,opacity:.72,depthWrite:!1}),!1),u=l/7*Math.PI*2;h.position.set(Math.cos(u)*t*.72,.15+l%3*.22,Math.sin(u)*t*.72),c.add(h)}this.scene.add(c),this.effects.push({object:c,life:i,maxLife:i,update:(l,h)=>{const u=1-l.life/l.maxLife,d=1-u;l.object.rotation.y-=h*(5.5+u*5),l.object.scale.setScalar(.3+u*.9),l.object.children.forEach(f=>{f.material&&(f.material.opacity=d*.72),f!==o&&(f.position.y+=h*1.4)})}})}spawnPortalEffect(e,t=6281675,n=.42){const i=new je;i.position.copy(e),i.position.y+=1;for(let s=0;s<3;s+=1){const a=le(new dn(.65+s*.17,.025,6,36),new ke({color:t,transparent:!0,opacity:.62-s*.1,depthWrite:!1,blending:$t}),!1);a.rotation.y=Math.PI/2,a.rotation.x=(s-1)*.14,i.add(a)}this.scene.add(i),this.effects.push({object:i,life:n,maxLife:n,update:(s,a)=>{const o=1-s.life/s.maxLife;s.object.scale.setScalar(.35+o*1.25),s.object.rotation.z+=a*3,s.object.children.forEach((c,l)=>{c.material.opacity=(1-o)*(.62-l*.1)})}})}spawnGuardShell(e=7531221,t=2.4){const n=new je,i=le(new Zt(1.02,1),new ke({color:e,transparent:!0,opacity:.24,wireframe:!0,depthWrite:!1,blending:$t}),!1);n.add(i);for(let s=0;s<4;s+=1){const a=le(new Vt(.13,0),new ke({color:e,transparent:!0,opacity:.72,depthWrite:!1}),!1),o=s/4*Math.PI*2;a.position.set(Math.cos(o)*1.12,s%2?.32:-.22,Math.sin(o)*1.12),n.add(a)}n.position.copy(this.player.group.position).add(new T(0,1.05,0)),this.scene.add(n),this.effects.push({object:n,life:t,maxLife:t,update:(s,a)=>{const o=rn(s.life/s.maxLife,0,1);s.object.position.copy(this.player.group.position).add(new T(0,1.05,0)),s.object.rotation.y+=a*2.4,s.object.rotation.x=Math.sin(this.elapsed*2.4)*.12,s.object.children.forEach((c,l)=>{c.material.opacity=o*(l===0?.24:.72),l>0&&(c.rotation.y+=a*(4+l))}),this.player.shield<=0&&(s.life=0)}})}spawnBurst(e,t,n,i){const s=new je,a=[],o=new ke({color:n,transparent:!0,depthWrite:!1});for(let c=0;c<t;c+=1){const l=le(new Yn(we(.04,.11),0),o.clone(),!1);l.position.copy(e);const h=new T(we(-1,1),we(.15,1.3),we(-1,1)).normalize().multiplyScalar(we(i*.35,i));s.add(l),a.push({mesh:l,velocity:h})}this.scene.add(s),this.effects.push({object:s,life:.62,maxLife:.62,update:(c,l)=>{const h=c.life/c.maxLife;a.forEach(u=>{u.velocity.y-=l*6,u.mesh.position.addScaledVector(u.velocity,l),u.mesh.material.opacity=h,u.mesh.rotation.x+=l*8})}})}createMuzzleBurst(e,t=16753759,n=4){this.spawnBurst(e,n,t,2.5+n*.08)}spawnDashTrail(e,t,n=6015160,i=.42){const s=t.clone().sub(e),a=s.length(),o=le(new gi(.8,a),new ke({color:n,transparent:!0,opacity:i,side:xt,depthWrite:!1}),!1);o.position.copy(e).add(t).multiplyScalar(.5),o.position.y=.06,o.rotation.x=-Math.PI/2,o.rotation.z=-Math.atan2(s.z,s.x)+Math.PI/2,this.scene.add(o),this.effects.push({object:o,life:.35,maxLife:.35,update:c=>{c.object.material.opacity=c.life/c.maxLife*i}})}spawnClickMarker(e){this.spawnRing(e.clone(),.75,15238989,.3)}spawnDamageNumber(e,t,n,i=!1){const s=document.createElement("span");s.className=`damage-number${i?" critical":""}`,s.textContent=t,s.style.color=n,this.floatLayer.append(s),this.damageNumbers.push({element:s,position:e.clone(),life:.85,maxLife:.85,drift:we(-12,12)})}updateDamageNumbers(e){for(let t=this.damageNumbers.length-1;t>=0;t-=1){const n=this.damageNumbers[t];n.life-=e,n.position.y+=e*.72;const i=n.position.clone().project(this.camera),s=(i.x*.5+.5)*window.innerWidth,a=(-i.y*.5+.5)*window.innerHeight;n.element.style.transform=`translate3d(${s+n.drift*(1-n.life/n.maxLife)}px, ${a}px, 0)`,n.element.style.opacity=String(rn(n.life/.35,0,1)),n.life<=0&&(n.element.remove(),this.damageNumbers.splice(t,1))}}updateEffects(e){for(let t=this.effects.length-1;t>=0;t-=1){const n=this.effects[t];n.life-=e,n.update?.(n,e),n.life<=0&&(n.onEnd?.(),n.remove!==!1&&n.object?.parent&&n.object.parent.remove(n.object),this.effects.splice(t,1))}}updateCooldowns(e){Object.values(this.skillState).forEach(t=>{t.cooldown=Math.max(0,t.cooldown-e)}),V.skillButtons.forEach(t=>{const n=this.skillState[t.dataset.skill],i=n.cooldown/n.max,s=t.querySelector(".cooldown-sweep");s.style.transform=`translateY(${100-i*100}%)`,t.classList.toggle("cooling",i>0),i===0&&t.dataset.wasCooling==="true"&&(t.classList.add("ready-flash"),setTimeout(()=>t.classList.remove("ready-flash"),450)),t.dataset.wasCooling=String(i>0)})}checkWaveState(e){this.lastRegionUpdate-=e,this.lastRegionUpdate<=0&&(this.lastRegionUpdate=.25,this.updateCurrentRegion());const t=this.regionStates.get(this.currentRegionKey);if(t){if(t.active&&t.event?.id==="rush"&&(t.eventTimeLeft=Math.max(0,t.eventTimeLeft-e)),t.active&&t.defeated>=t.enemyCount){this.completeRegion(t);return}if(!t.active&&Date.now()>=t.respawnAt){this.spawnRegionPack(t);return}this.syncRegionObjective(t)}}completeRegion(e){e.active=!1,e.clears+=1;const t=Math.round(we(24,58));e.respawnAt=Date.now()+t*1e3,this.waveActive=!1,this.regionsCleared+=1,this.runStats.wavesCleared+=1,this.runStats.bestWave=Math.max(this.runStats.bestWave,this.regionsCleared+1),this.regionsCleared%3===0&&(this.runStats.chaptersCleared+=1,this.addFeed("<b>探索里程碑</b> · 连续净化 3 个区域，额外获得 2000 积分")),V.bossBar.classList.add("hidden"),this.player.hp=Math.min(this.player.maxHp,this.player.hp+Math.round(this.player.maxHp*.12)),(Math.random()<.42||e.hasBoss)&&this.spawnDrop("gear",this.player.group.position,{level:e.threat,boss:e.hasBoss}),e.event?.id==="elite"&&this.spawnDrop("shard",this.player.group.position.clone().add(new T(-.6,0,.2)),22+e.threat*5),e.event?.id==="rush"&&(e.eventTimeLeft>0?(this.spawnDrop("gear",this.player.group.position,{level:e.threat+1,boss:!0}),this.spawnDrop("shard",this.player.group.position.clone().add(new T(.65,0,.3)),28+e.threat*6),this.addFeed("<b>限时猎杀完成</b> · 额外装备与余烬已发放")):this.addFeed("<b>限时奖励错过</b> · 区域仍已净化")),e.event?.id==="volatile"&&this.spawnDrop("shard",this.player.group.position.clone().add(new T(.55,0,-.3)),38+e.threat*7),!this.cursedChallenge&&(!this.cursedChest||this.cursedChest.status!=="sealed")&&(Math.random()<.52||this.regionsCleared%3===0)&&this.spawnCursedChest(e),this.addFeed(`<b>${e.biome.name} 已净化</b> · ${t} 秒后随机重生，继续前往相邻区域`),this.audio.play("regionClear",1.2),this.syncRegionObjective(e),this.updateUI(),this.saveGame(),this.submitCurrentScore()}continueAfterVictory(){V.victoryScreen.classList.remove("active"),this.state="running",this.updateCurrentRegion(!0)}pause(){this.state==="running"&&(this.state="paused",this.saveGame(),V.pauseScreen.classList.add("active"))}resume(){this.state==="paused"&&(this.state="running",V.pauseScreen.classList.remove("active"),this.clock.getDelta())}die(){this.state="dead",this.player.hp=0,localStorage.removeItem(Oi),V.deathWave.textContent=String(this.wave),V.deathSummary.textContent=`击败 ${this.kills} 个敌人 · 收集 ${this.player.shards} 枚余烬`,V.deathScore.textContent=mr(Er(this.runStats).total),this.submitCurrentScore(V.deathSubmitStatus),V.deathScreen.classList.add("active"),this.updateUI()}hasSave(){try{const e=JSON.parse(localStorage.getItem(Oi));return!!(e?.wave&&e?.player)}catch{return!1}}refreshSaveState(){if(!this.hasSave()){V.startButtonLabel.textContent="进入地窟",V.newRunButton.classList.add("hidden");return}const e=JSON.parse(localStorage.getItem(Oi));V.startButtonLabel.textContent=`继续威胁 ${e.wave} 区域`,V.newRunButton.classList.remove("hidden")}saveGame(){if(!["running","paused","victory","drafting"].includes(this.state))return;const e={version:2,wave:this.wave,kills:this.kills,victorySeen:this.victorySeen,runId:this.runId,runStats:Ir(this.runStats),world:{offsetX:this.worldOffset.x,offsetZ:this.worldOffset.y,regionsCleared:this.regionsCleared},progression:{runeRanks:this.runeRanks,pendingRuneDrafts:this.pendingRuneDrafts},player:{hp:this.player.hp,maxHp:this.player.maxHp,damage:this.player.damage,skillPower:this.player.skillPower,armor:this.player.armor,magicResist:this.player.magicResist,attackSpeed:this.player.attackSpeed,critChance:this.player.critChance,gearScore:this.player.gearScore,level:this.player.level,xp:this.player.xp,xpNeeded:this.player.xpNeeded,shards:this.player.shards,potions:this.player.potions,relics:this.player.relics,speed:this.player.speed}};localStorage.setItem(Oi,JSON.stringify(e))}loadSave(){try{const e=JSON.parse(localStorage.getItem(Oi));if(!e?.player)return;if(this.wave=e.wave??1,this.kills=e.kills??0,this.victorySeen=e.victorySeen??!1,this.worldOffset.set(Number(e.world?.offsetX)||0,Number(e.world?.offsetZ)||0),this.regionsCleared=Math.max(0,Number(e.world?.regionsCleared)||e.runStats?.wavesCleared||0),this.runId=e.runId||this.leaderboard.createRunId(),this.runeRanks=e.progression?.runeRanks&&typeof e.progression.runeRanks=="object"?{...e.progression.runeRanks}:{},this.pendingRuneDrafts=Math.max(0,Number(e.progression?.pendingRuneDrafts)||0),e.runStats)this.runStats=Ir(e.runStats);else{const t=Ta();t.kills.crawler=Math.max(0,Number(e.kills)||0),t.wavesCleared=Math.max(0,(Number(e.wave)||1)-1),t.chaptersCleared=Math.floor(t.wavesCleared/3),t.bestWave=Math.max(1,Number(e.wave)||1),this.runStats=t}Object.assign(this.player,e.player),this.player.hp=Math.max(1,this.player.hp)}catch{localStorage.removeItem(Oi)}}addFeed(e){const t=document.createElement("div");for(t.className="loot-message",t.innerHTML=e,V.lootFeed.prepend(t);V.lootFeed.children.length>4;)V.lootFeed.lastElementChild.remove();setTimeout(()=>t.remove(),3700)}updateUI(){const e=this.player,t=rn(e.hp/e.maxHp,0,1),n=rn(e.shield/e.maxHp,0,1);V.healthLabel.textContent=`${Math.max(0,Math.ceil(e.hp))} / ${e.maxHp}`,V.healthFill.style.transform=`scaleX(${t})`,V.shieldFill.style.transform=`translateX(${t*100}%) scaleX(${n})`,V.xpLabel.textContent=`${Math.floor(e.xp)} / ${e.xpNeeded}`,V.xpFill.style.transform=`scaleX(${rn(e.xp/e.xpNeeded,0,1)})`,V.levelLabel.textContent=String(e.level).padStart(2,"0"),V.waveLabel.textContent=`威胁 ${this.wave}`,V.damageStat.textContent=String(Math.round(e.damage)),V.skillStat.textContent=String(Math.round(e.skillPower)),V.armorStat.textContent=String(Math.round(e.armor)),V.resistStat.textContent=String(Math.round(e.magicResist)),V.threatStat.textContent=String(this.wave),V.shardStat.textContent=String(e.shards),V.currentScore.textContent=mr(Er(this.runStats).total),V.potionCount.textContent=String(e.potions),V.runeProgress.textContent=`已激活 ${this.getActiveRuneCount()} 层符文`;const i={attack:"火矢",nova:"震环",dash:"裂隙步",ward:"结界"};V.skillButtons.forEach(f=>{const g=Pl.filter(p=>p.skill===i[f.dataset.skill]&&this.getRuneRank(p.id)>0),_=g.reduce((p,M)=>p+this.getRuneRank(M.id),0);let m=f.querySelector(".rune-rank-badge");_>0&&!m&&(m=document.createElement("span"),m.className="rune-rank-badge",f.append(m)),m&&(m.textContent=String(_),m.classList.toggle("hidden",_===0)),f.classList.toggle("runed",_>0),f.title=g.length?g.map(p=>`${p.name} ${this.getRuneRank(p.id)}级`).join(" · "):""});const s=this.getPlayerWorldPosition(),a=this.regionStates.get(this.currentRegionKey),o=a??Rl(s.x,s.y),c=this.getThreatDamageMultiplier(this.wave),l=this.getEnemyMovementMultiplier(this.wave),h=this.getEnemyVolleySize("wisp",this.wave);V.regionStatus.textContent=`球面坐标 ${o.x} · ${o.z} ｜ 已净化 ${this.regionsCleared} ｜ 敌伤 ×${c.toFixed(1)} · 移速 ×${l.toFixed(1)} · 弹幕 ${h} 发`;const u=Math.max(0,(a?.enemyCount??this.waveTotal)-(a?.defeated??this.waveDefeated)),d=a?.enemyCount?a.defeated/a.enemyCount:this.waveTotal?this.waveDefeated/this.waveTotal:0;a?.active&&(V.objectiveText.textContent=`剩余 ${u} 个敌人`,V.objectivePercent.textContent=`${Math.round(d*100)}%`,V.objectiveFill.style.width=`${d*100}%`),this.updateRelics()}updateMinimap(){const e=V.minimap.getContext("2d"),t=V.minimap.width,n=t/2;e.clearRect(0,0,t,t),e.save(),e.beginPath(),e.arc(n,n,n-4,0,Math.PI*2),e.clip(),e.fillStyle="rgba(5, 20, 21, .8)",e.fillRect(0,0,t,t),e.strokeStyle="rgba(105, 176, 163, .12)",e.lineWidth=1;for(let a=1;a<4;a+=1)e.beginPath(),e.arc(n,n,n/4*a,0,Math.PI*2),e.stroke();const i=a=>({x:n+(a.x-this.player.group.position.x)/Cl*(n-9),y:n+(a.z-this.player.group.position.z)/Cl*(n-9)});if(this.enemies.forEach(a=>{if(a.dead)return;const o=i(a.group.position);e.fillStyle=a.type==="boss"?"#ff6b35":a.damageType==="magic"?"#b682ff":a.ranged?"#e4bd75":"#b14d38",e.beginPath(),e.arc(o.x,o.y,a.type==="boss"?4.5:2.2,0,Math.PI*2),e.fill()}),this.cursedChest){const a=i(this.cursedChest.group.position);e.fillStyle=this.cursedChest.status==="active"?"#ff80df":"#bb72ea",e.strokeStyle="rgba(255, 210, 255, .8)",e.lineWidth=1,e.fillRect(a.x-3.5,a.y-3.5,7,7),e.strokeRect(a.x-4.5,a.y-4.5,9,9)}const s={x:n,y:n};e.fillStyle="#76d8c6",e.beginPath(),e.moveTo(s.x,s.y-5),e.lineTo(s.x+4,s.y+4),e.lineTo(s.x-4,s.y+4),e.closePath(),e.fill(),e.restore()}updateAmbient(e){this.dust.rotation.y+=e*.012,this.forgeCore.rotation.y+=e*.8,this.forgeCore.position.y=.82+Math.sin(this.elapsed*2.4)*.08,this.emberLight.intensity=54+Math.sin(this.elapsed*4.1)*5,this.flames.forEach((t,n)=>{t.scale.y=.82+Math.sin(this.elapsed*8+n)*.18,t.rotation.y+=e*(.8+n*.04)}),this.cursor.rotation.z+=e*.75,this.cursor.material.opacity=this.state==="running"?.48+Math.sin(this.elapsed*4)*.18:0}updateCamera(e){this.cameraTarget.copy(this.player.group.position),this.cameraTarget.y=.75;const t=this.cameraTarget.clone().add(this.cameraOffset),n=1-Math.pow(7e-4,e);if(this.camera.position.lerp(t,n),this.cameraShake>0){const i=this.cameraShake*.18;this.camera.position.x+=we(-i,i),this.camera.position.y+=we(-i*.5,i*.5),this.camera.position.z+=we(-i,i),this.cameraShake=Math.max(0,this.cameraShake-e*1.8)}this.camera.lookAt(this.cameraTarget)}animate(){requestAnimationFrame(()=>this.animate());const e=Math.min(this.clock.getDelta(),.04);this.elapsed+=e,this.updateAmbient(e),this.updateCamera(e),this.state==="running"?(this.updatePlayer(e),this.updateEnemies(e),this.updateProjectiles(e),this.updateDrops(e),this.updateDelayedActions(e),this.updateCursedChest(e),this.updateEffects(e),this.updateDamageNumbers(e),this.updateCooldowns(e),this.checkWaveState(e),this.updateMinimap(),this.elapsed-this.lastSaveAt>12&&(this.lastSaveAt=this.elapsed,this.saveGame())):(this.updateEffects(e),this.updateDamageNumbers(e)),this.renderer.render(this.scene,this.camera)}}new q_;
