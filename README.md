# WebAR スタンプラリー - 導入・運用ガイド

## ファイル構成

```
stamp-rally/
├── index.html     ← メインHTML（画面構造）
├── style.css      ← デザイン（CSS変数で色変更可能）
├── app.js         ← アプリロジック（ES Modules）
├── sw.js          ← Service Worker（PWAオフライン対応）
├── manifest.json  ← PWAマニフェスト
└── README.md      ← このファイル
```

---

## 🚀 デプロイ手順（GitHub Pages）

1. GitHubにリポジトリを作成
2. ファイルをすべてアップロード
3. Settings → Pages → Source: main branch / root
4. `https://ユーザー名.github.io/リポジトリ名/` でアクセス

> ✅ GitHub PagesはCDN配信のため、5,000人同時アクセスに耐えられます。

---

## 📊 Google Sheets連携（設定の外部管理）

### GASスクリプト例（コードエディタに貼り付けてデプロイ）

```javascript
// Google Apps Script - doGet()でJSONを返す
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // === イベント情報シート ===
  const infoSheet = ss.getSheetByName('イベント情報');
  const infoData = infoSheet.getDataRange().getValues();
  const info = {};
  infoData.forEach(row => { if (row[0]) info[row[0]] = row[1]; });
  
  // === スタンプシート ===
  const stampSheet = ss.getSheetByName('スタンプ');
  const stampData = stampSheet.getDataRange().getValues();
  const headers = stampData[0];
  const stamps = stampData.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  
  // === 遊び方シート ===
  const howtoSheet = ss.getSheetByName('遊び方');
  const howtoData = howtoSheet.getDataRange().getValues();
  const howtoSteps = howtoData.slice(1).map(row => ({ title: row[0], desc: row[1] }));
  
  const result = {
    versionId:     info['versionId']     || '2026_Ver1',
    eventYear:     info['eventYear']     || '2026',
    eventTitle:    info['eventTitle']    || '文化祭スタンプラリー',
    eventSubtitle: info['eventSubtitle'] || '全スタンプを集めよう！',
    stamps,
    howtoSteps,
    coupon: {
      title: info['couponTitle'] || '🎁 特典クーポン',
      body:  info['couponBody']  || '特典内容',
      code:  info['couponCode']  || 'FES-2026',
    },
  };
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### スプレッドシート構成例

**シート①「イベント情報」**
| キー | 値 |
|---|---|
| versionId | 2026_Ver1 |
| eventYear | 2026 |
| eventTitle | 文化祭スタンプラリー |
| eventSubtitle | 全スタンプを集めてゲットしよう！ |
| couponTitle | 🎁 特典クーポン |
| couponBody | 文化祭グッズ引換券 |
| couponCode | FES-2026-COMP |

**シート②「スタンプ」** （1行目がヘッダー）
| id | name | location | message | emoji | code | barcodeId | modelUrl |
|---|---|---|---|---|---|---|---|
| stamp_01 | 科学部 | 3階理科室 | サイエンスの世界へ | 🔬 | 1234 | 0 | |

**シート③「遊び方」** （1行目がヘッダー行でもOK、2行目から）
| title | desc |
|---|---|
| アプリを開く | ホーム画面に追加しておくと便利です |

---

## 🏆 リーダーボード GASスクリプト例

```javascript
const SHEET_NAME = 'リーダーボード';

function doGet(e) {
  const version = e.parameter.version || '';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues().slice(1);
  const entries = data
    .filter(r => r[2] === version)
    .sort((a, b) => a[1] - b[1]) // 昇順（タイムが短い方が上位）
    .slice(0, 10)
    .map(r => ({ name: r[0], time: r[1] }));
  return ContentService
    .createTextOutput(JSON.stringify({ entries }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  sheet.appendRow([data.name, data.time, data.version, new Date()]);
  return ContentService
    .createTextOutput('OK')
    .setMimeType(ContentService.MimeType.TEXT);
}
```

---

## 🎯 バーコードマーカーの印刷方法

1. AR.jsのバーコードマーカー生成ツールにアクセス:
   `https://nicktomkins.github.io/ar-barcodes/`
2. タイプ: **3x3 Hamming 6.3**
3. ID 0〜63を印刷（スタンプ数分）
4. A4サイズ以上で印刷、光沢紙推奨
5. 廊下や壁に貼り付ける

---

## 📱 管理者パネルの使い方

1. タイトル画面右下の ⚙ ボタンを長押し
2. パスワード入力（初期: `admin`）
3. タブ構成:
   - **スタンプ** タブ: スタンプの追加・編集・削除・並び替え、.mindファイル管理
   - **表示文字** タブ: すべての文言・遊び方ステップの編集
   - **システム** タブ: 年度更新・Sheets連携・データ入出力・リーダーボード

---

## 🔄 年度更新の手順

1. 管理者パネル → **システム** タブ
2. バージョンIDを変更（例: `2026_Ver1` → `2027_Ver1`）
3. 「更新」ボタンを押す
4. 参加者がアプリを開くと、バージョン不一致を検知して自動リセット

---

## ⚠️ 既知の制限事項

- **AR.jsのNFT（.mind）機能**: GitHub Pagesでは`.mind`ファイルのCORSエラーが発生する場合があります。その場合はバーコードマーカーを推奨します。
- **iOS Safari**: カメラ許可を求めるダイアログが表示されます。許可が必要です。
- **Chrome 92以降**: HTTPS必須です（GitHub Pagesは自動HTTPS対応）。

---

## 🎨 デザインカスタマイズ

`style.css` の冒頭 `:root` セクションで色を変更できます：

```css
:root {
  --accent1: #c840ff;  /* メインカラー（紫） */
  --accent2: #00f0ff;  /* アクセント（シアン） */
  --accent3: #ffce00;  /* 強調（ゴールド） */
  --success: #00e87a;  /* 成功色（グリーン） */
}
```
