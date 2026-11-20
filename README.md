# 股市練功房

繁體中文台股模擬交易平台的網頁原型，採用 GitHub Pages 部署。

## 本機預覽

直接用瀏覽器開啟 `index.html` 即可預覽。目前內容為前端互動原型，行情與投資組合使用示意資料，未連接即時行情或後端交易服務。

## GitHub Pages

推送到 `main` 分支後，`.github/workflows/deploy.yml` 會透過 GitHub Actions 發布網站。首次使用時，在 repository 的 **Settings → Pages → Build and deployment** 將來源設為 **GitHub Actions**。

## 目前包含

- 遊戲化首頁儀表板與經驗值呈現
- 台股市場觀察、模擬投資組合摘要及自選清單示意
- 響應式桌面與手機版面
- GitHub Actions Pages 部署流程

