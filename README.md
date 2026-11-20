# 股市練功房

繁體中文台股模擬交易網站，部署於 GitHub Pages。這是單人、本機保存的學習工具；所有報價都是示意資料，不連接即時行情或券商。

## 本機預覽

專案使用 JavaScript ES modules，請從本資料夾啟動 HTTP server，再瀏覽 `http://localhost:8000`：

```powershell
python -m http.server 8000
```

## 驗證交易引擎

需要 Node.js 18 或更新版本。此專案沒有第三方執行期依賴：

```powershell
npm test
```

## 功能

- 搜尋六檔台股示意資料，依名稱、代號或產業篩選。
- 以 NT$1,000,000 虛擬資金模擬買進、賣出與整數股數交易。
- 試算手續費和賣出證交稅；買賣使用明確的示意參考價。
- 查看現金、持倉成本、市值、已實現／未實現損益與最近交易。
- 模擬帳戶保存在目前瀏覽器的 `localStorage`，可以重設。

交易費率與未納入的券商折扣、最低手續費、滑價等假設記錄於 [`knowledge/decision.md`](knowledge/decision.md)。模擬結果不代表真實撮合，不構成投資建議。

## 發布

推送至 `main` 後，`.github/workflows/deploy.yml` 會透過 GitHub Actions 自動發布至 Pages。repository Pages source 已設為 GitHub Actions。

