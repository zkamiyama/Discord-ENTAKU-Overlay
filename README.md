# Discord ENTAKU Overlay

Discordの通話参加者を中空の会議テーブルに配置し、発話に合わせて映像を切り替えるOBS用ローカルアプリです。Bun＋TypeScript＋Three.jsで実装しています。

**0.1.0-rc.2（リリース候補）**。席管理、自動カメラ、画像アバター、スタジオ編集、診断・イベント再生、Windows向け単独exeを実装しました。実Discord通話・OBS本体での受け入れ試験、署名、互換認証経路の公開配布条件の確認は完了していません。安定版としては扱いません。

## Bunを入れずに使う

GitHub Actionsの成功したCI実行から、`entaku-windows-development`アーティファクトを取得します。アーティファクト内の配布ZIPをすべて展開してください。`ENTAKU-Overlay.exe`だけでも標準ページと素材を配信できます。設定とカスタム素材は隣の`data/`へ保存します。

`ENTAKU-Overlay.exe`の通常起動はデモです。開いたDockで「発話 ON」を押すと緑の縁が反応し、継続発話でカメラが切り替わります。Discord認証を自動的に始めることはありません。

Discordへ接続する場合はデモを終了してから`Start-Live.cmd`を起動し、表示される互換認証の説明を読んで承認します。認証にはStreamKitのアプリ識別子とトークン交換先を利用します。独自アプリへの正式な利用承認ではありません。要求するのは`rpc`と`rpc.voice.read`です。音声の受信・録音・文字起こし・ミュート操作はしません。

OBSには、Dockの「OBSブラウザソースのURL」を1920×1080のブラウザソースとして登録します。操作用にはDock URLをカスタムブラウザドックに登録します。ページはそれぞれ`http://127.0.0.1:31337/overlay`と`http://127.0.0.1:31337/dock`です（ポート変更時はポートを読み替えます）。詳細は[起動手順](docs/getting-started.md)を参照してください。

## できること

| 機能 | 動作 |
|---|---|
| Discord取得 | IPCの参加者・名前・アイコン・START/STOP。切断時は発話をunknownへ戻して再同期 |
| 席予約 | 最大同時人数と予約人数を別管理。退出で机を縮めず、復帰で同じ論理席へ戻す。上限32席 |
| 可変円卓 | 中空カプセル型の天板・支持壁・台座。人数や画像幅に応じて拡張。椅子なし |
| 自動カメラ | SINGLE／TWO_SHOT／WIDE、短い相槌の抑制、同時発話、近い2人へのSINGLE⇄TWO_SHOTのMOVE、遠い席へのCUT |
| 操作Dock | AUTO、構図固定、人物指定、ワイド、席予約の解放・リセット、判断理由と継続発話時間 |
| カスタム人物画像 | PNG／静止WebP、顔矩形GUI、倍率・位置、独立した背面画像、撮影範囲、3Dプレビュー |
| 発話表示 | 画像のアルファ輪郭に緑の発光。Y軸±30度の追従と背面の減光。距離マップ生成はWorker |
| スタジオ | GLB、GLTF＋関連ファイル、ZIP。床・箱・ライト、モデル配置、円卓基準位置、JSON編集 |
| カメラ制約 | シーンに指定したBox3領域の経路・視線検査。安全な構図がなければ背景を隠して標準ワイド |
| 診断・再生 | 匿名化した発話メタデータの記録・JSONL出力、診断JSON、再生速度・一時停止・シーク |
| 配布 | ランタイムとWeb素材・デコーダーを埋め込んだWindows x64 exe、説明・ソース・ライセンス付きZIP |

[画像アバター](docs/custom-avatars.md)、[スタジオ](docs/studio.md)、[診断と再生](docs/diagnostics.md)に操作方法と制限を記載しています。

## 開発

固定バージョンはBun 1.4.4、Three.js 0.187.0です。依存は`bun.lock`で固定しています。

```sh
bun install --frozen-lockfile
bun run dev
bun run check
bun run test:e2e
bun run build:exe
bun run smoke:exe
```

E2Eを初めて動かす開発環境では`bunx playwright install chromium`が必要です。Playwrightは利用者向けexeへ含めません。Windows ZIPはクリーンなチェックアウトから作ります。

```sh
bun run build:exe -- --windows
bun run package:windows
```

出力は`dist/Discord-ENTAKU-Overlay-0.1.0-rc.2-windows-x64.zip`とその`.sha256`です。`BUILD-INFO.json`にソースのコミット、`SHA256SUMS.txt`に同梱ファイルのハッシュを記録します。署名済みexeではありません。

## 保存と安全性

サーバーは`127.0.0.1`だけに公開します。`/overlay`と`/dock`は固定URLで、キー入力やローカル用認証ファイルは不要です。Hostを検査し、別Originからの更新要求とWebSocket接続を拒否します。同じPCの別プロセスへのアクセス制限は設けません。Discordのアクセストークンはメモリ内だけに保持し、Discord側の認可は従来どおり必要です。

`avatars.json`と`scene.json`は保存成功後に映像へ反映します。編集中のプレビューは本番と別です。席は`data/sessions/`、素材は`data/assets/`へ保存します。アプリを停止してから`data/`をバックアップしてください。人に素材を渡す場合は個人情報を除いてください。

## 検証範囲と残る確認

単体・結合テストではIPCの模擬サーバー、席の永続化、発話・カメラ判断、画像・ZIPの検査、設定保存の失敗、匿名化・再生を検証しています。ブラウザ試験では操作から映像までを接続し、背面の減光は実際の画素で比較しています。単独exe試験はPATHが空の一時フォルダーで実行します。

これらは実Discordの認可成功やOBSのCEF環境の互換性を保証する試験ではありません。仮想時計の2時間テストは、実時間2時間のGPU稼働試験とは別です。詳細は[開発・検証状況](docs/implementation-status.md)と[受け入れ試験](docs/acceptance.md)を参照してください。

Three.jsの機能を優先し、GLTFLoader・LoadingManager・公式デコーダー・OrbitControls・Box3等を利用しています。判断は[ADR](docs/adr/)に記録しています。
