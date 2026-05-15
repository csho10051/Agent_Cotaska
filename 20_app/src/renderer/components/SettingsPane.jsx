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

function SettingsPane() {
  const [activeTab, setActiveTab] = useState("app-info");
  const [appInfo, setAppInfo] = useState(DEFAULT_APP_INFO);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await window.cotaskaAPI?.app?.getInfo?.();
      if (!cancelled && info) {
        setAppInfo({ ...DEFAULT_APP_INFO, ...info });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
              <button type="button" className="settings-primary-btn">更新を確認</button>
            </div>

            <div className="settings-section update-guide-card">
              <div>
                <div className="update-guide-title">更新案内</div>
                <div className="update-guide-text">{appInfo.updateGuidance}</div>
                <div className="update-guide-note">
                  自動更新は行わず、確認後にダウンロードページを開きます。
                </div>
              </div>
              <button type="button" className="settings-secondary-btn">ダウンロードページを開く</button>
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
            </div>

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
                      <input className="settings-text-input" type="text" defaultValue="Cotaska" aria-label="表示名" />
                      <div className="settings-help-text">Cotaska のランチャー表示名の入力欄。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>外部エディタ</th>
                    <td>
                      <div className="settings-field-row">
                        <input
                          className="settings-text-input settings-path-input"
                          type="text"
                          defaultValue="C:\\Program Files\\Microsoft VS Code\\Code.exe"
                          aria-label="外部エディタ"
                        />
                        <button type="button" className="settings-secondary-btn">参照</button>
                      </div>
                      <div className="settings-help-text">
                        タスクファイルを外部アプリで開く場合に使用する、外部アプリの実行ファイルの絶対パス。
                        空欄の場合は .md ファイルの既定のアプリが起動します。
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <th>通知時間</th>
                    <td>
                      <div className="settings-unit-field">
                        <input className="settings-number-input" type="number" defaultValue="5" min="0" step="1" aria-label="通知時間" />
                        <span className="settings-unit-label">分</span>
                      </div>
                      <div className="settings-help-text">タスクの日時が近い場合の、事前通知の時間。</div>
                    </td>
                  </tr>
                  <tr>
                    <th>文字サイズ</th>
                    <td>
                      <div className="settings-unit-field">
                        <input className="settings-number-input" type="number" defaultValue="14" min="10" max="28" step="1" aria-label="文字サイズ" />
                        <span className="settings-unit-label">px</span>
                      </div>
                      <div className="settings-help-text">タスク詳細の文字サイズ。</div>
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
          </section>
        )}

        {activeTab === "backup" && (
          <section className="settings-panel">
            <div className="settings-page-head">
              <div>
                <h2 className="settings-page-title">バックアップ</h2>
                <p className="settings-page-subtitle">バックアップ設定は後続タスクで実装します。</p>
              </div>
            </div>
            <div className="settings-section settings-empty-state">未実装</div>
          </section>
        )}
      </main>
    </div>
  );
}

export default SettingsPane;
