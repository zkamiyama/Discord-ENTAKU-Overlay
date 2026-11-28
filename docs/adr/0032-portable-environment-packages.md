# ADR 0032: 現在の環境を素材ごと持ち運ぶ

状態: 採用。利用手順は[環境パッケージ](../environment-package.md)を参照する。

## 問題

既存のParameterPresetは設定と素材IDを保存する。別の環境にJSONだけを渡しても、参照された画像、外部モデルのテクスチャ・バッファ、3DGSの元ファイルが存在しなければ同じ表示にならない。Discordに接続していない環境では、出演者名や標準アイコンも再現できない。

一方、保存したDiscordアイコンをライブ参加者の画像として使うと、更新や削除が反映されなくなる。通話の参加者や発話状態と、見た目を再現するための人物情報を別々に扱う必要がある。

## 決定

`entaku-environment.entaku.zip`を1つの環境として扱う。設定は現在のAppEngineからParameterPresetを取得し、MisskeySettings、テーマ、保存する人物情報を加える。起動後まだ通話のsnapshotがない場合は、保存済みの座席設定を使う。過去の全セッションや未使用素材は収集しない。

ZIPのルートには`entaku.json`を置き、素材の実体は`assets/<sha256>`へ格納する。manifestは`schemaVersion: 1`、`kind: "entaku-environment"`を持つ。各StudioBundleとGaussianAssetは、元のID・論理パス・ファイルのハッシュを保存する。同じ内容は素材種別をまたいで重複排除する。

GLTFのURIやGaussianの元manifestを書き換えない。人物ごとの3DGS調整は既存のprofile内に保持する。読み込み時に既存Storeで同じIDが再生成されることを確認するため、関連付けの移し替えも不要になる。

描画は既存のThree.js 0.187.0のGLTFLoaderとLoadingManagerの経路を使う。今回追加する処理はファイルの収集・検査・保存であり、別のGLTFローダーや描画形式を作らない。Three.jsのSceneをJSON化する案は、ENTAKUの席・設定・元素材の保存に代わらないため採用しない。

## Discord画像と再現プレビュー

DiscordはユーザーIDとアバターのhashを使ってCDN画像を指定する。既存のAvatarCacheはURL全体をキーにしており、画像が変わったURLは別の取得になる。標準アイコンの更新を受け取るOverlayは古い取得を取り消し、画像がなくなった場合はプレースホルダーへ戻す。

書き出し時、現在の参加者には現在のavatarUrlを使う。avatarUrlがなくなった人物へ保存アイコンを補わない。ライブ情報のない人物を未接続で再配布する場合だけ、保存済みの画像を使用する。収集した画像は書き出し元の素材Storeへ追加しない。

取り込み後の`/overlay?environment=preview`は`/ws?environment=preview`から独立したAppEngineとStatePublisherの状態を受け取る。保存した出演者名・アイコン・席を使い、発話とミュートは中立状態にする。ライブ側は通常のAppEngineのsnapshotを配信し、保存アイコンを装飾しない。プレビューは編集要求を送らず、サーバーもVC-CHATとMisskeyの購読を受け付けない。プレビューの描画診断もライブの診断へ混ぜない。

保存人物情報はSettingsStoreの`environment`へ保持する。従来のschema 1の設定にこの項目がなければnullとして読み込む。設定世代が変わるとプレビューを作り直し、新しいepochの全状態を送る。

SHA-256はZIPと素材の整合検査に使う。Discordの正しい画像を判断するための同期処理には使わない。

## 検査と確定の順序

1. 同一originの要求だけを受け付ける。環境パッケージの処理はリクエスト本文の読み込みから同時に1件に制限する。
2. ZIPのcentral／local header、CRC、offset、data descriptor、重複、パス、圧縮方式、実際の展開量を検査する。ZIP64、暗号化、分割ZIPは受け付けない。
3. manifestと実体の参照集合、サイズとSHA-256を確認する。パスは`entaku.json`と`assets/<sha256>`だけで、ZIP内のパスをそのままファイルシステムへ展開しない。
4. 一時的なディスクStoreで既存の素材検査を通し、画像寸法、モデルの依存関係、素材ID、3DGSの描画予算を確認する。現在のStoreや設定は変えず、一時保存先を削除する。
5. 確認したZIPのhashとrevision／generation／contextを保持する。適用時にも同じZIPと設定状態かを確認し、素材を公開したあとに再確認する。
6. AppEngine.applyPresetの同期transaction内でSettingsStoreをcommitする。設定と現在の座席を同じSQLite transactionに保存する。成功後だけMisskeyを再設定し、状態を配信する。

