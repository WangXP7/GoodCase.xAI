// Postura assentada: o mesmo estado deve dirigir animação, LOS, tiro e hitbox.
import { Game, bootGame, initTextures, THREE } from './harness.mjs';
if(process.argv.includes('--mutante=rodada')){const start=Game.prototype._startRound,postura=Game.prototype._posturaBot;Game.prototype._startRound=function(...args){this.__mutRound=true;try{return start.apply(this,args);}finally{this.__mutRound=false;}};Game.prototype._posturaBot=function(...args){if(!this.__mutRound)return postura.apply(this,args);};}
let falhas=0;const cobrar=(ok,msg)=>{console.log(`${ok?'OK':'FALHA'} ${msg}`);if(!ok)falhas++;};
if(process.argv.includes('--mutante=postura'))Game.prototype._posturaBot=()=>{};
if(process.argv.includes('--mutante=olho'))Game.prototype._botEye=b=>new THREE.Vector3(b.pos.x,b.pos.y+1.5,b.pos.z);
const g=bootGame('piscina_treta',{textures:initTextures(),bots:2,seed:985});
g.state='live';g.time=20;g.world.occluders=[];g.world.rayOccluded=null;g.world.groundHeightAt=()=>0;g._losClear=()=>true;
for(const k of ['_tracer','_flash','_fleshImpact','_bloodSpatter','_noteHit','_puff','_rastroTiroBot'])g[k]=()=>{};
const [b,alvo]=g.bots;const ctrl={crouch:false,setCrouch(v){this.crouch=!!v;},update(){},shoot(){},revive(){},die(){}};
b.mesh.isGLB=true;b.mesh.ctrl=ctrl;alvo.alive=true;alvo.team='B';g.player.alive=false;
const preparar=()=>{g.time+=2;b.pos.set(0,0,0);alvo.pos.set(0,0,10);Object.assign(b,{alive:true,hp:100,team:'E',yaw:0,target:alvo,think:Infinity,aimErr:0,reactAt:0,focusUntil:0,nextShotAt:0,reloadUntil:0,weapon:'ak',mag:30,skill:1,_losLost:false,smokes:0,grenades:0,crouchBias:true});};
let observado;g._dispararBot=function(bot,from){observado={crouchF:bot.crouchF,eye:from.y-bot.pos.y};return {point:from.clone().add(new THREE.Vector3(0,0,10))};};
const original=Math.random;Math.random=()=>.5;
try{for(const caminho of ['roteiro','NN']){
 preparar();observado=null;
 if(caminho==='roteiro')g._updateBot(b,0);else{g.botBrainMix=1;b._nnThink=Infinity;b._nn={moveFwd:0,moveStrafe:0,dyaw:0,fire:1,crouch:1};g._updateBotNN(b,0);}
 cobrar(b.crouchF===1&&ctrl.crouch,`${caminho}: animação e hitbox agacham juntas`);
 cobrar(observado?.crouchF===1&&Math.abs(observado.eye-.98)<1e-9,`${caminho}: primeiro disparo já parte do olho agachado`);
 cobrar(Math.abs(g._botEye(b).y-b.pos.y-.98)<1e-9,`${caminho}: LOS usa o mesmo olho`);
 const from=new THREE.Vector3(0,b.pos.y+1.6,-5),dir=new THREE.Vector3(0,0,1);alvo.alive=false;g.player.alive=false;
 const shooter={team:'B'};
 cobrar(!g._consultarTiro(shooter,from,dir,'ak'),`${caminho}: raio acima da cabeça agachada não acerta`);
 from.y=b.pos.y+1.08;const hit=g._consultarTiro(shooter,from,dir,'ak');
 cobrar(hit?.ent===b&&hit.head,`${caminho}: cabeça agachada recebe headshot real`);
 alvo.alive=true;b.target=null;b.nextShotAt=Infinity;
 if(caminho==='roteiro')g._updateBot(b,0);else{b._nn.crouch=0;g._updateBotNN(b,0);}
 cobrar(b.crouchF===0&&!ctrl.crouch,`${caminho}: volta a ficar em pé`);
 }
 preparar();g._updateBot(b,0);
 const parede=new THREE.Mesh(new THREE.BoxGeometry(4,1.3,.2),new THREE.MeshBasicMaterial());parede.position.set(0,.65,5);parede.updateMatrixWorld(true);g.world.occluders=[parede];
 cobrar(!Game.prototype._losClear.call(g,g._botEye(b),g._botEye(alvo)),'cobertura baixa bloqueia LOS do bot agachado');
 b.crouchBias=false;g._updateBot(b,0);
 cobrar(Game.prototype._losClear.call(g,g._botEye(b),g._botEye(alvo)),'bot em pé enxerga por cima da mesma cobertura');
 g.world.occluders=[];parede.geometry.dispose();parede.material.dispose();
 preparar();b.crouchF=1;ctrl.crouch=true;g._respawnEntity(b);
 cobrar(b.crouchF===0&&!ctrl.crouch,'respawn limpa postura lógica e animação');
 preparar();b.crouchF=1;ctrl.crouch=true;g._startRound();
 cobrar(b.crouchF===0&&!ctrl.crouch,'novo round limpa postura durante countdown');g.state='live';
 preparar();b.mesh.isGLB=false;g._updateBot(b,0);
 cobrar(!b.crouchF,'modelo procedural sem animação agachada mantém hitbox em pé');
 b._remote='jogador';b.crouchF=.4;g._updateBot(b,0);
 cobrar(b.crouchF===.4,'bot remoto conserva postura recebida pela rede');
}finally{Math.random=original;g.dispose();}
process.exitCode=falhas?1:0;
