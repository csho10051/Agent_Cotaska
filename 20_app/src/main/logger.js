const fs = require('fs');
const path = require('path');

/**
 * DebugLogger - 開発者向けデバッグログ
 * IPC通信、DB操作、エラーをトレース
 * 開発モード時のみログ出力・ファイル記録
 */
class DebugLogger {
  constructor() {
    this.logDir = path.join(__dirname, '../../../../workspace/logs');
    this.enabled = process.env.NODE_ENV === 'development';
    this.logFile = null;
    
    console.log('[DebugLogger] Initializing', {
      nodeEnv: process.env.NODE_ENV,
      enabled: this.enabled,
      logDir: this.logDir
    });
    
    if (this.enabled) {
      this._ensureLogDir();
      this._openLogFile();
      console.log('[DebugLogger] Logger enabled and initialized');
    } else {
      console.log('[DebugLogger] Logger disabled (NODE_ENV !== development)');
    }
  }

  /**
   * ログディレクトリを確保
   */
  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * ログファイルをオープン（本日分）
   */
  _openLogFile() {
    const today = new Date().toISOString().slice(0, 10);
    const filename = `debug-${today}.log`;
    this.logFilePath = path.join(this.logDir, filename);
  }

  /**
   * ログメッセージをフォーマット
   */
  _format(level, message, context = null) {
    const timestamp = new Date().toISOString();
    let output = `[${timestamp}] [${level}] ${message}`;
    if (context) {
      output += ` | ${JSON.stringify(context)}`;
    }
    return output;
  }

  /**
   * DEBUG レベルのログ
   * @param {string} message
   * @param {object} context
   */
  debug(message, context = null) {
    if (!this.enabled) return;
    const msg = this._format('DEBUG', message, context);
    console.log(msg);
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, msg + '\n');
      } catch (err) {
        console.error('[DebugLogger] Failed to write to log file:', err);
      }
    }
  }

  /**
   * INFO レベルのログ
   * @param {string} message
   * @param {object} context
   */
  info(message, context = null) {
    if (!this.enabled) return;
    const msg = this._format('INFO', message, context);
    console.log(msg);
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, msg + '\n');
      } catch (err) {
        console.error('[DebugLogger] Failed to write to log file:', err);
      }
    }
  }

  /**
   * WARN レベルのログ
   * @param {string} message
   * @param {object} context
   */
  warn(message, context = null) {
    if (!this.enabled) return;
    const msg = this._format('WARN', message, context);
    console.warn(msg);
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, msg + '\n');
      } catch (err) {
        console.error('[DebugLogger] Failed to write to log file:', err);
      }
    }
  }

  /**
   * ERROR レベルのログ（スタックトレース付き）
   * @param {string} message
   * @param {Error} error
   */
  error(message, error = null) {
    if (!this.enabled) return;
    let output = `[${new Date().toISOString()}] [ERROR] ${message}`;
    if (error && error.stack) {
      output += `\n${error.stack}`;
    }
    console.error(output);
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, output + '\n');
      } catch (err) {
        console.error('[DebugLogger] Failed to write to log file:', err);
      }
    }
  }

  /**
   * ログファイルをクローズ（アプリ終了時）
   */
  destroy() {
    // 同期書き込みなので、特別なクローズ処理は不要
  }
}

module.exports = new DebugLogger();
