param(
    [int]$ParentPid = 0,
    [uint32]$Modifiers = 1,
    [uint32]$Vk = 70,
    [switch]$CompileCheck
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms

$cs = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public sealed class PrBinViewHotkeyWindow : NativeWindow, IDisposable {
    private const int HOTKEY_ID = 0x5042;
    private const uint MOD_NOREPEAT = 0x4000;

    private const int WM_HOTKEY = 0x0312;
    private const int WM_APP_QUIT = 0x8001;
    private const int WM_APP_UPDATE = 0x8002;
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const uint GA_ROOTOWNER = 3;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    private delegate void WinEventDelegate(
        IntPtr hWinEventHook,
        uint eventType,
        IntPtr hwnd,
        int idObject,
        int idChild,
        uint dwEventThread,
        uint dwmsEventTime
    );

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr hmodWinEventProc,
        WinEventDelegate lpfnWinEventProc,
        uint idProcess,
        uint idThread,
        uint dwFlags
    );

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private readonly int _parentPid;
    private readonly WinEventDelegate _winEventProc;
    private readonly object _keyLock = new object();
    private IntPtr _winEventHook = IntPtr.Zero;
    private System.Windows.Forms.Timer _watchdog;
    private uint _modifiers;
    private uint _vk;
    private uint _pendingModifiers;
    private uint _pendingVk;
    private bool _registered = false;
    private bool _disposed = false;
    private long _lastTriggerTicks = 0;

    public PrBinViewHotkeyWindow(int parentPid, uint modifiers, uint vk) {
        _parentPid = parentPid;
        _modifiers = modifiers & 0x000Fu;
        _vk = vk;
        _pendingModifiers = _modifiers;
        _pendingVk = _vk;
        _winEventProc = new WinEventDelegate(OnForegroundChanged);

        CreateParams cp = new CreateParams();
        cp.Caption = "PrBinViewHotkeyMessageWindow";
        cp.Parent = new IntPtr(-3); /* HWND_MESSAGE */
        CreateHandle(cp);

        _winEventHook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero,
            _winEventProc,
            0,
            0,
            WINEVENT_OUTOFCONTEXT
        );

        _watchdog = new System.Windows.Forms.Timer();
        _watchdog.Interval = 500;
        _watchdog.Tick += new EventHandler(OnWatchdogTick);
        _watchdog.Start();

        SyncHotkeyState();
        StartStdinWatcher(this.Handle);

        Console.Out.WriteLine("READY:" + _modifiers + ":" + _vk);
        Console.Out.Flush();
    }

    private void StartStdinWatcher(IntPtr targetHwnd) {
        Thread th = new Thread(delegate() {
            try {
                string line;
                while ((line = Console.In.ReadLine()) != null) {
                    string trimmed = line.Trim();
                    if (trimmed.Equals("EXIT", StringComparison.OrdinalIgnoreCase)) {
                        break;
                    }
                    if (trimmed.StartsWith("SET:", StringComparison.OrdinalIgnoreCase)) {
                        string[] parts = trimmed.Split(':');
                        uint nextMods;
                        uint nextVk;
                        if (parts.Length >= 3 && uint.TryParse(parts[1], out nextMods) && uint.TryParse(parts[2], out nextVk) && nextVk > 0) {
                            lock (_keyLock) {
                                _pendingModifiers = nextMods & 0x000Fu;
                                _pendingVk = nextVk;
                            }
                            if (targetHwnd != IntPtr.Zero) {
                                PostMessage(targetHwnd, WM_APP_UPDATE, IntPtr.Zero, IntPtr.Zero);
                            }
                        }
                    }
                }
            } catch {
            } finally {
                if (targetHwnd != IntPtr.Zero) {
                    PostMessage(targetHwnd, WM_APP_QUIT, IntPtr.Zero, IntPtr.Zero);
                }
            }
        });
        th.IsBackground = true;
        th.Start();
    }

    private static string GetProcessBaseName(uint pid) {
        if (pid == 0) return string.Empty;
        IntPtr hProc = IntPtr.Zero;
        try {
            hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc != IntPtr.Zero) {
                StringBuilder sb = new StringBuilder(512);
                uint sz = (uint)sb.Capacity;
                if (QueryFullProcessImageName(hProc, 0, sb, ref sz) && sz > 0) {
                    string full = sb.ToString();
                    int slash = full.LastIndexOf('\\');
                    string file = (slash >= 0) ? full.Substring(slash + 1) : full;
                    if (file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                        file = file.Substring(0, file.Length - 4);
                    }
                    return file;
                }
            }
        } catch {
        } finally {
            if (hProc != IntPtr.Zero) CloseHandle(hProc);
        }
        try {
            using (Process p = Process.GetProcessById((int)pid)) {
                return p.ProcessName ?? string.Empty;
            }
        } catch {
            return string.Empty;
        }
    }

    private bool IsTargetProcess(uint pid) {
        if (pid == 0) return false;
        if (_parentPid > 0 && pid == (uint)_parentPid) return true;
        string name = GetProcessBaseName(pid);
        if (string.IsNullOrEmpty(name)) return false;
        return name.StartsWith("Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase);
    }

    private bool IsPremiereForeground() {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        uint fgPid = 0;
        GetWindowThreadProcessId(fg, out fgPid);
        if (IsTargetProcess(fgPid)) return true;

        IntPtr root = GetAncestor(fg, GA_ROOTOWNER);
        if (root != IntPtr.Zero && root != fg) {
            uint rootPid = 0;
            GetWindowThreadProcessId(root, out rootPid);
            if (IsTargetProcess(rootPid)) return true;
        }
        return false;
    }

    private bool IsParentAlive() {
        if (_parentPid <= 0) return true;
        try {
            using (Process p = Process.GetProcessById(_parentPid)) {
                return !p.HasExited;
            }
        } catch (ArgumentException) {
            return false;
        } catch {
            return true;
        }
    }

    private void SyncHotkeyState() {
        if (_disposed || this.Handle == IntPtr.Zero) return;
        bool want = IsPremiereForeground() && _vk > 0;
        if (want && !_registered) {
            if (RegisterHotKey(this.Handle, HOTKEY_ID, _modifiers | MOD_NOREPEAT, _vk)) {
                _registered = true;
            }
        } else if (!want && _registered) {
            UnregisterHotKey(this.Handle, HOTKEY_ID);
            _registered = false;
        }
    }

    private void ApplyPendingHotkey() {
        if (_disposed || this.Handle == IntPtr.Zero) return;
        uint nextMods;
        uint nextVk;
        lock (_keyLock) {
            nextMods = _pendingModifiers;
            nextVk = _pendingVk;
        }
        if (nextMods == _modifiers && nextVk == _vk) return;
        if (_registered) {
            UnregisterHotKey(this.Handle, HOTKEY_ID);
            _registered = false;
        }
        _modifiers = nextMods;
        _vk = nextVk;
        SyncHotkeyState();
        Console.Out.WriteLine("UPDATED:" + _modifiers + ":" + _vk);
        Console.Out.Flush();
    }

    private void OnForegroundChanged(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime) {
        SyncHotkeyState();
    }

    private void OnWatchdogTick(object sender, EventArgs e) {
        if (!IsParentAlive()) {
            QuitLoop();
            return;
        }
        SyncHotkeyState();
    }

    private void QuitLoop() {
        Dispose();
        Application.ExitThread();
    }

    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID) {
            long now = DateTime.UtcNow.Ticks;
            if ((now - _lastTriggerTicks) >= 1200000L && IsPremiereForeground()) {
                _lastTriggerTicks = now;
                Console.Out.WriteLine("TRIGGER:reveal");
                Console.Out.Flush();
            }
            return;
        }
        if (m.Msg == WM_APP_UPDATE) {
            ApplyPendingHotkey();
            return;
        }
        if (m.Msg == WM_APP_QUIT) {
            QuitLoop();
            return;
        }
        base.WndProc(ref m);
    }

    public void Dispose() {
        if (_disposed) return;
        _disposed = true;
        try {
            if (_watchdog != null) {
                _watchdog.Stop();
                _watchdog.Dispose();
                _watchdog = null;
            }
        } catch {}
        try {
            if (_winEventHook != IntPtr.Zero) {
                UnhookWinEvent(_winEventHook);
                _winEventHook = IntPtr.Zero;
            }
        } catch {}
        try {
            if (_registered && this.Handle != IntPtr.Zero) {
                UnregisterHotKey(this.Handle, HOTKEY_ID);
                _registered = false;
            }
        } catch {}
        try {
            if (this.Handle != IntPtr.Zero) {
                DestroyHandle();
            }
        } catch {}
    }

    public static void Run(int parentPid, uint modifiers, uint vk) {
        using (PrBinViewHotkeyWindow win = new PrBinViewHotkeyWindow(parentPid, modifiers, vk)) {
            Application.Run();
        }
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp -ReferencedAssemblies System.Windows.Forms

if ($CompileCheck) {
    Write-Output 'OK:COMPILED'
    exit 0
}

[PrBinViewHotkeyWindow]::Run($ParentPid, $Modifiers, $Vk)
