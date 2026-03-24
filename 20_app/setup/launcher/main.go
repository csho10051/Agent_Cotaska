//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

func appendLauncherLog(logPath string, message string) {
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	line := fmt.Sprintf("%s %s\n", time.Now().Format("2006-01-02 15:04:05.000"), message)
	_, _ = f.WriteString(line)
}

// allowSetForegroundWindow は子プロセスが Windows のフォアグラウンド制限を
// 回避してウィンドウを前面に表示できるよう権限を付与する。
func allowSetForegroundWindow(pid uint32) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("AllowSetForegroundWindow")
	_, _, _ = proc.Call(uintptr(pid))
}

func showError(title string, message string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBoxW := user32.NewProc("MessageBoxW")
	_, _, _ = messageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(message))),
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(title))),
		0x00000010,
	)
}

func main() {
	// 自身のEXEと同じフォルダを基準に本体EXEを解決
	exePath, err := os.Executable()
	if err != nil {
		showError("Cotaska Launcher Error", err.Error())
		os.Exit(1)
	}

	launcherDir := filepath.Dir(exePath)
	launcherLogPath := filepath.Join(launcherDir, "launcher.log")
	appendLauncherLog(launcherLogPath, "Launcher start: exePath="+exePath)

	target := filepath.Join(launcherDir, "_app", "Cotaska.exe")
	appendLauncherLog(launcherLogPath, "Target resolved: "+target)
	if _, err := os.Stat(target); err != nil {
		appendLauncherLog(launcherLogPath, "Target missing: "+err.Error())
		showError("Cotaska Launcher Error", "_app\\Cotaska.exe was not found. Please rebuild release package.")
		os.Exit(1)
	}

	cmd := exec.Command(target)
	// コンソールウィンドウを表示しない
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	// 作業ディレクトリを _app/ に設定（Electron が相対パスを解決できるように）
	cmd.Dir = filepath.Dir(target)
	appendLauncherLog(launcherLogPath, "Starting child process in dir="+cmd.Dir)

	if err := cmd.Start(); err != nil {
		appendLauncherLog(launcherLogPath, "Child start failed: "+err.Error())
		showError("Cotaska Launcher Error", err.Error())
		os.Exit(1)
	}
	appendLauncherLog(launcherLogPath, fmt.Sprintf("Child started successfully: pid=%d", cmd.Process.Pid))

	// Windows フォアグラウンドロック回避:
	// 子プロセスがウィンドウをフォアグラウンドに持ってこられるよう権限を付与する
	allowSetForegroundWindow(uint32(cmd.Process.Pid))
	appendLauncherLog(launcherLogPath, fmt.Sprintf("AllowSetForegroundWindow called: pid=%d", cmd.Process.Pid))

	// 本体の終了を待たずにランチャー自身は即終了
}
