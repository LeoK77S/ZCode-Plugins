[CmdletBinding()]
param(
    [ValidateSet('Install', 'Status', 'Remove', 'Restart')][string]$Action = 'Status',
    [ValidateRange(1, 65535)][int]$Port = 17329,
    [ValidateSet('relay', 'local-only')][string]$Mode = 'relay',
    [ValidateSet(1, 2)][int]$RelayProtocolVersion,
    [string]$ZcodeAppVersion = $env:ZCODE_APP_VERSION,
    [ValidateRange(1, 30)][int]$HealthTimeoutSec = 5,
    [ValidateRange(0, 600)][int]$BusyTimeoutSec = 60,
    [ValidateRange(50, 60000)][int]$BusyRetryMs = 2000,
    [string]$UpstreamUrl = 'wss://zcode.z.ai/ws',
    [string]$DataDir = (Join-Path $env:USERPROFILE '.zcode\tools\suian-zcode-gateway'),
    [string]$SkillsDir = (Join-Path $env:USERPROFILE '.zcode\skills'),
    # 缓存外部署根：deployments\<buildId> 存放网关运行文件副本，launchers 存放稳定启动器。
    [string]$ToolsRoot = (Join-Path $env:USERPROFILE '.zcode\tools\suian-zcode-common'),
    [switch]$NativePlugin
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$relayVariable = 'ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL'
$configFile = Join-Path $DataDir 'config.json'
$activeGatewayFile = Join-Path $ToolsRoot 'active-gateway.json'
$config = if (Test-Path -LiteralPath $configFile) { Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$restarting = $Action -eq 'Restart'
if ($restarting -and $null -eq $config) { throw 'Shared gateway is not installed; use Install first' }
$runningPort = $Port
$Mode = $Mode.ToLowerInvariant()
$installedMode = 'relay'
$installedProtocol = 1
if ($null -ne $config) {
    if ($config.version -ne 1) { throw 'Unsupported gateway config version' }
    if (-not [int]::TryParse([string]$config.port, [ref]$runningPort) -or $runningPort -lt 1 -or $runningPort -gt 65535) { throw 'Installed gateway port must be an integer from 1 to 65535' }
    if (-not $PSBoundParameters.ContainsKey('Port')) { $Port = $runningPort }
    if (-not $PSBoundParameters.ContainsKey('UpstreamUrl')) { $UpstreamUrl = $config.upstream_url }
    if ($config.PSObject.Properties['mode']) { $installedMode = $config.mode }
    if ($installedMode -cnotin @('relay', 'local-only')) { throw 'Invalid installed gateway mode' }
    if (-not $PSBoundParameters.ContainsKey('Mode')) { $Mode = $installedMode }
    if ($config.PSObject.Properties['relay_protocol_version']) {
        if ($config.relay_protocol_version -notin @(1, 2)) { throw 'Unsupported installed relay protocol version' }
        $installedProtocol = [int]$config.relay_protocol_version
    }
}
$protocolSource = 'installed_config'
$applicationProtocol = $null
if ($Action -ne 'Remove' -and $ZcodeAppVersion) {
    if ($ZcodeAppVersion -notmatch '^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?(?:\+[\w.-]+)?$' -or [int]$Matches[1] -lt 3) { throw 'Use the actual ZCode Desktop application version (for example 3.16.1), not the CLI version' }
    $applicationProtocol = if ([int]$Matches[1] -gt 3 -or [int]$Matches[2] -ge 16) { 2 } else { 1 }
}
if ($PSBoundParameters.ContainsKey('RelayProtocolVersion')) {
    $protocolSource = 'parameter'
    if ($null -ne $applicationProtocol -and $RelayProtocolVersion -ne $applicationProtocol) { throw 'Relay protocol version conflicts with the ZCode Desktop application version' }
} elseif ($null -ne $applicationProtocol) {
    $RelayProtocolVersion = $applicationProtocol; $protocolSource = 'desktop_version'
} else {
    $RelayProtocolVersion = $installedProtocol
    if ($null -eq $config) { $protocolSource = 'legacy_default' }
}
$officialV1 = @('wss://zcode.z.ai/ws', 'wss://zcode.chatglm.site/ws')
$officialV2 = 'wss://zcode.z.ai/api/v1/remote/ws2'
if (-not $PSBoundParameters.ContainsKey('UpstreamUrl') -and ($null -eq $config -or ($RelayProtocolVersion -ne $installedProtocol -and $config.upstream_url -in ($officialV1 + $officialV2)))) {
    $UpstreamUrl = if ($RelayProtocolVersion -eq 2) { $officialV2 } else { $officialV1[0] }
}
if ($Action -in @('Install', 'Restart')) {
    if ($Mode -eq 'local-only' -and $RelayProtocolVersion -eq 2) { throw 'ZCode 3.16 / relay V2 does not support local-only; use -Mode relay' }
    if (($RelayProtocolVersion -eq 2 -and $UpstreamUrl -in $officialV1) -or ($RelayProtocolVersion -eq 1 -and $UpstreamUrl -eq $officialV2)) { throw 'Official upstream URL does not match the relay protocol version' }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'suian-zcode-gateway-' + $identity.User.Value
$task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq '\' }
$property = (Get-ItemProperty -LiteralPath 'HKCU:\Environment').PSObject.Properties[$relayVariable]
$userRelay = if ($null -ne $property) { [string]$property.Value } else { $null }
$relayUrl = "ws://127.0.0.1:$Port/ws"
$healthUrl = "http://127.0.0.1:$runningPort/health"
$legacyLauncherFile = Join-Path $DataDir 'gateway-launch.vbs'
$stableVbsFile = Join-Path $ToolsRoot 'launchers\gateway-launch.vbs'
$stablePsFile = Join-Path $ToolsRoot 'launchers\run.ps1'
$scriptHost = Join-Path $env:SystemRoot 'System32\wscript.exe'
$vbsLauncher = $null -ne $task -and @($task.Actions)[0].Execute -eq $scriptHost
$taskRunning = $null -ne $task -and $task.State -eq 'Running'

function Read-GatewayHealth {
    param([switch]$AllowUnavailable)
    for ($queryAttempt = 0; $queryAttempt -lt 2; $queryAttempt++) {
        try {
            $result = Invoke-RestMethod -Uri $healthUrl -TimeoutSec $HealthTimeoutSec -UseBasicParsing
            if (-not $result.PSObject.Properties['mode']) { Add-Member -InputObject $result -NotePropertyName mode -NotePropertyValue 'relay' }
            if ($result.mode -cnotin @('relay', 'local-only')) { throw 'Unknown running gateway mode' }
            if (-not $result.PSObject.Properties['relay_protocol_version']) { Add-Member -InputObject $result -NotePropertyName relay_protocol_version -NotePropertyValue 1 }
            if ($result.relay_protocol_version -notin @(1, 2)) { throw 'Unknown running relay protocol version' }
            return $result
        }
        catch [Net.WebException] {
            if ($AllowUnavailable -and $_.Exception.Status -eq [Net.WebExceptionStatus]::ConnectFailure) { return $null }
            if ($_.Exception.Status -ne [Net.WebExceptionStatus]::Timeout) { throw }
            if ($queryAttempt -eq 1) { throw "Gateway health check timed out twice ($HealthTimeoutSec seconds per attempt); running state is unknown" }
        }
    }
}

# 稳定任务参数：指向缓存外 launchers 的 VBS 与 PowerShell 启动器，不编码任何版本缓存路径。
# 外层 exit $LASTEXITCODE 把启动器脚本的退出码精确传回进程（& 调用脚本内的 exit 只退出脚本作用域）。
function Get-LauncherArguments {
    $launcherPs = $stablePsFile.Replace("'", "''")
    $safeTools = $ToolsRoot.Replace("'", "''")
    $safeData = $DataDir.Replace("'", "''")
    $launch = "& '$launcherPs' -ToolsRoot '$safeTools' -DataDir '$safeData'; exit `$LASTEXITCODE"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launch))
    return '//B //NoLogo "' + $stableVbsFile + '" ' + $encoded
}

function Invoke-DeployCli {
    param([string[]]$CliArguments)
    $output = & $script:gatewayNode $script:deployCli @CliArguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Gateway deployment tool failed: ' + (($output | Select-Object -Last 5 | Out-String).Trim())) }
    return ($output | Where-Object { $_ -is [string] } | Select-Object -Last 1) | ConvertFrom-Json
}

function Get-GatewayUpgradeStatus {
    param($InstalledConfig, $Health)
    $deployStatus = Invoke-DeployCli @('--status', '--source-root', $PSScriptRoot, '--tools-root', $ToolsRoot)
    $candidateBuildId = $deployStatus.candidateBuildId
    $active = $deployStatus.active
    $activeBuildId = if ($null -ne $active) { $active.build_id } else { $null }
    $expected = [pscustomobject]@{ id = $candidateBuildId; version = $deployStatus.version; root = (Join-Path $ToolsRoot ('deployments\' + $candidateBuildId)) }
    $running = $null; $codeStatus = 'not_configured'; $pathMatches = $false
    if ($null -ne $InstalledConfig) {
        if ($null -eq $Health) { $codeStatus = 'unreachable' }
        elseif (-not $Health.PSObject.Properties['build']) { $codeStatus = 'unknown' }
        else {
            $running = $Health.build
            $codeStatus = if ($running.id -eq $candidateBuildId) { 'current' } else { 'changed' }
        }
        if ($null -ne $activeBuildId -and $null -ne $Health -and $Health.PSObject.Properties['build']) {
            $activeDeploymentDir = Join-Path $ToolsRoot ('deployments\' + $activeBuildId)
            $pathMatches = $InstalledConfig.gateway_root -eq $activeDeploymentDir -and $Health.build.root -eq $activeDeploymentDir
        }
    }
    $launcherUpdate = $false
    if ($null -ne $InstalledConfig) {
        $launcherUpdate = -not $vbsLauncher -or -not $taskRunning -or
            @($task.Actions)[0].Arguments -cne (Get-LauncherArguments) -or
            -not (Test-Path -LiteralPath $stableVbsFile) -or -not (Test-Path -LiteralPath $stablePsFile)
    }
    $configuredProtocol = if ($null -ne $InstalledConfig -and $InstalledConfig.PSObject.Properties['relay_protocol_version']) { $InstalledConfig.relay_protocol_version } else { 1 }
    $protocolUpdate = $null -ne $InstalledConfig -and ($configuredProtocol -ne $RelayProtocolVersion -or ($null -ne $Health -and $Health.relay_protocol_version -ne $RelayProtocolVersion))
    $upstreamUpdate = $null -ne $InstalledConfig -and $InstalledConfig.upstream_url -ne $UpstreamUrl
    $candidatePending = $null -ne $activeBuildId -and $candidateBuildId -ne $activeBuildId
    $gatewayRestart = $null -ne $InstalledConfig -and ($codeStatus -ne 'current' -or -not $pathMatches -or $launcherUpdate -or $protocolUpdate -or $upstreamUpdate -or $candidatePending)
    $desktopRestart = $null -ne $InstalledConfig -and $userRelay -ne $relayUrl
    $desktopConnection = $null -ne $InstalledConfig -and ($null -eq $Health -or -not $Health.desktop_connected)
    return [ordered]@{
        expected_build=$expected; candidate_build_id=$candidateBuildId; active_build_id=$activeBuildId
        candidate_pending_activation=$candidatePending
        running_build=$running; code_status=$codeStatus; gateway_path_matches=$pathMatches
        relay_protocol_version=$RelayProtocolVersion; protocol_source=$protocolSource; running_relay_protocol_version=$(if ($null -ne $Health) { $Health.relay_protocol_version } else { $null })
        upstream_url=$UpstreamUrl; protocol_update_required=$protocolUpdate; upstream_update_required=$upstreamUpdate
        launcher_update_required=$launcherUpdate; gateway_restart_required=$gatewayRestart
        desktop_restart_required=$desktopRestart; desktop_connection_required=$desktopConnection
        restart_required=($gatewayRestart -or $desktopRestart -or $desktopConnection)
    }
}

function Wait-GatewayExit {
    for ($stopAttempt = 0; $stopAttempt -lt 40; $stopAttempt++) {
        $exitingTask = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq '\' }
        $remainingHealth = Read-GatewayHealth -AllowUnavailable
        if ($null -eq $remainingHealth -and ($null -eq $exitingTask -or $exitingTask.State -ne 'Running')) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Gateway or launcher did not exit; configuration was not changed'
}

# 切换事务锁：独占句柄随进程退出由系统自动释放，崩溃或被杀无需陈旧清理；
# 持锁方写入自身 pid 并以读共享打开，拿锁失败方可读出持锁者身份。
# 残留锁文件在下一次 Create 打开时被覆盖，不阻塞后续实例。暂存部署（--deploy）在锁外，保持幂等可并发。
function Acquire-UpgradeLock {
    [IO.Directory]::CreateDirectory($DataDir) | Out-Null
    $lockPath = Join-Path $DataDir 'upgrade.lock'
    try {
        $script:upgradeLock = [IO.File]::Open($lockPath, 'Create', 'ReadWrite', 'Read')
        $pidBytes = [Text.Encoding]::UTF8.GetBytes("$PID`n")
        $script:upgradeLock.Write($pidBytes, 0, $pidBytes.Length)
        $script:upgradeLock.Flush()
    }
    catch [IO.IOException] {
        $holderPid = $null
        try {
            $holderStream = [IO.File]::Open($lockPath, 'Open', 'Read', 'ReadWrite')
            try {
                $buffer = New-Object byte[] $holderStream.Length
                [void]$holderStream.Read($buffer, 0, $buffer.Length)
                $holderPid = [Text.Encoding]::UTF8.GetString($buffer).Trim()
            } finally { $holderStream.Dispose() }
        } catch [IO.IOException] {}
        throw "Another gateway setup is already running (upgrade.lock is held$(if ($holderPid) { " by pid $holderPid" })); nothing was changed"
    }
}

function Release-UpgradeLock {
    if ($null -ne $script:upgradeLock) { $script:upgradeLock.Dispose(); $script:upgradeLock = $null }
    Remove-Item -LiteralPath (Join-Path $DataDir 'upgrade.lock') -ErrorAction SilentlyContinue
}

# 忙退避封顶 15 秒：与 Desktop V2 连接层重连退避（1s–30s）同量级，覆盖切换窗口又不过度拉长等待。
$busyBackoffCapMs = 15000

function Start-BusyBackoff {
    # 睡一拍（不越过 deadline）、倍增封顶后重读健康；[ref] 递增退避间隔。
    param([ref]$Delay, [datetime]$Deadline)
    Start-Sleep -Milliseconds ([Math]::Min($Delay.Value, [Math]::Max(0, [int](($Deadline - [DateTime]::UtcNow).TotalMilliseconds))))
    $Delay.Value = [Math]::Min($busyBackoffCapMs, $Delay.Value * 2)
    return Read-GatewayHealth -AllowUnavailable
}

# 忙退避重探：运行中网关健康自报 V2 且含 rpc_in_flight 时，连接在但无飞行操作即视为空闲，用升级关闭闪断
# （Desktop 连接层自带断线自愈）；健康自报 V1 或无该字段时保守等待连接断开——判定用运行实例自报协议，
# 不用本次请求的目标协议，避免对 V1 Desktop 误发闪断。
# 关闭失败（服务端 409 busy 竞争窗口、瞬断）先重探再判超时：网关可能已退出，此时等待收尾并按已停止处理；
# 401/404 等确定性错误直接抛出；总时长由 BusyTimeoutSec 限制（最后一拍钳制到剩余时间），超时返回 busy。
function Stop-GatewayForUpgrade {
    param([object]$CurrentHealth)
    $deadline = [DateTime]::UtcNow.AddSeconds($BusyTimeoutSec)
    $delay = $BusyRetryMs
    while ($true) {
        if ($null -eq $CurrentHealth) { return 'stopped' }
        $query = ''
        if ($CurrentHealth.desktop_connected) {
            if ($CurrentHealth.PSObject.Properties['relay_protocol_version'] -and $CurrentHealth.relay_protocol_version -eq 2 -and $CurrentHealth.PSObject.Properties['rpc_in_flight'] -and [int]$CurrentHealth.rpc_in_flight -eq 0) { $query = '?idle=1' }
            elseif ([DateTime]::UtcNow -ge $deadline) { return 'busy' }
            else {
                $CurrentHealth = Start-BusyBackoff ([ref]$delay) $deadline
                continue
            }
        }
        try {
            $stopped = Invoke-RestMethod -Uri "http://127.0.0.1:$runningPort/shutdown$query" -Method Post -Headers @{ Authorization=('Bearer ' + $config.control_token) } -TimeoutSec 5 -UseBasicParsing
            if (-not $stopped.ok) { throw 'Gateway did not accept shutdown' }
            Wait-GatewayExit
            return 'stopped'
        }
        catch [Net.WebException] {
            $failureStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
            if ($failureStatus -eq 401 -or $failureStatus -eq 404) { throw }
            if ([DateTime]::UtcNow -lt $deadline) {
                $CurrentHealth = Start-BusyBackoff ([ref]$delay) $deadline
                if ($null -ne $CurrentHealth) { continue }
            }
            else {
                $CurrentHealth = Read-GatewayHealth -AllowUnavailable
                if ($null -ne $CurrentHealth) { return 'busy' }
            }
            # 网关已退出（瞬断或恰在收尾）：等待监听与启动器实际退出，按已停止处理。
            Wait-GatewayExit
            return 'stopped'
        }
    }
}

function Send-EnvironmentChange {
    if (-not ('SuianZcodeGateway.EnvironmentBroadcast' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace SuianZcodeGateway {
    public static class EnvironmentBroadcast {
        [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)]
        public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wparam, string area, uint flags, uint timeout, out UIntPtr result);
    }
}
'@
    }
    $messageResult = [UIntPtr]::Zero
    # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG；每个窗口最多等待一秒。
    $sent = [SuianZcodeGateway.EnvironmentBroadcast]::SendMessageTimeout([IntPtr]65535, 26, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$messageResult)
    if ($sent -eq [IntPtr]::Zero) { throw 'Environment change broadcast failed or timed out; user environment was already updated. Use the explicit launch steps to load it' }
}

if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid gateway port' }
$script:gatewayNode = $null
$script:deployCli = Join-Path $PSScriptRoot 'gateway-deploy.mjs'
if ($Action -ne 'Remove') {
    $script:gatewayNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    if ($null -eq $script:gatewayNode) { throw 'Node.js 24+ is required' }
}
if ($Action -eq 'Status') {
    $health = $null
    if ($null -ne $config) {
        $health = Read-GatewayHealth -AllowUnavailable
        if ($null -ne $health -and ($health.service -ne 'suian-zcode-gateway' -or $health.version -ne 1 -or $health.instance_id -ne $config.instance_id -or $health.upstream_url -ne $config.upstream_url -or $health.mode -ne $installedMode)) { throw 'Gateway health does not match the installed configuration' }
    }
    $rpcAvailable = $false; $upstreamPaired = $null; $localClients = $null
    if ($null -ne $health) {
        if ($health.PSObject.Properties['rpc_protocol_version']) { $rpcAvailable = $health.rpc_protocol_version -eq 1 }
        if ($health.PSObject.Properties['upstream_paired']) { $upstreamPaired = $health.upstream_paired }
        if ($health.PSObject.Properties['local_clients']) { $localClients = $health.local_clients }
    }
    $status = [ordered]@{
        ok=$true; action='status'; configured=($null -ne $config); relay_url=$relayUrl; health_url=$healthUrl
        mode=$(if ($null -ne $config) { $installedMode } else { $Mode }); desktop_ready=$(if ($null -ne $health -and $health.PSObject.Properties['desktop_ready']) { $health.desktop_ready } else { $null })
        user_env_matches=($null -ne $config -and $userRelay -eq $relayUrl); gateway_running=($null -ne $health)
        task_running=$taskRunning; health_status=$(if ($null -eq $config) { 'not_configured' } elseif ($null -eq $health) { 'unreachable' } else { 'reachable' })
        vbs_launcher=$vbsLauncher
        desktop_connected=($null -ne $health -and $health.desktop_connected); upstream_connected=($null -ne $health -and $health.upstream_connected)
        rpc_available=$rpcAvailable; upstream_paired=$upstreamPaired; local_clients=$localClients
        paired=($null -ne $health -and $health.paired)
    }
    $upgrade = Get-GatewayUpgradeStatus $config $health
    foreach ($field in $upgrade.Keys) { $status[$field] = $upgrade[$field] }
    $status | ConvertTo-Json -Depth 4 -Compress
    return
}
if ($Action -eq 'Remove') {
    if ($null -eq $config) { @{ ok=$true; action='not_installed' } | ConvertTo-Json -Compress; return }
    Acquire-UpgradeLock
    $health = Read-GatewayHealth -AllowUnavailable
    if ($taskRunning -and $null -eq $health) { throw 'Gateway task is running but health is unavailable; running state is unknown, configuration was not changed' }
    if ($null -ne $health) {
        if ($health.service -ne 'suian-zcode-gateway' -or $health.version -ne 1 -or $health.instance_id -ne $config.instance_id -or $health.upstream_url -ne $config.upstream_url -or $health.mode -ne $installedMode) { throw 'Gateway health does not match the installed configuration' }
        $stopVerdict = Stop-GatewayForUpgrade -CurrentHealth $health
        if ($stopVerdict -eq 'busy') {
            Release-UpgradeLock
            [ordered]@{ ok=$true; action='remove_deferred'; upgrade_deferred='remote_busy'; busy_timeout_sec=$BusyTimeoutSec } | ConvertTo-Json -Compress
            return
        }
    }
    $environmentAction = 'preserved_external'
    if ($userRelay -eq "ws://127.0.0.1:$runningPort/ws") {
        if ($null -eq $config.previous_user_relay) { Remove-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $relayVariable }
        else { New-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $relayVariable -Value $config.previous_user_relay -PropertyType String -Force | Out-Null }
        $environmentAction = 'restored'
    }
    $environmentBroadcast = 'not_needed'
    if ($environmentAction -eq 'restored') { Send-EnvironmentChange; $environmentBroadcast = 'sent' }
    if ($null -ne $task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    foreach ($skillName in @('suian-zcode-common', 'suian-zcode-gateway')) {
        $installedSkill = Join-Path $SkillsDir ($skillName + '\SKILL.md')
        if (Test-Path -LiteralPath $installedSkill) {
            $installed = Get-Content -LiteralPath $installedSkill -Raw -Encoding UTF8
            if ($installed.Contains(('**本机公共根**：`' + $config.gateway_root + '`')) -or ($installed.Contains(('**本机公共根**：`' + $PSScriptRoot + '`'))) -or $installed.Contains(('**本机网关根**：`' + $config.gateway_root + '`'))) { Remove-Item -LiteralPath $installedSkill }
        }
    }
    Remove-Item -LiteralPath $configFile
    if (Test-Path -LiteralPath $legacyLauncherFile) { Remove-Item -LiteralPath $legacyLauncherFile }
    # 网关部署产物：活动记录必清；deployments 与 launchers 在 Toast 活动记录仍存在时保留。
    $toastRecord = 'none'
    if (Test-Path -LiteralPath (Join-Path $ToolsRoot 'active-toast.json')) { $toastRecord = 'preserved' }
    if (Test-Path -LiteralPath $activeGatewayFile) { Remove-Item -LiteralPath $activeGatewayFile }
    if ($toastRecord -eq 'none') {
        foreach ($deployArtifact in @('launchers', 'deployments')) {
            $artifactPath = Join-Path $ToolsRoot $deployArtifact
            if (Test-Path -LiteralPath $artifactPath) { Remove-Item -LiteralPath $artifactPath -Recurse -Force }
        }
    }
    [ordered]@{ ok=$true; action='removed'; user_env_action=$environmentAction; environment_broadcast=$environmentBroadcast; toast_record=$toastRecord; restart_required=$true } | ConvertTo-Json -Compress
    Release-UpgradeLock
    return
}

$upstream = [Uri]$UpstreamUrl
if (-not $upstream.IsAbsoluteUri -or ($upstream.Scheme -ne 'wss' -and -not ($upstream.Scheme -eq 'ws' -and $upstream.Host -eq '127.0.0.1')) -or $upstream.UserInfo -or $upstream.Query -or $upstream.Fragment) {
    throw 'Upstream must be a credential-free wss URL (or loopback ws for testing)'
}
$nodeVersion = & $script:gatewayNode --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node.js 24+ is required' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\ws\package.json'))) { throw 'Run npm ci in suian-zcode-common first' }
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SKILL.md') -Raw -Encoding UTF8
$marker = '<!-- suian-zcode-common:root -->'
if (-not $template.Contains($marker)) { throw 'Gateway skill root marker is missing' }
$skill = $template.Replace($marker, ('**本机公共根**：`' + $PSScriptRoot + '`'))
$sha = [Security.Cryptography.SHA256]::Create()
try { $instanceId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($ToolsRoot.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }

# 步骤 1：校验候选并暂存部署运行文件（真实文件副本，不使用 junction）；暂存不改变活动版本。
$deployResult = Invoke-DeployCli @('--deploy', '--source-root', $PSScriptRoot, '--tools-root', $ToolsRoot)
$buildId = $deployResult.buildId
$deploymentDir = $deployResult.deploymentDir
Invoke-DeployCli @('--ensure-launchers', '--source-root', $PSScriptRoot, '--tools-root', $ToolsRoot) | Out-Null
# 切换事务从这里开始：shutdown、活动记录切换、任务注册与健康确认须整体互斥。
Acquire-UpgradeLock

# 复用在运行的实例。修改地址或安装位置时不能悄悄切断 Desktop。
$health = $null
if ($null -ne $config -or $null -ne $task) { $health = Read-GatewayHealth -AllowUnavailable }
if ($taskRunning -and $null -eq $health) { throw 'Gateway task is running but health is unavailable; running state is unknown, configuration was not changed' }
if ($null -ne $health) {
    if ($restarting) {
        if ($health.service -ne 'suian-zcode-gateway' -or $health.version -ne 1 -or $health.instance_id -ne $config.instance_id -or $health.upstream_url -ne $config.upstream_url -or $health.mode -ne $installedMode) { throw 'Gateway health does not match the installed configuration' }
        $stopVerdict = Stop-GatewayForUpgrade -CurrentHealth $health
        if ($stopVerdict -eq 'busy') {
            Release-UpgradeLock
            [ordered]@{ ok=$true; action='restart_deferred'; upgrade_deferred='remote_busy'; candidate_build_id=$buildId; busy_timeout_sec=$BusyTimeoutSec; restart_required=$true } | ConvertTo-Json -Compress
            return
        }
        # 步骤 3：等待旧网关、监听与监督启动器实际退出后才修改任何记录（Stop-GatewayForUpgrade 已完成）。
        $health = $null
    } elseif ($health.service -ne 'suian-zcode-gateway' -or $health.version -ne 1 -or $health.instance_id -ne $instanceId -or $health.upstream_url -ne $UpstreamUrl -or $runningPort -ne $Port -or $health.mode -ne $Mode -or $health.relay_protocol_version -ne $RelayProtocolVersion) {
        throw 'Running gateway differs from requested configuration; stop mobile remote control in ZCode and use Restart; keep ZCode open to finish the upgrade'
    }
}

$previousRelay = if ($null -ne $config) { $config.previous_user_relay } else { $userRelay }
$controlToken = if ($null -ne $config) { $config.control_token } else { [Guid]::NewGuid().ToString('N') }
# 步骤 4 前置：保存本次要修改的活动记录、任务与配置，供候选失败回退。
$previousConfigBytes = if ($null -ne $config) { [IO.File]::ReadAllBytes($configFile) } else { $null }
$previousActiveBytes = if (Test-Path -LiteralPath $activeGatewayFile) { [IO.File]::ReadAllBytes($activeGatewayFile) } else { $null }
$previousTaskAction = if ($null -ne $task) { @($task.Actions)[0] } else { $null }
$nextConfig = [ordered]@{ version=1; gateway_root=$deploymentDir; tools_root=$ToolsRoot; active_build_id=$buildId; instance_id=$instanceId; port=$Port; upstream_url=$UpstreamUrl; mode=$Mode; relay_protocol_version=$RelayProtocolVersion; previous_user_relay=$previousRelay; control_token=$controlToken }
$healthUrl = "http://127.0.0.1:$Port/health"
[IO.Directory]::CreateDirectory($DataDir) | Out-Null

$registeredThisRun = $false
if ($null -eq $health) {
    $candidateError = $null
    try {
    [IO.File]::WriteAllText($configFile, ($nextConfig | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    # 步骤 4：原子切换活动记录并复用原任务启动候选；任务参数与版本无关。
    Invoke-DeployCli @('--activate', '--tools-root', $ToolsRoot, '--build-id', $buildId, '--node-path', $script:gatewayNode) | Out-Null
    if ($null -eq $task -or @($task.Actions)[0].Execute -cne $scriptHost -or @($task.Actions)[0].Arguments -cne (Get-LauncherArguments)) {
        $taskAction = New-ScheduledTaskAction -Execute $scriptHost -Argument (Get-LauncherArguments) -WorkingDirectory $DataDir
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
        $principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        $registeredThisRun = $true
        $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq '\' }
        $vbsLauncher = $true
    }
    Start-ScheduledTask -TaskName $taskName
    # 步骤 5：核对健康指纹、协议、模式与监听。
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { $health = Read-GatewayHealth; break }
        catch [Net.WebException] {
            if ($_.Exception.Status -ne [Net.WebExceptionStatus]::ConnectFailure -or $attempt -eq 39) { $candidateError = $_.Exception.Message; break }
            Start-Sleep -Milliseconds 250
        }
        catch { $candidateError = $_.Exception.Message; break }
    }
    if ($null -eq $candidateError -and $null -ne $health) {
        if ($health.service -ne 'suian-zcode-gateway' -or $health.version -ne 1 -or $health.instance_id -ne $instanceId -or $health.upstream_url -ne $UpstreamUrl -or $health.mode -ne $Mode -or $health.relay_protocol_version -ne $RelayProtocolVersion) { $candidateError = 'Gateway health check returned a different instance or relay protocol' }
        elseif (-not $health.PSObject.Properties['build'] -or $health.build.id -ne $buildId -or $health.build.root -ne $deploymentDir) { $candidateError = 'Candidate gateway is not running the deployed runtime files' }
    }
    } catch { $candidateError = $_.Exception.Message }
    if ($null -ne $candidateError) {
        # 步骤 6：候选失败回退。有旧部署时恢复先前活动版本；首次安装撤销本次新增注册、环境修改与部署。
        if ($null -ne $previousConfigBytes -or $null -ne $previousActiveBytes -or $null -ne $previousTaskAction) {
            try {
                if ($null -ne $health -and $health.instance_id -eq $instanceId) {
                    if ($health.desktop_connected) { throw 'candidate has an active Desktop connection; fallback was not applied' }
                    $stopped = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/shutdown" -Method Post -Headers @{ Authorization=('Bearer ' + $controlToken) } -TimeoutSec 5 -UseBasicParsing
                    if (-not $stopped.ok) { throw 'candidate did not accept shutdown' }
                    Wait-GatewayExit
                }
                if ($null -ne $previousConfigBytes) { [IO.File]::WriteAllBytes($configFile, $previousConfigBytes) }
                if ($null -ne $previousActiveBytes) { [IO.File]::WriteAllBytes($activeGatewayFile, $previousActiveBytes) }
                elseif (Test-Path -LiteralPath $activeGatewayFile) { Remove-Item -LiteralPath $activeGatewayFile }
                if ($registeredThisRun) {
                    if ($null -ne $previousTaskAction) {
                        $previousWorkingDirectory = $null
                        if ($previousTaskAction.PSObject.Properties['WorkingDirectory']) { $previousWorkingDirectory = $previousTaskAction.WorkingDirectory }
                        $restoreAction = New-ScheduledTaskAction -Execute $previousTaskAction.Execute -Argument $previousTaskAction.Arguments -WorkingDirectory $previousWorkingDirectory
                        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
                        $principal = New-ScheduledTaskPrincipal -UserId $identity.User.Value -LogonType Interactive -RunLevel Limited
                        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1)) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
                        Register-ScheduledTask -TaskName $taskName -Action $restoreAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
                    } else {
                        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
                    }
                }
                if ($null -ne $previousTaskAction) {
                    $healthUrl = "http://127.0.0.1:$runningPort/health"
                    $health = $null
                    Start-ScheduledTask -TaskName $taskName
                    for ($attempt = 0; $attempt -lt 40; $attempt++) {
                        try { $health = Read-GatewayHealth; break }
                        catch [Net.WebException] {
                            if ($_.Exception.Status -ne [Net.WebExceptionStatus]::ConnectFailure -or $attempt -eq 39) { throw }
                            Start-Sleep -Milliseconds 250
                        }
                    }
                    if ($null -eq $health) { throw 'previous deployment did not become reachable' }
                }
                $previousBuildId = 'unknown'
                if ($null -ne $previousActiveBytes) { try { $previousBuildId = ([Text.Encoding]::UTF8.GetString($previousActiveBytes) | ConvertFrom-Json).build_id } catch {} }
            }
            catch {
                throw ("Candidate gateway activation failed: $candidateError; fallback also failed: " + $_.Exception.Message)
            }
            throw ("Candidate gateway activation failed: $candidateError; fallback: restored previous active deployment ($previousBuildId), configuration and task were restored")
        } else {
            if ($null -ne $task -or $registeredThisRun) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
            Remove-Item -LiteralPath $configFile
            if (Test-Path -LiteralPath $activeGatewayFile) { Remove-Item -LiteralPath $activeGatewayFile }
            if (-not $deployResult.alreadyPresent) { Remove-Item -LiteralPath (Join-Path $ToolsRoot ('deployments\' + $buildId)) -Recurse -Force }
            throw ("Candidate gateway activation failed: $candidateError; installation rolled back; the shared gateway is NOT installed (registry and task changes were undone)")
        }
    }
    $vbsLauncher = $true
    $taskRunning = $true
    $task = Get-ScheduledTask | Where-Object { $_.TaskName -eq $taskName -and $_.TaskPath -eq '\' }
    # 旧安装的数据目录启动文件在切换成功后移除；归属为 config 记录的 DataDir。
    if (Test-Path -LiteralPath $legacyLauncherFile) { Remove-Item -LiteralPath $legacyLauncherFile }
} else {
    [IO.File]::WriteAllText($configFile, ($nextConfig | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}
$skillDir = Join-Path $SkillsDir 'suian-zcode-common'
if ($NativePlugin) {
    $installedSkill = Join-Path $skillDir 'SKILL.md'
    if (Test-Path -LiteralPath $installedSkill) {
        $installed = Get-Content -LiteralPath $installedSkill -Raw -Encoding UTF8
        if ($installed.Contains(('**本机公共根**：`' + $PSScriptRoot + '`')) -or ($null -ne $config -and $installed.Contains(('**本机公共根**：`' + $config.gateway_root + '`')))) { Remove-Item -LiteralPath $installedSkill }
    }
} else {
    [IO.Directory]::CreateDirectory($skillDir) | Out-Null
    [IO.File]::WriteAllText((Join-Path $skillDir 'SKILL.md'), $skill, (New-Object Text.UTF8Encoding($false)))
}
$legacySkillFile = Join-Path $SkillsDir 'suian-zcode-gateway\SKILL.md'
if ($null -ne $config -and (Test-Path -LiteralPath $legacySkillFile)) {
    $legacySkill = Get-Content -LiteralPath $legacySkillFile -Raw -Encoding UTF8
    if ($legacySkill.Contains(('**本机网关根**：`' + $config.gateway_root + '`'))) { Remove-Item -LiteralPath $legacySkillFile }
}
# 写入后通知 Explorer 等启动器；当前 Desktop 主进程仍需事后重开。
New-ItemProperty -LiteralPath 'HKCU:\Environment' -Name $relayVariable -Value $relayUrl -PropertyType String -Force | Out-Null
Send-EnvironmentChange
$status = [ordered]@{ ok=$true; action=$(if ($restarting) { 'restarted' } else { 'installed' }); mode=$Mode; relay_url=$relayUrl; health_url=$healthUrl; gateway_running=$true; task_running=$taskRunning; health_status='reachable'; desktop_connected=$health.desktop_connected; paired=$health.paired; vbs_launcher=$vbsLauncher; environment_broadcast='sent' }
$upgrade = Get-GatewayUpgradeStatus ([pscustomobject]$nextConfig) $health
foreach ($field in $upgrade.Keys) { $status[$field] = $upgrade[$field] }
Release-UpgradeLock
$status | ConvertTo-Json -Depth 4 -Compress
