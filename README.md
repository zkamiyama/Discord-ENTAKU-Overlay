# Discord ENTAKU Overlay

Discord通話の参加者をThree.jsの中空会議テーブルに配置する、Bun＋TypeScript製のOBS向けローカルアプリです。

**現在は開発版です。** Discordなしで動くデモ、IPC取得処理、席予約、自動カメラ、OBS用の2ページ、単独実行ファイルのビルドを実装しています。実Discord通話とOBS本体での受け入れ試験は未完了です。完成版・安定版としては公開していません。

## まずデモを動かす

開発環境ではBun 1.4.4を使います。

```sh
bun install --frozen-lockfile
bun run dev
```

コンソールに表示されるDock URLをブラウザで開きます。自動起動を止める場合は次のように実行します。

```sh
bun run build:web
bun run src/cli.ts --demo --no-open
```

Dockで人物の「発話 ON」を押すと緑の縁が点灯し、約1秒の継続発話でカメラが反応します。3人を同時に発話させるとワイドへ切り替わります。最短ショット維持や机の伸長中は、切替条件を満たしても待機します。理由と待機時間はDockに表示します。

「退出」で席予約を残し、「復帰」で同じ論理席へ戻せます。新規参加者を追加すると、必要な場合だけ机を広げます。退出だけでは机を縮めません。

## OBSへの登録

映像ページは`/overlay`、操作ページは`/dock`です。起動コンソールのURLには、それぞれ異なるローカルアクセスキーが付いています。

1. OBSにブラウザソースを追加し、Dock内の「OBSブラウザソースのURL」を設定します。初期サイズは1920×1080です。
2. OBSのカスタムブラウザドックに、コンソールのDock URLを設定します。
3. 配信終了後はアプリのコンソールでCtrl+Cを押して終了します。

ブラウザソースやDockを再読み込みしても、Bun側の席・カメラ状態は維持します。アプリを終了するとローカルページへの接続も終了します。

URLのキーは表示・操作の権限です。URLや`data/access-keys.json`を配信画面・ログ共有・Gitへ含めないでください。サーバーは`127.0.0.1`にだけバインドします。既定の31337番ポートが使われている場合は、他のプロセスを停止せず、`--port 31338`などを指定します。

## Discordとの接続を検証する

通常の起動はデモです。Discord認可を勝手に開始しません。診断も既定では接続・認可を行いません。

```sh
bun run doctor
```

自分のアプリIDでIPCのハンドシェイクだけを試す場合は、`--doctor --client-id YOUR_APPLICATION_ID`を使います。これは音声情報への認可を取得する操作ではありません。

ライブ接続は、認証条件を理解したうえで次のコマンドを明示的に実行します。

```sh
bun run build:web
bun run src/cli.ts --live --compat-auth --accept-streamkit-compat
```

この互換経路は独立して承認されたDiscordアプリではありません。認証にStreamKitの識別子とトークン交換先を利用し、Discord側にStreamKitとして表示されます。`rpc`と`rpc.voice.read`だけを要求し、トークンはメモリだけに保持します。音声の受信・録音・文字起こし・ミュート操作は行いません。拒否や期限切れの場合は状態をDockに表示し、再認可の無限ループを避けます。

公開配布の利用条件確認と実機試験は別の完了条件です。互換認証の技術的成功だけで、これらを完了したとは扱いません。詳しくは[ADR-0001](docs/adr/0001-architecture-and-delivery.md)と[受け入れ試験](docs/acceptance.md)を参照してください。

## Bunなしで起動する開発用exe

開発用ZIPはGitHub ActionsのCIが成功するとWindowsアーティファクトとして保存します。GitHub Releasesの安定版ではありません。展開後、`ENTAKU-Overlay.exe`を起動するとデモのDockを開きます。利用者側にBun、Node.js、ブラウザ自動化環境は不要です。

ソースから作る場合は次を実行します。

```sh
bun run build:exe -- --windows
bun run package:windows
```

出力は`dist/ENTAKU-Overlay.exe`と`dist/Discord-ENTAKU-Overlay-0.1.0-dev.1-windows-x64.zip`です。ZIPには実行ファイル、アプリの追跡済みソース、ライセンス通知、SHA-256一覧を含めます。ユーザーデータや認証情報は含めません。exeは未署名です。OSの保護機能を無効化する操作は推奨しません。

設定・席予約はexeと同じ場所の`data/`へ保存します。書き込みできない場所では、`--data-dir DIRECTORY`で保存先を指定してください。`--safe-mode`は既存設定を変更せず、メモリ内の新しい状態で起動します。フォントはOSにインストールされたものを使用し、フォントファイルは配布物に含めません。

## 実装範囲

| 項目 | 現在の状態 |
|---|---|
| IPCフレーム・nonce・PING/PONG・明示同意の認証・イベント正規化 | 実装済み。模擬IPCで検証。実Discordは未検証 |
| 最大同時人数と予約人数の分離・退出時の配置維持・32席上限 | 実装・テスト済み |
| JSONセッション保存・前版バックアップ・破損時の停止 | 実装・テスト済み |
| `/overlay`と`/dock`・読取／操作キー・編集revision | 実装・ブラウザE2E検証済み |
| 中空の机・支持部・台座・円形アイコン・名前プレート | 初期実装済み。机は固定トポロジーのバッファを更新 |
| Y軸±30°・裏面減光・円形アイコンの発話リング | 初期実装済み |
| 発話時間・短い相槌・同時発話・SINGLE／TWO_SHOT／WIDE | 実装済み。標準シーンでの保守的なMOVE判定 |
| カスタムPNG／WebP登録・顔矩形GUI・任意アルファ境界のSDFグロー | 未実装 |
| シーンJSON編集・カスタムGLB・障害物を含むカメラ経路 | 未実装 |
| 2時間連続稼働・OBSの表示切替・16人1080p60fps測定・署名 | 未検証／未実施 |

初回の範囲と仕様との差分は[ADR-0002](docs/adr/0002-first-development-slice.md)、次の着手順は[開発状況](docs/implementation-status.md)に記載しています。

## テストと再生

```sh
bun run check
bun run test:e2e
bun run build:exe
bun run smoke:exe
```

E2Eを初めて動かす開発環境では、PlaywrightのChromiumをインストールしてください。`playwright install chromium`を使用します。これは開発用です。利用者向けexeにPlaywrightは含めません。

`smoke:exe`は実行ファイルだけを別の一時フォルダーへコピーし、子プロセスのPATHを空にして、ヘルプ、オフライン診断、HTTP起動、埋め込みWeb素材を確認します。

```sh
bun run src/cli.ts --replay fixtures/basic-conversation.jsonl --no-open
```

JSONL再生は仮想20Hz時計を使います。未対応の設定・シーンを黙って読み飛ばさず、エラーにします。今回のUIは既定の机・アイコン向けで、素材編集や本格的な診断イベントビューアは後続の実装です。
