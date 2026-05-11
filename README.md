# 車中泊向けRSSニュースアプリ + 分析機能拡張

GitHub Pages と GitHub Actions だけで動かせる、完全無料のRSSニュース閲覧アプリです。RSS取得と分析は GitHub Actions 側の Python で行い、`data/news.json` と `data/analytics.json` を GitHub Pages 上の静的HTML / CSS / JavaScript で表示します。

このリポジトリは現在、`車中泊` `キャンピングカー` `RVパーク` `ポータブル電源` `防災・避難` の話題を追いやすいように強化しています。

## 特徴

- 完全無料で運用可能
- GitHub Pages でそのまま公開可能
- GitHub Actions で3時間ごとに自動更新
- RSS取得にAPIキー不要
- RSSがないWebサイトも差分監視で取り込み可能
- 車中泊向けクイックフィルターと専用サマリー
- SOTOBIRA / JRVA のような車中泊系ソースを強化
- タグ分類、重要度、配信元偏り、日別推移を可視化
- 更新状況カードと手動更新導線を表示
- `feeds.json` `config/tag_rules.json` `config/watch_sites.json` を編集して拡張可能
- PC / スマホ両対応
- ライト / ダークモード切り替え対応

## ディレクトリ構成

```text
.
├─ index.html
├─ analytics.html
├─ style.css
├─ script.js
├─ supabase-client.js
├─ user-sync.js
├─ profile.js
├─ config.example.js
├─ analytics.js
├─ feeds.json
├─ requirements.txt
├─ config/
│  ├─ tag_rules.json
│  └─ watch_sites.json
├─ data/
│  ├─ news.json
│  ├─ analytics.json
│  ├─ watch_state.json
│  └─ status.json
├─ scripts/
│  ├─ fetch_rss.py
│  └─ check_websites.py
└─ .github/
   └─ workflows/
      └─ update-rss.yml
```

## 使い方

1. `index.html` を GitHub Pages で公開します。
2. GitHub Actions が `scripts/fetch_rss.py` を実行します。
3. RSSから記事を取得し、タグ分類と重要度計算を行います。
4. 続けて `scripts/check_websites.py` が RSSのないサイトを差分監視します。
5. `data/news.json` `data/analytics.json` `data/watch_state.json` を更新します。
6. `index.html` がニュース一覧を、`analytics.html` が分析結果を表示します。

## Supabase同期機能

Supabase Auth と Row Level Security を使って、記事クリック履歴とフィードバックをログインユーザーごとに保存します。GitHub Pages の静的サイトとして動作し、未ログイン時やSupabase保存失敗時は `localStorage` の `rss_news_local_events_v1` に退避します。ログイン後、未同期イベントはSupabaseへアップロードされ、成功後にローカルから削除されます。

フロントに置くのは `anon key` のみです。`service_role key` は絶対にブラウザへ置かないでください。将来 GitHub Actions や `fetch_rss.py` 側で `user_interest_profiles` を読む場合は、`service_role key` を GitHub Actions Secrets に保存してサーバー側だけで使います。

### config.js の作成

`config.example.js` を元に、公開環境では `config.js` を作成します。

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY"
};
```

`anon key` は公開される前提のキーです。安全性は必ずRLSで担保します。このリポジトリでは `config.js` を `.gitignore` していますが、公開してもよいのは `anon key` のみです。

Magic Link を使うため、Supabase Dashboard の Authentication URL Configuration で、GitHub Pages の公開URLとローカル確認用URLをリダイレクト許可に追加してください。

- `https://ractodaisuki.github.io/RSS_news/`
- `http://localhost:8000/`

### Supabase SQL

Supabase SQL Editorで以下を実行してください。RLSを有効化し、認証済みユーザーが自分の行だけを参照・追加・削除・更新できるようにします。

