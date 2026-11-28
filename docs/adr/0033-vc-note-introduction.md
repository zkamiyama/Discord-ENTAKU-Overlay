# ADR 0033: VCチャットからのノート紹介

日付: 2026-11-28

状態: 採用

## 背景

VCチャットに投稿したノートURLを番組内で紹介し、次のURLで差し替え、Dockで終了できるようにする。カードは幅80%・高さ最大50%とし、短文の余白を抑え、長文は省略せず縮小する。カメラ移動とSPLITのどちらでも、番組画面全体へ1枚表示する。

## 決定

`VcChatFeed`へ正規化後の変更通知を追加する。既存のDiscord RPC購読を共有し、新たなチャット取得やポーリングは行わない。チャット状態全体の差分では保持上限による履歴の削除と実際の削除を区別できないため、create/update/delete/resetを通知する。保持範囲外の紹介元が編集された場合も、最小限の変更通知を使って古い表示を無効にする。

`NoteIntroductionFeed`は表示中1件と最新の取得待ち1件を管理する。古い要求を取り消し、世代を確認して遅延応答を破棄する。新しい取得に失敗した場合は前のカードを保持する。取り下げ、チャンネル切替、接続終了では保留中の処理も破棄する。取り下げAPIは紹介stateのrevisionを検査し、古いDockの操作が新しい紹介を消さないようにする。同期的な取り下げは大きな素材の検査を待つ必要がないため、設定保存のWorkQueueへ入れない。

紹介ノートは独立したWebSocket購読で配信し、AppSnapshot、発話録画、プリセット、環境パッケージへ本文を追加しない。保存時の出演者プレビューはライブ紹介を購読しない。

## 設定と取得

許可インスタンスは`config/note-introduction.json`から初期化する。運用時はDockでJSONを読み込み・書き出しでき、CLIでも明示的な読み込みを受け付ける。検査後の設定はSQLiteへ保存し、環境パッケージにも含める。別の可変JSONを常時同期する方式は、ファイルとDBの更新に部分失敗を生むため採用しない。

URLは設定したHTTPS originとノートパスを照合する。匿名`notes/show`の応答を検査し、公開範囲・非表示・CW・センシティブ指定を確認する。取得は10秒、応答は1 MiBを上限とし、リダイレクトと認証情報の転送を許可しない。MFMは既存`mfm-js`のASTから静的テキストへ変換する。本文や選択肢の各入力は16,000 UTF-16コード単位、投稿者名や引用を含む総入力と変換後の本文は32,768 UTF-16コード単位までとする。上限を超えた場合は省略せず取得失敗として扱う。ハッシュタグカードの文字数切り詰め、新しさ、ハッシュタグ一致条件は適用しない。

## 描画

既存のThree.jsは0.187.0。今回の固定表示はDOMの`article`を画面全体のレイヤーへ配置し、既存3Dの座標やカメラを変更しない。3Dカード用PlaneGeometryやSprite、CSS3DRendererはカメラとビューごとの状態が不要な用途に合わず、CanvasTextureは全文の折り返しと文字計測を重複して実装するため採用しない。

文字サイズはDOMの実寸を使って二分探索する。改行の多さやブラウザの最小文字サイズで本文だけでは収まらない場合は、カード全体を縮小する。縮小時にレイアウト幅を広げ、画面上の幅80%を維持する。本文を削除せず、スクロールやline-clampも使わない。

計測は内容・viewport・フォントの変化時に行う。`ResizeObserver`は文字サイズを変更するカードを監視せず、viewportの変化を監視する。アニメーションはWeb Animations APIのtransformとopacityで行い、退場完了後に最新の内容で入場する。取消による`finished`のrejectionを処理し、DOMは1枚に保つ。

## 参照と検証範囲

- [Misskey notes/showの固定ソース](https://github.com/OtomadSite/system/blob/13cde5a03c560e0bfbe9ec475157f29ae4ba1653/packages/backend/src/server/api/endpoints/notes/show.ts)から、[NoteEntityService](https://github.com/OtomadSite/system/blob/13cde5a03c560e0bfbe9ec475157f29ae4ba1653/packages/backend/src/core/entities/NoteEntityService.ts)の非表示処理と[ApiCallService](https://github.com/OtomadSite/system/blob/13cde5a03c560e0bfbe9ec475157f29ae4ba1653/packages/backend/src/server/api/ApiCallService.ts)の制限へたどった。
- [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)、[scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight)、[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)から[CSSWG仕様](https://drafts.csswg.org/resize-observer/)へたどり、計測とアニメーションを分けた。CSS transformsはResizeObserverの通知対象ではない。
- 自動試験は合成RPCとAPIを用いる。実Discord、対象インスタンスへの今回の実API接続、WindowsのOBS/CEFでの確認は未実施。
