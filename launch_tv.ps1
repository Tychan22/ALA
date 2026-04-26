$pkg = Get-AppxPackage -Name '*TradingView*' -ErrorAction SilentlyContinue
if (-not $pkg) { Write-Error "TradingView not installed"; exit 1 }
$manifest = Get-AppxPackageManifest $pkg
$appId = $manifest.Package.Applications.Application.Id
$aumid = "$($pkg.PackageFamilyName)!$appId"

$def = @"
using System; using System.Runtime.InteropServices;
namespace TV {
    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAAMgr { int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id,
[MarshalAs(UnmanagedType.LPWStr)] string args, int opts, out int pid); }
    [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"), ClassInterface(ClassInterfaceType.None)]
    public class AAMgr {}
    public class Launcher {
        public static int Launch(string aumid, string args) {
            var m = (IAAMgr)new AAMgr();
            int pid;
            m.ActivateApplication(aumid, args, 0, out pid);
            return pid;
        }
    }
}
"@
Add-Type -TypeDefinition $def
$p = [TV.Launcher]::Launch($aumid, "--remote-debugging-port=9222")
Write-Output "Launched TradingView PID: $p"
