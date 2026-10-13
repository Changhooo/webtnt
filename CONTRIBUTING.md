# 参与贡献

欢迎通过 [Issues](https://github.com/Changhooo/webtnt/issues) 报告问题或提出想法，也可以提交 Pull Request。

## 本地开发

需要 Node.js 22 或更新版本，以及用于测试网页和打包的 Python 3。扩展本身没有构建步骤，也不依赖 Node.js。

```bash
git clone https://github.com/Changhooo/webtnt.git
cd webtnt
npm ci
npm test
```

在 Chrome 或 Edge 的扩展管理页面开启开发者模式，加载仓库中的 `extension` 文件夹。启动测试网页：

```bash
python -m http.server 8765
```

打开 `http://localhost:8765/demo/`，从工具栏启用 TNT。修改扩展后，先重新加载扩展，再刷新测试网页。

## 报告问题

请提供浏览器版本、操作系统、页面类型、缩放比例、相关设置、复现步骤及预期结果。涉及截图时先遮盖个人信息。

真实浏览器截图授权、视频、iframe 与全屏兼容性需要实际验证；程序级测试通过不表示这些场景已通过。验证方法见 [手动检查清单](docs/manual-checklist.md)。

## 提交改动

- 聚焦一个问题，说明触发条件与修改后的行为。
- 保留右键移动固定图标、左键投放爆点的操作约定。
- 保持网页正常运行、覆盖层点击穿透、截图仅本机临时使用。
- 修改渲染或生命周期时验证精确复原、取消、重复播放和缓存清理。
- 更新与行为有关的文档，运行 `npm test` 和相应打包检查。
- 不提交依赖目录、内部测试输出、用户上传图片或凭据。

打包命令：

```bash
python tools/package.py --install-only --output dist/TNT_Blast_install.zip
python tools/package.py --output dist/TNT_Blast_source.zip
```

## 许可与素材

提交代码应允许按 [MIT 许可证](LICENSE) 分发。请标明新增素材的来源与许可。项目采用自绘的像素风格 TNT，并非 Minecraft 官方工具。