```sql
create table public.article_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text not null,
  article_url text,
  title text not null,
  source text,
  category text,
  keywords text[] default '{}',
  event_type text not null check (
    event_type in ('click', 'important', 'unimportant', 'saved', 'hidden', 'unhidden')
  ),
  read_duration_seconds integer,
  created_at timestamptz not null default now()
);

create index article_events_user_id_idx
  on public.article_events(user_id);

create index article_events_article_id_idx
  on public.article_events(article_id);

create index article_events_event_type_idx
  on public.article_events(event_type);

alter table public.article_events enable row level security;

create policy "Users can select own article events"
on public.article_events
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own article events"
on public.article_events
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete own article events"
on public.article_events
for delete
to authenticated
using (auth.uid() = user_id);

create table public.user_interest_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorite_categories jsonb not null default '{}',
  favorite_keywords jsonb not null default '{}',
  favorite_sources jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_interest_profiles enable row level security;

create policy "Users can select own interest profile"
on public.user_interest_profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can upsert own interest profile"
on public.user_interest_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own interest profile"
on public.user_interest_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

### 収集するイベント

記事リンククリック時に `click` を保存します。記事カードのフィードバックボタンから以下を保存します。

- `important`: 重要
- `unimportant`: 不要
- `hidden`: 非表示
- `unhidden`: 表示に戻す

`saved` は旧UI互換のためテーブル制約では許可していますが、現在の画面からは生成しません。重要に分類した記事は Supabase の `important` イベントから復元され、ログイン中の端末間で共有されます。

保存項目は `article_id`, `article_url`, `title`, `source`, `category`, `keywords`, `event_type`, `created_at` です。`article_id` はURLがあればURLを使い、URLがない場合は `title + source + published` を元にブラウザ側でハッシュ化します。

### 興味プロファイル

`article_events` から以下の重みで `category`, `keywords`, `source` を集計し、`user_interest_profiles` に保存します。

- `click`: +1
- `important`: +5
- `unimportant`: -3
- `hidden`: -5

トップページの「あなた向けプロファイル」に、Geminiへ渡せるJSONとプロンプト文字列を表示します。Gemini API呼び出し自体はブラウザでは行いません。

フロント表示では既存重要度にユーザープロファイル補正をかけ、`重要度: 3 → あなた向け 5` のように表示します。補正後の値は1〜5に丸めます。

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
- `更新中`: RSS取得とWeb監視を実行しています
- `更新成功`: 最新のJSON生成が完了しています
- `更新失敗`: 更新処理に失敗しています

表示項目:

- 最終更新
- 最終成功
- 最終失敗
- 実行履歴リンク

最終成功から6時間以上経過すると「情報が少し古い可能性があります」を表示し、24時間以上経過すると長時間未更新の警告を表示します。

`data/status.json` には GitHub Actions の実行URLも入り、トップページから該当実行ログへ移動できます。

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

## RSSがないWebサイトの追加方法

`config/watch_sites.json` に監視対象を追加してください。

```json
[
  {
    "name": "Example News",
    "url": "https://example.com/news",
    "selector": "main",
    "tag": "Web更新"
  },
  {
    "name": "Vendor Updates",
    "url": "https://example.com/releases",
    "selector": ".release-list",
    "tag": "リリース"
  }
]
```

- `name`: 更新検知時の表示名
- `url`: 監視するページURL
- `selector`: 比較対象のCSSセレクタ。空文字なら `body` 全体を比較
- `tag`: 検知記事に付ける任意タグ。常に `Web更新` も付きます

初回実行時は本文ハッシュを `data/watch_state.json` に保存するだけで、`news.json` には追加しません。2回目以降に本文差分が出たときだけ `Web監視` ソースの記事が `news.json` に追加されます。

さらに、次の任意フィールドを使うと、RSSのないサイトでも「更新されました」ではなく、最新記事のタイトル・リンク・概要まで `news.json` に入れられます。

```json
[
  {
    "name": "JRVA NEWS",
    "url": "https://www.jrva.com/jrvanews/",
    "selector": "",
    "tag": "RVパーク",
    "item_selector": ".news .card",
    "title_selector": "h3.title",
    "link_selector": "a.newslistlink",
    "summary_selector": "p.description",
    "tags_selector": ".tag-list li a"
  }
]
```

- `item_selector`: 監視対象ページのうち最新記事カードを特定するセレクタ
- `title_selector`: 記事タイトル取得用セレクタ
- `link_selector`: 記事リンク取得用セレクタ
- `summary_selector`: 概要取得用セレクタ
- `tags_selector`: 補助タグ取得用セレクタ

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

自分の興味に合わせて、たとえば `宇宙` `半導体` `スタートアップ` に加えて `車中泊DIY` `軽バン・ミニバン` `RVパーク` なども追加できます。

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
python -m pip install -r requirements.txt
python scripts/fetch_rss.py
python scripts/check_websites.py
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
- `requirements.txt` を使って依存を管理
- `actions/setup-python` の `cache: pip` で依存インストールを高速化
- `concurrency` で同時実行を抑制し、古い実行は自動停止
- `timeout-minutes: 10` でハング時に自動停止
- `RUN_URL` を `data/status.json` に保存
- 実行開始時に `data/status.json` を `running` に更新
- 完了時に `data/status.json` を `success` または `error` に更新
- `scripts/fetch_rss.py` 実行後に `scripts/check_websites.py` を実行
- `data/news.json` `data/analytics.json` `data/status.json` `data/watch_state.json` を必要に応じて commit / push

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
- Python依存は `requirements.txt` で管理しています
- GitHub Actions は pip キャッシュで依存インストールを高速化しています
- 同時実行は `concurrency` で抑制しています
- RSSごとに失敗しても全体処理は継続します
- 一時的に全RSS取得に失敗した場合は、既存JSONを維持します
- 概要はHTMLタグを除去してプレーンテキストに近い形で保存します
- 重要度と分析はキーワードベースの軽量実装です
- 複雑な機械学習や外部AIは使っていません
- 最終保持件数は全体で最大300件です
