# ENTAKU 開発資料

最新の作業状況と過去の実装記録を区別する。開発者・引き継ぎ担当者は、まず次の文書を読む。

| 目的 | 文書 |
|---|---|
| 作業を再開する | [2026-11-27 改修の引き継ぎ](handoff-2026-11-27.md)（PR、実装SHA、CI失敗、再現手順、残作業） |
| 現行の設計判断を理解する | [ADR 0026](adr/0026-state-stream-and-resource-ownership.md)（差分通信と資源所有権）、[描画パイプライン](render-pipeline.md) |
| 利用・開発環境を準備する | [起動とOBSへの登録](getting-started.md)、[ルートREADME](../README.md)、[開発ルール](../AGENTS.md) |
| 検証する | [診断と発話イベント再生](diagnostics.md)、[ブラウザCIの設計](ci-render-tests.md)、[受け入れ条件](acceptance.md)、[配布候補の確認](release-checklist.md) |

## 機能別

| 分野 | 文書 |
|---|---|
| 2D画像 | [カスタムアバター](custom-avatars.md) |
| 3DGS | [利用手順](gaussian-avatars.md)、[素材形式](gaussian-package.md)、[native geometry](gaussian-native-geometry.md)、[発話グロー](gaussian-speech-glow.md) |
| メッシュアバター | [GLB発話表示](mesh-avatar-speech.md) |
| スタジオ・画質 | [スタジオ](studio.md)、[露出](exposure.md)、[画質と机](quality-and-desk.md)、[ポストエフェクト](post-effects.md) |
| カメラ・席 | [RC.15](rc15-controls-and-camera.md)、[発話終了](rc11-speech-end.md)、[分割](rc10-dialogue-split.md)、[プリセットと席](rc12-presets-and-seats.md) |
| Discord | [認証とスタジオ](rc13-auth-and-studio.md)、[VC-CHAT](rc14-vc-chat.md)、[チャット検証](vc-chat-probe.md) |

## 過去の検証記録

以下は記載された時点・コミットに対する記録であり、最新PRの合格を示すものではない。

| 文書 | 内容 |
|---|---|
| [開発・検証状況](implementation-status.md) | 2026-11-09までのRC別の検証 |
| [3DGS検証記録](gaussian-validation.md) | 静的3DGS導入時の自動テストと測定 |
| [2026-11-10 監査](refactoring-audit-2026-11-10.md)、[進捗](refactoring-progress-2026-11-10.md)、[第2段階](refactoring-stage2-2026-11-10.md)、[完了記録](refactoring-completion-2026-11-10.md) | 以前のリファクタリングの経緯 |
| [ADR一覧](adr/) | 採用した設計と理由。新しい判断が古い判断を変更した場合は新しいADRを参照 |
| [測定資料](measurements/)、[ドメイン測定](benchmarks/) | 過去の測定値。コミット・環境・条件を確認して比較する |

引き継ぎを更新するときは、対象のブランチ・コミット、実施した検査、失敗した検査、未実施の検査、再開手順を記載する。古い検証結果はそのまま残し、新しい結果と混ぜない。
