# arcanade_homepage_v2

ARCANADEの静的ホームページです。

## 構成

- `homepage_contents/`: S3へ配置する公開ファイル
- `user_contents/`: ブログ、制作物、ミニゲームの元データ
- `tools/build-content.mjs`: `user_contents` から `homepage_contents/data/content.json` を生成

## 公開パス

- `/`: トップページ
- `/blog/`: ブログ一覧
- `/blog/<日時-タイトル>/`: ブログ詳細
- `/works/`: 制作物一覧
- `/works/<日時-タイトル>/`: 制作物詳細
- `/games/`: ミニゲーム一覧
- `/games/<日時-タイトル>/`: ミニゲーム表示
- `/contact/`: 連絡

## ローカル確認

```bash
cd homepage_contents
python -m http.server 8000
```

その後、`http://localhost:8000` を開きます。

## コンテンツ生成

```bash
node tools/build-content.mjs
```

このコマンドで各ディレクトリの `index.html` も生成されます。
ブログ本文、制作物詳細、ゲーム表示は各詳細ページの `index.html` に静的HTMLとして埋め込まれます。公開用の `content.json` には一覧や動的更新に必要な概要情報だけを出力し、ブログ本文の `body` は含めません。

## PV・いいね

PV数といいね数は API Gateway のレスポンスを表示します。GET APIの結果はブラウザの `localStorage` に約5分間キャッシュし、その間はGET APIを再実行しません。PV・いいねのPOST後は、POSTの返却値でこのローカルキャッシュを更新します。

GETは全件取得APIを使用します。

- `GET /blog`: ブログのPV・いいね全件取得
- `GET /work`: 制作物のPV・いいね全件取得
- `GET /game`: ゲームのPV・いいね全件取得
- `POST /blog/pv`, `POST /work/pv`, `POST /game/pv`: 詳細表示時のPV加算
- `POST /blog/likes`, `POST /work/likes`, `POST /game/likes`: いいね加算
