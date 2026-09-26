# JIZURA 独自フォーク

このリポジトリは [exveria1015/JIZURA](https://github.com/exveria1015/JIZURA) の開発版です。[元プロジェクト](https://github.com/852wa/JIZURA) の公開サイトとは別に管理します。元の著作権表示と MIT ライセンス、PR のコミット履歴を保持しています。

## ローカルで使う

リポジトリのルートで次を実行し、`http://127.0.0.1:8765/` を開きます。

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

日本語版は `index.html`、英語版は `en/index.html` です。他の言語へは画面上部から切り替えられます。README に残してある `852wa.github.io` のリンクは、元プロジェクトの公開版を指します。

## 更新先と公開設定

2026-09-26 の統合作業で、このクローンを次の設定にしました。

| 項目 | 設定 |
|---|---|
| `origin` | `https://github.com/exveria1015/JIZURA.git` |
| `upstream` の取得先 | `https://github.com/852wa/JIZURA.git` |
| `upstream` の送信先 | `DISABLED`（誤送信を防ぐための無効な送信先） |
| 既定の push 先 | `origin` |
| GitHub CLI の既定リポジトリ | `exveria1015/JIZURA` |
| フォークの Pages / Actions | 無効 |

これらの Git 設定はこのクローンに保存されます。別の場所へクローンした場合は `git remote -v` を確認し、必要に応じて同じ設定にしてください。元リポジトリの PR に対するマージ・クローズ操作は行いません。

生成ページには、既定で canonical URL・公開 URL・言語別の公開 URL を入れません。将来、フォーク用の公開先を決めた場合だけ、ビルド時に `JIZURA_SITE_URL` へその絶対 URL を指定します。この変数を指定してもデプロイは実行されません。ソースの `VERSION` は元プロジェクトの `0.9.0` を保持しており、独自変更は Git のコミットと以下の記録で識別します。

## PR の取り込みと検証

2026-09-26 時点で開いていた **10件（#25〜33、#35）**を取り込みました。基準コミット、各 PR の取得時 SHA、競合解消と追加修正は [統合記録](docs/UPSTREAM_INTEGRATION.md) と [取得一覧](docs/upstream-prs-2026-09-26.json) に記載しています。

ブラウザ版の再生成と検証：

```sh
python3 build.py
python3 dev/check_fork.py
```

検証には Node.js 22 以降、Python 3、Chrome が必要です。Chrome の場所は `CHROME_BIN` で指定できます。検証用ブラウザには一時プロファイルを使います。

CEP 配布物を再生成する場合は、先にブラウザ版を再生成してから次を実行します。

```sh
node tools/export_ae_data.js
python3 build_ae.py
python3 build_ae.py --lang en
python3 build_cep.py --out build/ja
python3 build_cep.py --lang en --out build/en
```

CEP の拡張 ID は元のままです。同じ言語の元版と同時にインストールすると置き換わるため、独立した AE 拡張として配布する段階で ID とインストーラを分離してください。今回の作業ではインストールしていません。

## 新機能の範囲

文字起こしは、日本語または英語を明示的に選択して実行します。外部ライブラリとモデルは要求時に読み込みます。音声を送信する処理はありません。「結果を破棄」は反映を防ぐ操作で、実行中のダウンロードや推論の即時停止は保証しません。モデル初期化時の WebGPU 失敗には WASM で再試行しますが、推論途中の GPU エラーに対する自動再試行はありません。

カットの文字制御はブラウザ描画向けです。中央を空けるモードでは、同じカットの両側に設定を適用します。本文を置き換えた場合は両側へそれぞれ置換文字を描きます。レイアウトによっては元の文字に合わせた配置寸法が残るため、長さを大きく変えたときはプレビューを確認してください。AE で同一の描画になることは確認していません。
