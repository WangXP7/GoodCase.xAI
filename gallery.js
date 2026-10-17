(async function () {
  'use strict';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  try {
    const r=await fetch('gallery.json',{cache:'no-cache'});if(!r.ok)throw Error(r.status);
    const entries=GalleryData.normalize(await r.json());
    let history={entries:{}};
    try { const h=await fetch('gallery-commits.json',{cache:'no-cache'});if(h.ok)history=await h.json(); }catch{}
    const timeFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    for(const e of entries){const record=history.entries?.[e.id];const ms=Date.parse(record?.committedAt||'');e.committedAt=Number.isFinite(ms)?record.committedAt:null;e.commitTime=Number.isFinite(ms)?ms:null;e.commitLabel=e.committedAt?timeFormat.format(new Date(ms)):'时间未记录';e.commitMonth=e.committedAt?e.commitLabel.slice(0,7):'时间未记录';}
    const byId=new Map(entries.map(e=>[e.id,e]));
    const {unknown}=GalleryData;
    const values=(e,d)=>d==='submitted'?[e.commitMonth]:GalleryData.values(e,d);
    const counts=(items,d)=>{if(d!=='submitted')return GalleryData.counts(items,d);const out={};for(const e of items)out[e.commitMonth]=(out[e.commitMonth]||0)+1;return out;};
    const dimensions={tags:'主题 / 类型',agent:'Agent',model:'大模型',combo:'Agent + 大模型',format:'打开方式',submitted:'提交时间'};
    const marks={tags:'◈',agent:'◇',model:'✦',combo:'⊕',format:'↗',submitted:'◷'};
    const globalCounts=Object.fromEntries(Object.keys(dimensions).map(d=>[d,counts(entries,d)]));
    const knownModels=Object.keys(globalCounts.model).filter(x=>x!==unknown);
    document.body.className='gallery';
    document.body.innerHTML=`<a class="skip" href="#library">跳到案例库</a><canvas id="space" aria-hidden="true"></canvas><div class="wrap"><div class="topbar"><a class="brand" href="./"><i>✳</i>GoodCase<span>.xAI</span></a><div class="toplinks"><a href="#library">探索案例</a><a href="https://github.com/WangXP7/GoodCase.xAI">GitHub ↗</a><button class="motion" aria-pressed="false">暂停星系</button></div></div><section class="hero"><div class="eyebrow">THE AGENT CREATION ATLAS</div><h1>灵感落地，<br><em>让创造有迹可循。</em></h1><p>由 AI Agent 独立完成的成品案例集。<br>从一场游戏、一座微缩世界，到可触碰的知识与想象。</p><a class="hero-link" href="#library">探索全部作品 <span>↗</span></a></section><div class="stats"><div class="stat"><strong>${entries.length}</strong><span>收录案例</span></div><div class="stat"><strong>${Object.keys(globalCounts.agent).length}</strong><span>创作 Agent</span></div><div class="stat"><strong>${knownModels.length}</strong><span>已记录模型</span></div><div class="stat"><strong>${Object.keys(globalCounts.tags).length}</strong><span>主题标签</span></div></div><section class="library" id="library"><div class="section-head"><div><h2>作品星图 <span style="color:#63708e;font-size:13px;margin-left:10px">/ EXPLORE</span></h2><p>按主题发现灵感，按 Agent 与模型探索创作能力。</p></div><label class="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="搜索案例" placeholder="搜索名称、功能、Agent 或模型…"></label></div><div class="workspace"><aside class="sidebar"><div class="filter-box"><div class="filter-label">探索维度</div><div class="dimensions">${Object.keys(dimensions).map(d=>`<button class="dimension ${d==='tags'?'active':''}" data-dim="${d}" aria-pressed="${d==='tags'}"><b>${marks[d]}</b>${dimensions[d]}</button>`).join('')}</div><p class="rule">不同维度可交叉筛选。<br>标签数字为全库案例数，不随搜索变化。<br>一个案例可有多个主题、多个模型，不重复计入总数。</p></div></aside><div class="results"><div class="facets" aria-label="筛选选项"></div><div class="selected" aria-label="已选条件"></div><div class="resultbar"><span id="result-count" role="status" aria-live="polite"></span><button class="clear">清除筛选</button><label>排序 <select aria-label="案例排序"><option value="curated">策展顺序</option><option value="title">名称 A–Z</option><option value="agent">按 Agent</option></select></label></div><div class="grid"></div><details class="audit"><summary>统计口径与全库核对表</summary><p>唯一入口标识去重，共 ${entries.length} 个案例。Agent、完整 Agent + 模型组合及打开方式为互斥分组；模型和主题是多标签计数，分项之和可能大于总数。模型名称严格使用已有登记；未记录不等于没有使用模型。组合保留一个案例所登记的全部模型。</p><table><tbody>${Object.entries(dimensions).map(([d,label])=>`<tr><th scope="row">${label}</th><td>${Object.entries(globalCounts[d]).map(([k,v])=>`${esc(k)}：${v}`).join('　·　')}</td></tr>`).join('')}</tbody></table></details></div></div></section><footer><span>GoodCase.xAI · 让每一次 AI 创作，都成为可探索的作品。</span><span>首页设计：Codex + GPT-6 · 案例署名见各卡片</span></footer></div>`;
    document.querySelector('select').insertAdjacentHTML('afterbegin','<option value="committed-desc">提交时间：最新在前</option><option value="committed-asc">提交时间：最早在前</option>');
    document.querySelector('.audit p').append(document.createTextNode(' 提交时间取案例目录最近一次 Git 提交的时间（独立文件按该文件计算），以北京时间按月分组。无记录的案例始终排在时间排序末尾。'));
    let dimension='tags',selected={},query='',sort='committed-desc';
    try { const saved=JSON.parse(sessionStorage.getItem('goodcase-filters')||'null');if(saved){selected=saved.selected||{};query=saved.query||'';sort=saved.sort||'curated';dimension=dimensions[saved.dimension]?saved.dimension:'tags';} }catch{}
    const input=document.querySelector('input');input.value=query;document.querySelector('select').value=sort;
    const matches=e=>Object.entries(selected).every(([d,v])=>values(e,d).includes(v))&&(!query||[e.title,e.desc,e.credit,...e.tags].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    function render(){
      document.querySelectorAll('[data-dim]').forEach(b=>{b.classList.toggle('active',b.dataset.dim===dimension);b.setAttribute('aria-pressed',String(b.dataset.dim===dimension));});
      const facets=Object.entries(globalCounts[dimension]).sort((a,b)=>dimension==='submitted'?(a[0]==='时间未记录'?1:b[0]==='时间未记录'?-1:b[0].localeCompare(a[0])):b[1]-a[1]||a[0].localeCompare(b[0],'zh-CN'));
      document.querySelector('.facets').innerHTML=`<button class="chip ${!selected[dimension]?'active':''}" data-value="" aria-pressed="${!selected[dimension]}">全部<span>${entries.length}</span></button>`+facets.map(([name,n])=>`<button class="chip ${selected[dimension]===name?'active':''}" data-value="${esc(name)}" aria-pressed="${selected[dimension]===name}">${esc(name)}<span>${n}</span></button>`).join('');
      document.querySelector('.selected').innerHTML=Object.entries(selected).map(([d,v])=>`<button data-remove="${d}" aria-label="移除 ${esc(dimensions[d]+': '+v)}">${esc(dimensions[d])}：${esc(v)} ×</button>`).join('');
      let filtered=entries.filter(matches);
      if(sort==='committed-desc'||sort==='committed-asc')filtered.sort((a,b)=>a.commitTime===null?(b.commitTime===null?a.id.localeCompare(b.id):1):b.commitTime===null?-1:(sort==='committed-desc'?b.commitTime-a.commitTime:a.commitTime-b.commitTime)||a.id.localeCompare(b.id));
      else if(sort!=='curated')filtered.sort((a,b)=>(sort==='title'?a.title:a.agent).localeCompare(sort==='title'?b.title:b.agent,'zh-CN'));
      else filtered.sort((a,b)=>Number(!!b.cover)-Number(!!a.cover));
      document.querySelector('#result-count').textContent=`显示 ${filtered.length} / ${entries.length} 个案例 · 标签数字为全库计数`;
      document.querySelector('.grid').innerHTML=filtered.map((e,i)=>{
        const hues={'游戏':260,'建模':36,'视觉艺术':212,'工具面板':175,'文档研究':315,'科普教育':195,'模拟仿真':225,'国风历史':42};
        const icons={'游戏':'✧','建模':'◇','视觉艺术':'◉','工具面板':'⌘','文档研究':'¶','科普教育':'∑','模拟仿真':'◎','国风历史':'卷'};
        const hue=hues[e.tags[0]]||225;
        return `<a class="case-card" href="case.html?id=${encodeURIComponent(e.id)}" data-id="${esc(e.id)}" style="--hue:${hue}"><div class="art" aria-hidden="true">${e.cover?`<img src="${esc(e.cover)}" loading="lazy" alt="">`:`<span class="symbol">${icons[e.tags[0]]||'✧'}</span>`}<span class="art-label">${esc(e.tags[0])} / ${String(i+1).padStart(2,'0')}</span></div><div class="card-body"><div class="credit">${esc(e.credit)}</div><h3>${esc(e.title)}</h3><p class="description">${esc(e.desc)}</p><div class="case-tags">${e.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div><div class="card-foot"><span>${e.format}</span><b>${e.format==='文档阅读'?'阅读文档':'探索作品'} ↗</b></div></div></a>`;
      }).join('')||'<div class="empty">没有符合这些条件的案例。<br>试试其他关键词，或清除筛选。</div>';
      document.querySelectorAll('.case-card').forEach(card=>{const e=byId.get(card.dataset.id),row=document.createElement('div');row.className='credit';row.style.marginTop='12px';row.title='案例目录最近一次 Git 提交 · 北京时间';row.append(document.createTextNode('最近提交：'));if(e.committedAt){const time=document.createElement('time');time.dateTime=e.committedAt;time.textContent=e.commitLabel;row.append(time);}else row.append(document.createTextNode('时间未记录'));card.querySelector('.card-foot').before(row);});
      try{sessionStorage.setItem('goodcase-filters',JSON.stringify({selected,query,sort,dimension}));}catch{}
      window.galleryAudit={total:entries.length,counts:globalCounts,visible:filtered.map(e=>e.id)};
    }
    document.querySelector('.dimensions').onclick=e=>{const b=e.target.closest('[data-dim]');if(b){dimension=b.dataset.dim;if(dimension==='submitted'){sort='committed-desc';document.querySelector('select').value=sort;}render();}};
    document.querySelector('.facets').onclick=e=>{const b=e.target.closest('[data-value]');if(b){if(b.dataset.value)selected[dimension]=b.dataset.value;else delete selected[dimension];render();}};
    document.querySelector('.selected').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){delete selected[b.dataset.remove];render();}};
    document.querySelector('.clear').onclick=()=>{selected={};query='';input.value='';render();};
    input.oninput=()=>{query=input.value.trim();render();};document.querySelector('select').onchange=e=>{sort=e.target.value;render();};
    render();galaxy();
  } catch(error) { console.error('Gallery enhancement failed:',error); }
  function galaxy(){
    const canvas=document.querySelector('#space'),ctx=canvas.getContext('2d');if(!ctx)return;
    const media=matchMedia('(prefers-reduced-motion: reduce)');let paused=media.matches,raf=0,w=0,h=660,t=0,px=0,py=0,last=0;
    const button=document.querySelector('.motion');
    let seed=7187;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const points=Array.from({length:1250},(_,i)=>{const r=Math.pow(rand(),.65);return {r,a:(i%3)*Math.PI*2/3+r*5+(rand()-.5)*(.25+r*.7),alpha:.25+rand()*.7,size:i%29===0?1.65:.55+rand()*.4};});
    function resize(){w=canvas.clientWidth;const dpr=Math.min(devicePixelRatio,1.5);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
    function draw(){ctx.clearRect(0,0,w,h);const cx=w*(w<700?.85:.77)+px*20,cy=265+py*16,scale=Math.min(w*.48,530);const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,scale);glow.addColorStop(0,'#8c80ed2c');glow.addColorStop(.3,'#6258b518');glow.addColorStop(1,'#080b1400');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);for(const p of points){const a=p.a+t*(1-p.r)*.07+p.r*4;const x=Math.cos(a)*p.r*scale,y=Math.sin(a)*p.r*scale*.37;const rx=x*.94-y*.34,ry=x*.34+y*.94;ctx.globalAlpha=p.alpha;ctx.fillStyle=p.r>.65?'#7fa9ff':'#e8d9ff';ctx.beginPath();ctx.arc(cx+rx,cy+ry,p.size,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
    function loop(now){if(!paused&&!document.hidden){if(now-last>32){t+=.025;draw();last=now;}raf=requestAnimationFrame(loop);}}
    function sync(){cancelAnimationFrame(raf);button.textContent=paused?'开启星系':'暂停星系';button.setAttribute('aria-pressed',String(paused));if(!paused&&!document.hidden)raf=requestAnimationFrame(loop);}
    button.onclick=()=>{paused=!paused;sync();};media.addEventListener('change',()=>{paused=media.matches;sync();});
    window.addEventListener('pointermove',e=>{if(paused)return;px=e.clientX/w-.5;py=e.clientY/h-.5;},{passive:true});
    window.addEventListener('resize',resize);document.addEventListener('visibilitychange',sync);resize();sync();
  }
})();
