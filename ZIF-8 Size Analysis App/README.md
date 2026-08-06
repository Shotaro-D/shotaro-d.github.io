# ZIF-8 Size Analysis App

認証付きのWeb版SEM粒径統計アプリである。ユーザーが自分のローカル解析フォルダを選択すると，TIFF，TXT，JPEG，CSV，JSONなどをブラウザー内で読み込み，保存済みのmanual-count JSONセッションから形状別統計を計算する。

```text
Shape, Average diameter (nm), standard deviation (nm), CV (%), Counts
```

## データ取り扱いの原則

このアプリは，研究データをサーバーへアップロードしない。

- フォルダ選択はブラウザーのFile APIで行う。
- TIFF，TXT，JPEG，CSV，JSONの読み込みは使用者のブラウザー内だけで行う。
- 解析計算はJavaScriptでブラウザー内に完結する。
- 結果CSVはブラウザー内で生成し，使用者のローカルへダウンロードする。
- サーバーへ送信するのはログイン時の認証要求と認証セッションだけである。
- Flaskサーバーに解析ファイル，解析結果，ユーザーの作業JSONを保存するAPIは存在しない。

ブラウザーの開発者ツールのNetwork欄で，解析開始後にmultipart uploadや`/api/jobs`へのファイル送信が発生しないことを確認できる。

## 現在の実装範囲

- メールアドレスとパスワードによる認証
- 認証は日本時間の日付が変わるまで有効
- パスワードはWerkzeugのハッシュで検証し，平文を保存しない
- 本番Cookieは`Secure`，`HttpOnly`，`SameSite=Lax`
- ログイン失敗の簡易レート制限
- ローカルフォルダ内のTIFF，TXT，JPEG，CSV，JSONのファイル数を表示
- `particles`配列を持つJSONセッションをブラウザー内で自動検出
- `image_sha256`またはsample／image名による重複セッションの排除
- `included_in_statistics=false`の粒子を除外
- 形状別の平均径，母標準偏差（ddof=0），CV，Countsを計算
- CSVを使用者のローカルへダウンロード

この版は保存済みJSONセッションの集計に対応する。Web上で新しい3D図形を配置するmanual-count画面そのものは，別段階の実装対象である。

## ローカル起動

Python 3.10以上を使用する。Pythonは認証サーバーの起動にだけ必要であり，解析対象ファイルをPythonへ送信することはない。

```bash
cd "/Users/danjoushoutarou/Homepage/ZIF-8 Size Analysis App"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```

認証用のパスワードハッシュを作成する。入力した平文パスワードは表示されず，出力されたハッシュだけをSecretへ登録する。

```bash
.venv/bin/python create_user.py user@example.com
```

開発時だけ，次のように環境変数を設定する。実際のパスワードやハッシュをこのREADMEへ書き込まない。

```bash
export APP_SECRET_KEY="replace-with-a-long-random-secret"
export APP_USERS_JSON='{"user@example.com":"paste-generated-password-hash-here"}'
.venv/bin/python app.py
```

ブラウザーで`http://127.0.0.1:8795/`を開く。

## GitHub／Renderへ配置する場合

GitHubにはPython環境そのもの（`.venv`），平文パスワード，ユーザーJSON，解析データを入れない。アプリのソースコードをPrivateリポジトリへ置くことは推奨するが，認証情報はリポジトリではなくRenderのEnvironment Secretへ登録する。

```text
Build Command: pip install -r requirements.txt
Start Command: gunicorn --bind 0.0.0.0:$PORT app:app
```

RenderのEnvironment Variablesへ次を登録する。

```text
APP_ENV=production
APP_SECRET_KEY=<十分に長いランダム値>
APP_USERS_JSON=<生成したユーザーのハッシュを含むJSON>
```

`APP_USERS_JSON`に平文パスワードを入れない。ユーザーを追加・変更するときは`create_user.py`で新しいハッシュを生成し，RenderのSecretだけを更新する。

Homepageからは，公開後に発行されたアプリURLへリンクする。URLを知っているだけでは利用できず，認証が必要である。

## セキュリティ上の注意

- 公開環境では必ずHTTPSを使用する。
- 独自暗号ではなく，HTTPS／TLSによってログイン情報を保護する。
- 平文パスワードをGitHub，Homepage，HTML，JavaScript，README，ログへ書かない。
- このプロジェクトへ実運用の認証情報を入力する場合，この会話などに平文で記載したパスワードは使用せず，新しいものへ変更する。
- 解析ファイルはサーバーへ送信しないが，WebアプリのJavaScript自体はサーバーから配信される。そのため，Privateリポジトリ，HTTPS，依存関係の固定，第三者スクリプトの不使用を推奨する。
