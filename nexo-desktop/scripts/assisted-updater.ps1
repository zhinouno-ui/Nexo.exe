param(
  [Parameter(Mandatory=$true)]
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "No existe el instalador: $InstallerPath"
  }

  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
  Start-Process -FilePath $resolvedInstaller -ArgumentList '/SILENT','/NORESTART' -WindowStyle Normal
} catch {
  try {
    Add-Content -Path "$env:TEMP\nexo-assisted-updater.log" -Value "[$(Get-Date -Format o)] $($_.Exception.Message)"
  } catch {}
}
