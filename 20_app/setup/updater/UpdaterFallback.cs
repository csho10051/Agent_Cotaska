using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;

internal static class UpdaterFallback
{
    private sealed class Options
    {
        public string ZipPath;
        public string PortableRoot;
        public string Version;
    }

    private static string workLogPath;
    private static string portableLogPath;

    private static int Main(string[] args)
    {
        string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        string extractRoot = Path.Combine(Path.GetTempPath(), "Cotaska-update-extract-" + timestamp);
        string backupPath = null;

        try
        {
            Options options = ParseOptions(args);
            string exeDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName) ?? AppDomain.CurrentDomain.BaseDirectory;
            string logDir = Path.Combine(options.PortableRoot, "logs");
            workLogPath = Path.Combine(exeDir, "portable-update-" + timestamp + ".log");
            portableLogPath = Path.Combine(logDir, "portable-update-" + timestamp + ".log");

            WriteLog("Portable update started. Version=" + (options.Version ?? ""));
            WriteLog("Portable root: " + options.PortableRoot);
            WriteLog("Zip path: " + options.ZipPath);

            if (!Directory.Exists(options.PortableRoot))
            {
                throw new DirectoryNotFoundException("Portable root was not found: " + options.PortableRoot);
            }
            if (!File.Exists(options.ZipPath))
            {
                throw new FileNotFoundException("Update zip was not found: " + options.ZipPath);
            }

            WaitForCotaskaExit(options.PortableRoot);

            DeleteDirectoryIfExists(extractRoot);
            Directory.CreateDirectory(extractRoot);
            ZipFile.ExtractToDirectory(options.ZipPath, extractRoot);

            string sourceRoot = Path.Combine(extractRoot, "Cotaska-Portable");
            ValidateSourceRoot(sourceRoot);

            string backupDir = Path.Combine(options.PortableRoot, "backup");
            Directory.CreateDirectory(backupDir);
            backupPath = Path.Combine(backupDir, "portable-update-before-" + timestamp);
            Directory.CreateDirectory(backupPath);
            WriteLog("Creating backup: " + backupPath);
            BackupCurrentFiles(options.PortableRoot, backupPath);

            WriteLog("Replacing application files");
            ReplaceApplicationFiles(options.PortableRoot, sourceRoot);

            WriteLog("Portable update completed");
            RestartCotaska(options.PortableRoot);
            WriteLog("Cotaska restart requested");
            return 0;
        }
        catch (Exception ex)
        {
            WriteLog("Portable update failed: " + ex.Message);
            if (!string.IsNullOrEmpty(backupPath))
            {
                try
                {
                    RestoreFromBackup(backupPath, GetPortableRootFromArgs(args));
                }
                catch (Exception restoreEx)
                {
                    WriteLog("Restore failed: " + restoreEx.Message);
                }
            }
            return 1;
        }
        finally
        {
            DeleteDirectoryIfExists(extractRoot);
        }
    }

    private static Options ParseOptions(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i++)
        {
            string key = args[i];
            if (!key.StartsWith("--", StringComparison.Ordinal) || i + 1 >= args.Length)
            {
                continue;
            }
            values[key.Substring(2)] = args[++i];
        }

        var options = new Options
        {
            ZipPath = GetRequired(values, "zip"),
            PortableRoot = GetRequired(values, "portable-root"),
            Version = values.ContainsKey("version") ? values["version"] : ""
        };
        return options;
    }

    private static string GetPortableRootFromArgs(string[] args)
    {
        try
        {
            return ParseOptions(args).PortableRoot;
        }
        catch
        {
            return null;
        }
    }

    private static string GetRequired(Dictionary<string, string> values, string key)
    {
        string value;
        if (!values.TryGetValue(key, out value) || string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Missing required option: --" + key);
        }
        return Path.GetFullPath(value);
    }

    private static void WriteLog(string message)
    {
        string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine;
        TryAppend(workLogPath, line);
        TryAppend(portableLogPath, line);
    }

    private static void TryAppend(string path, string line)
    {
        if (string.IsNullOrEmpty(path))
        {
            return;
        }
        try
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }
            File.AppendAllText(path, line);
        }
        catch
        {
            // Updater execution should continue even when one log destination is unavailable.
        }
    }

    private static void WaitForCotaskaExit(string portableRoot)
    {
        for (int i = 0; i < 120; i++)
        {
            List<Process> running = GetCotaskaProcesses(portableRoot);
            if (running.Count == 0)
            {
                return;
            }
            if (i == 0 || i % 10 == 0)
            {
                WriteLog("Waiting for Cotaska processes: " + string.Join(", ", running.Select(p => p.ProcessName + "#" + p.Id).ToArray()));
            }
            System.Threading.Thread.Sleep(1000);
        }

        List<Process> remaining = GetCotaskaProcesses(portableRoot);
        if (remaining.Count > 0)
        {
            throw new InvalidOperationException("Cotaska process is still running: " + string.Join(", ", remaining.Select(p => p.ProcessName + "#" + p.Id).ToArray()));
        }
    }

    private static List<Process> GetCotaskaProcesses(string portableRoot)
    {
        string rootPrefix = EnsureTrailingSeparator(Path.GetFullPath(portableRoot));
        var result = new List<Process>();
        foreach (string name in new[] { "Cotaska", "CotaskaCore" })
        {
            foreach (Process process in Process.GetProcessesByName(name))
            {
                try
                {
                    string path = process.MainModule.FileName;
                    if (!string.IsNullOrEmpty(path) && path.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        result.Add(process);
                    }
                    else
                    {
                        process.Dispose();
                    }
                }
                catch
                {
                    process.Dispose();
                }
            }
        }
        return result;
    }

    private static string EnsureTrailingSeparator(string path)
    {
        if (path.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal))
        {
            return path;
        }
        return path + Path.DirectorySeparatorChar;
    }

    private static void ValidateSourceRoot(string sourceRoot)
    {
        if (!Directory.Exists(sourceRoot))
        {
            throw new DirectoryNotFoundException("Cotaska-Portable root was not found in update zip.");
        }
        foreach (string required in new[] { "Cotaska.exe", "_app", Path.Combine("_app", "resources", "app.asar") })
        {
            string path = Path.Combine(sourceRoot, required);
            if (!File.Exists(path) && !Directory.Exists(path))
            {
                throw new FileNotFoundException("Required update item was not found: " + required);
            }
        }
    }

    private static void BackupCurrentFiles(string portableRoot, string backupPath)
    {
        CopyFileIfExists(Path.Combine(portableRoot, "Cotaska.exe"), Path.Combine(backupPath, "Cotaska.exe"));
        CopyDirectoryIfExists(Path.Combine(portableRoot, "_app"), Path.Combine(backupPath, "_app"));
        CopyDirectoryIfExists(Path.Combine(portableRoot, "tools"), Path.Combine(backupPath, "tools"));
        CopyMatchingFiles(portableRoot, backupPath, "Cotaska_AI*.md");
        CopyFileIfExists(Path.Combine(portableRoot, "README.md"), Path.Combine(backupPath, "README.md"));
    }

    private static void ReplaceApplicationFiles(string portableRoot, string sourceRoot)
    {
        File.Copy(Path.Combine(sourceRoot, "Cotaska.exe"), Path.Combine(portableRoot, "Cotaska.exe"), true);
        ReplaceDirectory(Path.Combine(sourceRoot, "_app"), Path.Combine(portableRoot, "_app"));
        string sourceTools = Path.Combine(sourceRoot, "tools");
        if (Directory.Exists(sourceTools))
        {
            ReplaceDirectory(sourceTools, Path.Combine(portableRoot, "tools"));
        }
        CopyMatchingFiles(sourceRoot, portableRoot, "Cotaska_AI*.md");
        CopyFileIfExists(Path.Combine(sourceRoot, "README.md"), Path.Combine(portableRoot, "README.md"));
    }

    private static void RestoreFromBackup(string backupPath, string portableRoot)
    {
        if (string.IsNullOrEmpty(portableRoot) || !Directory.Exists(backupPath))
        {
            return;
        }
        WriteLog("Restoring from backup: " + backupPath);
        CopyFileIfExists(Path.Combine(backupPath, "Cotaska.exe"), Path.Combine(portableRoot, "Cotaska.exe"));
        CopyDirectoryIfExists(Path.Combine(backupPath, "_app"), Path.Combine(portableRoot, "_app"));
        CopyDirectoryIfExists(Path.Combine(backupPath, "tools"), Path.Combine(portableRoot, "tools"));
        CopyMatchingFiles(backupPath, portableRoot, "Cotaska_AI*.md");
        CopyFileIfExists(Path.Combine(backupPath, "README.md"), Path.Combine(portableRoot, "README.md"));
    }

    private static void RestartCotaska(string portableRoot)
    {
        string exePath = Path.Combine(portableRoot, "Cotaska.exe");
        if (!File.Exists(exePath))
        {
            throw new FileNotFoundException("Cotaska.exe was not found after update: " + exePath);
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = portableRoot,
            UseShellExecute = true
        });
    }

    private static void ReplaceDirectory(string source, string destination)
    {
        DeleteDirectoryIfExists(destination);
        CopyDirectory(source, destination);
    }

    private static void CopyDirectoryIfExists(string source, string destination)
    {
        if (Directory.Exists(source))
        {
            CopyDirectory(source, destination);
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(destination, GetRelativePath(source, dir)));
        }
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string target = Path.Combine(destination, GetRelativePath(source, file));
            string targetDir = Path.GetDirectoryName(target);
            if (!string.IsNullOrEmpty(targetDir))
            {
                Directory.CreateDirectory(targetDir);
            }
            File.Copy(file, target, true);
        }
    }

    private static string GetRelativePath(string root, string path)
    {
        Uri rootUri = new Uri(EnsureTrailingSeparator(Path.GetFullPath(root)));
        Uri pathUri = new Uri(Path.GetFullPath(path));
        return Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString()).Replace('/', Path.DirectorySeparatorChar);
    }

    private static void CopyMatchingFiles(string sourceDir, string destinationDir, string pattern)
    {
        if (!Directory.Exists(sourceDir))
        {
            return;
        }
        foreach (string file in Directory.GetFiles(sourceDir, pattern, SearchOption.TopDirectoryOnly))
        {
            CopyFileIfExists(file, Path.Combine(destinationDir, Path.GetFileName(file)));
        }
    }

    private static void CopyFileIfExists(string source, string destination)
    {
        if (!File.Exists(source))
        {
            return;
        }
        string dir = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }
        File.Copy(source, destination, true);
    }

    private static void DeleteDirectoryIfExists(string path)
    {
        if (!string.IsNullOrEmpty(path) && Directory.Exists(path))
        {
            Directory.Delete(path, true);
        }
    }
}
