(async function(){
  'use strict';
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const content=document.querySelector('#content');let loadId=0;
  const base=new URL('./',location.href);
  const safePath=path=>{const url=new URL(path,base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error('无效的案例路径');return url;};
  try{
    const r=await fetch('gallery.json',{cache:'no-cache'});if(!r.ok)throw Error('清单加载失败');
    const entries=GalleryData.normalize(await r.json());const id=new URLSearchParams(location.search).get('id');
    const entry=entries.find(e=>e.id===id);if(!entry)throw Error('没有找到这个案例，请返回主页重新选择。');
    document.title=entry.title+' · GoodCase.xAI';document.querySelector('#title').textContent=entry.title;document.querySelector('#credit').textContent=entry.credit;
    const nav=document.querySelector('#resources');
    entry.resources.forEach((resource,i)=>{const b=document.createElement('button');b.textContent=resource.label;b.onclick=()=>{nav.querySelectorAll('button').forEach(n=>{n.classList.remove('active');n.setAttribute('aria-pressed','false');});b.classList.add('active');b.setAttribute('aria-pressed','true');show(resource.path);};nav.append(b);if(i===0)b.click();});
    document.querySelector('#fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.().catch(()=>{});};
    async function show(path){
      const n=++loadId;const url=safePath(path);document.querySelector('#original').href=url.href;
      if(!/\.md$/i.test(url.pathname)){content.innerHTML='';const frame=document.createElement('iframe');frame.title=entry.title;frame.src=url.href;frame.allow='fullscreen; autoplay; clipboard-write';frame.allowFullscreen=true;content.append(frame);return;}
      content.innerHTML='<p class="message">正在排版文档…</p>';
      try{const response=await fetch(url);if(!response.ok)throw Error('HTTP '+response.status);const md=await response.text();if(n!==loadId)return;
        content.innerHTML='<article class="document"><div class="doc-note">原始 Markdown · 仅优化阅读排版，内容保持原样</div>'+markdown(md,url)+'</article>';
        if(entry.key==='workbuddy/token-dashboard') content.querySelector('article').insertAdjacentHTML('beforeend','<h2>用量统计示例</h2><p>项目原有示例图片</p><img loading="lazy" src="workbuddy/token-dashboard/usage-sessions.png" alt="按会话统计的用量示例"><img loading="lazy" src="workbuddy/token-dashboard/usage-workspaces.png" alt="按工作区统计的用量示例">');
        content.querySelectorAll('a').forEach(a=>{const u=new URL(a.href);if(u.origin===base.origin&&u.pathname.startsWith(base.pathname)&&/\.md$/i.test(u.pathname))a.onclick=e=>{e.preventDefault();show(decodeURIComponent(u.pathname.slice(base.pathname.length)));};});
      }catch(e){if(n===loadId)content.innerHTML='<p class="message error">文档暂时无法加载。可使用右上角“原页”查看。<br>'+esc(e.message)+'</p>';}
    }
  }catch(e){content.innerHTML='<p class="message error">'+esc(e.message)+'</p>';document.querySelector('#title').textContent='案例浏览';}
  function markdown(source,url){
    function target(raw){try{const u=new URL(raw.replace(/&amp;/g,'&'),url);return /^https?:$/.test(u.protocol)?esc(u.href):'#';}catch{return '#';}}
    function inline(s){const tokens=[];const token=html=>'\u0000'+(tokens.push(html)-1)+'\u0000';
      s=s.replace(/`([^`]+)`/g,(_,v)=>token('<code>'+esc(v)+'</code>'));
      s=s.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,(_,a,p)=>token('<img loading="lazy" alt="'+esc(a)+'" src="'+target(p)+'">'));
      s=s.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,(_,a,p)=>token('<a href="'+target(p)+'" target="_blank" rel="noopener">'+esc(a)+'</a>'));
      s=esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/~~([^~]+)~~/g,'<del>$1</del>');
      return s.replace(/\u0000(\d+)\u0000/g,(_,i)=>tokens[i]);
    }
    const lines=source.replace(/\r\n?/g,'\n').split('\n');let out='',i=0;
    const cells=s=>s.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(x=>x.trim());
    while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
      if(/^\s*(```|~~~)/.test(line)){const fence=line.trim().slice(0,3);const code=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence))code.push(lines[i++]);i++;out+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';continue;}
      const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){out+=`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;i++;continue;}
      if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){out+='<hr>';i++;continue;}
      if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){out+='<div class="table-scroll"><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>';i+=2;while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){out+='<tr>'+cells(lines[i++]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>';}out+='</tbody></table></div>';continue;}
      if(/^\s*>/.test(line)){const block=[];while(i<lines.length&&/^\s*>/.test(lines[i]))block.push(lines[i++].replace(/^\s*> ?/,''));out+='<blockquote>'+markdown(block.join('\n'),url)+'</blockquote>';continue;}
      if(/^\s*(?:[-+*]|\d+[.)])\s/.test(line)){const ordered=/^\s*\d/.test(line),tag=ordered?'ol':'ul';out+='<'+tag+'>';while(i<lines.length&&/^\s*(?:[-+*]|\d+[.)])\s/.test(lines[i]))out+='<li>'+inline(lines[i++].replace(/^\s*(?:[-+*]|\d+[.)])\s+/,''))+'</li>';out+='</'+tag+'>';continue;}
      const p=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:#{1,6}\s|\s*[-+*>]\s|\s*\d+[.)]\s|\s*```|\s*~~~)/.test(lines[i])&&!(lines[i].includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])))p.push(lines[i++]);out+='<p>'+p.map(inline).join('<br>')+'</p>';
    }
    return out;
  }
})();
