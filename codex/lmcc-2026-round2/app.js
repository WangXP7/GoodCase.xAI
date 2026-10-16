(function () {
  "use strict";
  var message=document.querySelector("#route-message");
  function classify(){
    var s=message.value;
    var account=["账号","登录","密码"].filter(function(w){return s.includes(w);});
    var billing=["充值","退款","余额"].filter(function(w){return s.includes(w);});
    var route=account.length?"ACCOUNT":billing.length?"BILLING":"OTHER";
    document.querySelector("#route-result").textContent="[Route]: "+route+"\n命中："+(account.concat(billing).join("、")||"无规定关键词")+(account.length&&billing.length?"；账号类优先":"");
  }
  message.addEventListener("input",classify);classify();
  document.querySelectorAll("[data-message]").forEach(function(b){b.addEventListener("click",function(){message.value=b.dataset.message;classify();});});
  var seq=document.querySelector("#brackets");
  function trace(){
    var s=seq.value;
    var box=document.querySelector("#trace");box.replaceChildren();
    var output=document.querySelector("#bracket-result");
    if(!/^[()]{2,12}$/.test(s)){output.textContent="请输入2～12个半角圆括号，不含空白。";return;}
    var balance=0,first=-1;
    for(var i=0;i<s.length;i++){
      balance+=s[i]==="("?1:-1;if(balance<0&&first<0)first=i;
      var span=document.createElement("span");span.textContent=s[i]+" → "+balance;if(balance<0)span.className="bad";box.append(span);
    }
    var yes=first<0&&balance===0;
    output.textContent="[Valid]: "+(yes?"YES":"NO")+"\n"+(yes?"所有前缀非负，最终为0。":first>=0?"第"+(first+1)+"个字符首次出现负值。":"最终余额为"+balance+"，未全部闭合。");
  }
  seq.addEventListener("input",trace);trace();
  document.querySelectorAll("[data-seq]").forEach(function(b){b.addEventListener("click",function(){seq.value=b.dataset.seq;trace();});});
  document.querySelectorAll("pre").forEach(function(pre){
    var wrap=document.createElement("div");wrap.className="code-wrap";pre.replaceWith(wrap);wrap.append(pre);
    var b=document.createElement("button");b.className="copy";b.textContent="复制";
    b.addEventListener("click",async function(){
      try{await navigator.clipboard.writeText(pre.textContent);b.textContent="已复制";}
      catch(e){var range=document.createRange();range.selectNodeContents(pre);var sel=getSelection();sel.removeAllRanges();sel.addRange(range);b.textContent="已选中，请复制";}
      setTimeout(function(){b.textContent="复制";},1800);
    });wrap.append(b);
  });
  document.querySelectorAll("a[href^='#']").forEach(function(a){a.addEventListener("click",function(){
    var target=document.querySelector(a.getAttribute("href"));if(target){var details=target.closest("details");if(details)details.open=true;}
  });});
}());
