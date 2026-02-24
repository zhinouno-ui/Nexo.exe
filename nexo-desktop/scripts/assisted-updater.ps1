param(
  [Parameter(Mandatory=$true)]
  [string]$InstallerPath,
  [Int64]$ExpectedBytes = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-AssistForm {
  param([string]$Title)
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title
  $form.StartPosition = 'CenterScreen'
  $form.Size = New-Object System.Drawing.Size(520, 180)
  $form.TopMost = $true

  $label = New-Object System.Windows.Forms.Label
  $label.Location = New-Object System.Drawing.Point(20, 20)
  $label.Size = New-Object System.Drawing.Size(470, 42)
  $label.Text = 'Preparando actualización...'

  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Location = New-Object System.Drawing.Point(20, 70)
  $bar.Size = New-Object System.Drawing.Size(470, 24)
  $bar.Style = 'Marquee'

  $meta = New-Object System.Windows.Forms.Label
  $meta.Location = New-Object System.Drawing.Point(20, 102)
  $meta.Size = New-Object System.Drawing.Size(470, 24)
  $meta.Text = 'Validando instalador descargado...'

  $form.Controls.Add($label)
  $form.Controls.Add($bar)
  $form.Controls.Add($meta)

  return @{ Form = $form; Label = $label; Meta = $meta }
}

try {
  if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "No existe el instalador: $InstallerPath"
  }

  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
  $file = Get-Item -LiteralPath $resolvedInstaller
  if ($file.Length -le 0) {
    throw "El instalador está vacío (0 bytes)."
  }

  if ($ExpectedBytes -ge 1048576) {
    if ($file.Length -lt 1048576) {
      throw "Instalador demasiado pequeño para el tamaño esperado."
    }
    $diffRatio = [Math]::Abs($ExpectedBytes - $file.Length) / [double]$ExpectedBytes
    if ($diffRatio -gt 0.2) {
      throw "Diferencia crítica de tamaño detectada."
    }
  }

  $ui = Show-AssistForm -Title 'Nexo Updater Assist'
  $form = $ui.Form
  $label = $ui.Label
  $meta = $ui.Meta

  $label.Text = 'Actualización en curso (proceso externo)'
  $meta.Text = "Lanzando instalador: $($file.Name)"

  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1000
  $startedAt = Get-Date

  $proc = Start-Process -FilePath $resolvedInstaller -PassThru

  $timer.Add_Tick({
    $elapsed = (Get-Date) - $startedAt
    if ($proc.HasExited) {
      $timer.Stop()
      $meta.Text = "Instalador finalizado con código: $($proc.ExitCode)"
      Start-Sleep -Milliseconds 900
      $form.Close()
      return
    }
    $meta.Text = "Instalando... $([int]$elapsed.TotalSeconds)s"
  })

  $timer.Start()
  [void]$form.ShowDialog()
} catch {
  [System.Windows.Forms.MessageBox]::Show("Error en asistente de actualización:`n$($_.Exception.Message)", 'Nexo Updater Assist', 'OK', 'Error') | Out-Null
  try {
    Add-Content -Path "$env:TEMP\nexo-assisted-updater.log" -Value "[$(Get-Date -Format o)] $($_.Exception.Message)"
  } catch {}
  exit 1
}
