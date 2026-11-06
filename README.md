# Discord ENTAKU Overlay

Discord通話をThree.jsの中空会議テーブルとして表示する、Bun＋TypeScript製のOBS向けローカルアプリ。

**開発中。ライブDiscord接続・OBS・Windows実機の受け入れ試験は未完了です。** 現在の実装範囲と未完了項目は [開発状況](docs/implementation-status.md)、設計判断は [ADR-0001](docs/adr/0001-architecture-and-delivery.md) を参照してください。

## 設計

BunがDiscord IPC接続、席予約、発話状態、自動カメラ判断を管理します。OBSブラウザソースは`/overlay`、操作用カスタムブラウザドックは`/dock`です。音声は録音・解析しません。

## 開発環境

Bun 1.4.4を使用します。依存は`bun.lock`に固定します。

```sh
bun install --frozen-lockfile
bun run check
```

Windows向けの配布物は単独exeと外部ユーザーデータをまとめたZIPを予定しています。未検証の配布物を安定版として公開しません。
