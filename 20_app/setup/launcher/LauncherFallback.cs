using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class LauncherFallback
{
    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    private static void AppendLauncherLog(string logPath, string message)
    {
        try
        {
            File.AppendAllText(
                logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine
            );
        }
        catch
        {
            // The launcher must not fail just because logging is unavailable.
        }
    }

    [STAThread]
    private static int Main()
    {
        string exePath = Application.ExecutablePath;
        string launcherDir = Path.GetDirectoryName(exePath) ?? AppDomain.CurrentDomain.BaseDirectory;
        string launcherLogPath = Path.Combine(launcherDir, "launcher.log");
        AppendLauncherLog(launcherLogPath, "Launcher start: exePath=" + exePath);

        string target = Path.Combine(launcherDir, "_app", "CotaskaCore.exe");
        AppendLauncherLog(launcherLogPath, "Target resolved: " + target);
        if (!File.Exists(target))
        {
            AppendLauncherLog(launcherLogPath, "Target missing");
            MessageBox.Show(
                "_app\\CotaskaCore.exe was not found. Please rebuild release package.",
                "Cotaska Launcher Error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }

        try
        {
            var process = new Process();
            process.StartInfo.FileName = target;
            process.StartInfo.WorkingDirectory = Path.GetDirectoryName(target) ?? launcherDir;
            process.StartInfo.UseShellExecute = false;
            process.StartInfo.CreateNoWindow = true;
            process.StartInfo.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            AppendLauncherLog(launcherLogPath, "Starting child process in dir=" + process.StartInfo.WorkingDirectory);

            process.Start();
            AppendLauncherLog(launcherLogPath, "Child started successfully: pid=" + process.Id);
            AllowSetForegroundWindow(process.Id);
            AppendLauncherLog(launcherLogPath, "AllowSetForegroundWindow called: pid=" + process.Id);
            return 0;
        }
        catch (Exception ex)
        {
            AppendLauncherLog(launcherLogPath, "Child start failed: " + ex.Message);
            MessageBox.Show(ex.Message, "Cotaska Launcher Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
