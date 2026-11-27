# アーキテクチャの現状

対象は[PR #6](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/pull/6)、ブランチ`fix/entaku-stability-performance-audit`。この文書と同じコミットの実装を説明する。mainと配布済みの実行ファイルへの反映は、PRとリリースの状態で確認する。

最新HEADの検証結果は[PRのChecks](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/pull/6/checks)を参照する。過去の合格を新しいHEADへ流用しない。[2026-11-27の引き継ぎ](handoff-2026-11-27.md)はa160eac／67bac9e時点の記録として保持する。

## 構成

| 層 | 主な所有者 | 役割 |
|---|---|---|
| 通話入力とドメイン | Discord provider、AppEngine | 参加者、発話、席、カメラ計画を更新する。席のない退出者の履歴を解放する |
| 設定操作 | WorkQueue、SettingsService | 受付数と要求の寿命を管理し、素材検証後に状態変更と保存を実行する |
| 保存 | SettingsStore、SessionWriter | SQLiteへ設定と現在の座席を同時に保存する。通常の座席保存はチャンネルごとの最新変更へまとめる |
| 素材 | AvatarStore、StudioStore、PresetStore | 内容で識別する素材、named preset、インポート検査を扱う |
| 状態通信 | StatePublisher、StateReceiver、StudioClient | 全状態と差分を検証し、欠落時に再同期する。古い接続からの応答を反映しない |
| 表示状態 | OverlayScene、ScenePresentation、StudioVisual | 完成済みのスタジオとカメラを組み合わせ、参加者・発話を継続更新する |
| 資源 | ResourceCache、StudioModelRegistry、AlphaFieldQueue | 共有参照、所有者による取り消し、遅れて完了した資源の破棄を扱う |
| 描画 | ProgramRenderer、GaussianRuntime | 世界座標の影・反射対象を共有し、視点ごとのLoD・ソート・描画先を管理する |

ライブラリは既存のThree.js 0.187.0、Spark 2.4.0、fflate 0.8.3を使用する。保存にはBun 1.4.4標準の`bun:sqlite`を採用し、npmの実行時依存は追加していない。[ADR 0026](adr/0026-state-stream-and-resource-ownership.md)、[ADR 0027](adr/0027-durable-settings-and-command-transactions.md)、[ADR 0028](adr/0028-render-generation-and-screen-halo.md)に判断と代替案を記録した。

## 障害時の動作

差分の連番が途切れた場合は最後の確定状態を残し、全状態を要求する。同期が戻るまで編集コマンドは送らない。接続の置換で古いHTTP要求とハンドラーを終了し、成功したか不明な変更操作を自動再送しない。最初の状態を待つ間はSTATE_WAITING、同期を失った場合はSTATE_STALEを報告する。

変更操作の受付上限は実行中を含め8件。待機中の要求が取り消されたら受付枠を解放する。すでに始まった保存操作はcommitまたはrollbackまで完了させる。競合はHTTP 409、書込み失敗は500、入力や素材の検証失敗は422で返す。停止時も実行中の変更と最後の座席保存を待つ。

スタジオの候補が失敗しても、完成済みの表示とカメラ計画を保持する。同じ設定のスタジオ読み込みと画質処理は500ms、2,000ms後に最大2回再試行する。画像workerは64件の受付上限と15秒のタイムアウトを持ち、実行中の処理を取り消した場合はworkerを終了する。GLBなどの取り消せないデコーダー処理は、遅れて完了した資源を破棄する。

3DGSは元の大きさのSplatから発話マスクを作り、画面上の距離計算で外側グローを生成する。新しい視点はLoDとソートの準備を進め、初回から描画予算内の選択を使う。分割画面では各描画先の実画素viewportを復元する。[描画パイプライン](render-pipeline.md)と[発話グロー](gaussian-speech-glow.md)に詳細を記載する。

## データの移行

可変設定と座席セッションの保存先は`data/settings.sqlite`。初回だけ`scene.json`、`avatars.json`、`preset-state.json`、`sessions/demo`、`sessions/ipc`を検証して取り込み、元ファイルは保持する。素材とnamed presetはそれぞれの既存フォルダに残る。バックアップするときはアプリを終了し、素材を含む`data/`全体を保存する。

設定世代と座席行のversionで別プロセスの上書きを検出する。設定変更で現在の座席も変わる場合は、同じSQLiteトランザクションで保存する。保存失敗時はカメラ計画やrevisionを含むAppEngineの状態も戻す。通常の座席保存は変更内容と設定世代の確認を分け、設定だけの変更で保存済みの全チャンネルを書き直さない。

初回DBは完全に作成・closeした一時ファイルをhardlinkで公開する。hardlinkを使えないファイルシステムではSETTINGS_PUBLISH_FAILEDで停止し、移行候補と旧データを残す。公開済みDBの破損や未知のschemaを検出した場合は起動を失敗させ、旧JSONへ暗黙に戻さない。初回公開後のdirectory fsyncは実装していないため、初回の電源断耐性を検証済みとは扱わない。

## 検証

| 対象 | 自動試験の範囲 |
|---|---|
| 保存・再起動 | 一度だけの移行、元JSONの保持、別プロセスとの競合、設定と座席の同時保存、SQL途中失敗、強制終了からの復旧 |
| 通信 | 不正な全状態・差分、連番の欠落、旧接続の遅延イベント、編集要求の取り消し、受付上限、停止処理 |
| 資源と非同期処理 | 最後の参照解放、古い候補の取り消し、遅れた成功・失敗、worker異常・タイムアウト、描画状態の復元 |
| 長時間のドメイン更新 | 16話者、仮想2時間の更新。有限のカメラ値、席予約、診断履歴の上限 |
| ブラウザ描画 | 初期状態待機、GLB発話停止、Gaussianの発話・遮蔽・複数話者、分割の逆向き視点、CUT、リサイズ、描画予算、ポストエフェクト |
| 配布 | Linux／Windowsで型検査・単体結合・実行ファイルビルド・起動確認。WindowsでZIP作成と内容検証 |

保存までを反映したae208c2の[CI](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/actions/runs/46028554489)はLinux／Windowsそれぞれ393テスト、実行ファイルのビルド、SQLite保存・再起動のsmokeに成功した。Windowsの配布ZIP検証も成功した。この記録より後のGaussian変更を含む結果は、同じHEADのChecksで確認する。

この作業環境はAF_UNIXを作成できず、ローカルのIPC模擬試験12件がソケット作成時点で失敗した。Linux／WindowsのCIでは同じ試験が成功している。環境制約のためのskipやテスト上限の緩和は追加していない。

実GPU、実際のDiscordデスクトップアプリ、WindowsのOBS/CEF、長時間の実配信は未検証。仮想時間の試験は実時間でのGPU資源やOBSの出力fpsの測定ではない。

## 性能の確認

状態同期は`bun run bench:state`で全状態との一致とJSONの転送量を比較できる。3DGSの発話グローは同じ合成人物・視点・選択Splat数で、描画後のreadPixels完了までを含めて比較した。条件と生の値は[比較記録](measurements/architecture-refactor.json)に保存する。フレーム送信だけの時間をGPU完了時間として扱わない。

発話グローの同じ条件は`bun run bench:gaussian-speech --software`で再実行できる。比較対象のcheckoutを使う場合は`--repository`、出力先は`--output`で指定する。実GPUを測る場合は`--software`を外す。ソフトウェア描画を検出した場合は、その実行を実GPUの測定として保存せず停止する。

SwiftShaderによる単一条件の比較は、そのソフトウェア描画環境での結果である。実GPUのfps、ネットワーク圧縮後の転送量、実配信全体の改善率へは置き換えない。

## 再実行

```sh
bun install --frozen-lockfile
bun run check
bun run build:exe
bun run smoke:exe
bunx playwright install chromium
bun run test:e2e
bun run bench:state
```

Windowsでは続けて`bun run package:windows`と`bun run verify:package`を実行する。Linux上のPlaywrightにOS依存ライブラリが不足する場合は、CIと同じ`bunx playwright install --with-deps chromium`を使う。

変更を反映するときは最新のリモートHEADを確認し、GitHub Pluginでコミットを作成してexpected_sha付きでブランチを更新する。実装、試験、設計文書を同じHEADで照合する。
