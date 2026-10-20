[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ToolsRoot,
    [Parameter(Mandatory)][string]$DataDir
)
$ErrorActionPreference = 'Stop'
$activeFile = Join-Path $ToolsRoot 'active-gateway.json'
if (-not (Test-Path -LiteralPath $activeFile)) { [Console]::Error.WriteLine('No active gateway record; run setup.ps1 Install first'); exit 3 }
$active = Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8 | ConvertFrom-Json
$gatewayFile = Join-Path (Join-Path $ToolsRoot ('deployments\' + $active.build_id)) 'gateway.mjs'
if (-not (Test-Path -LiteralPath $gatewayFile)) { [Console]::Error.WriteLine('Active gateway deployment is missing: ' + $gatewayFile); exit 4 }
[IO.Directory]::CreateDirectory($DataDir) | Out-Null
$arguments = @(('"' + $gatewayFile + '"'), '--config', ('"' + (Join-Path $DataDir 'config.json') + '"'))
$gatewayProcess = Start-Process -FilePath $active.node_path -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $DataDir 'gateway.out.log') -RedirectStandardError (Join-Path $DataDir 'gateway.error.log')
exit $gatewayProcess.ExitCode
