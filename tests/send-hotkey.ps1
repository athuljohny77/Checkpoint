param([switch]$CheckDesktop, [string]$Keys = '^+ ')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CheckpointKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr handle);
}
'@
$inputDesktop = [CheckpointKeys]::OpenInputDesktop(0, $false, 1)
if ($inputDesktop -eq [IntPtr]::Zero) {
  Write-Output 'Input desktop unavailable'
  exit 2
}
[void][CheckpointKeys]::CloseDesktop($inputDesktop)
if ($CheckDesktop) { exit 0 }
# Release modifiers left by another automation client, then send an actual Windows key chord.
foreach ($key in @(0x10,0x11,0x12,0x5B,0x5C)) {
  [CheckpointKeys]::keybd_event($key,0,2,[UIntPtr]::Zero)
}
Start-Sleep -Milliseconds 100
Add-Type -AssemblyName System.Windows.Forms
try { [System.Windows.Forms.SendKeys]::SendWait($Keys) }
catch {
  if ($_.Exception.InnerException -is [System.ComponentModel.Win32Exception] -and $_.Exception.InnerException.NativeErrorCode -eq 5) {
    Write-Output 'Windows denied synthetic keyboard input in this session.'
    exit 2
  }
  throw
}