素材は内容で識別する不変ファイルなので、設定の確定前に公開できる。途中で競合や保存失敗が起きた場合は設定を維持する。未参照の新しい素材が残る場合はあるが、共有されている既存素材を削除してrollbackしない。非同期の素材処理をまたいでライブ参加者の状態を巻き戻すこともない。

ZIP全体と展開後の合計は512 MiB、1ファイル128 MiB、manifest 4 MiB、エントリー数4,096を上限とする。素材ごとの既存制限も維持する。fflate 0.8.3のZipPassThroughを使った無圧縮ZIPを小さい単位で書き出す。読み込みは検査したmemberの範囲を使い、Inflateへ渡すデータと実出力量を制限する。素材に含まれるPKバイト列をZIPの境界と誤認しない。ハッシュ計算とZIP処理の途中でイベントループへ制御を戻す。

Gaussian素材の検査も、PLY／SPZの全点を1,024点ずつ確認する非同期経路を使う。同期APIと同じ検査処理を共有し、gzip／zstdはnode:zlibの非同期APIで展開する。ASCII PLYは全行を一括で生成せず、1行ずつ検査する。描画中のサーバー更新を長く止めないための変更であり、大きなメモリコピーなどの短い停止までなくす保証ではない。

## HTTP API

| API | 入力 | 結果 |
|---|---|---|
| GET `/api/environment` | なし | 設定世代、プレビューの有無、上限 |
| POST `/api/environment/export` | JSON: theme、expectedRevision、expectedGeneration | ZIPダウンロード |
| POST `/api/environment/inspect` | multipart: archive | 内容の概要、ZIPのSHA-256、確認時のrevisionとgeneration |
| POST `/api/environment/import` | multipart: archive、sha256、expectedRevision、expectedGeneration | 適用結果、テーマ、新しい世代 |

設定競合・接続先変更・確認後のZIP変更は409、サイズ超過は413、形式や素材の問題は422、画像取得失敗は502、処理中の追加要求は503を返す。SQLiteの書込み失敗は500で返し、設定変更を戻す。入力の例外本文やローカルパスをそのまま応答しない。

## 採用しなかった案

| 案 | 採用しなかった理由 |
|---|---|
| 設定JSONのみ | 素材の依存関係を受け取り側で復元できない |
| dataディレクトリ全体の共有 | 未使用素材や過去のセッションまで含み、現在の環境の共有範囲を超える |
| 保存Discord画像をライブ側でも優先 | Discordでの画像更新と削除を反映できなくなる |
| アバター画像の定期照合 | ライブ画像は現在のDiscord情報で選べるため、保存プレビューとの同期は不要 |
| 復元のためにライブ参加者を置換 | 実際の通話入力と表示確認が混ざる |
| 同期的なZIP一括圧縮 | 大きな素材でサーバーのイベント処理を止める時間が増える |

## 検証

`environment-package.test.ts`は空の保存先への復元、元IDと相対参照、前後画像、3DGSの別調整、ハッシュ・依存関係・描画予算の不正を検査する。`environment-archive.test.ts`はZIPのヘッダー不整合、CRC、展開量偽装、処理中のyieldを検査する。

`environment-service.test.ts`は設定と座席の保存、SQL途中失敗、別プロセスとの競合、素材処理中のcontext変更、未接続再起動後の書き出しを検査する。`environment-api.test.ts`は実HTTP／WebSocketでライブとプレビューを分け、同じ人物のアイコン更新と削除が保存画像に置き換わらないことを確認する。Playwrightは実ZIPと実Overlayで移行操作を確認する。

実Discordの認可や画像イベント配送、WindowsのOBS、最大容量の全組み合わせは検証済みとは扱わない。最新HEADのCIと実環境での受け入れを別に確認する。

## 参照

- [Discord Image Formatting](https://docs.discord.com/developers/reference#image-formatting)
- [fflate公式README](https://github.com/101arrowz/fflate#readme)とインストール済み0.8.3のZip／Inflate実装
- [Three.js LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)と0.187.0のGLTFLoader
- [ADR 0027: 保存と設定操作](0027-durable-settings-and-command-transactions.md)
