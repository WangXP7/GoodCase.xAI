# 不会Python也能开始：三题语法速学

真正必须手写Python的是第二题process_data。第一题只写提示词；第三题使用自然语言与Agent协作，懂少量JavaScript/HTML可以更好地读懂修改。没有必要为这三题同时学完整Python、C++和Java。

## 四小时突击路线

| 时段 | 学什么 | 必须交出的练习 |
| --- | --- | --- |
| 0至30分钟 | 缩进、变量、字符串、列表、字典 | 写两条sequence/valid记录 |
| 30至65分钟 | def、if、for、continue、return、raise | 跳过非字典，非列表报错 |
| 65至100分钟 | isinstance、get、split/join、strip/upper | 正确清洗空白与标签 |
| 100至135分钟 | in、any、范围、seen稳定去重 | 重复保首条、冲突抛异常 |
| 135至165分钟 | JSON/JSONL、UTF-8、assert | 运行公开P01/P02 |
| 165至195分钟 | JS数组/对象、filter、findIndex、id | 解释筛选与交换 |
| 195至220分钟 | DOM、事件、localStorage、disabled | 解释刷新保存与边界 |
| 220至240分钟 | 综合演练 | 不看答案重写清洗骨架并口述第三题反例 |

这是建议学习量，不是保证四小时熟练。若只能学90分钟，优先Python的输入检查、清洗、去重与下方练习1至4。

## A. Python必须会的语法

### 1. 缩进就是代码块

~~~python
if valid == "YES":
    result.append(valid)
~~~

冒号后换行，下一层通常缩进4个空格。不要混Tab和空格。Python一般不写分号，不靠花括号划分代码块。等号=赋值，双等号==比较；字符串要用英文引号。

### 2. 三种核心容器

~~~python
sequence = "()()"                         # str：字符串
records = [{"sequence": "()", "valid": "YES"}]  # list：有序列表
record = {"sequence": "()", "valid": "YES"}     # dict：键值字典
result = []                               # 空列表
seen = {}                                 # 空字典，不是空集合
~~~

列表保留顺序；字典按字段名取值。sequence是字符串，不是括号表达式。list和dict存的是数据结构，不是长得相似的一段JSON文字。

### 3. 函数、返回与异常

~~~python
def process_data(records):
    if not isinstance(records, list):
        raise ValueError("records must be a list")
    return []
~~~

def定义函数，括号内是参数。return把结果交给调用方并结束函数；print只显示内容，不是返回值。raise表示这个调用不能正常完成。这里必须抛ValueError，不能换成TypeError、return None或print报错文字。

### 4. isinstance与get

~~~python
if not isinstance(record, dict):
    continue
sequence = record.get("sequence")
if not isinstance(sequence, str):
    continue
~~~

continue只能在循环内使用，意思是跳过当前项。get在字段不存在时返回None，不会像record["sequence"]那样抛KeyError。必须先确认是字典再调用get；None没有get方法。

### 5. for、continue与break

~~~python
for record in records:
    if not isinstance(record, dict):
        continue
    result.append(record)
~~~

for依次遍历每一条。continue只跳当前条；break结束整个循环；return结束整个函数。第二题遇到无效记录通常应continue，不能让后面全部失去处理机会。

### 6. 全部空白、两端空白、大写

~~~python
sequence = "".join(sequence.split())
valid = valid.strip().upper()
~~~

split()不传参数时按空白切分，得到字符串列表；"".join(...)用空字符串把片段拼起来，因此删除全部空白。strip()只去两端。upper()转大写。这些方法返回新字符串，不会原地修改变量，必须接回结果。

举例：" ( )\t( )\n"变为"()()"；" yes "变为"YES"；"y e s"变为"Y E S"，依然无效。

### 7. 比较、逻辑与成员关系

~~~python
if not 2 <= len(sequence) <= 12:
    continue
if valid not in ("YES", "NO"):
    continue
