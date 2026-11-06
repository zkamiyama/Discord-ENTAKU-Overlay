# ADR-0001: IPC接続とBunによる状態管理を採用する

- 状態: 一部採用。ローカルの読取・操作キーに関する決定はADR-0006で変更。Discord認証の判断は維持。
- 決定日: 2026-11-06
- 対象: Discord ENTAKU Overlay 初版
- 根拠: 合意済みの実装仕様書 v0.1.0、および操作画面名をDockへ訂正する依頼。

## 背景

Discord通話の参加者をThree.jsの中空会議テーブルへ配置する。発話開始・終了から緑の輪郭表示と自動カメラを制御する。BunがないWindows環境でも実行できる配布物を作る。

安定性は、外部仕様が変わらないという仮定ではなく、責務の分離、再同期、診断、再現可能なテストで確保する。StreamKitとIPCの故障率を比較できる実測値はない。

## 決定

### Discord取得と認証

BunからDiscordのローカルRPCへIPC接続する。WindowsではNamed Pipeを用いる。`IpcTransport → RpcClient → AuthProvider → IpcVoiceProvider`を分離し、ライブ接続は一本にする。音声受信・録音・文字起こしは行わない。

StreamKitのHTMLプロキシ、DOM監視、常駐Playwright、取得経路の自動切替は標準実装に含めない。比較対象としてのStreamKitを排除する判断ではない。

IPCと認証は別の問題である。Discordの`rpc`と`rpc.voice.read`には承認制限がある。StreamKit互換認証は、非公式な互換経路であることとDiscord側にStreamKitとして表示されることを説明し、明示的に有効化した場合だけ使用する。自アプリの正式認証は承認取得後に交換する。互換認証の技術的成功を公開配布の許諾確認とみなさない。

ユーザートークンの貼り付け、Discord内部からのトークン抽出、self-botを使わない。アクセストークンは既定でメモリだけに保持し、ブラウザ、ログ、設定、URLへ出さない。必要な読取スコープだけを要求する。

### OBSページと状態の所有

映像は`/overlay`、操作画面は`/dock`にする。画面名・ソースディレクトリ・型の名称もDockへ統一する。以前の`Deck`と`/deck`は誤記であり、未配布のため互換用の旧ルートは作らない。

参加者、席予約、発話履歴、カメラ判断はBunが管理する。ブラウザはスナップショットを受け取り描画・補間する。Dockを閉じたりOBSソースを再読み込みしたりしてもDiscord接続と席予約を失わない。

HTTPはloopbackだけに公開する。HostとOriginを検証し、読取キーと操作キーを分ける。WebSocketは認証前に参加者データを送らない。

### 席と演出

退出で机を縮めず、Discord IDと論理seatIdの対応をセッション内に予約する。最大同時人数と退出者を含む予約人数を分ける。新規参加者のために必要なら増席する。復帰は同じ論理席への復帰であり、増席後の世界座標まで固定する意味ではない。上限32席を超えた新規参加者は待機扱いとし、既存席を奪わない。

`SpeakerTracker`、`ShotDirector`、`CameraPlanner`を分離する。発話表示は即応し、カメラだけが1秒の実発話、最短ショット維持、短い無音の許容、多人数発話の確認を待つ。切断時は発話をunknownとし、安全なワイドへ戻す。長いSTARTに任意のTTLを適用して偽のSTOPを作らない。

人物は顔アンカーで実寸化し、Y軸だけ±30度追従する。裏面を減光し、画像のアルファ境界を発光させる。机と支持部は中空カプセル形状から生成する。カスタムGLBの見た目とJSONの配置・カメラ制約を分離する。

### 開発・配布

TypeScriptのドメイン処理はDOM・Three.js・Discord接続から独立させる。仮想時計とReplay入力で席とカメラを再現可能にする。Bunの単独実行ファイルに標準Web素材を含め、編集可能な設定・ユーザー素材は外部へ置く。配布単位はexeと外部データをまとめたZIPとする。

実装は検証可能な単位ごとにコミットする。仕様と実装状況を区別し、未実装を完成した機能として記載しない。

## 検討した代替案

StreamKitページ＋DOM監視は、ページ読込、注入コード、DOM、ブラウザ寿命を調査対象に追加する。WebSocket RPC中継はDOM依存を減らせるが、旧経路とOrigin中継が残る。今回は構造化RPCのIPCを選び、認証を独立して検証する。

## 検証条件と再検討

P0ではdoctor CLI、分割フレーム処理、nonce応答、PING/PONG、認証拒否、購読と切断を実装・試験する。Windows実機で2人以上の参加・退出・発話、Discord再起動、Bun未導入環境のexeを確認するまではP0合格としない。

P0の実機確認を待つ間も、Replay経由で席・カメラ・描画を開発できる。認証の失敗を描画側で隠さない。実機未試験、認証経路未確認、署名未実施を明示し、安定版として公開しない。

## 参照

- Discord RPC: https://docs.discord.com/developers/topics/rpc
- Discord OAuth2 scopes: https://docs.discord.com/developers/topics/oauth2
- Bun standalone executables: https://bun.sh/docs/compiler/executables
- 原仕様: Discord Roundtable Studio 実装仕様書 v0.1.0（2026-11-06）。リポジトリへの取り込み時にDock表記へ修正する。
