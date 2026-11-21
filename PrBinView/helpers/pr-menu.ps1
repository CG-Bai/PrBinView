param(
    [ValidateSet('export-media', 'link-media')]
    [string]$Action = 'export-media',
    [switch]$CompileCheck
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

public static class PrBinViewMenuBridge {
    private const uint WM_COMMAND = 0x0111;
    private const uint WM_INITMENUPOPUP = 0x0117;
    private const uint MF_BYPOSITION = 0x00000400;
    private const uint MF_GRAYED = 0x00000001;
    private const uint MF_DISABLED = 0x00000002;
    private const uint MIIM_STRING = 0x00000040;
    private const uint GA_ROOT = 2;

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const ushort VK_SHIFT = 0x10;
    private const ushort VK_CONTROL = 0x11;
    private const ushort VK_ESCAPE = 0x1B;
    private const ushort VK_1 = 0x31;
    private const ushort VK_M = 0x4D;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion {
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MENUITEMINFO {
        public uint cbSize;
        public uint fMask;
        public uint fType;
        public uint fState;
        public uint wID;
        public IntPtr hSubMenu;
        public IntPtr hbmpChecked;
        public IntPtr hbmpUnchecked;
        public IntPtr dwItemData;
        public string dwTypeData;
        public uint cch;
        public IntPtr hbmpItem;
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetMenu(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetSubMenu(IntPtr hMenu, int nPos);

    [DllImport("user32.dll")]
    private static extern int GetMenuItemCount(IntPtr hMenu);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetMenuString(IntPtr hMenu, uint uIDItem, StringBuilder lpString, int nMaxCount, uint uFlag);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMenuItemInfo(IntPtr hMenu, uint uItem, bool fByPosition, ref MENUITEMINFO lpmii);

    [DllImport("user32.dll")]
    private static extern uint GetMenuItemID(IntPtr hMenu, int nPos);

    [DllImport("user32.dll")]
    private static extern uint GetMenuState(IntPtr hMenu, uint uId, uint uFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    private static INPUT KeyEvent(ushort vk, bool keyUp) {
        return new INPUT {
            type = INPUT_KEYBOARD,
            U = new InputUnion {
                ki = new KEYBDINPUT {
                    wVk = vk,
                    wScan = 0,
                    dwFlags = keyUp ? KEYEVENTF_KEYUP : 0,
                    time = 0,
                    dwExtraInfo = IntPtr.Zero
                }
            }
        };
    }

    private static void SendKey(ushort vk) {
        INPUT[] inputs = new INPUT[] { KeyEvent(vk, false), KeyEvent(vk, true) };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    private static void SendChord(ushort modVk, ushort keyVk) {
        INPUT[] inputs = new INPUT[] {
            KeyEvent(modVk, false),
            KeyEvent(keyVk, false),
            KeyEvent(keyVk, true),
            KeyEvent(modVk, true)
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    /* Always locate Premiere Pro's REAL main frame window (preferring a top-level window that owns an HMENU,
       never getting fooled by an undocked/floating CEP panel window!) */
    private static bool FindPremiereTarget(out IntPtr mainHwnd, out int pid) {
        mainHwnd = IntPtr.Zero;
        pid = 0;

        Process prProc = null;
        try {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero) {
                IntPtr root = GetAncestor(fg, GA_ROOT);
                if (root == IntPtr.Zero) root = fg;
                uint fgPid = 0;
                GetWindowThreadProcessId(root, out fgPid);
                if (fgPid != 0) {
                    Process p = Process.GetProcessById((int)fgPid);
                    if (p != null && p.ProcessName.IndexOf("Premiere", StringComparison.OrdinalIgnoreCase) >= 0) {
                        prProc = p;
                    }
                }
            }
        } catch {}

        if (prProc == null) {
            try {
                Process[] all = Process.GetProcesses();
                for (int i = 0; i < all.Length; i++) {
                    try {
                        if (all[i].MainWindowHandle != IntPtr.Zero &&
                            all[i].ProcessName.IndexOf("Premiere", StringComparison.OrdinalIgnoreCase) >= 0) {
                            prProc = all[i];
                            break;
                        }
                    } catch {}
                }
            } catch {}
        }

        if (prProc == null) return false;
        pid = prProc.Id;
        int targetPid = pid;
        IntPtr menuHwnd = IntPtr.Zero;
        IntPtr visibleFallback = IntPtr.Zero;

        EnumWindows((h, l) => {
            uint wPid = 0;
            GetWindowThreadProcessId(h, out wPid);
            if ((int)wPid != targetPid) return true;
            if (!IsWindowVisible(h)) return true;
            if (GetMenu(h) != IntPtr.Zero) {
                menuHwnd = h;
                return false;
            }
            if (visibleFallback == IntPtr.Zero) visibleFallback = h;
            return true;
        }, IntPtr.Zero);

        if (menuHwnd != IntPtr.Zero) {
            mainHwnd = menuHwnd;
            return true;
        }
        if (prProc.MainWindowHandle != IntPtr.Zero) {
            mainHwnd = prProc.MainWindowHandle;
            return true;
        }
        if (visibleFallback != IntPtr.Zero) {
            mainHwnd = visibleFallback;
            return true;
        }
        return false;
    }

    private static void TransferFocusToPremiereFrame(IntPtr hwnd) {
        uint fgPid = 0;
        uint prPid = 0;
        uint myTid = GetCurrentThreadId();
        IntPtr fgHwnd = GetForegroundWindow();
        uint fgTid = fgHwnd != IntPtr.Zero ? GetWindowThreadProcessId(fgHwnd, out fgPid) : 0;
        uint prTid = GetWindowThreadProcessId(hwnd, out prPid);

        bool attFg = false;
        bool attPr = false;
        try {
            if (fgTid != 0 && fgTid != myTid) attFg = AttachThreadInput(myTid, fgTid, true);
            if (prTid != 0 && prTid != myTid && prTid != fgTid) attPr = AttachThreadInput(myTid, prTid, true);
            SetForegroundWindow(hwnd);
            SetActiveWindow(hwnd);
            SetFocus(hwnd);
        } finally {
            if (attPr) AttachThreadInput(myTid, prTid, false);
            if (attFg) AttachThreadInput(myTid, fgTid, false);
        }
    }

    private static string CleanLabel(string raw) {
        if (string.IsNullOrEmpty(raw)) return "";
        int tabIdx = raw.IndexOf('\t');
        string s = tabIdx >= 0 ? raw.Substring(0, tabIdx) : raw;
        s = s.Replace("&", "").Replace("...", "").Replace("\u2026", "").Trim();
        int p = s.IndexOf('(');
        if (p > 0 && s.EndsWith(")")) s = s.Substring(0, p).Trim();
        return s;
    }

    private static bool LabelMatches(string candidate, string[] targets) {
        string clean = CleanLabel(candidate);
        if (string.IsNullOrEmpty(clean)) return false;
        for (int i = 0; i < targets.Length; i++) {
            if (string.Equals(clean, targets[i], StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static bool LabelContains(string candidate, string[] targets) {
        string clean = CleanLabel(candidate);
        if (string.IsNullOrEmpty(clean)) return false;
        for (int i = 0; i < targets.Length; i++) {
            if (clean.IndexOf(targets[i], StringComparison.OrdinalIgnoreCase) >= 0) return true;
        }
        return false;
    }

    private static string ReadMenuText(IntPtr hMenu, int pos) {
        try {
            MENUITEMINFO mii = new MENUITEMINFO();
            mii.cbSize = (uint)Marshal.SizeOf(typeof(MENUITEMINFO));
            mii.fMask = MIIM_STRING;
            mii.dwTypeData = null;
            if (GetMenuItemInfo(hMenu, (uint)pos, true, ref mii) && mii.cch > 0) {
                mii.cch += 1;
                mii.dwTypeData = new string('\0', (int)mii.cch);
                if (GetMenuItemInfo(hMenu, (uint)pos, true, ref mii) && !string.IsNullOrEmpty(mii.dwTypeData)) {
                    string cleaned = CleanLabel(mii.dwTypeData);
                    if (!string.IsNullOrEmpty(cleaned)) return cleaned;
                }
            }
        } catch {}

        StringBuilder sb = new StringBuilder(256);
        int len = GetMenuString(hMenu, (uint)pos, sb, sb.Capacity, MF_BYPOSITION);
        return len > 0 ? CleanLabel(sb.ToString()) : "";
    }

    private static int FindHMenuIndex(IntPtr hMenu, string[] targets) {
        int count = GetMenuItemCount(hMenu);
        for (int i = 0; i < count; i++) {
            if (LabelMatches(ReadMenuText(hMenu, i), targets)) return i;
        }
        for (int i = 0; i < count; i++) {
            if (LabelContains(ReadMenuText(hMenu, i), targets)) return i;
        }
        return -1;
    }

    private static List<string[]> GetMenuPath(string action) {
        var path = new List<string[]>();
        if (action == "link-media") {
            path.Add(new string[] { "File", "\u6587\u4ef6" });
            path.Add(new string[] { "Link Media", "\u94fe\u63a5\u5a92\u4f53" });
        } else if (action == "export-media") {
            path.Add(new string[] { "File", "\u6587\u4ef6" });
            path.Add(new string[] { "Export", "\u5bfc\u51fa" });
            path.Add(new string[] { "Media", "\u5a92\u4f53" });
        }
        return path;
    }

    private static bool TryFocusProjectPanelViaMenu(IntPtr hwnd) {
        IntPtr hMenu = GetMenu(hwnd);
        if (hMenu == IntPtr.Zero) return false;
        int winIdx = FindHMenuIndex(hMenu, new string[] { "Window", "\u7a97\u53e3" });
        if (winIdx < 0) return false;
        IntPtr hWin = GetSubMenu(hMenu, winIdx);
        if (hWin == IntPtr.Zero) return false;
        SendMessage(hwnd, WM_INITMENUPOPUP, hWin, (IntPtr)winIdx);
        int projIdx = FindHMenuIndex(hWin, new string[] { "Projects", "Project", "\u9879\u76ee" });
        if (projIdx < 0) return false;
        IntPtr hSub = GetSubMenu(hWin, projIdx);
        if (hSub != IntPtr.Zero) {
            SendMessage(hwnd, WM_INITMENUPOPUP, hSub, (IntPtr)projIdx);
            uint subCmd = GetMenuItemID(hSub, 0);
            if (subCmd != 0 && subCmd != 0xFFFFFFFF) {
                PostMessage(hwnd, WM_COMMAND, (IntPtr)subCmd, IntPtr.Zero);
                return true;
            }
            return false;
        }
        uint cmdId = GetMenuItemID(hWin, projIdx);
        if (cmdId != 0 && cmdId != 0xFFFFFFFF) {
            PostMessage(hwnd, WM_COMMAND, (IntPtr)cmdId, IntPtr.Zero);
            return true;
        }
        return false;
    }

    /* Engine 1: Standard Win32 HMENU walk + WM_INITMENUPOPUP + WM_COMMAND */
    private static string TryInvokeHMenu(IntPtr hwnd, List<string[]> path) {
        IntPtr curMenu = GetMenu(hwnd);
        if (curMenu == IntPtr.Zero) return "NO_HMENU";

        for (int step = 0; step < path.Count; step++) {
            int idx = FindHMenuIndex(curMenu, path[step]);
            if (idx < 0) return "HMENU_MISS_" + step;

            bool isLast = (step == path.Count - 1);
            if (isLast) {
                uint st = GetMenuState(curMenu, (uint)idx, MF_BYPOSITION);
                if ((st & (MF_GRAYED | MF_DISABLED)) != 0) return "DISABLED";
                uint cmdId = GetMenuItemID(curMenu, idx);
                if (cmdId == 0 || cmdId == 0xFFFFFFFF) return "INVALID_CMD";
                PostMessage(hwnd, WM_COMMAND, (IntPtr)cmdId, IntPtr.Zero);
                return "OK:HMENU:" + cmdId;
            } else {
                IntPtr sub = GetSubMenu(curMenu, idx);
                if (sub == IntPtr.Zero) return "HMENU_NOSUB_" + step;
                SendMessage(hwnd, WM_INITMENUPOPUP, sub, (IntPtr)idx);
                curMenu = sub;
            }
        }
        return "HMENU_END";
    }

    /* Engine 2: Fast STA UI Automation (depth 1 + depth 2 MenuBar lookup) */
    private static AutomationElement FindMenuBarFast(AutomationElement win) {
        var barCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuBar);
        AutomationElement bar = win.FindFirst(TreeScope.Children, barCond);
        if (bar != null) return bar;
        try {
            AutomationElementCollection kids = win.FindAll(TreeScope.Children, Condition.TrueCondition);
            for (int i = 0; i < kids.Count && i < 16; i++) {
                bar = kids[i].FindFirst(TreeScope.Children, barCond);
                if (bar != null) return bar;
            }
        } catch {}
        return null;
    }

    private static AutomationElement FindUiaMenuItem(AutomationElement scope, IntPtr mainHwnd, int pid, string[] targets, bool searchPopups) {
        var menuItemCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem);
        var candidates = new List<AutomationElement>();

        if (scope != null) {
            try {
                AutomationElementCollection found = scope.FindAll(TreeScope.Children, menuItemCond);
                for (int i = 0; i < found.Count; i++) candidates.Add(found[i]);
                if (candidates.Count == 0) {
                    found = scope.FindAll(TreeScope.Descendants, menuItemCond);
                    for (int i = 0; i < found.Count; i++) candidates.Add(found[i]);
                }
            } catch {}
        }

        if (searchPopups) {
            try {
                int mainHandleInt = mainHwnd.ToInt32();
                var pidCond = new PropertyCondition(AutomationElement.ProcessIdProperty, pid);
                var menuCond = new AndCondition(pidCond, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Menu));
                AutomationElementCollection menus = AutomationElement.RootElement.FindAll(TreeScope.Children, menuCond);
                for (int m = 0; m < menus.Count; m++) {
                    AutomationElementCollection items = menus[m].FindAll(TreeScope.Descendants, menuItemCond);
                    for (int i = 0; i < items.Count; i++) candidates.Add(items[i]);
                }
                var winCond = new AndCondition(pidCond, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));
                AutomationElementCollection wins = AutomationElement.RootElement.FindAll(TreeScope.Children, winCond);
                for (int w = 0; w < wins.Count; w++) {
                    try { if (wins[w].Current.NativeWindowHandle == mainHandleInt) continue; } catch {}
                    AutomationElementCollection items = wins[w].FindAll(TreeScope.Descendants, menuItemCond);
                    for (int i = 0; i < items.Count; i++) candidates.Add(items[i]);
                }
            } catch {}
        }

        foreach (AutomationElement el in candidates) {
            try { if (LabelMatches(el.Current.Name, targets)) return el; } catch {}
        }
        foreach (AutomationElement el in candidates) {
            try { if (LabelContains(el.Current.Name, targets)) return el; } catch {}
        }
        return null;
    }

    private static bool ExpandUiaItem(AutomationElement el) {
        object patObj;
        if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out patObj)) {
            ((ExpandCollapsePattern)patObj).Expand();
            return true;
        }
        if (el.TryGetCurrentPattern(InvokePattern.Pattern, out patObj)) {
            ((InvokePattern)patObj).Invoke();
            return true;
        }
        return false;
    }

    private static string TryInvokeUia(IntPtr hwnd, int pid, List<string[]> path) {
        try {
            AutomationElement win = AutomationElement.FromHandle(hwnd);
            if (win == null) return "UIA_NO_WIN";

            AutomationElement menuBar = FindMenuBarFast(win);
            if (menuBar == null) return "UIA_NO_MENUBAR";

            AutomationElement curScope = menuBar;
            for (int step = 0; step < path.Count; step++) {
                AutomationElement item = FindUiaMenuItem(curScope, hwnd, pid, path[step], step > 0);
                if (item == null) {
                    if (step > 0) SendKey(VK_ESCAPE);
                    return "UIA_MISS_" + step;
                }

                bool isLast = (step == path.Count - 1);
                if (isLast) {
                    if (!item.Current.IsEnabled) {
                        SendKey(VK_ESCAPE);
                        return "DISABLED";
                    }
                    object invObj;
                    if (item.TryGetCurrentPattern(InvokePattern.Pattern, out invObj)) {
                        ((InvokePattern)invObj).Invoke();
                        return "OK:UIA";
                    }
                    SendKey(VK_ESCAPE);
                    return "UIA_NO_INVOKE";
                } else {
                    if (!item.Current.IsEnabled) {
                        if (step > 0) SendKey(VK_ESCAPE);
                        return "DISABLED_PARENT_" + step;
                    }
                    if (!ExpandUiaItem(item)) {
                        if (step > 0) SendKey(VK_ESCAPE);
                        return "UIA_NO_EXPAND_" + step;
                    }
                    Thread.Sleep(110);
                    curScope = item;
                }
            }
            return "UIA_END";
        } catch (Exception ex) {
            try { SendKey(VK_ESCAPE); } catch {}
            return "UIA_ERR:" + ex.Message;
        }
    }

    public static string Execute(string action) {
        IntPtr hwnd;
        int pid;
        if (!FindPremiereTarget(out hwnd, out pid)) return "NO_PREMIERE_WINDOW";

        List<string[]> path = GetMenuPath(action);
        if (path.Count == 0) return "UNKNOWN_ACTION";

        TransferFocusToPremiereFrame(hwnd);
        Thread.Sleep(60);

        bool menuFocused = TryFocusProjectPanelViaMenu(hwnd);
        if (!menuFocused) {
            SendChord(VK_SHIFT, VK_1);
        } else {
            Thread.Sleep(90);
            SendChord(VK_SHIFT, VK_1);
        }
        Thread.Sleep(220);

        string hRes = "";
        for (int attempt = 0; attempt < 3; attempt++) {
            hRes = TryInvokeHMenu(hwnd, path);
            if (hRes.StartsWith("OK:")) return hRes;
            if (hRes == "NO_HMENU" || hRes.StartsWith("HMENU_MISS_")) break;
            Thread.Sleep(120);
        }

        string uRes = TryInvokeUia(hwnd, pid, path);
        if (uRes.StartsWith("OK:")) return uRes;

        if (action == "export-media") {
            TransferFocusToPremiereFrame(hwnd);
            Thread.Sleep(40);
            SendChord(VK_SHIFT, VK_1);
            Thread.Sleep(140);
            SendChord(VK_CONTROL, VK_M);
            return "OK:SHORTCUT_CTRL_M";
        }

        return hRes + "|" + uRes;
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies UIAutomationClient, UIAutomationTypes -ErrorAction Stop

if ($CompileCheck) {
    Write-Output 'PR_MENU_COMPILE_OK'
    exit 0
}

$result = [PrBinViewMenuBridge]::Execute($Action)
Write-Output $result
if ($result -like 'OK:*') { exit 0 } else { exit 1 }