if input_text in seen:
    pass
~~~

and表示同时成立；or表示至少一个成立；not取反。len返回长度。in用于字符串时检查子串，用于列表/元组时检查元素，用于字典时检查键。("YES","NO")是元组，用作允许值集合即可；pass只是占位，正式函数此处要写去重逻辑。

### 8. any与生成器表达式

~~~python
if any(char not in "()" for char in sequence):
    continue
~~~

意思是“只要有一个字符不是左括号或右括号就跳过”。看不懂时可先展开：

~~~python
bad_character = False
for char in sequence:
    if char not in "()":
        bad_character = True
        break
if bad_character:
    continue
~~~

这段只检查字符集合，没有累计左右括号数，因此符合清洗职责。不要把检查换成is_valid(sequence)。

### 9. append与稳定去重

~~~python
if input_text in seen:
    if seen[input_text] != output_text:
        raise ValueError("conflicting labels")
    continue
seen[input_text] = output_text
result.append({"input": input_text, "output": output_text})
~~~

append在列表末尾加入一个元素。seen的键是规范化后的input，不是原始含空格的sequence。先判冲突，再跳重复；若直接赋值覆盖旧标签，就会吞掉错误。

### 10. assert用于课前核验

~~~python
assert process_data([]) == []
assert process_data([None]) == []
assert process_data([{"sequence": " ( ) ", "valid": " yes "}]) == [
    {"input": "序列：()", "output": "[Valid]: YES"}
]
~~~

assert条件不成立就报AssertionError。测试应放独立文件，不放在提交函数文件顶层执行。正式异常处理若要检查ValueError，用try/except；不要用except: pass吞掉所有错误。

## B. JSON、JSONL与文件

| 含义 | Python写法 | JSON写法 |
| --- | --- | --- |
| 空值 | None | null |
| 真/假 | True / False | true / false |
| 字符串与键 | 单双引号都可 | 必须双引号 |
| 注释 | # 注释 | 不支持 |
| 尾部多余逗号 | 部分结构允许 | 不允许 |

train.jsonl每行一个完整JSON对象，不在整个文件外面包一对方括号，不在行尾加逗号。UTF-8保存。例如：

~~~json
{"sequence":"()","valid":"YES"}
{"sequence":")(","valid":"NO"}
~~~

training_params.json是单个JSON对象，可以跨行排版。参数名大小写必须准确，例如learningRate，不是learning_rate。

读取/生成数据需要json模块与文件操作，但它们属于课前辅助程序，process_data本身不应读文件。先分清文件格式再学文件IO，不必把它们混进提交函数。

运行方式：安装Python 3后在案例目录运行“python tests/verify.py”；Windows也可能使用“py -3 tests/verify.py”。如命令不存在，先安装或选用已有Python解释器。不要把命令行命令写到Python代码中。

## C. JavaScript与网页只学到能审查

### 1. 变量、对象、数组与函数

~~~javascript
const task = {id: "7", title: "练习", completed: false, subject: "math"};
let tasks = [task];
const isActive = t => !t.completed;
~~~

const表示不能重新给变量绑定另一个值，并不使对象内部属性不可变；let允许重新赋值。JS的true/false是小写。===是严格相等，!==是不相等。!相当于Python的not；&&相当于and；||相当于or。

### 2. filter与findIndex

~~~javascript
const visible = tasks.filter(t =>
  (subject === "all" || t.subject === subject) &&
  (status === "all" || (status === "active" && !t.completed) ||
   (status === "completed" && t.completed))
);
const i = tasks.findIndex(t => t.id === id);
~~~

filter返回筛选后的新数组，不应把全清单变量赋成visible而丢掉隐藏项。findIndex返回第一个满足条件的下标，找不到是-1。可见下标和全局下标不是一回事。

### 3. 交换完整对象

~~~javascript
[tasks[i], tasks[j]] = [tasks[j], tasks[i]];
~~~

