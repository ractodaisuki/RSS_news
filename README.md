# 無料RSSニュースアプリ

GitHub Pages と GitHub Actions だけで動かせる、完全無料のRSSニュース閲覧アプリです。RSS取得は GitHub Actions 側で行い、生成した `data/news.json` を GitHub Pages 上の静的HTML / CSS / JavaScript で表示します。

## 特徴

- 完全無料で運用可能
- GitHub Pages でそのまま公開可能
- GitHub Actions で3時間ごとに自動更新
- RSS取得にAPIキー不要
- `feeds.json` を編集するだけで配信元を追加・削除可能
- PC / スマホ両対応
- ライト / ダークモード切り替え対応
- 検索、配信元フィルター、もっと見る表示に対応

## ディレクトリ構成

```text
.
├─ index.html
├─ style.css
├─ script.js
├─ feeds.json
├─ data/
│  └─ news.json
├─ scripts/
│  └─ fetch_rss.py
└─ .github/
   └─ workflows/
      └─ update-rss.yml
```

## 使い方

1. `index.html` をGitHub Pagesで公開します。
2. GitHub Actions が `scripts/fetch_rss.py` を実行します。
3. 取得した記事が `data/news.json` に保存されます。
4. ブラウザが `data/news.json` を読み込み、一覧表示します。

## RSS追加方法

`feeds.json` に以下の形式で追加してください。

```json
[
  {
    "name": "NHK NEWS WEB",
    "url": "https://www3.nhk.or.jp/rss/news/cat0.xml"
  }
]
```

- `name`: 画面表示用の配信元名
- `url`: RSS / Atom / RDF のURL

配信元を削除したい場合は、該当オブジェクトを削除するだけで反映できます。

現在のサンプル設定には、以下の配信元を入れています。

- NHK NEWS WEB
- ITmedia NEWS
- Impress Watch
- Gigazine
- オモコロ
- ライフハッカー・ジャパン
- 電ファミニコゲーマー
- BE-PAL
- 窓の杜
- ケータイ Watch

## ローカルでの更新方法

Python 3.10 以上を想定しています。

```bash
python -m pip install certifi feedparser python-dateutil
python scripts/fetch_rss.py
```

生成された `data/news.json` をブラウザ表示で確認してください。静的ファイルのため、ローカル確認時は簡易HTTPサーバーを使うと確実です。

```bash
python -m http.server 8000
```

その後、`http://localhost:8000` を開きます。

## GitHub Actions の動かし方

ワークフロー定義は `.github/workflows/update-rss.yml` です。

- `schedule`: 3時間ごとに自動実行
- `workflow_dispatch`: Actions画面から手動実行
- `ubuntu-latest` と Python 3.12 を利用
- `data/news.json` に差分があるときだけ commit / push

手動実行手順:

1. GitHub リポジトリの `Actions` タブを開く
2. `Update RSS News` ワークフローを選ぶ
3. `Run workflow` を押す

## GitHub Pages を有効化する手順

1. GitHub リポジトリの `Settings` を開く
2. 左メニューの `Pages` を開く
3. `Build and deployment` の `Source` で `Deploy from a branch` を選ぶ
4. Branch を `main`、フォルダを `/ (root)` にする
5. 保存後、公開URLにアクセスする

このプロジェクトは相対パスで `data/news.json` を読み込むため、GitHub Pages のルート公開でそのまま動きます。

## 画面機能

- 記事カード表示
- タイトル、配信元、公開日時、概要、記事リンク
- タイトル / 配信元 / 概要の部分一致検索
- 配信元ドロップダウンフィルター
- 最新10件表示ボタン
- 条件クリアボタン
- ライト / ダークモード切り替え
- 記事が多い場合の `もっと見る`
- 最終更新時刻表示

## よくあるエラー

### `記事を読み込めませんでした`

原因候補:

- GitHub Pages に `data/news.json` がまだ反映されていない
- ローカルで `file://` 直開きしており `fetch` が失敗している
- JSONの構造が壊れている

対応:

- GitHub Actions を手動実行する
- `python -m http.server 8000` で確認する
- `data/news.json` のJSON形式を確認する

### RSSの一部が更新されない

原因候補:

- 配信元RSSのURL変更
- 一時的な配信元障害
- 対象RSSのXML形式変更

対応:

- Actions の実行ログを確認する
- `feeds.json` のURLを見直す
- 問題の配信元を一時的に外して他のRSSだけで運用する

### GitHub Actions が push できない

確認点:

- リポジトリの Actions に書き込み権限があるか
- デフォルトブランチが `main` か
- `permissions.contents: write` が有効か

## 実装メモ

- RSS取得はブラウザではなく GitHub Actions 側で実行します
- RSSごとに失敗しても全体処理は継続します
- 一時的に全RSS取得に失敗した場合は、既存の `data/news.json` を維持します
- 概要はHTMLタグを除去してプレーンテキストに近い形で保存します
- 公開日時がない記事は `published` を空文字にし、一覧の末尾に回します
- 最終保持件数は全体で最大100件です
