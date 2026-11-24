param([string[]]$Names = @('verifier-titre-foncier-kinshasa', 'garantie-3-1-1-kinshasa'))
$d = $PSScriptRoot
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
foreach ($n in $Names) {
  $p = Start-Process -FilePath $edge -ArgumentList @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--force-device-scale-factor=1', '--window-size=3840,2160', '--virtual-time-budget=6000', "--user-data-dir=$d\edge-profile",
    "--screenshot=$d\$n.png", "file:///$($d -replace '\\','/')/$n.html") -Wait -PassThru -NoNewWindow -RedirectStandardError "$d\edge-err.txt"
  "$n exit $($p.ExitCode)"
}
