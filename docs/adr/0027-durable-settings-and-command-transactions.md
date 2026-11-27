# ADR 0027：設定と座席の永続化を SQLite のトランザクションにまとめる

採用・実装済み。実装対象は [ae208c2](https://github.com/zkamiyama/Discord-ENTAKU-Overlay/commit/ae208c22942f31dcba5813fc53488bda4b0d4721)。CI と配布確認の最新結果は [アーキテクチャの現状](../architecture-status.md) を参照する。この ADR は [ADR 0026](0026-state-stream-and-resource-ownership.md) の設定保存と変更操作の設計を具体化する。

## 決定

可変設定と座席セッションを `settings.sqlite` に保存する。Bun 1.4.4 に含まれる `bun:sqlite` を使い、設定の変更と、その変更に伴う現在の通話の座席を同じトランザクションで確定する。SQLite 接続は操作ごとに開閉し、稼働中の設定の読み取りにはメモリ上のスナップショットを使う。

旧 JSON は初回にだけ読み込み、元ファイルを保持する。移行後は SQLite を保存先とし、破損時に旧 JSON を自動的に読み直さない。素材と名前付きプリセットは引き続き別のファイルとして保存する。

## 旧方式の問題

旧実装は `scene.json`、`avatars.json`、`preset-state.json` を順番に書き、後続処理が失敗すると、完了した書き込みを逆順で戻していた。プロセスが動き続けている場合には補償できたが、途中で終了すると新旧の設定が混在した。単一ファイルの置換を担当していた `writeAtomicJson` にも `fsync` はなかった。

プリセットの座席設定にも別の保存経路があった。Engine が現在の通話の `SeatSession` を置き換えた後、CLI が座席 JSON を非同期で保存していたため、設定の保存後から座席の保存前までの間に終了すると、新しいスタジオや人物に古い座席が組み合わされた。設定の 3 ファイルをまとめるだけでは、この問題は残る。

これらの補償処理、各素材 store が持っていた可変設定の cache、旧 `SessionStore`、未使用になった `atomic-json.ts` を削除した。

## 採用理由

| 検討した方式 | 判断 |
|---|---|
| 複数 JSON と補償書き込み | プロセス終了後の復旧を補償処理で扱えないため廃止した。 |
| 設定を単一 JSON にまとめて置換 | 複数設定の混在は減らせるが、座席との同時確定、同期処理、置換後の失敗の扱いをアプリ側で実装する必要が残る。 |
| Bun 標準 SQLite | 設定と座席を同じ DB トランザクションに含められる。journal、ファイルロック、未確定の変更の復旧は SQLite に任せられ、新しい npm 依存も不要なため採用した。 |

設定変更と SQLite commit の間に `await` を挟まずに済むことも採用理由である。Bun の transaction callback は同期処理であり、戻った時点で commit する。素材の検証を先に済ませる設計と一致する。仕様は [Bun 1.4.4 の SQLite ドキュメント](https://github.com/oven-sh/bun/blob/bun-v1.4.4/docs/runtime/sqlite.mdx#transactions) を参照する。

## モジュールの責務

| モジュール | 責務 |
|---|---|
| [SettingsStore](../../src/storage/settings-store.ts) | DB の初期化、設定の読み書き、座席の読み書き、世代と行 version の比較、SQLite 接続の解放。 |
| [settings-schema](../../src/storage/settings-schema.ts) | 保存する設定の型と検証。プリセット由来の設定を `seating`、`autoCamera`、`theme` に限定する。 |
| [SettingsService](../../src/server/settings-service.ts) | 素材の非同期検証、通話と編集 revision の再確認、Engine の設定変更と保存の組み合わせ。 |
| [AppEngine](../../src/domain/engine.ts) | カメラや配置を含む設定変更の計画。同期処理が失敗した場合に、変更前のドメイン状態へ戻す。 |
| [SessionWriter](../../src/storage/session-writer.ts) | 通常の座席保存を 1 件ずつ実行する。待機中の状態はチャンネルごとに最新の 1 件を保持する。 |
| [AvatarStore](../../src/assets/store.ts)・[StudioStore](../../src/studio/store.ts)・[PresetStore](../../src/presets/store.ts) | 素材や名前付きプリセットの読み書きと検証。現在の可変設定は保持しない。 |

## 保存データと番号の意味

DB の schema version は `1` とし、`application_id` と `user_version` を読み取り時に照合する。`settings` の JSON に記録した generation と SQL 列の generation も一致を確認する。

| 保存先 | 主キー | 内容と更新単位 |
|---|---|---|
| `settings` | `id=1` | `schemaVersion`、`generation`、`studio`、`avatarProfiles`、`preferences` を含む JSON。設定操作で全体を置き換える。 |
| `sessions` | `(source, channel_id)` | `demo` または `ipc` の通話ごとの `SeatSession` と行 version。通常の保存では対象行だけを更新する。 |

番号は用途を分ける。

| 番号 | 比較する対象 |
|---|---|
| Engine の `revision` | HTTP 操作が編集を始めた時点と、現在の編集状態。 |
| `settingsContextVersion` | 非同期検証の前後で、接続元の世代や通話が変わったか。 |
| 設定の `generation` | SettingsStore が読んだ設定と、DB にある設定。同時に、待機していた座席保存が古い設定に基づくものか。 |
| 座席行の `version` | SettingsStore が読んだ座席行と、DB にある同じ行。 |
| `sessionId` と座席の `revision` | SessionWriter が保存済みの内容と、次に渡された内容。 |

`snapshot()` は複製を返す。呼び出し元が返却値を変更しても SettingsStore 内の設定は変わらない。

## 設定操作の確定順序

設定の保存は [SettingsService](../../src/server/settings-service.ts) と [Engine の settingsTransaction](../../src/domain/engine.ts) を次の順序で実行する。

1. HTTP の変更キューで操作を直列化し、編集 revision と通話の状態を記録する。
2. 素材やプリセットを非同期で読み、画像・Gaussian・スタジオへの参照と設定値を検証する。
3. 通話の状態と編集 revision を再確認する。変化していれば保存前に拒否する。
4. Engine が変更前の状態を退避し、設定、配置、カメラを更新する。ここから commit callback が戻るまでは同期処理とする。
5. commit callback が新しい設定と現在の通話の座席を SQLite の `BEGIN IMMEDIATE` トランザクションで保存する。設定の generation と座席行の version を照合してから更新する。
6. DB commit が成功した後、SettingsStore の設定と version の参照を更新する。Engine の変更処理が戻ると、HTTP 側が状態を配信して成功応答を返す。

配置やカメラの計画が失敗した場合は DB を書かない。DB の書き込みに失敗した場合は SQLite が変更を戻し、Engine も退避した状態へ戻る。Engine が退避する対象には、設定、参加者と発話追跡、座席 allocator、カメラ、演出判断、時刻、seq、revision が含まれる。複数の参照が同じ allocator を指す関係も保持する。

Engine の退避と復元は非同期処理をまたがない。素材の読み取り中に受け取った Discord の更新は、保存前の通話確認で扱う。古い Engine のスナップショットを使って、その更新まで戻すことはしない。

設定の保存対象に現在の通話の座席を含めるため、プリセット適用後の通常保存を待たずに、設定と座席をまとめて再起動できる。通話がない場合と replay では座席行をこの commit に含めない。

## SQLite の接続と失敗処理

接続は `create:false`、`strict:true` で開き、`journal_mode=DELETE`、`synchronous=EXTRA`、`busy_timeout=0`、`trusted_schema=OFF` を設定する。通常の書き込みには `transaction(...).immediate()` を使う。ロック競合を待ち続けてリアルタイム処理を止めないよう、busy wait は行わない。

通常の DB 更新の同期と復旧は SQLite の rollback journal に委ねる。`EXTRA` は `DELETE` モードの journal 削除時にディレクトリも同期する。定義は [SQLite の synchronous pragma](https://www.sqlite.org/pragma.html#pragma_synchronous) と [Atomic Commit In SQLite](https://www.sqlite.org/atomiccommit.html) を参照する。独自の WAL は実装しない。

SettingsStore は `db.query()` と `db.transaction()` が所有する statement を使用し、接続を `finally` の `close(false)` で閉じる。[Bun 1.4.4 の実装](https://github.com/oven-sh/bun/blob/bun-v1.4.4/src/js/bun/sqlite.ts)では、close 時に query cache と transaction controller の statement を解放する。外部へ statement を返さないため、操作後に接続を保持する必要がない。

SettingsStore の COMMIT 後には、検証や外部 callback を実行せず、準備済みの設定と version を代入する。close や移行候補の掃除が確定済みの保存を「未保存」という結果に変えないようにする。

## 初回移行と起動順序

移行を実行する条件は `settings.sqlite` が存在しないことである。既存 DB が空、破損、未知 schema であることは、移行を再実行する条件にしない。

[legacy-settings](../../src/storage/legacy-settings.ts) は `scene.json`、`avatars.json`、`preset-state.json` を読む。`avatars.json` は schema 1 / 2 を受け付ける。[legacy-sessions](../../src/storage/legacy-sessions.ts) は `sessions/demo` と `sessions/ipc` を読む。元ファイルと `.bak` は変更しない。存在しない設定には既定値を使うが、存在する設定を読めない場合は移行を中止する。

1. 旧設定と旧座席をサイズ上限付きで読み、全件を検証する。失敗した場合、正式な保存先の DB は作らない。
2. 同じディレクトリ内の一時 SQLite に schema、設定、座席を 1 トランザクションで書き、commit して接続を閉じる。
3. 完成した一時 DB への hardlink を `settings.sqlite` として作る。既存の保存先を上書きしない。
4. 同時に起動した別プロセスが先に公開していた場合は、その DB を読み直す。公開できた場合は一時ファイルを削除し、正式な保存先を読み直す。
5. [CLI](../../src/cli.ts) が設定と現在の source の座席を読み、素材 store を初期化する。その後に Engine と HTTP サーバーを起動する。

hardlink を作成できないファイルシステムでは `SETTINGS_PUBLISH_FAILED` で中止し、完成した移行候補と旧 JSON を保持する。上書き rename に切り替える処理はない。公開後の一時ファイル削除が失敗しても、保存結果は変えない。

初回の hardlink 作成は一時 DB に対する SQLite commit の後に行う。このリンクについてアプリ側で親ディレクトリの `fsync` は実行していないため、初回公開直後の電源断に対する耐久性は保証しない。プロセス終了時に未完成の DB を正式な保存先として公開しないことと、電源断後もディレクトリエントリーが残ることは、別の保証として扱う。

safe mode と replay はメモリ上の SettingsStore を使用する。旧データの移行も、SQLite への保存も行わない。

## 別プロセスとの競合

設定の書き込みは DB の generation が SettingsStore の記憶した値と一致する場合だけ進める。通常の座席保存は設定 generation を増やさないため、同じ source と channel の行 version も比較する。プリセットが更新する座席にも同じ比較を適用する。

比較と更新は同じ書き込みトランザクション内で実行する。別プロセスの更新で一致しなくなった場合は `SETTINGS_CONFLICT` とし、その更新を上書きしない。保存済みの設定と行 version を表すメモリ上の値は、DB commit に成功した場合だけ進める。SettingsStore は競合を理由に期待する version を読み直して上書きしない。HTTP の変更操作も自動的に再実行しない。

## SessionWriter の変更検出と世代確認

SessionWriter は `sessionId:revision` を内容の署名として持つ。保存済みと同じ署名なら書き込まない。待機項目にはその状態を受け取った時点の設定 generation を別に記録する。

設定 generation が変わっただけなら、すでに保存した他のチャンネルを書き直す必要はない。一方、まだ保存していない状態を新しい generation で受け取った場合は、内容が同じでも待機項目の generation を更新する。変更検出と世代確認を同じ署名にまとめると、設定の変更ごとに全チャンネルの保存が発生するため分離した。

保存関数の `true` は保存完了を示し、保存済みの署名を更新する。`false` は同じプロセス内ですでに設定 generation が進んだため、その待機項目を破棄したことを示す。この場合は保存済みの署名を更新しない。DB の generation や行 version が別プロセスによって変わった場合は、`false` ではなく競合エラーを返す。

保存に失敗した項目は待機状態に残す。同じ処理の中で無制限に再試行せず、次の `offer` または `flush` で再試行する。他のチャンネルの保存は継続できる。通常の座席変更はこの経路で非同期に保存するため、保存前にプロセスが終了すれば最後の未保存変更は失われ得る。設定操作に伴う現在の通話の座席は、前述の同期 commit に含める。

## HTTP の変更操作と終了処理

[WorkQueue](../../src/server/work-queue.ts) は実行中を含めて変更操作を 8 件まで受け付け、1 件ずつ実行する。待機中の request が abort された場合はキューから除く。実行を開始した操作は abort から切り離し、commit または rollback まで進める。HTTP 接続の切断は、操作が取り消されたことを意味しない。

[commandRoute](../../src/server/routes/commands.ts) は `requestId` と本文の digest を照合し、保存している成功応答の範囲内で同じ操作に同じ応答を返す。本文が異なる requestId の再利用は競合とする。副作用のあるコマンドを自動的に再実行しない。

| 状態 | HTTP ステータスと主なエラー |
|---|---|
| 編集・保存済みデータ・通話の競合 | `409`。`REVISION_CONFLICT`、`SETTINGS_CONFLICT`、`SETTINGS_CONTEXT_CHANGED`、`PRESET_CONTEXT_CHANGED`。 |
| 設定やプリセットの書き込み失敗 | `500`。`SETTINGS_WRITE_FAILED`、`PRESET_WRITE_FAILED`。 |
| 設定値や素材の検証失敗 | `422`。該当する検証エラーを返す。 |
| コマンド本文の上限超過 | `413`。`COMMAND_TOO_LARGE`。 |
| キューの上限・終了中・待機中の中止 | `503`。`SERVER_BUSY`、`SERVER_STOPPING`、`REQUEST_CANCELLED`。 |

起動時の DB 読み取り失敗は `SETTINGS_READ_FAILED`、未知 schema は `SETTINGS_SCHEMA_UNSUPPORTED`、移行元の読み取り失敗は対象ファイルに対応するエラーで報告する。通常の座席保存に失敗した場合は待機項目を残して報告し、最終 `flush` でも保存できなければ `SESSION_WRITE_FAILED` とする。

[サーバーの stop](../../src/server/app.ts) は新しい操作を受け付けず、待機中の変更を中止して実行中の変更を待つ。ネイティブ server の停止が失敗しても、その待機を `finally` で実行する。[CLI の shutdown](../../src/cli.ts) は provider と app の両方の停止を試み、停止結果にかかわらず最後の `persist` と `SessionWriter.flush()` を実行する。失敗があれば `SHUTDOWN_FAILED` と終了コード `1` を設定し、signal handler を解除する。

## 上限

| 対象 | 上限 | 実装 |
|---|---|---|
| 設定 JSON 全体 | 4 MiB | [SettingsStore](../../src/storage/settings-store.ts) |
| 保存するアバター割り当て | 256 件。userId の重複を拒否する。 | [settings-schema](../../src/storage/settings-schema.ts) |
| 座席 JSON 1 件 | 1 MiB | [SettingsStore](../../src/storage/settings-store.ts) |
| 保存するチャンネル | source ごとに 1,024 件 | [SettingsStore](../../src/storage/settings-store.ts)・[legacy-sessions](../../src/storage/legacy-sessions.ts) |
| 移行元の scene / avatars / preset-state | 順に 1 MiB / 2 MiB / 2 MiB | [legacy-settings](../../src/storage/legacy-settings.ts) |
| HTTP コマンド本文 | 256 KiB | [commandRoute](../../src/server/routes/commands.ts)・[bounded-body](../../src/server/bounded-body.ts) |
| 実行中・待機中の変更操作 | 合計 8 件 | [server](../../src/server/app.ts)・[WorkQueue](../../src/server/work-queue.ts) |
| requestId に対応する成功応答 | 256 件 | [commandRoute](../../src/server/routes/commands.ts) |

DB の同期処理中は JavaScript のイベントループを占有する。素材の読み取りをその区間の前に済ませ、通常の座席更新は対象行だけを書き、変更のないチャンネルの保存を避ける設計とした。ハードウェアごとの commit 時間や、電源断時の動作をこの設計だけから測定済みとは扱わない。

## 検証と保証の範囲

導入時の Bun 1.4.4 による対象試験は、36 件成功、失敗なしだった。各試験が確認する条件を以下に示す。全体の CI 結果と Windows の実行結果は [アーキテクチャの現状](../architecture-status.md) を参照する。

| 試験 | 確認する条件 |
|---|---|
| [settings-store.test.ts](../../tests/integration/settings-store.test.ts) | 旧 3 設定の一度だけの移行、原本保持、破損・truncate・未知 schema の拒否、同時初期化、接続解放後の rename、設定世代と座席行の CAS。未 commit のページを書き出した子プロセスを `SIGKILL` し、旧設定と旧座席へ復旧する。 |
| [settings-service.test.ts](../../tests/integration/settings-service.test.ts) | カメラ・配置計画の失敗、検証中の通話変更、設定行を更新した後の座席 SQL の失敗で、DB と Engine が不整合にならない。プリセット全体を再起動できる。 |
| [session-store.test.ts](../../tests/integration/session-store.test.ts) | demo / ipc の分離、プリセット直後の座席保存、古い待機書き込みの拒否、その後の通常の席移動を次回起動で保持する。 |
| [legacy-sessions.test.ts](../../tests/integration/legacy-sessions.test.ts) | 元ファイルを変更しない。チャンネル名、本文サイズ、件数を検査する。 |
| [seat-lifecycle.test.ts](../../tests/integration/seat-lifecycle.test.ts) | 入退室と再起動を通じた席の保持、DB ロック競合時の失敗と解除後の保存。 |
| [session-writer.test.ts](../../tests/unit/session-writer.test.ts) | 待機内容の集約、失敗時の保持、世代確認。保存済み 1,000 チャンネルで設定世代だけを変更しても、追加の座席書き込みが発生しない。 |
| [server.test.ts](../../tests/integration/server.test.ts) | 停止の冪等性、停止失敗時も実行中の変更を待つこと、実 HTTP の競合 `409` と保存失敗 `500`、Engine の rollback。 |

[実行ファイルの smoke](../../scripts/smoke-executable.ts) にも、通常起動で SQLite へ設定と座席を保存し、再起動して読み戻す検査がある。safe mode だけの起動確認では DB を開かないため、この経路を分けて検査する。

子プロセスの強制終了試験は未確定の更新からのプロセスクラッシュ復旧を確認する。OS 全体の異常終了、電源断、初回 hardlink 公開後のディレクトリエントリーの耐久性を実証する試験ではない。hardlink の対応状況とファイル handle の解放は配布対象のファイルシステムと Windows CI でも確認する。

## 公式資料

- [Bun 1.4.4 SQLite ドキュメント](https://github.com/oven-sh/bun/blob/bun-v1.4.4/docs/runtime/sqlite.mdx)：標準モジュール、同期 transaction、statement と close の動作。
- [Bun 1.4.4 SQLite 実装](https://github.com/oven-sh/bun/blob/bun-v1.4.4/src/js/bun/sqlite.ts)：query cache、transaction controller、close、commit / rollback の処理。
- [SQLite Transaction](https://www.sqlite.org/lang_transaction.html)：`BEGIN IMMEDIATE`、writer の排他、commit 失敗時の扱い。
- [SQLite synchronous pragma](https://www.sqlite.org/pragma.html#pragma_synchronous)：`DELETE` と `EXTRA` の同期範囲。
- [Atomic Commit In SQLite](https://www.sqlite.org/atomiccommit.html)：rollback journal と途中で終了した更新の復旧。
