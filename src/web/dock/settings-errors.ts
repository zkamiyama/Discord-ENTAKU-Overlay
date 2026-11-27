/** Settings operations keep the previous runtime state when persistence fails. */
export const SETTINGS_ERROR_MESSAGES:Record<string,string>={
  SETTINGS_WRITE_FAILED:'設定を保存できませんでした。保存先の空き容量とアクセス権を確認してください。以前の設定を維持しています。',
  SETTINGS_CONFLICT:'別の ENTAKU から保存内容が更新されました。アプリを再起動して最新の設定を読み込んでください。',
  SETTINGS_CONTEXT_CHANGED:'通話の状態が変わったため適用を中止しました。現在の通話を確認して、もう一度操作してください。',
  PRESET_CONTEXT_CHANGED:'通話の状態が変わったため適用を中止しました。現在の通話を確認して、もう一度操作してください。',
};
