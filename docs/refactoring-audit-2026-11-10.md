# リファクタリング監査（2026-11-10）

対象：`4225b36`（v0.1.0-rc.15）。この文書は**改善候補の調査結果**であり、列挙したリファクタリングを実装した報告ではない。

## 調べた範囲と判断方法

- `src/`、`scripts/`、`tests/`、`e2e/` のTypeScript **175ファイル・約9,450行**（うち `src/` 約5,855行）を列挙し、行数・依存・例外処理・ポーリング・毎フレーム処理・永続化・テストを横断検索した。
- 主要な処理経路を入口から追った：`cli → IpcVoiceProvider/RpcClient → AppEngine/ShotDirector → Bun server → StudioClient → Dock/Overlay → Three.js`。スタジオ読込は `StudioStore → GLTFLoader → StudioVisual`、設定は `PresetStore/AvatarStore/StudioStore → server → AppEngine` の順に確認した。
- 別の観点として、**正しさ・障害時の整合性**と、**性能・保守性・テスト容易性**を独立に調べ、重複候補をまとめた。根拠を別モジュールとテストで再確認した項目を先に置く。
- `tsc --noEmit --noUnusedLocals --noUnusedParameters` の追加診断も実行した。通常の `bun run typecheck` は成功している。追加診断は「未使用」を指摘するためのもので、現在のCIが失敗しているという意味ではない。
- 以下の「確定」は**ソース上の構造・経路を確認した**ことを表し、実際に利用者の環境で障害が起きたことを意味しない。「要再現」は故障・性能低下の程度をまだ計測していない。安全策として機能を削ることは提案していない。

優先度は **P1：先に着手、P2：段階的に整理、P3：低リスクな後片付け**。見積もりや確定的な不具合件数ではない。

## P1：整合性・復旧性と描画安定性（8件）