这是解构赋值交换。也可用临时变量，参考实现使用后者方便初学者理解。不能只交换title，否则id与科目/完成状态会串台。不要用splice删除后插入来代替题目的两位置交换。

### 4. DOM、事件与原生disabled

~~~javascript
const button = document.querySelector(".move-up");
button.disabled = true;
input.addEventListener("keydown", event => {
  if (event.key === "Enter") addTask();
});
label.textContent = task.title;
~~~

DOM是浏览器中的页面元素树。querySelector按CSS定位元素。disabled=true才是原生禁用，仅改灰色样式不够。textContent把内容当文字，适合显示用户标题。

HTML识读：input输入框；button按钮；select下拉框；option选项；ul/li列表；label行内标题。CSS里#subject-filter指id，.task-subject指class，.todo-list > li指列表的直接子项。

### 5. localStorage与JSON

~~~javascript
localStorage.setItem("tasks", JSON.stringify(tasks));
const tasksAgain = JSON.parse(localStorage.getItem("tasks") || "[]");
~~~

localStorage存字符串；JSON.stringify把对象转字符串；JSON.parse反向转换。只保存标题不够，必须保存id、完成状态、科目和顺序。演示还保存nextId防止刷新后身份冲突。页面渲染不等于保存，移动成功后也要写存储。

## D. 已会C++/Java时的迁移对照

| 用途 | Python | JavaScript | C++/Java读法提示 |
| --- | --- | --- | --- |
| 代码块 | 冒号+缩进 | 花括号 | 类似花括号块 |
| 有序集合 | list | Array | vector / List |
| 键值表 | dict | Object / Map | map / Map |
| 空值 | None | null | 不完全等同nullptr/null |
| 逻辑且或非 | and/or/not | && / 两条竖线 / ! | 同常见C系写法 |
| 遍历 | for x in xs | for (const x of xs) | 范围for/增强for |
| 函数返回 | return value | return value | 同义 |
| 抛异常 | raise ValueError(...) | throw new Error(...) | 类型机制不同 |
| 字符串相等 | == | === | Java字符串常用equals |

本题不要求写C++或Java。对照表是迁移工具，不是让零基础学生再学两门语言。

## E. 自测题与答案

1. records为字典而非列表，应该返回空列表吗？答案：应抛ValueError。

2. sequence=" ( ) \t( ) "，valid=" yes "，结果是什么？答案：{"input":"序列：()()","output":"[Valid]: YES"}。

3. sequence=")("，valid="YES"，清洗应改成NO吗？答案：不能；应复制YES。制作训练数据时才纠正标签。

4. 同一规范化sequence先出现YES又出现NO怎么办？答案：抛ValueError，不能选第一条或最后一条。

5. valid=" Y E S "能保留吗？答案：不能；只去两端和转大写，内部空格还在。

6. 数学筛选下添加“英语朗读”，新条目的科目？答案：未分类，不能依据标题或筛选推断。

7. 全清单[A数学,B英语,C数学,D英语]中C上移后的顺序？答案：[C,B,A,D]。

8. 单条可见任务的上移、下移按钮？答案：两者都原生禁用并仍显示。

9. 页面里只有2条可见任务，全清单共有5条未完成，剩余数字是多少？答案：5。

10. Python代码输出正确，能证明Qwen经过LoRA训练后满分吗？答案：不能；它只证明相应确定性部分，模型要实际训练并评测。

## F. 常见报错的定位顺序

IndentationError：先检查缩进层级。SyntaxError：检查冒号、英文引号、括号是否成对。NameError：检查变量拼写及定义位置。KeyError：检查缺失字段是否错误地用下标访问。AttributeError：检查是否在None或非字典上调用get。AssertionError：比较实际值与期望值，定位哪条题面规则没满足。

不要一遇到报错就用try/except把所有异常吞掉；这样会掩盖题目要求的ValueError。先用最小输入复现，再改对应分支。
