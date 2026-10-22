param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [Parameter(Mandatory = $true)]
  [string]$Sha256
)

$project = Split-Path -Parent $PSScriptRoot
$out = Join-Path $project "dist\update.json"
$payload = @{
  addons = @{
    "literatureflow@zotero.local" = @{
      updates = @(@{
        version = $Version
        update_link = "https://github.com/PracticeEarnestly/zotero-literature-flow/releases/download/v$Version/zotero-literature-flow-$Version.xpi"
        update_hash = "sha256:$Sha256"
        applications = @{
          zotero = @{
            strict_min_version = "7.0"
            strict_max_version = "9.*"
          }
        }
      })
    }
  }
}
$payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $out -Encoding utf8NoBOM
Write-Output "Wrote $out"
