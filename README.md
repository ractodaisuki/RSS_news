# 無料RSSニュースアプリ + 分析機能拡張

GitHub Pages と GitHub Actions だけで動かせる、完全無料のRSSニュース閲覧アプリです。RSS取得と分析は GitHub Actions 側の Python で行い、`data/news.json` と `data/analytics.json` を GitHub Pages 上の静的HTML / CSS / JavaScript で表示します。

## 特徴

- 完全無料で運用可能
- GitHub Pages でそのまま公開可能
- GitHub Actions で3時間ごとに自動更新
- RSS取得にAPIキー不要
- タグ分類、重要度、配信元偏り、日別推移を可視化
- 更新状況カードと手動更新導線を表示
- `feeds.json` と `config/tag_rules.json` を編集するだけで拡張可能
- PC / スマホ両対応
- ライト / ダークモード切り替え対応

## ディレクトリ構成

```text
.
├─ index.html
├─ analytics.html
├─ style.css
├─ script.js
├─ analytics.js
├─ feeds.json
├─ config/
│  └─ tag_rules.json
├─ data/
│  ├─ news.json
│  ├─ analytics.json
│  └─ status.json
├─ scripts/
│  └─ fetch_rss.py
└─ .github/
   └─ workflows/
      └─ update-rss.yml
```

## 使い方

1. `index.html` を GitHub Pages で公開します。
2. GitHub Actions が `scripts/fetch_rss.py` を実行します。
3. RSSから記事を取得し、タグ分類と重要度計算を行います。
4. `data/news.json` と `data/analytics.json` を出力します。
5. `index.html` がニュース一覧を、`analytics.html` が分析結果を表示します。

## 手動更新ボタンについて

トップページの「最新ニュースを取得」ボタンは、GitHub Actions のページを開くための導線です。GitHub Pages 上では直接RSS取得を行わず、ブラウザから `workflow_dispatch` API を叩くこともしません。

動作:

1. ボタンを押す
2. GitHub Actions ページを別タブで開く
3. GitHub 側で `Run workflow` を実行する

この方式により、Personal Access Token をフロントに埋め込まずに安全な運用を維持します。

## 更新状況カードの見方

トップページには `data/status.json` を元にした更新状況カードがあります。

- `待機中`: 通常待機中です
- `更新中`: RSS取得と分析を実行しています
- `更新成功`: 最新のJSON生成が完了しています
- `更新失敗`: 更新処理に失敗しています

表示項目:

- 最終更新
- 最終成功
- 最終失敗
- 実行履歴リンク

最終成功から6時間以上経過すると「情報が少し古い可能性があります」を表示し、24時間以上経過すると長時間未更新の警告を表示します。

## ページ構成

### ニュース一覧 `index.html`

- タイトル、配信元、公開日時、概要、タグ、重要度を表示
- タイトル / 配信元 / 概要 / タグの検索
- 配信元フィルター
- タグフィルター
- 新着順 / 重要度順の並び替え
- 注目記事の簡易表示

### 分析ページ `analytics.html`

- 総記事数
- 最終更新時刻
- ひとこと分析
- タグ別件数
- 配信元別件数
- 重要度分布
- 日別件数推移
- 注目記事一覧
- よく出るタグ組み合わせ

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

## タグルールの編集方法

タグ分類ルールは `config/tag_rules.json` で管理しています。

```json
{
  "AI": ["ai", "生成ai", "llm", "chatgpt", "openai"],
  "開発": ["github", "python", "javascript", "api", "開発"]
}
```

- キー: タグ名
- 値: ヒットさせたいキーワード配列
- 英字は大小区別せず判定します
- タイトルと概要のどちらかに含まれればタグが付きます
- どのタグにも一致しない場合は `その他` になります

## タグ追加方法

1. `config/tag_rules.json` に新しいタグを追加する
2. キーワード配列を増やす
3. GitHub Actions を手動実行するか、定期更新を待つ
4. `news.json` と `analytics.json` に反映される

自分の興味に合わせて、たとえば `宇宙` `半導体` `スタートアップ` などのタグを追加できます。

## importance の決め方

重要度は 1〜5 のヒューリスティックで計算しています。

- `+2`: タイトルに強い語が入る
  - `発表`, `公開`, `開始`, `導入`, `判明`, `決定`, `規制`, `障害`, `脆弱性`
