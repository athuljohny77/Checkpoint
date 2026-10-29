param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
$updateConfig = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$updateLog = Join-Path (Split-Path -Parent $Config) 'install-result.json'
try {
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  $downloadStream = [IO.File]::OpenRead($updateConfig.download)
  try { $actualHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($downloadStream)).Replace('-', '').ToLowerInvariant() }
  finally { $downloadStream.Dispose(); $hashAlgorithm.Dispose() }
  if ($actualHash -ne $updateConfig.sha256) { throw 'Update verification failed before installation.' }
  # The app waits for this acknowledgement before quitting.
  [IO.File]::WriteAllText($updateConfig.ready, 'ready')
  $appProcess = Get-Process -Id $updateConfig.pid -ErrorAction SilentlyContinue
  if ($appProcess -and -not $appProcess.WaitForExit(60000)) { throw 'Checkpoint did not exit. Please retry the update.' }
  if ($updateConfig.mode -eq 'portable') {
    $updateTarget = [IO.Path]::GetFullPath($updateConfig.target)
    $updateStage = $updateTarget + '.update-new'
    $updateBackup = $updateTarget + '.previous'
    Copy-Item -LiteralPath $updateConfig.download -Destination $updateStage -Force
    $replaced = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
      try {
        # Atomic replacement leaves the old launcher intact if it is still locked.
        [IO.File]::Replace($updateStage, $updateTarget, $updateBackup, $true)
        $replaced = $true
        break
      } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $replaced) { throw 'Could not replace Checkpoint. The original app is unchanged; check folder permissions and retry.' }
    Start-Process -FilePath $updateTarget -WindowStyle Hidden
  } elseif ($updateConfig.mode -eq 'installer') {
    Start-Process -FilePath $updateConfig.download -ArgumentList '/S','--force-run' -Wait -PassThru -WindowStyle Hidden | ForEach-Object {
      if ($_.ExitCode -ne 0) { throw "The installer exited with code $($_.ExitCode)." }
    }
  } else { throw 'Unknown update installation mode.' }
  @{ok=$true;version=$updateConfig.version} | ConvertTo-Json | Set-Content -LiteralPath $updateLog -Encoding UTF8
} catch {
  @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $updateLog -Encoding UTF8
  # Preserve the original launcher and make any failure visible on next launch.
  if ($updateConfig.target -and (Test-Path -LiteralPath $updateConfig.target)) {
    Start-Process -FilePath $updateConfig.target -WindowStyle Hidden
  }
  exit 1
}
