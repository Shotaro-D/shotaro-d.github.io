# ZIF-8 SEM Manual Fitting App

認証付きのWeb版SEM画像フィッティングアプリである。研究者がローカルのSEM画像上で，菱形十二面体，面取り立方体，立方体の3Dモデルを手動配置し，回転，移動，サイズ，面取り率を調整する。

## 最重要：研究データはサーバーへ送信しない

このアプリの解析対象は，使用者のブラウザーだけで読み込む。Flask／Render側は認証処理と，フィッティングに必要な固定3Dモデル形状JSONの配信だけを行う。

- フォルダ選択はブラウザーのFile API（`webkitdirectory`）で行う。
- TIFF，TXT，JPEG，CSV，JSONなどは，選択されたローカルFileオブジェクトからブラウザー内で読む。
- SEM画像，サイドカーTXT，解析JSONを`fetch`，`FormData`，multipart uploadでサーバーへ送信しない。
- 3Dモデルの投影，投影面積，等価円直径，粒子統計はJavaScriptとCanvasでブラウザー内に計算する。
- 作業セッションはブラウザーの`localStorage`へ画像ハッシュ単位で保存する。
- JSON，TXT，PNG，JPEGはブラウザーで生成し，使用者のローカルへダウンロードする。
- ログイン時の認証要求と認証セッション以外に，使用者のファイル内容をサーバーへ送らない。

ブラウザーの開発者ツールのNetwork欄で，解析対象を開いた後に送信されるリクエストがないことを確認できる。`/api/manual/meshes`はユーザー固有でない固定3Dモデル情報だけを取得するリクエストである。

## 操作

1. ログイン後，「ローカルフォルダを選択」を押し，SEM TIFFを含むフォルダを選ぶ。
2. TIFF一覧から対象画像を選択する。隣接するHitachi形式TXTからPixelSize／MicronMarkerを読み込み，既存の対応JSONがあればブラウザー内で復元する。
3. 「新しい粒子」を押し，画像上で3Dモデルを調整する。
4. `Add`または更新を押すと，ブラウザー内で投影面積と等価円直径を再計算する。
5. 必要に応じてJSON，TXT，PNG，JPEGをダウンロードする。

画面上部の「サイズ分布」から，選択したローカルフォルダ内の解析JSONをMLZIFフォルダ（Analysis run）単位で集約できる。
「サイズ分布」または「↻ 再集計」で最新のローカルJSONを読み直し，次をブラウザー内で生成して，選択したローカルフォルダ内の`Particle size`フォルダ（存在しない場合は作成）へ自動保存する。

- `shape_statistics_by_shape.csv`：1行をMLZIFフォルダとし，形状ごとにAverage，standard deviation，CV，Countsの列を作成する。
- サイズ分布PNG：個数基準ヒストグラム，正規分布フィット線，Average，1σ，CV，D50を表示する。

粒径は各画像のJSONに保存された`equivalent_diameter_nm`を使用する。TIFFではTIFFタグ／Hitachi TXT／画像内スケールバーの既存校正を使用する。BMPでは画像メタデータを使用せず，隣接TXT，確認済みJSON，または使用者が入力したバー表示値を用いる。後者では，画像右下のスケールバー長を自動検出して`nm/px`を算出する。この集計でも，画像，TXT，JSON，粒径データをサーバーへ送信しない。

主な操作は次のとおりである。

- 通常ドラッグ：3D回転
- `Shift`＋ドラッグ：平行移動
- `Option`＋ドラッグ：画像面内の2D回転
- `X`／`Y`／`Z`＋ドラッグ：モデル軸を拘束した回転
- ホイール：モデルサイズ変更
- `Shift`＋ホイール：画像ズーム
- `Space`＋ドラッグ：画像パン
- 右下のショートカット一覧：開閉可能

## 認証

認証情報はGitHubへ保存しない。RenderのEnvironment Variablesへ，Werkzeugのパスワードハッシュを含む`APP_USERS_JSON`をSecretとして登録する。

```text
APP_ENV=production
APP_SECRET_KEY=<十分に長いランダム値>
APP_USERS_JSON=<メールアドレスとパスワードハッシュのJSON>
```

認証は日本時間の日付単位で有効である。本番Cookieは`Secure`，`HttpOnly`，`SameSite=Lax`であり，ログイン試行には簡易レート制限を設けている。

実運用のパスワードをREADME，GitHub，Homepage，HTML，JavaScript，ログへ書き込まない。HTTPSを使用し，認証情報をこのアプリ以外へ再利用しない。

## ローカル起動

Python 3.10以上を使用する。Pythonは認証サーバーの起動にだけ必要であり，解析対象ファイルをPythonへ送信することはない。

```bash
cd "ZIF-8 Size Analysis App"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python create_user.py user@example.com
```

開発時は環境変数を設定して起動する。

```bash
export APP_SECRET_KEY="replace-with-a-long-random-secret"
export APP_USERS_JSON='{"user@example.com":"paste-generated-password-hash-here"}'
.venv/bin/python app.py
```

ブラウザーで`http://127.0.0.1:8795/`を開く。

## Render

```text
Build Command: pip install -r requirements.txt
Start Command: gunicorn --bind 0.0.0.0:$PORT app:app
```

GitHubへPython仮想環境，平文パスワード，ユーザーJSON，SEM画像，解析データを入れない。RenderのEnvironment Variablesに認証Secretだけを登録する。アプリのコードを更新した後は，Renderで再デプロイする。

本アプリの設計上，Renderの一時ディスクへ解析対象を保存する機能は存在しない。ただし，ブラウザーへ配信されるJavaScriptを改変できる立場の者は，ブラウザー内データを取得できるため，アプリのGitHubリポジトリとRenderのデプロイ権限を厳格に管理する。
