param(
    [ValidateSet('files', 'single', 'folders')]
    [string]$Mode = 'files',
    [string]$Title = '',
    [string]$InitialDir = '',
    [switch]$CompileCheck
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$nativeDialogCs = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class PrBinViewNativeDialog {
    private const uint FOS_PICKFOLDERS      = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM  = 0x00000040;
    private const uint FOS_ALLOWMULTISELECT = 0x00000200;
    private const uint FOS_PATHMUSTEXIST    = 0x00000800;
    private const uint FOS_FILEMUSTEXIST    = 0x00001000;
    private const uint SIGDN_FILESYSPATH    = 0x80058000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct COMDLG_FILTERSPEC {
        [MarshalAs(UnmanagedType.LPWStr)] public string pszName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pszSpec;
    }

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogCom {}

    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, [In, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] COMDLG_FILTERSPEC[] rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IShellItemArray ppenum);
        void GetSelectedItems(out IShellItemArray ppsai);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("b63ea76d-1f85-456f-a19c-48159efa858b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemArray {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
        void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
        void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
        void GetAttributes(int dwAttribFlags, uint sfgaoMask, out uint psfgaoAttribs);
        void GetCount(out uint pdwNumItems);
        void GetItemAt(uint dwIndex, out IShellItem ppsi);
        void EnumItems(out IntPtr ppenumShellItems);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);

    private static readonly COMDLG_FILTERSPEC[] MediaFilters = new COMDLG_FILTERSPEC[] {
        new COMDLG_FILTERSPEC {
            pszName = "All Supported Media",
            pszSpec = "*.mp4;*.mov;*.mxf;*.mkv;*.avi;*.webm;*.mts;*.m2ts;*.m4v;*.mpg;*.mpeg;*.wmv;*.ts;*.flv;*.r3d;*.braw;*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.svg;*.tif;*.tiff;*.psd;*.psb;*.ai;*.pdf;*.eps;*.exr;*.dpx;*.heic;*.avif;*.wav;*.mp3;*.aac;*.m4a;*.aif;*.aiff;*.flac;*.ogg;*.wma"
        },
        new COMDLG_FILTERSPEC {
            pszName = "All Files (*.*)",
            pszSpec = "*.*"
        }
    };

    private static IFileOpenDialog CreateConfigured(string mode, string title, string initialDir) {
        var dialog = (IFileOpenDialog)new FileOpenDialogCom();
        uint options;
        dialog.GetOptions(out options);

        if (mode == "folders") {
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT | FOS_PATHMUSTEXIST);
        } else if (mode == "single") {
            dialog.SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST);
            dialog.SetFileTypes((uint)MediaFilters.Length, MediaFilters);
            dialog.SetFileTypeIndex(1);
        } else {
            dialog.SetOptions(options | FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST);
            dialog.SetFileTypes((uint)MediaFilters.Length, MediaFilters);
            dialog.SetFileTypeIndex(1);
        }

        if (!string.IsNullOrEmpty(title)) {
            dialog.SetTitle(title);
        }

        if (!string.IsNullOrEmpty(initialDir)) {
            Guid shellItemGuid = typeof(IShellItem).GUID;
            IShellItem folderItem;
            if (SHCreateItemFromParsingName(initialDir, IntPtr.Zero, ref shellItemGuid, out folderItem) == 0 && folderItem != null) {
                dialog.SetFolder(folderItem);
                Marshal.ReleaseComObject(folderItem);
            }
        }
        return dialog;
    }

    public static bool SelfTest() {
        string[] modes = new string[] { "files", "single", "folders" };
        foreach (string m in modes) {
            var dlg = CreateConfigured(m, "SelfTest", "");
            Marshal.ReleaseComObject(dlg);
        }
        return true;
    }

    public static string[] Pick(IntPtr ownerHwnd, string mode, string title, string initialDir) {
        var list = new List<string>();
        var dialog = CreateConfigured(mode, title, initialDir);
        try {
            int hr = dialog.Show(ownerHwnd);
            if (hr == 0) {
                if (mode == "single") {
                    IShellItem item;
                    dialog.GetResult(out item);
                    if (item != null) {
                        string path;
                        item.GetDisplayName(SIGDN_FILESYSPATH, out path);
                        if (!string.IsNullOrEmpty(path)) list.Add(path);
                        Marshal.ReleaseComObject(item);
                    }
                } else {
                    IShellItemArray results;
                    dialog.GetResults(out results);
                    if (results != null) {
                        uint count;
                        results.GetCount(out count);
                        for (uint i = 0; i < count; i++) {
                            IShellItem item;
                            results.GetItemAt(i, out item);
                            if (item != null) {
                                string path;
                                item.GetDisplayName(SIGDN_FILESYSPATH, out path);
                                if (!string.IsNullOrEmpty(path)) list.Add(path);
                                Marshal.ReleaseComObject(item);
                            }
                        }
                        Marshal.ReleaseComObject(results);
                    }
                }
            }
        } finally {
            Marshal.ReleaseComObject(dialog);
        }
        return list.ToArray();
    }
}
'@

Add-Type -TypeDefinition $nativeDialogCs -ErrorAction Stop

if ($CompileCheck) {
    $ok = [PrBinViewNativeDialog]::SelfTest()
    if ($ok) { Write-Output 'WIN_DIALOG_SELFTEST_OK'; exit 0 }
    exit 1
}

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.ShowInTaskbar = $false
$owner.Show()
$owner.Activate()

$picked = @()

try {
    $useDir = if ($InitialDir -and (Test-Path -LiteralPath $InitialDir -PathType Container)) { $InitialDir } else { '' }
    $dialogTitle = if ($Title) {
        $Title
    } elseif ($Mode -eq 'folders') {
        '选择要导入的文件夹（可多选）'
    } elseif ($Mode -eq 'single') {
        '选择替代媒体文件'
    } else {
        '导入媒体文件'
    }
    $picked = @([PrBinViewNativeDialog]::Pick($owner.Handle, $Mode, $dialogTitle, $useDir))
} finally {
    $owner.Close()
    $owner.Dispose()
}

if ($picked.Count -eq 0) {
    Write-Output '[]'
} else {
    Write-Output (ConvertTo-Json -InputObject @($picked) -Compress)
}
