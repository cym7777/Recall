# 正式站点验证

日期：2026-10-20（Asia/Shanghai）。

- 仓库：[cym7777/Recall](https://github.com/cym7777/Recall)
- 正式体验：[Recall](https://cym7777.github.io/Recall/)
- 首次源代码快照：`4e1ae34449981b6594e264629fd830bb4b0fa67b`
- 远程检查：[Recall checks #1](https://github.com/cym7777/Recall/actions/runs/39368572294)，成功。
- 首次部署：[Deploy Recall to GitHub Pages #1](https://github.com/cym7777/Recall/actions/runs/39368640317)，成功。

## 29 项测试及检查

GitHub Actions 的 9 项模型测试和 20 项浏览器检查全部通过。部署后在正式 Pages 地址重新执行同一套 20 项浏览器检查，全部通过；这些是对相同用例的再次执行，不将其重复计为额外的独立用例。

测试在独立临时浏览器环境中使用虚构题目执行，不读取或覆盖个人浏览器的数据。实际完成新增、编辑、搜索与筛选、图片上传/粘贴/刷新、答案揭晓、复习反馈、等级调度、重复提交去重、历史、统计、JSON 完整恢复、异常文件处理和删除确认。使用临时磁盘 profile 关闭整个 Chrome 并重新启动，题目、可解码图片及历史仍保留。

三个视口（1440×1000、820×1180、390×844）检查六个主要页面无横向溢出；深浅色切换与主题保存通过。页面未捕获异常为 0。配额错误回滚是测试事务内注入的模拟异常，不宣称实际填满设备磁盘。

## /Recall/ 子路径与资源验证

通过 HTTPS GET 正式站点，各文件逐字节比较与审查后的本地源码一致：

| 文件          | HTTP 状态 | 源码比较 |
| ------------- | --------- | -------- |
| index.html    | 200       | 一致     |
| favicon.svg   | 200       | 一致     |
| src/style.css | 200       | 一致     |
| src/app.js    | 200       | 一致     |
| src/model.js  | 200       | 一致     |
| src/db.js     | 200       | 一致     |
| src/images.js | 200       | 一致     |
| src/backup.js | 200       | 一致     |

题目图片以 Data URL 存在当前浏览器 IndexedDB 中，线上上传与重载检查验证了图片可正常解码显示。README 的截图存放在仓库 docs/screenshots，均为正式站点测试时的真实渲染画面；截图中的题目与学习记录是虚构测试数据。

## 复现

```sh
# 按 README 安装依赖及 Chromium 后，在项目目录执行
RECALL_URL=https://cym7777.github.io/Recall npm run test:browser
```

如本机已有代理，可通过 `RECALL_PROXY` 指定其地址；不需要大模型 API Key，也不需要为测试创建 GitHub 密钥。页面的本地数据库属于当前浏览器及当前站点来源，不会自动跨设备同步。

## 验证限制

尚未在真实 iPad/iPhone、Safari 或 Firefox 上验证；响应式结果来自桌面 Chrome 的视口检查。尚未进行大规模数据压力测试。本次网络访问通过已有代理完成，不代表各网络地区的连通性。浏览器清理或回收存储仍可能导致丢失，需要定期导出备份。
