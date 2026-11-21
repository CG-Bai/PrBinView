param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [int]$MaxSize = 360
)

$ErrorActionPreference = 'Stop'

function Save-SmartVectorPng {
    param([System.IO.Stream]$PngStream, [string]$Dst, [bool]$IsTransparentMode)
    if (-not $IsTransparentMode) {
        $netOut = [System.IO.File]::Create($Dst)
        try {
            $PngStream.CopyTo($netOut)
        } finally {
            $netOut.Dispose()
        }
        return
    }

    Add-Type -AssemblyName System.Drawing
    $bmp = [System.Drawing.Bitmap]::FromStream($PngStream)
    try {
        $w = $bmp.Width
        $h = $bmp.Height
        $stepX = [Math]::Max(1, [int][Math]::Floor($w / 48))
        $stepY = [Math]::Max(1, [int][Math]::Floor($h / 48))
        $transparentSamples = 0
        $visibleSamples = 0
        $totalSamples = 0
        $lumSum = 0.0

        for ($y = 0; $y -lt $h; $y += $stepY) {
            for ($x = 0; $x -lt $w; $x += $stepX) {
                $px = $bmp.GetPixel($x, $y)
                $totalSamples++
                if ($px.A -lt 20) {
                    $transparentSamples++
                } else {
                    $visibleSamples++
                    $lumSum += (0.299 * $px.R + 0.587 * $px.G + 0.114 * $px.B)
                }
            }
        }

        $hasAlphaBg = ($totalSamples -gt 0) -and (($transparentSamples / $totalSamples) -gt 0.12)
        $isDarkArtwork = ($visibleSamples -gt 0) -and (($lumSum / $visibleSamples) -lt 72.0)

        if ($hasAlphaBg -and $isDarkArtwork) {
            # Dark vector artwork on transparent artboard: place on clean light backing so it stays legible on dark UI
            $canvas = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                $g = [System.Drawing.Graphics]::FromImage($canvas)
                try {
                    $g.Clear([System.Drawing.Color]::FromArgb(255, 234, 236, 240))
                    $g.DrawImage($bmp, 0, 0, $w, $h)
                } finally {
                    $g.Dispose()
                }
                $canvas.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
            } finally {
                $canvas.Dispose()
            }
        } else {
            $bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
        }
    } finally {
        $bmp.Dispose()
    }
}

function Render-WithWinRtPdf {
    param([string]$Src, [string]$Dst, [int]$Limit)
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
    [void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
    [void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    $asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
    })[0]

    $ext = [System.IO.Path]::GetExtension($Src).ToLowerInvariant()
    $useTransparent = ($ext -eq '.ai')

    $fs = [System.IO.File]::OpenRead($Src)
    try {
        $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fs)
        $loadOp = [Windows.Data.Pdf.PdfDocument]::LoadFromStreamAsync($ras)
        $loadTask = $asTaskGeneric.MakeGenericMethod([Windows.Data.Pdf.PdfDocument]).Invoke($null, @($loadOp))
        $loadTask.Wait(10000) | Out-Null
        if (-not $loadTask.IsCompleted -or $loadTask.IsFaulted) { return $false }
        $pdf = $loadTask.Result
        if ($null -eq $pdf -or $pdf.PageCount -lt 1) { return $false }

        $page = $pdf.GetPage(0)
        try {
            $pw = [double]$page.Size.Width
            $ph = [double]$page.Size.Height
            if ($pw -le 0 -or $ph -le 0) { return $false }
            $scale = $Limit / [Math]::Max($pw, $ph)
            $dw = [uint32][Math]::Max(2, [Math]::Round($pw * $scale))
            $dh = [uint32][Math]::Max(2, [Math]::Round($ph * $scale))

            $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
            $opts.DestinationWidth = $dw
            $opts.DestinationHeight = $dh
            if ($useTransparent) {
                $bg = $opts.BackgroundColor
                $bg.A = 0; $bg.R = 0; $bg.G = 0; $bg.B = 0
                $opts.BackgroundColor = $bg
            }

            $mem = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
            try {
                $renderOp = $page.RenderToStreamAsync($mem, $opts)
                $renderTask = $asTaskAction.Invoke($null, @($renderOp))
                $renderTask.Wait(10000) | Out-Null
                if (-not $renderTask.IsCompleted -or $renderTask.IsFaulted) { return $false }
                $mem.Seek(0)
                $netIn = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($mem)
                try {
                    Save-SmartVectorPng -PngStream $netIn -Dst $Dst -IsTransparentMode $useTransparent
                } finally {
                    $netIn.Dispose()
                }
                return ((Test-Path -LiteralPath $Dst) -and ((Get-Item -LiteralPath $Dst).Length -gt 120))
            } finally {
                $mem.Dispose()
            }
        } finally {
            $page.Dispose()
        }
    } finally {
        $fs.Dispose()
    }
}

function Render-WithShellThumbnail {
    param([string]$Src, [string]$Dst, [int]$Limit)
    Add-Type -AssemblyName System.Drawing
    $cs = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PrBinViewShellThumb {
    [StructLayout(LayoutKind.Sequential)]
    public struct SIZE { public int cx; public int cy; }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory {
        [PreserveSig]
        int GetImage(SIZE size, int flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    public static bool Extract(string src, string dst, int maxDim) {
        Guid guid = typeof(IShellItemImageFactory).GUID;
        IShellItemImageFactory factory;
        if (SHCreateItemFromParsingName(src, IntPtr.Zero, ref guid, out factory) != 0 || factory == null) return false;
        IntPtr hbm = IntPtr.Zero;
        try {
            SIZE sz = new SIZE { cx = maxDim, cy = maxDim };
            /* SIIGBF_THUMBNAILONLY (0x08) | SIIGBF_BIGGERSIZEOK (0x01) */
            int hr = factory.GetImage(sz, 0x09, out hbm);
            if (hr != 0 || hbm == IntPtr.Zero) return false;
            using (Bitmap bmp = Image.FromHbitmap(hbm)) {
                bmp.Save(dst, ImageFormat.Png);
            }
            return true;
        } finally {
            if (hbm != IntPtr.Zero) DeleteObject(hbm);
            Marshal.ReleaseComObject(factory);
        }
    }
}
'@
    if (-not ('PrBinViewShellThumb' -as [type])) {
        Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing -ErrorAction Stop
    }
    return [PrBinViewShellThumb]::Extract($Src, $Dst, $Limit)
}

if (-not (Test-Path -LiteralPath $InputPath)) { exit 2 }

$ok = $false
try { $ok = Render-WithWinRtPdf -Src $InputPath -Dst $OutputPath -Limit $MaxSize } catch { $ok = $false }
if (-not $ok) {
    try { $ok = Render-WithShellThumbnail -Src $InputPath -Dst $OutputPath -Limit $MaxSize } catch { $ok = $false }
}

if ($ok) { exit 0 } else { exit 1 }
