# LMCC 2026 三题教学参考

制作：Codex + GPT-6。模型细分后缀未在会话中提供。

这是根据《06LMCC-2026第2轮-机考3题例题.pdf》制作的独立教学案例，包含题解、教案、语法速学、提交文件与可复现测试，不是官方满分答案。

打开index.html即可阅读和使用规则、括号演示。第三题演示位于q3/index.html，浏览器localStorage保存数据。稳定测试建议通过本地HTTP服务器运行：

~~~text
python -m http.server 8766
~~~

随后访问 http://127.0.0.1:8766/ 。网页没有外部依赖、模型调用或外网数据请求。

## 内容

- docs/：三题详解、4课时教案、4小时语法速学与验证报告。
- downloads/：可打印PDF与第二题提交文件压缩包。
- q1/：第一题推荐System Prompt，thinking先关闭；须在平台检查Token与模型表现。
- q2/：100条分层训练数据、合规清洗函数、建议训练起点。
- q3/：独立TodoMVC教学实现与Agent对话模板；不是考场原项目补丁。
- tests/：测试代码、根据题面整理的公开操作、真实执行结果。
- tools/：数据构造与资料生成；不属于考场提交文件。

## 复验

~~~text
python tests/verify.py
node tests/browser-verify.cjs http://127.0.0.1:8766/
~~~

Python测试只需标准库。浏览器测试需要Node.js、Playwright及其浏览器；可用LMCC_BROWSER_EXECUTABLE指定已有Chrome/Edge。生成PDF还需reportlab，默认使用Windows黑体，可通过LMCC_FONT指定其他支持中文的TrueType字体。构建命令：python tools/build.py。

Python验证不能证明Qwen提示词或LoRA准确率；浏览器验证针对随附独立参考实现，不能代替正式考场评分。平台固定分词器计数、指定模型推理、LoRA训练及隐藏评分均未在本案例中执行。

## 发布范围与来源

只发布本次教学案例及必要验证材料；原PDF和用户其他文件不在发布包内。题目规则与公开测试来自上述用户提供PDF，第2至22页。页面遵循GoodCase.xAI现有深色卡片视觉。参考实现为本次原创，没有下载或复制TodoMVC原仓库代码。考场要求保留其原项目许可证与来源说明。
