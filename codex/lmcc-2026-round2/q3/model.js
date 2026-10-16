(function (root) {
  "use strict";
  function createStore(storage) {
    var key = "lmcc-2026-teaching-todos-v1";
    var saved = storage.getItem(key);
    var data = saved ? JSON.parse(saved) : {tasks: [], nextId: 1};
    var subject = "all";
    var status = "all";
    function save() { storage.setItem(key, JSON.stringify(data)); }
    function visible() {
      return data.tasks.filter(function (t) {
        return (subject === "all" || t.subject === subject) &&
          (status === "all" || (status === "active" && !t.completed) ||
           (status === "completed" && t.completed));
      });
    }
    function task(id) { return data.tasks.find(function (t) { return t.id === id; }); }
    return {
      all: function () { return data.tasks; },
      visible: visible,
      filters: function () { return {subject:subject,status:status}; },
      setSubjectFilter: function (value) { subject = value; },
      setStatusFilter: function (value) { status = value; },
      remaining: function () { return data.tasks.filter(function (t) { return !t.completed; }).length; },
      add: function (title) {
        title = title.trim();
        if (!title) return;
        data.tasks.push({id:String(data.nextId++),title:title,completed:false,subject:"unassigned"});
        save();
      },
      setSubject: function (id,value) { var t=task(id); if(t) {t.subject=value; save();} },
      toggle: function (id) { var t=task(id); if(t) {t.completed=!t.completed; save();} },
      remove: function (id) { data.tasks=data.tasks.filter(function (t) {return t.id!==id;}); save(); },
      clearCompleted: function () {data.tasks=data.tasks.filter(function(t){return !t.completed;}); save();},
      move: function (id,direction) {
        var rows = visible();
        var at = rows.findIndex(function (t) {return t.id===id;});
        var other = at + direction;
        if (at < 0 || other < 0 || other >= rows.length) return;
        var a = data.tasks.findIndex(function (t) {return t.id===id;});
        var b = data.tasks.findIndex(function (t) {return t.id===rows[other].id;});
        var temp = data.tasks[a];
        data.tasks[a] = data.tasks[b];
        data.tasks[b] = temp;
        save();
      }
    };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = createStore;
  else root.createTodoStore = createStore;
}(typeof globalThis !== "undefined" ? globalThis : this));
