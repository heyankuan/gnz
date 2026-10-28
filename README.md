# 逛女装进货查价

店里用的进货查价小程序。网址：https://heyankuan.github.io/gnz/

- 录入小票：选电子小票截图，在本机离线识别款号、名称、数量、单价，逐行对照原图核对后入库（需要“录入权限”）。
- 查价：输入款号，显示供应商、入库时间、数量、进货价和普通 / 白金 / 黄金会员价（×1.8 / ×1.6 / ×1.4）。
- 数据加密后存在本仓库的 data.enc.json，没有查价密码看不到内容。

第三方组件：onnxruntime-web 1.20.1（MIT），SheetJS xlsx 0.18.5（Apache-2.0，用于导入 Excel），PaddleOCR PP-OCRv4 中文识别模型（Apache-2.0，取自 npm 包 @gutenye/ocr-models）。
更新程序后把 sw.js 里的 VERSION 改个新值，手机下次联网打开会自动更新。