### R01 設定保存と実行状態更新を一つの操作単位にする【確定／失敗時影響は要再現】
[`src/server/app.ts:184-194`](../src/server/app.ts#L184-L194) はスタジオ設定や画像プロフィールを**ディスクに保存してから** `AppEngine` に適用する。一方、プリセット適用だけは [`src/server/app.ts:158-177`](../src/server/app.ts#L158-L177) に複数ストアの手動ロールバックがある。保存後の検証・適用が失敗すると、起動中の状態と次回起動時の状態が一致しない可能性がある。提案： 共通の「全検証→変更計画→永続化→状態反映／巻戻し」サービスへ切り出す。確認： 書込成功直後の例外、チャンネル変更、プロセス中断、再起動後の読み戻し。

### R02 GPUレンダーターゲットを所有者と状態遷移で管理する【確定】
`src/web/studio/quality-renderer.ts:16-26,60-82,106-108,142-159,173-184` がWorld・SSR・AO・GI・FXAA・ポスト合成のターゲットを共有し、効果のON/OFF時に個別`dispose()`する。解放済みオブジェクトを参照として残す経路もあるため、仕様切替の再初期化と寸法管理が追いにくい。提案： リソースレジストリ＋明示的な `ensureTarget`／`releaseTarget`／再生成、パスごとの所有権を定義。確認： 画質の全ON/OFF組合せ、解像度切替、分割↔単独、WebGLコンテキスト復旧、`renderer.info.memory`の前後比較。

### R03 実描画の旧スタジオ保持を保証する【確定】
[`src/web/studio/visual.ts:15-37`](../src/web/studio/visual.ts#L15-L37) は新しいモデルの非同期読込に失敗した際、`this.loaded`（前の正常なシーン）も`disposeObject`してしまう。Dockのインポート前検証はあるが、Overlay上での後段のテクスチャ・GPUエラーまで防げるわけではない。提案： 新シーンを別グループで完成するまで表示を切り替えず、エラー時は旧シーンを維持し、ユーザーへ失敗を通知。確認： 読込途中の失敗、遅延読込の競合、読み込み成功後の旧素材解放。

### R04 RPCイベントハンドラーの失敗を接続全体へ伝搬させない【経路は確定／発生は要再現】
[`src/discord/rpc-client.ts:146-182`](../src/discord/rpc-client.ts#L146-L182) は`DISPATCH`の全リスナーを一つの`try`内で呼び、**任意のリスナー例外でIPCを閉じる**。チャット側は内部で例外を吸収しているが、将来の診断用リスナーやUIイベントが接続全体を落とす可能性がある。提案： フレーム解読エラーと各リスナー例外を分離し、非必須リスナーの例外を隔離して安全な診断コードを出す。確認： 1つのリスナーがthrowしても発話・VC購読が続くこと。プロトコル破損では従来どおり切断すること。

### R05 GET_CHANNELの単発失敗とIPC再認証を切り離す【確定／許容回数は要設計】
`src/discord/ipc-voice-provider.ts:63-68,103-109` は15秒ごとの参加者再同期で`GET_CHANNEL`が一度失敗すると`client.close()`し、接続全体の再試行へ進む。提案： 一時的な読み取り失敗と選択VCの変化・認証切れを分類し、短時間の再試行、鮮度表示、致命的な切断を分ける。確認： 1回／連続失敗、VC移動、切断、Chatは失敗しても発話情報を維持。

### R06 依存するThree.js addonの内部実装をラップして境界を明示【確定】
`src/web/studio/quality-renderer.ts:118-125,129-141` は`SSRPass.ssrMaterial.fragmentShader`を書き換え、`metalnessRenderTarget`など内部ターゲットへ直接アクセスする。`src/web/studio/post-renderer.ts:33-39,65-71` は`BokehShader.fragmentShader`の文字列置換と`UnrealBloomPass.renderTargetsHorizontal[0]`を使う。バージョン0.187.0ではテスト済みでも、**アップグレード時に壊れやすい箇所**。提案： addonの使用箇所をアダプターへ局所化し、Three.js更新時のShader差分チェックと画素回帰を必須化。標準APIだけで可能な経路を毎回先に確認する。確認： 現行版での同一ピクセル・透明度・深度と、次版候補の互換性。

### R07 WebSocket再接続の所有権・古いイベントを隔離【経路は確定／競合は要再現】
[`src/web/shared/client.ts:23-53`](../src/web/shared/client.ts#L23-L53) の`connect()`はソケットの世代番号を持たず、遅延した旧ソケットの`onclose`が新ソケットの`connected`や再接続タイマーへ影響する余地がある。提案： 現行ソケットのidentity確認、世代管理、接続解除メソッド、単一の再接続タイマー。確認： 開閉の順序入替え、Dock再読込、ネットワーク揺らぎ、同時接続上限。

### R08 描画効果の例外処理に再試行と限定フォールバックを設ける【確定／影響は要測定】
`src/web/studio/quality-renderer.ts:87-90,165-170` は効果のエラーを`failed`に固定し、設定値が変わるまで直描画へフォールバックする。原因が一時的なGPU資源やターゲットサイズなら、回復しても復帰しない。提案： エラー分類、低解像度・低品質への段階的退避、復帰を制御する状態遷移と診断を追加。確認： WebGLリソース不足・context loss・SSR失敗から回復するケース。

## P2：処理境界・性能・UI（16件）

### R09 Bunサーバーをルーター・コマンド・同期配信に分割【確定】
[`src/server/app.ts:36-284`](../src/server/app.ts#L36-L284) はHTTP、資産取込、プリセット適用、状態変更、WebSocket、診断を1クロージャーに持つ。提案： `routes/{assets,studio,presets,commands,diagnostics}`、`command-service`、`snapshot-publisher`へ分け、バリデーションとエラーコードを共通化。確認： 既存のOrigin/Host・競合・冪等性テストを各APIに引き継ぐ。

### R10 AppEngineの責務を段階的に分離【確定】
[`src/domain/engine.ts:25-332`](../src/domain/engine.ts#L25-L332) は参加者、席予約、姿勢・素材サイズ、撮影判断、プリセット、永続化対象スナップショットを兼ねる。提案： `MembershipState`、`SeatLayoutCoordinator`、`CameraCoordinator`、`SessionState` をまず純粋関数で切り出し、既存の`AppEngine` APIは維持。確認： 退出復帰・増席非縮小・司会変更・トランジションの回帰。

### R11 撮影判断の理由文字列を型付き状態へ【確定】
[`src/domain/shot-director.ts:1-215`](../src/domain/shot-director.ts#L1-L215) では`reason`、`pending`、`bridge`、`crowdWide`、`splitWeakAt`等が組み合わさり、[`src/web/dock/direction-panel.ts:18-20`](../src/web/dock/direction-panel.ts#L18-L20) は理由の文字列末尾で「終了確認」を判定している。提案： `START_PENDING`／`END_CONFIRMING`／`END_GRACE`／`STABLE`等の判定状態と絶対期限を型で公開し、Dockは`reason`の文言を解析しない。確認： 1.5秒START、2.5＋5秒STOP、主話者窓、第三者・分割・手動優先。

### R12 毎フレームの重い構図検査と文字列化を減らす【確定／CPU効果は要測定】
[`src/domain/engine.ts:239-270`](../src/domain/engine.ts#L239-L270) から`src/domain/camera-planner.ts:33-82,128-145,162-225`へ多くの幾何計算が呼ばれる。`canSplit`内の`JSON.stringify([layout,byUser,extents,...])`も判定ごとに行う（`engine.ts:258-264`）。提案： 世代番号に基づく構図キャッシュ、入退室・画像変更・設定変更時だけ再計画し、発話tickでは集計値だけ更新する。確認： 4〜32席×大画像、カメラ可視性、CPU計時、キャッシュ無効化。

### R13 発話統計の窓集計を一度で行う【確定／必要性は計測】
[`src/domain/speaker-tracker.ts:70-105`](../src/domain/speaker-tracker.ts#L70-L105) と[`src/domain/engine.ts:321-330`](../src/domain/engine.ts#L321-L330) は同じ発話区間を`stats`／`intervals`で複数回走査する。提案： あるtickの`SpeechWindowSnapshot`を作り、撮影判断・Dock表示・分割判定で再利用する。確認： 3〜30秒窓と無音除外、境界の半開区間、リアルタイム負荷。

### R14 状態全量を定期送信する頻度を見直す【確定／通信量は要測定】
`src/server/app.ts:59-70,275-278` は50ms tickで、およそ100msごとに`engine.snapshot()`を作成して全クライアントへ送る。`send()`はソケットごとにJSON化し、`journal.state()`にも別スナップショットを使う。提案： 1tickのシリアライズを共有し、seq変更時は全量または差分、時計だけの更新は軽量イベントにする。確認： 8接続・32人・1秒当たりのバイト数、カメラの補間連続性、再接続時のスナップショット。

### R15 Shadow/SSR用のシーン走査をキャッシュ【確定／GPU/CPU効果は要測定】
`src/web/studio/quality-renderer.ts:29-58,110,130-135` で影の境界Box3や反射対象候補を毎フレーム更新し、影マップの`needsUpdate=true`も毎回設定する。提案： 机形状・スタジオ・ライトの変更世代に応じて更新し、静止中の影再生成とメッシュ全走査を省く。確認： カメラMOVE、増席、GLBライト変更、影境界の見た目、実GPU fps。

### R16 Overlayの状態・人物・カメラ・描画を分離【確定】
[`src/web/overlay/main.ts:1-190`](../src/web/overlay/main.ts#L1-L190) はWebSocket状態、画像ロード、Avatarのライフサイクル、座席アニメーション、カメラ、ポスト処理を1つのフレーム関数に持つ。提案： `AvatarLayer`／`CameraPresenter`／`StagePresenter`／`RenderCoordinator`に分離して依存注入。確認： CUT直後の向き、±30°制限、人物の露出除外、机による遮蔽。

### R17 合成パスの色空間とレイヤーの契約を明文化【確定】
[`src/web/studio/post-renderer.ts:46-78`](../src/web/studio/post-renderer.ts#L46-L78) と`quality-renderer.ts:149-163` でlinear/sRGB、透過、被写界深度、人物の除外と深度復元を複数段で扱う。提案： 各パスの入力/出力を`linear HDR`・`display sRGB`・premultiplied alpha・depth等で定義した小さなパスグラフにし、保存／復元を共通化。確認： 白飛び、unlitロゴ、FXAA、DoF境界、透過ピクセル、人物色一致。

### R18 Dockの設定パネルを共通フォームに【確定】
`src/web/dock/{quality,post,direction,exposure}-panel.ts` が各々`busy`、入力取込、`studio-set`送信、エラー表示を複製する。`post-panel.ts:20-24`や`quality-panel.ts:28-32`は送信後に全inputを無条件で有効化する。提案： 値の型付きフィールド定義、`saveStudioPatch`、処理前のdisabled状態復元、REVISION_CONFLICT再同期を共通化。確認： 連続操作・無効欄・プリセット復元・Dockリロード。

### R19 数値コントロールの常時ポーリングを廃止【確定】
[`src/web/dock/numeric-controls.ts:18-45`](../src/web/dock/numeric-controls.ts#L18-L45) はMutationObserverで全数値欄をスキャンし、150ms間隔でスライダー同期する。加えて`direction-panel.ts:13-21`の100ms、`exposure-panel.ts:12-19`の1秒など複数タイマーがある。提案： 設定反映時に明示同期、表示中のカウントダウンだけタイマーで更新。確認： スライダーと手入力の同期・UI折り畳み・非表示DockのCPU負荷。

### R20 DockのHTML/CSSを読みやすい単位へ分割【確定】
`src/web/dock/index.html` は多数の設定フォームがほぼ長い1行に並ぶ。`src/web/dock/style.css` には後から上書きするルール群・複数のモバイルメディアクエリがある。提案： テンプレートの意味単位をファイル分割、スタイルを`base/layout/forms/roster/chat`に整理し、意味のあるclassへ統一。確認： 390/1024/1440px、キーボード操作、チェックボックス位置の画素差分。

### R21 カスタムアバター編集の画像処理と画面イベントを分ける【確定】
`src/web/dock/avatar-editor.ts:20-52,120-175` は画像アップロード、顔矩形のポインタ操作、3Dプレビュー、保存、GPUリソースを兼ねる。提案： `image-draft`・`selection-geometry`・`preview-controller`・`persistence`に分離。確認： 続けて画像を選ぶ、キャンセル、背面編集、非同期プレビューの競合。

### R22 ZIP/GLTF検証を安全性の責務ごとに分類【確定】
[`src/studio/gltf.ts:18-70`](../src/studio/gltf.ts#L18-L70) はパス・依存URIの検査、`src/studio/store.ts:20-53,75-109` は展開上限と保存、[`src/web/studio/loader.ts:11-52`](../src/web/studio/loader.ts#L11-L52) はGLTFLoader・デコーダーを扱う。提案： 不正入力・安全な相対参照・資源制限をアプリ側に残し、glTF構文解釈は引き続きThree.js公式に委譲。ZIP展開と読込テストを独立。確認： パストラバーサル、重複パス、外部URL、上限、ドット相対参照、DRACO/KTX2/GLB。

### R23 スタジオ読込時の二重WebGL・資産ロードを減らす【確定／効果は要測定】
[`src/web/dock/studio-panel.ts:24-33`](../src/web/dock/studio-panel.ts#L24-L33) がインポートの検証だけのために一時`WebGLRenderer`を作り、`src/web/studio/loader.ts`でGLBと全関連画像を読み、その後Overlayも別途ロードする。提案： サーバー側の静的検証とOverlay側の実描画チェックの責務を明記し、追加のWebGLコンテキストを使う場面を限定。確認： テクスチャ不足、読み込み失敗時の旧背景保持、OBS DockのWebGLコンテキスト上限。

### R24 データ保存の共通原子的書込と起動時検証【確定】
[`src/assets/store.ts:80-94`](../src/assets/store.ts#L80-L94)、[`src/studio/store.ts:144-157`](../src/studio/store.ts#L144-L157)、[`src/presets/store.ts:43-55`](../src/presets/store.ts#L43-L55)、`src/domain/session-store.ts` に類似した一時ファイル・rename・backup・メモリ反映が点在する。提案： `atomicJsonWrite`、schema validator、復旧手順の共通化（Windowsのrename・バックアップ挙動も検証）。確認： 書込中断、設定破損、読み込めないバックアップ、アクセス拒否。

## P3：小規模改善・開発体験・負荷測定（8件）

### R25 利用していない引数と関数を除去【追加静的診断で確認】
`camera-planner.ts:106` の`cross`、`camera-planner.ts:162` の`planCamera.capacity`、`overlay/main.ts:19` の`TABLE`が未使用。テスト側でも`camera-composition.test.ts`、`camera-rc9.test.ts`、`presets.test.ts`に各1件ある。提案： 呼び出し側まで整理し、追加の未使用検査をCIの任意ジョブへ。

### R26 ファイル一覧の都度読み込みをインデックス化【確定／効果は要測定】
`src/presets/store.ts:11-16,28-33` は一覧要求ごとに最大256個のJSONを逐次開く。Dock側の`preset-panel.ts:20,36`は5秒周期で更新する。[`src/assets/store.ts:51-55`](../src/assets/store.ts#L51-L55)は画像アップロードごとに既存ファイルのstatを繰り返す。提案： ディレクトリ世代と変更検知による軽量一覧、容量カウンタの整合性チェック。確認： 大量プリセット、手動ファイル変更、破損、複数回保存。

### R27 型付きコマンドとエラーコードを共通契約へ【確定】
[`src/server/app.ts:141-225`](../src/server/app.ts#L141-L225) では`Record<string,unknown>`を文字列`type`で分岐し、[`src/web/shared/client.ts:56-62`](../src/web/shared/client.ts#L56-L62)や各Dockパネルも似たリクエストを手で構築する。提案： `Command`判別共用体とバリデータを境界に置き、UI側でも型安全に生成。確認： 不明コマンド、revision競合、同じrequestIdの再試行。

### R28 スナップショットとUI差分の更新範囲を絞る【確定／効果は要測定】
[`src/web/dock/main.ts:82-125`](../src/web/dock/main.ts#L82-L125) は受信ごとに人物情報と席表示を走査し、発話集計も`find`を繰り返す。提案： userIdで索引化し、人数/発話状態/レイアウトの変化だけDOM更新する。確認： 32人・発話イベント多数・Dockの再描画負荷、メニュー操作中のフォーカス。

### R29 大規模E2Eの所要時間とGPU変動を分ける【確定】
`playwright.config.ts:3-7` はsoftware WebGL・ワーカー1で全E2Eを実行する。画素回帰は必要だが、全変更の必須経路は重い。提案： 純粋な状態テスト、UI、レンダラ画素、実GPU/OBS受け入れを分けて、CIで軽量スモークと全描画テストの両方を維持。確認： 分割したスイートを同じコミットで走らせ結果を照合。

### R30 パフォーマンスの基準を用意【未測定】
[`src/web/studio/split-renderer.ts:15-42`](../src/web/studio/split-renderer.ts#L15-L42) は2カメラ分のレンダリングと後処理を行う。`quality-renderer.ts:110-148`と組み合わせると8灯PCF・AO・SSRの負荷が大きい。提案： 6/16/32席、1080p60、通常/分割、標準/高画質のp50/p95フレーム時間、GPUメモリ、描画回数を計測し、自動品質低下は測定してから設計する。

### R31 ドキュメント／起動時ヘルプの矛盾を検査【一部対応済み】
従来のREADMEはRCの履歴から始まり、[`src/cli-options.ts:51-56`](../src/cli-options.ts#L51-L56) は「voice metadata only」と表記する一方、現行アプリはVC-CHAT本文を読む。**今回のREADME・起動用ヘルプ・Start-Live.cmdは説明を修正済み**。今後は初心者向けREADME、`docs/getting-started.md`、`--help`、コマンドファイルの用語を一致させる静的チェックを追加。

### R32 配布と更新を利用者向けに安定化【確定】
`.github/workflows/ci.yml:24-37` はCIアーティファクトを14日間だけ配布し、Windows ZIPをその中に入れる。提案： Discord/OBS実機受け入れと配布条件の確認後に、リリースノート付きGitHub Release、検証用SHA-256、移行注意を一箇所で提示する。新しいセキュリティ境界を設ける話ではない。

## この監査で候補から外したもの

- **E2Eがテスト間でサーバー状態を共有する説：** `e2e/fixtures.ts:5-26` は各テストが独立したin-memoryサーバーを持つ。以前の残存ログとは異なるため、現行コードには当てはめない。
- **Three.jsに標準GLTFLoaderがない説：** `src/web/studio/loader.ts:3-5,31-51` で公式`GLTFLoader`、`LoadingManager.setURLModifier()`、公式デコーダーを使用している。依存URIの安全検査はアプリの責務なので削除しない。
- **全てのJSON.stringifyが悪い説：** 設定差分やプリセット署名には適切な利用がある。毎tick/各ソケットの重複処理のみ計測対象にした。
- **ローカルアクセスキーがないのはバグという説：** 意図された設計判断（`docs/adr/0006-remove-local-access-keys.md`）。不用意に認証を再導入しない。

## 推奨する実装順序

まず **R01・R03・R04・R05・R07** の障害時の状態と接続を固める。次に **R02・R06・R08・R17** の描画パスを整理し、色・影・深度の画素試験を先に固定する。続いて **R09・R10・R11・R27** のAPIと状態の責務を分け、最後に **R12〜R16・R18〜R30** を測定しながら進める。

各PRは1つの境界に限定する。**振る舞いを変えない抽出→既存回帰→失敗注入／性能基準→振る舞いの変更**の順を推奨する。特に認可・Discord IPC・Three.jsのアップデートは別PRとし、同時に切り替えない。

## 検証済みと未検証の線引き

本調査では通常の`bun run typecheck`と未使用コードの追加検査を行った。RC.15の従来の単体・結合201件、ブラウザ49件の成功は`docs/implementation-status.md`に記録されている。今回、個々の候補の障害注入や実GPU/OBSの長時間負荷測定までは行っていない。**P1という順位は危険度の仮説を含み、既知の故障の認定ではない。**
