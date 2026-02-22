param(
  [Parameter(Mandatory=$true)][int]$ParentPid,
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$AppExecutable,
  [Parameter(Mandatory=$true)][string]$StatusFile,
  [string]$TargetVersion = ''
)

$ErrorActionPreference = 'Stop'

function Write-Status {
  param(
    [string]$Status,
    [string]$Message,
    [hashtable]$Extra = @{}
  )

  try {
    $payload = @{
      status = $Status
      message = $Message
      targetVersion = $TargetVersion
      installerPath = $InstallerPath
      appExecutable = $AppExecutable
      timestamp = (Get-Date).ToString('o')
    }

    foreach ($key in $Extra.Keys) {
      $payload[$key] = $Extra[$key]
    }

    $json = $payload | ConvertTo-Json -Depth 6
    Set-Content -Path $StatusFile -Value $json -Encoding UTF8
  } catch {
    # best effort: nunca romper la actualización por fallo de log
  }
}

Write-Status -Status 'running' -Message 'Updater asistido iniciado.' -Extra @{ parentPid = $ParentPid }

try {
  Wait-Process -Id $ParentPid -Timeout 90 -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $InstallerPath)) {
    Write-Status -Status 'error' -Message 'No se encontró el instalador descargado.'
    exit 2
  }

  $file = Get-Item -LiteralPath $InstallerPath
  if ($file.Length -le 0) {
    Write-Status -Status 'error' -Message 'El instalador descargado está vacío (0 bytes).' -Extra @{ installerSize = $file.Length }
    exit 3
  }

  Write-Status -Status 'installing' -Message 'Ejecutando instalador NSIS…' -Extra @{ installerSize = $file.Length }
  $proc = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -Wait -PassThru
  $installerExitCode = $proc.ExitCode

  if ($installerExitCode -ne 0) {
    Write-Status -Status 'error' -Message "El instalador NSIS devolvió código $installerExitCode." -Extra @{ installerExitCode = $installerExitCode }
    exit $installerExitCode
  }

  Write-Status -Status 'success' -Message 'Actualización aplicada. Reiniciando Nexo…' -Extra @{ installerExitCode = $installerExitCode }
  Start-Sleep -Milliseconds 600

  if (Test-Path -LiteralPath $AppExecutable) {
    Start-Process -FilePath $AppExecutable | Out-Null
  }

  exit 0
} catch {
  Write-Status -Status 'error' -Message ("Falló el updater asistido: " + $_.Exception.Message)
  exit 1
}
