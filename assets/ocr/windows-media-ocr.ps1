param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-WhaleDockResult {
  param([hashtable]$Value)
  [Console]::Out.Write(($Value | ConvertTo-Json -Compress -Depth 3))
}

function Wait-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Parameter(Mandatory = $true)][Type]$ResultType
  )
  $Method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and
      $_.GetGenericArguments().Count -eq 1 -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  if ($null -eq $Method) { throw 'WinRT task bridge unavailable' }
  $Task = $Method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $Task.Wait()
  return $Task.Result
}

$Stream = $null
$Bitmap = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $StorageFileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $RandomAccessStreamType = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $BitmapDecoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $SoftwareBitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $OcrEngineType = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $OcrResultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

  $File = Wait-WinRtOperation ($StorageFileType::GetFileFromPathAsync($ImagePath)) $StorageFileType
  $Stream = Wait-WinRtOperation ($File.OpenAsync([Windows.Storage.FileAccessMode]::Read)) $RandomAccessStreamType
  $Decoder = Wait-WinRtOperation ($BitmapDecoderType::CreateAsync($Stream)) $BitmapDecoderType
  $Bitmap = Wait-WinRtOperation ($Decoder.GetSoftwareBitmapAsync()) $SoftwareBitmapType
  $Engine = $OcrEngineType::TryCreateFromUserProfileLanguages()
  if ($null -eq $Engine) {
    Write-WhaleDockResult @{ schemaVersion = 1; ok = $false; reason = 'language-unavailable' }
    exit 0
  }
  $Result = Wait-WinRtOperation ($Engine.RecognizeAsync($Bitmap)) $OcrResultType
  if ($null -eq $Result -or [string]::IsNullOrEmpty($Result.Text)) {
    Write-WhaleDockResult @{ schemaVersion = 1; ok = $false; reason = 'no-text' }
    exit 0
  }
  Write-WhaleDockResult @{ schemaVersion = 1; ok = $true; text = [string]$Result.Text }
} catch {
  Write-WhaleDockResult @{ schemaVersion = 1; ok = $false; reason = 'script-error' }
} finally {
  if ($null -ne $Bitmap) { $Bitmap.Dispose() }
  if ($null -ne $Stream) { $Stream.Dispose() }
}
