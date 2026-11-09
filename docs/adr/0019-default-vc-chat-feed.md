# ADR-0019: VCチャットを既定で読み取り、Dockへ分離配信する

- 状態: 採用
- 日付: 2026-11-09

## 根拠と対象

利用者の実行ログでは、サーバーVC（type 2）のMESSAGE_CREATEが同じchannel_idで届いた。本人の投稿であり、別アカウントからの投稿まで実証したとは扱わない。要求した権限はrpcとrpc.voice.readで、実際の認可応答にはmessages.readも含まれていた。この結果を全利用環境の保証にはしない。

## 決定

ライブ接続では環境変数なしでチャット購読を始める。既存の認証済みRpcClient、選択中VC、GET_CHANNELを使う。要求権限やアプリIDを変更しない。主購読はMESSAGE_CREATEとし、編集・削除も個別に購読する。補助購読の失敗では新規投稿や音声取得を止めない。旧Probeは明示的な診断用として残し、同時使用ではCREATEの購読を共有する。

チャットはProviderEventやAppSnapshotへ混ぜない。独立したメモリ内Feedに最大100件・本文JSON合計256KiBを保持し、Dockの明示購読へ別WebSocketメッセージで配信する。既存GET_CHANNELの履歴があれば合流させるが、履歴を完全取得するAPIや追加ポーリングは作らない。処理中に届いた新しい投稿・編集・削除を優先する。VC移動、退出、切断では内容を消す。

Dockの参加者一覧下にVC-CHATを置き、投稿者、時刻、本文、編集表示、添付件数を表示する。HTMLはテキスト扱いとし、HTTP/HTTPSのURLだけを利用者の操作で開けるリンクにする。プレビュー画像や外部コンテンツを自動取得しない。読み取り専用で、送信操作はない。

本文はファイル、プリセット、匿名化された発話記録、診断JSONへ保存しない。通常のOverlayはチャットを購読せず、配信映像に投稿を追加しない。ローカルGET /api/vc-chatは同じ状態を返す。既定の端末出力へ本文を流さず、従来のProbeを明示的に有効にした場合だけ端末にも出る。

## 検証

模擬IPCからの通常購読、二重購読防止、チャンネル照合、履歴とリアルタイムの競合、編集・削除、件数と容量上限、権限拒否時の音声継続を試験する。ブラウザではDock表示、HTMLの無害化、外部自動取得なし、再読み込み、スクロール、狭い幅を試験する。実DiscordとOBSでの受け入れは自動試験と区別する。

## 原典

- https://docs.discord.com/developers/topics/rpc#message_create-message_update-message_delete
- https://docs.discord.com/developers/topics/rpc#get_channel
- https://docs.discord.com/developers/topics/oauth2#oauth2-scopes
