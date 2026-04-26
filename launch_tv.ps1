param([string]$Args = "--remote-debugging-port=9222")

# Dynamically find AUMID in case the package version changes
$pkg = Get-AppxPackage -Name '*TradingView*' -ErrorAction SilentlyContinue
if (-not $pkg) { Write-Error "TradingView not found"; exit 1 }
$manifest = Get-AppxPackageManifest $pkg
$appId = $manifest.Package.Applications.Application.Id
$aumid = "$($pkg.PackageFamilyName)!$appId"

$typeDefinition = @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IApplicationActivationManager {
    int ActivateApplication(string appUserModelId, string arguments, int options, out int processId);
    int ActivateForFile(string appUserModelId, IntPtr itemArray, string verb, out int processId);
    int ActivateForProtocol(string appUserModelId, IntPtr itemArray, out int processId);
}
[ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"), ClassInterface(ClassInterfaceType.None)]
public class ApplicationActivationManager {}
"@

Add-Type -TypeDefinition $typeDefinition
$mgr = [IApplicationActivationManager]([ApplicationActivationManager]::new())
$pid = 0
$mgr.ActivateApplication($aumid, $Args, 0, [ref]$pid)
Write-Output $pid
