import React, { useEffect, useState } from "react";

const SETTINGS_TABS = [
  { id: "app-info", label: "アプリ情報" },
  { id: "settings", label: "設定" },
  { id: "backup", label: "バックアップ" },
];

const DEFAULT_APP_INFO = {
  productName: "Cotaska",
  currentVersion: "Cotaska 0.1.0",
  distributionFolder: "Cotaska-dist",
  updateGuidance: "利用者確認付きの手動ダウンロード案内",
};

const DEFAULT_SETTINGS = {
  displayName: "Cotaska",
  externalEditorPath: "",
  notification: {
    minutesBefore: 5,
  },
  detailTextSize: 14,
};

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    notification: {
      ...DEFAULT_SETTINGS.notification,
      ...((settings || {}).notification || {}),
    },
  };
}

function SettingsPane() {
  const [activeTab, setActiveTab] = useState("app-info");
  const [appInfo, setAppInfo] = useState(DEFAULT_APP_INFO);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsPath, setSettingsPath] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateUrl, setUpdateUrl] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [backupDir, setBackupDir] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [backupError, setBackupError] = useState("");

  const refreshAppInfo = async () => {
    const info = await window.cotaskaAPI?.app?.getInfo?.();
    if (info) {
      setAppInfo({ ...DEFAULT_APP_INFO, ...info });
      if (info.downloadPageUrl) setUpdateUrl(info.downloadPageUrl);
    }
  };

  const loadSettings = async () => {
    const result = await window.cotaskaAPI?.settings?.get?.();
    if (result?.settings) {
      const normalized = normalizeSettings(result.settings);
      setSettings(normalized);
      window.localStorage?.setItem("cotaska.detailContentFontSize", String(normalized.detailTextSize));
    }
    if (result?.path) setSettingsPath(result.path);
    if (result && result.ok === false) setErrorMessage(result.error || "設定を読み込めませんでした。");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshAppInfo();
      if (!cancelled) await loadSettings();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettingState = (patch) => {
    setSettings((current) => normalizeSettings({
      ...current,
      ...patch,
      notification: {
        ...current.notification,
        ...(patch.notification || {}),
      },
    }));
  };

  const saveSettings = async () => {
    setStatusMessage("");
    setErrorMessage("");
    const result = await window.cotaskaAPI?.settings?.update?.(settings);
    if (!result?.ok) {
      setErrorMessage(result?.error || "設定を保存できませんでした。");
      return;
    }

    const normalized = normalizeSettings(result.settings);
    setSettings(normalized);
    setSettingsPath(result.path || settingsPath);
    window.localStorage?.setItem("cotaska.detailContentFontSize", String(normalized.detailTextSize));
    window.dispatchEvent(new CustomEvent("cotaska:detailTextSizeChanged", { detail: normalized.detailTextSize }));
    setStatusMessage("設定を保存しました。");
    await refreshAppInfo();
  };

  const chooseExternalEditor = async () => {
    const result = await window.cotaskaAPI?.settings?.chooseExternalEditor?.();
    if (result?.ok && result.path) {
      updateSettingState({ externalEditorPath: result.path });
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateStatus("");
    setErrorMessage("");
    try {
      const result = await window.cotaskaAPI?.app?.checkForUpdates?.();
      if (result?.downloadPageUrl) setUpdateUrl(result.downloadPageUrl);
      if (result?.ok) {
        setUpdateStatus(result.message || "更新確認が完了しました。");
      } else {
        setUpdateStatus(result?.error || "更新確認に失敗しました。");
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const openDownloadPage = async () => {
    const targetUrl = updateUrl || appInfo.downloadPageUrl;
    if (!window.confirm("ダウンロードページをブラウザで開きますか？")) return;
    const result = await window.cotaskaAPI?.app?.openDownloadPage?.(targetUrl);
    if (!result?.ok) {
      setUpdateStatus(result?.error || "ダウンロードページを開けませんでした。");
    }
  };

  const chooseBackupDirectory = async () => {
    const result = await window.cotaskaAPI?.backup?.chooseDirectory?.();
    if (result?.ok && result.path) {
      setBackupDir(result.path);
      setBackupError("");
    }
  };

  const createBackup = async () => {
    setBackupStatus("");
    setBackupError("");
    const result = await window.cotaskaAPI?.backup?.create?.(backupDir);
    if (!result?.ok) {
      setBackupError(result?.error || "バックアップを作成できませんでした。");
      return;
    }
    setBackupStatus(`バックアップを作成しました: ${result.backupPath}`);
  };

  return (
    <div className="settings-screen">
      <aside className="settings-side-panel" aria-label="設定項目">
        <h1 className="settings-side-title">設定</h1>
        <div className="settings-side-label">MENU</div>
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-side-item${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </aside>

      <main className="settings-main">
        {activeTab === "app-info" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">アプリ情報</h2>
                <p className="settings-page-subtitle">現在の Cotaska と更新情報を確認します。</p>
              </div>
            </div>

            <div className="settings-section app-info-card">
              <div className="app-info-logo">C</div>
              <div>
                <div className="app-info-name">{appInfo.productName}</div>
                <div className="app-info-version">{appInfo.currentVersion}</div>
              </div>
              <button type="button" className="settings-primary-btn" onClick={checkForUpdates} disabled={checkingUpdate}>
                {checkingUpdate ? "確認中..." : "更新を確認"}
              </button>
            </div>

            <div className="settings-section update-guide-card">
              <div>
                <div className="update-guide-title">更新案内</div>
                <div className="update-guide-text">{updateStatus || appInfo.updateGuidance}</div>
                <div className="update-guide-note">自動更新は行わず、確認後にダウンロードページを開きます。</div>
              </div>
              <button type="button" className="settings-secondary-btn" onClick={openDownloadPage}>
                ダウンロードページを開く
              </button>
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">設定</h2>
                <p className="settings-page-subtitle">表示、外部アプリ、通知、AI Agent の接続先を設定します。</p>
              </div>
              <button type="button" className="settings-primary-btn" onClick={saveSettings}>保存</button>
            </div>

            {(statusMessage || errorMessage) && (
              <div className={`settings-message ${errorMessage ? "settings-message--error" : "settings-message--success"}`}>
                {errorMessage || statusMessage}
              </div>
            )}

            <div className="settings-section">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>表示名</th>
                    <td>
                      <input
                        className="settings-text-input"
                        type="text"
                        value={settings.displayName}
                        maxLength={40}
                        aria-label="表示名"
                        onChange={(e) => updateSettingState({ displayName: e.target.value })}
                      />
                      <div className="settings-help-text">Cotaska の画面タイトルやアプリ情報に表示する名前。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>外部エディタ</th>
                    <td>
                      <div className="settings-field-row">
                        <input
                          className="settings-text-input settings-path-input"
                          type="text"
                          value={settings.externalEditorPath}
                          aria-label="外部エディタ"
                          onChange={(e) => updateSettingState({ externalEditorPath: e.target.value })}
                        />
                        <button type="button" className="settings-secondary-btn" onClick={chooseExternalEditor}>参照</button>
                      </div>
                      <div className="settings-help-text">空欄の場合は .md ファイルの既定のアプリが起動します。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>通知時間</th>
                    <td>
                      <div className="settings-unit-field">
                        <input
                          className="settings-number-input"
                          type="number"
                          value={settings.notification.minutesBefore}
                          min="0"
                          max="1440"
                          step="1"
                          aria-label="通知時間"
                          onChange={(e) => updateSettingState({ notification: { minutesBefore: e.target.value } })}
                        />
                        <span className="settings-unit-label">分</span>
                      </div>
                      <div className="settings-help-text">タスクの日時が近い場合の、事前通知の時間。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>文字サイズ</th>
                    <td>
                      <div className="settings-unit-field">
                        <input
                          className="settings-number-input"
                          type="number"
                          value={settings.detailTextSize}
                          min="10"
                          max="28"
                          step="1"
                          aria-label="文字サイズ"
                          onChange={(e) => updateSettingState({ detailTextSize: e.target.value })}
                        />
                        <span className="settings-unit-label">px</span>
                      </div>
                      <div className="settings-help-text">タスク詳細の文字サイズ。ショートカット操作でも同じ設定値を更新します。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>外部AIAgent</th>
                    <td>
                      <select className="settings-select-input" disabled aria-label="外部AIAgent">
                        <option>(未実装) ローカルCLI</option>
                      </select>
                      <div className="settings-help-text">ローカル CLI 連携は未実装。</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {settingsPath && <div className="settings-file-path">設定ファイル: {settingsPath}</div>}
          </section>
        )}

        {activeTab === "backup" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">バックアップ</h2>
                <p className="settings-page-subtitle">タスク正本、リスト、設定ファイルを手動バックアップします。</p>
              </div>
            </div>

            <div className="settings-section backup-panel">
              <div className="settings-field-row">
                <input
                  className="settings-text-input settings-path-input"
                  type="text"
                  value={backupDir}
                  aria-label="バックアップ保存先"
                  onChange={(e) => setBackupDir(e.target.value)}
                />
                <button type="button" className="settings-secondary-btn" onClick={chooseBackupDirectory}>保存先</button>
              </div>
              <div className="settings-help-text">
                タイムスタンプ付きフォルダに `data/tasks`、`data/lists.yaml`、`data/settings.yaml` をコピーします。復元機能は初期実装には含めません。
              </div>
              <button type="button" className="settings-primary-btn backup-create-btn" onClick={createBackup}>
                バックアップ作成
              </button>
              {(backupStatus || backupError) && (
                <div className={`settings-message ${backupError ? "settings-message--error" : "settings-message--success"}`}>
                  {backupError || backupStatus}
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default SettingsPane;
