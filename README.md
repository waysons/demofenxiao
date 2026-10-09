# demofenxiao

三三拼团分销模式静态模拟网站，按提供的 HTML 原样整理。

## 文件

- `index.html`：网站入口。
- `assets/styles.css`：原页面自定义样式。
- `assets/simulation-engine.js`：原结算逻辑。
- `assets/simulation-ui.js`：原页面交互。

无需安装依赖或构建，保留全部文件即可运行。Tailwind CSS 继续使用原页面的 CDN，需要联网加载。

## GitHub Pages

在仓库 **Settings → Pages** 中选择 **Deploy from a branch**，分支选择 `main`，目录选择 `/(root)` 后保存。

发布成功后访问：https://waysons.github.io/demofenxiao/

## 数据说明

仅为静态模拟，无真实扣款。数据保存在每位访客当前页面的内存中，不会与其他访客同步，刷新后清空。
