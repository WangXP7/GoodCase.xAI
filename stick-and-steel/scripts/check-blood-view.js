async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1200, height: 700 } });
  const view = await context.newPage(), errors = []; view.on('pageerror', e => errors.push(e.message));
  await view.route('http://localhost:3000/blood-review', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#efeeeb"><div style="position:absolute;top:24px;left:0;right:0;display:flex;text-align:center;color:#59544d;font:24px serif"><span style="flex:1">Shoulder</span><span style="flex:1">Elbow</span><span style="flex:1">Wrist</span></div></body>' }));
  try {
    await view.goto('http://localhost:3000/blood-review');
    await view.evaluate(async () => {
      const source = await (await fetch('/lib/duel/effects.ts')).text();
      const T = await import(source.match(/from "([^"]+three.js[^"]*)"/)[1]);
      const { DuelSimulation, initPhysics } = await import('/lib/duel/physics.ts');
      const { createAvatar } = await import('/lib/duel/avatar.ts');
      const { createImpactEffects } = await import('/lib/duel/effects.ts');
      await initPhysics();
      const renderer = new T.WebGLRenderer({ antialias: true }); renderer.setSize(1200,700);renderer.setPixelRatio(1);document.body.appendChild(renderer.domElement);
      const views=[];
      for(const part of ['right upper arm','right forearm','right hand']){
        const sim=new DuelSimulation();sim.online=true;sim.start();sim.drop(0);sim.drop(1);
        for(let i=0;i<120;i++)sim.step();
        const f=sim.fighters[0],scene=new T.Scene();scene.background=new T.Color('#efeeeb');scene.add(new T.HemisphereLight('#fff','#918c83',2.4));
        const sun=new T.DirectionalLight('#fff',3);sun.position.set(-2,6,4);scene.add(sun);
        const floor=new T.Mesh(new T.PlaneGeometry(20,20),new T.MeshStandardMaterial({color:'#e6e3dd'}));floor.rotation.x=-Math.PI/2;floor.position.y=-.006;scene.add(floor);
        const avatar=createAvatar(scene,f,'#e11d2d'),effects=createImpactEffects(scene);
        const wound=f.rig.detach(part);f.wounds.push({...wound,born:sim.time,bleed:3});
        const body=f.rig.parts.get(wound.parent).body,point=wound.parentAnchor.clone().applyQuaternion(new T.Quaternion().copy(body.rotation())).add(new T.Vector3().copy(body.translation()));
        effects.hit({kind:'sever',point,velocity:new T.Vector3(2,0,1),strength:5,damage:35,attacker:1,target:0,part});
        const camera=new T.PerspectiveCamera(43,400/700,.05,30);camera.position.set(-3.0,2.6,3.6);camera.lookAt(-1.05,1,0);
        views.push({sim,f,scene,avatar,effects,camera});
      }
      window.advanceReview=(frames)=>{
        for(const v of views)for(let i=0;i<frames;i++){v.sim.step();v.effects.update(1/120,[v.f],v.sim.time);}
        renderer.setScissorTest(true);
        views.forEach((v,i)=>{v.avatar.update(v.f);renderer.setViewport(i*400,0,400,700);renderer.setScissor(i*400,0,400,700);renderer.render(v.scene,v.camera);});
      };
      window.advanceReview(55);
    });
    await view.screenshot({path:'output/playwright/blood-cut-points.png'});
    await view.evaluate(()=>window.advanceReview(420));
    await view.screenshot({path:'output/playwright/blood-settled-drips.png'});
    if(errors.length)throw new Error(errors.join('\n'));
    return 'Shoulder/elbow/wrist visual review rendered with the actual avatar, rig and effect code.';
  } finally {await context.close();}
}
