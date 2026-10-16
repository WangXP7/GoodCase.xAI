(function () {
  "use strict";
  var store = createTodoStore(localStorage);
  var list = document.querySelector(".todo-list");
  var names = {unassigned:"未分类",chinese:"语文",math:"数学",english:"英语"};
  function button(text,cls,action,disabled) {
    var b=document.createElement("button");
    b.textContent=text; b.className=cls; b.disabled=!!disabled;
    b.addEventListener("click",function(){action();render();});
    return b;
  }
  function render() {
    list.replaceChildren();
    var rows=store.visible();
    rows.forEach(function(t,i) {
      var li=document.createElement("li");li.dataset.id=t.id;
      var check=document.createElement("input"); check.type="checkbox";check.className="toggle";check.checked=t.completed;
      check.setAttribute("aria-label","完成："+t.title);
      check.addEventListener("change",function(){store.toggle(t.id);render();});
      var label=document.createElement("label");label.textContent=t.title;
      if(t.completed)label.className="done";
      var select=document.createElement("select");select.className="task-subject";select.setAttribute("aria-label","科目："+t.title);
      Object.keys(names).forEach(function(value){var o=document.createElement("option");o.value=value;o.textContent=names[value];select.append(o);});
      select.value=t.subject;
      select.addEventListener("change",function(){store.setSubject(t.id,select.value);render();});
      li.append(check,label,select,
        button("上移","move-up",function(){store.move(t.id,-1);},i===0),
        button("下移","move-down",function(){store.move(t.id,1);},i===rows.length-1),
        button("删除","destroy",function(){store.remove(t.id);}));
      list.append(li);
    });
    document.querySelector(".todo-count strong").textContent=store.remaining();
    document.querySelector("#empty").hidden=rows.length>0;
    document.querySelector("#all-state").textContent=JSON.stringify(store.all(),null,2);
    document.querySelectorAll(".filters a").forEach(function(a){a.classList.toggle("selected",a.hash===(location.hash||"#/"));});
  }
  document.querySelector(".new-todo").addEventListener("keydown",function(e) {
    if(e.key==="Enter" && !e.isComposing){store.add(e.target.value);e.target.value="";render();}
  });
  document.querySelector("#subject-filter").addEventListener("change",function(e){store.setSubjectFilter(e.target.value);render();});
  document.querySelector(".clear-completed").addEventListener("click",function(){store.clearCompleted();render();});
  function status(){store.setStatusFilter(location.hash==="#/active"?"active":location.hash==="#/completed"?"completed":"all");render();}
  addEventListener("hashchange",status);
  status();
}());