- `+1`: 概要がある程度長い
- `+1`: `AI` `医療` `セキュリティ` `規制` タグを含む
- `+1`: 主要媒体の記事
- `-1`: 概要が極端に短い
- 最終スコアは 1〜5 に丸める

表示上の目安:

- `5`: かなり重要
- `4`: 高め
- `3`: 普通
- `2`: 低め
- `1`: 補助的

## 分析機能の概要

Python 側であらかじめ以下を集計し、`data/analytics.json` に保存しています。

- `total_articles`
- `generated_at`, `generated_label`
- `tag_counts`
- `source_counts`
- `importance_counts`
- `daily_counts`
- `top_tags`
- `top_sources`
- `recent_high_importance`
- `cross_tag_counts`
- `insights`

ブラウザ側では重い集計を避け、集計済みJSONをそのまま描画するだけにしています。

## analytics.html の見方

- `総記事数`: 現在保持している記事数
- `最終更新`: 分析JSONの生成時刻
- `ひとこと分析`: 集計値から生成した短いコメント
- `タグ別件数`: よく出ているテーマ
- `配信元別件数`: どの媒体が多いか
- `重要度分布`: 読む優先度の偏り
- `日別件数推移`: 最近の更新量
- `注目記事`: 重要度4以上の新着
- `タグ組み合わせ`: 分野横断の傾向

## ローカルでの更新方法

Python 3.10 以上を想定しています。

```bash
python -m pip install certifi feedparser python-dateutil
python scripts/fetch_rss.py
```

静的ファイルのため、ローカル確認時は簡易HTTPサーバーを使うと確実です。

```bash
python -m http.server 8000
```

その後、以下を開きます。

- `http://localhost:8000/`
- `http://localhost:8000/analytics.html`

## GitHub Actions の動かし方

ワークフロー定義は `.github/workflows/update-rss.yml` です。

- `schedule`: 3時間ごとに自動実行
- `workflow_dispatch`: Actions画面から手動実行
- `ubuntu-latest` と Python 3.12 を利用
- 実行開始時に `data/status.json` を `running` に更新
- 完了時に `data/status.json` を `success` または `error` に更新
- `data/news.json` `data/analytics.json` `data/status.json` を必要に応じて commit / push

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

このプロジェクトは相対パスで `data/news.json` と `data/analytics.json` を読むため、GitHub Pages のルート公開でそのまま動きます。

## よくあるエラー

### `記事を読み込めませんでした`

原因候補:

- GitHub Pages にJSONがまだ反映されていない
- ローカルで `file://` 直開きしており `fetch` が失敗している
- JSONの構造が壊れている

対応:

- GitHub Actions を手動実行する
- `python -m http.server 8000` で確認する
- `data/news.json` と `data/analytics.json` のJSON形式を確認する

### RSSの一部が更新されない

原因候補:

- 配信元RSSのURL変更
- 一時的な配信元障害
- 対象RSSのXML形式変更

対応:

- Actions の実行ログを確認する
- `feeds.json` のURLを見直す
- 問題の配信元を一時的に外して他のRSSだけで運用する

### 更新状況が `更新失敗` になる

原因候補:

- GitHub Actions 実行時の一時的な通信失敗
- 配信元RSSの403 / 404 / タイムアウト
- Pythonスクリプトの設定エラー

対応:

- トップページの「実行履歴を見る」リンクから GitHub Actions ログを確認する
- `feeds.json` や `config/tag_rules.json` の内容を見直す
- 失敗している配信元を一時的に外して再実行する

### タグ分類が期待と違う

原因候補:

- キーワードが不足している
- 似た表現が `tag_rules.json` に入っていない
- `その他` に落ちている

対応:

- `config/tag_rules.json` にキーワードを追加する
- タグ名とキーワードの粒度を見直す
- 手動更新して分類結果を確認する

## 実装メモ

- RSS取得はブラウザではなく GitHub Actions 側で実行します
- Pages 上の手動更新ボタンは GitHub Actions への導線のみです
- RSSごとに失敗しても全体処理は継続します
- 一時的に全RSS取得に失敗した場合は、既存JSONを維持します
- 概要はHTMLタグを除去してプレーンテキストに近い形で保存します
- 重要度と分析はキーワードベースの軽量実装です
- 複雑な機械学習や外部AIは使っていません
- 最終保持件数は全体で最大100件です
