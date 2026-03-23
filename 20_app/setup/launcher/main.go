//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

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
	// 自刁E�E身のEXEと同じフォルダを基準に本体EXEを解決
	exePath, err := os.Executable()
	if err != nil {
		showError("Cotaska Launcher Error", err.Error())
		os.Exit(1)
	}

	target := filepath.Join(filepath.Dir(exePath), "_app", "Cotaska.exe")
	if _, err := os.Stat(target); err != nil {
		showError("Cotaska Launcher Error", "_app\\Cotaska.exe was not found. Please rebuild release package.")
		os.Exit(1)
	}

	cmd := exec.Command(target)
	// コンソールウィンドウを表示しなぁE
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	// 作業チE��レクトリめE_app/ に設定！Electron が相対パスを解決できるよう�E�E
	cmd.Dir = filepath.Dir(target)

	if err := cmd.Start(); err != nil {
		showError("Cotaska Launcher Error", err.Error())
		os.Exit(1)
	}
	// 本体�E終亁E��征E��ずにランチャー自身は即終亁E
}
