# VC内蔵チャットのIPC受信プローブ

RC.14以降、通常のDockのVC-CHATは環境変数なしで受信します。このページは明示的な端末診断の説明です。通常表示は[VC-CHAT](rc14-vc-chat.md)を参照してください。

## 目的と範囲

既存の認証済みRpcClientで、参加中のサーバーVC（type: 2）のMESSAGE_CREATEを受信できるか検証する診断機能です。ENTAKU_PROBE_VC_CHAT=1のときだけ有効です。StreamKit互換認証の要求権限はrpcとrpc.voice.readのままで、messages.readなどを追加しません。

この端末診断自体にはBot、メッセージ送信、UI表示、チャットの永続化はありません。通常の参加者・発話取得と同じIPC接続を利用します。プローブの購読拒否、タイムアウト、壊れたイベント、端末出力の失敗で音声取得を停止させません。VCを移動すると既存の再接続処理で新VCへ購読し直します。

## Windowsで実行する

Discordデスクトップアプリを起動し、テスト用のサーバーVCへ参加してください。Bunを使う場合もWindows版を使います。WindowsのDiscordへWSLのUnixソケットから接続する構成ではありません。

PowerShellでリポジトリのフォルダーから実行します。

```powershell
$env:ENTAKU_PROBE_VC_CHAT = '1'
# Discordの設定画面で確認した実際のバージョンを記入します。
$env:ENTAKU_PROBE_DISCORD_VERSION = '実際のバージョン番号'
bun run probe:vc-chat --accept-streamkit-compat --seconds 120
```

バージョン欄は実際の数値等に置き換えてください。省略時はnot-reportedです。RPC READY.vはプロトコル版であり、Discordクライアントの版として扱いません。

BunがないPCでは、同梱のStart-VC-Chat-Probe.cmd、または同じ環境変数を設定したPowerShellから次を実行します。

```powershell
.\ENTAKU-VC-Chat-Probe.exe --accept-streamkit-compat --seconds 120
```

認可画面が表示された場合は、自分で内容を確認してください。互換認証への同意がなければ開始しません。既存のOverlayを起動する入口ではなく、HTTPサーバー、OBSページ、設定ファイルを作らない端末専用入口です。Ctrl+Cまたは指定秒数で終了し、成功条件を満たした場合は早期終了します。秒数は5〜3600です。

通常のENTAKUアプリも、新しいソースでビルドして環境変数を設定すると同じプローブが有効になります。配布済みRC.12のexeに後から機能が増えるわけではありません。

## 操作と成功条件

端末にSUBSCRIBE MESSAGE_CREATE successが出てから、表示されたENTAKU_VC_CHAT_TEST_で始まるテスト文を、別アカウントで同じVC内蔵チャットへ投稿します。自分のアカウントからの投稿では成功と判定しません。

新規イベントを受信した場合、通常モードでは以下の形式でauthor.username、本文、投稿時刻を表示します。author.usernameがなければglobal_nameを使います。時刻はメッセージのtimestampをローカル時刻へ変換したものです。制御文字はエスケープします。

```text
[19:52:01] [VC] tester: ENTAKU_VC_CHAT_TEST_...
[VC-CHAT-PROBE] MESSAGE_CREATE channel_match=true timestamp=... other_author=true test_marker=matched
```

DISPATCH/MESSAGE_CREATEだけを対象にし、data.channel_idを選択中VCのIDと照合します。外側のIDがなければmessage.channel_idを確認し、両方ある場合の矛盾は拒否します。購読開始前のtimestamp、同一セッションの重複イベント、他のVCの投稿は成功条件へ加えません。

PASS_OTHER_ACCOUNT_NEW_TEST_MESSAGEになるには、同じ接続で購読ACKが正常であり、認証済み利用者とは異なるauthor.idから、指定テスト文が新規イベントとして届く必要があります。認証レスポンスに自分のIDがなければ、別アカウントと自動判定できないためPASSにしません。GET_CHANNEL.messagesの存在や件数、購読ACKだけではPASSにしません。ACK直前のイベントも取りこぼさず、ACKが拒否された場合は成功証拠へ加えません。

終了時のSUMMARYには、Discord版、要求権限・認証レスポンスで確認できた権限、購読成否、数値のRPCエラーコード、イベント件数、判定を出力します。認証前に接続できなかった場合のrequestedScopes空配列は、AUTHORIZEに未到達という意味です。

## 個人情報とログ

履歴の本文は出力せず、GET_CHANNELのmessagesが配列かどうかと件数だけを表示します。新規投稿の本文と表示名は通常モードの端末へ出るため、テスト用VCを使い、ファイルへリダイレクトしないでください。トークン、認可コード、生の認証レスポンス、上流エラー本文、VC ID、ユーザーIDは出力しません。投稿時刻は新規イベントの確認用に表示します。

共有や遠隔検証には--metadata-onlyを追加してください。このモードは本文と表示名を出さず、同一VC・別アカウント・指定テスト文への一致だけを示します。テスト文以外の実投稿を報告書やリポジトリへ残さないでください。チャットはProviderEventやWebSocketのスナップショット、診断JSON、イベント記録には渡しません。認可情報とIDは接続処理のメモリだけで扱います。

## 失敗の分類

- IPC_NOT_FOUND: 対応するデスクトップクライアントへ未接続。スコープやVCチャットの非対応を示す結果ではありません。
- AUTH_*: 現行認可の段階で失敗。購読試験には未到達です。
- SUBSCRIBE_MESSAGE_CREATE failed: 数値のrpc_codeを記録します。エラー本文を転記しません。権限不足が疑われても、この診断から第三者アプリのスコープを変更しません。
- SUBSCRIBE成功・イベント0件: 未確認です。別アカウントの投稿、同一VC、観測時間とクライアント版を確認します。

追加のmessages.readが必要な場合は、承認された自分のアプリと正規OAuth2認可経路を別課題とします。ユーザートークンの抽出、認証回避、Botへの置き換えは行いません。

## この変更時の検証結果（2026-11-09）

接続先PCでWindows x64版のプローブを実行しました。Discord/DiscordPTB/DiscordCanaryの起動中プロセスは検出できず、IPC探索はIPC_NOT_FOUNDでした。

| 項目 | 実機で観測した結果 |
|---|---|
| Discord版 | 起動中クライアントなし。特定できず |
| 要求予定権限 | rpc、rpc.voice.read。認証には未到達 |
| GET_CHANNEL.messages | 未取得 |
| SUBSCRIBE MESSAGE_CREATE | 未実行 |
| MESSAGE_CREATE | 受信0件 |
| 別アカウントの指定投稿 | 未実施 |
| 判定 | NOT_CONFIRMED。実接続環境がないため未判定 |

模擬IPCでは、購読拒否後の音声継続、VC移動、再接続、ACK前のイベント、同一VC照合、別アカウント判定、履歴非表示を試験しています。これはDiscordの実投稿受信の実証ではありません。

## 根拠資料

- Discord公式RPC仕様: https://github.com/discord/discord-api-docs/blob/main/developers/topics/rpc.mdx
- Discord公式OAuth2のmessages.read: https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx
- Embedded App SDK Issue #349: https://github.com/discord/embedded-app-sdk/issues/349

RPC仕様はSUBSCRIBEのevt/argsとMESSAGE_CREATEのchannel_id・messageを定義しています。OAuth2仕様は一般チャンネルの閲覧にmessages.readを挙げています。Issue #349はtype:2のGET_CHANNELにmessagesが含まれたSDKの事例であり、デスクトップIPCのリアルタイム受信を実証した資料ではありません。
