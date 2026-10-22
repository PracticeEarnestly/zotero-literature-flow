$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$addon = Join-Path $project "addon"
$dist = Join-Path $project "dist"
$manifest = Get-Content -LiteralPath (Join-Path $addon "manifest.json") -Raw | ConvertFrom-Json
$xpi = Join-Path $dist ("zotero-literature-flow-" + $manifest.version + ".xpi")

& (Join-Path $PSScriptRoot "validate-xpi.ps1")
if (Test-Path -LiteralPath $xpi) {
  Remove-Item -LiteralPath $xpi -Force
}
Push-Location $addon
try {
  & 7z.exe a -tzip $xpi bootstrap.js prefs.js manifest.json content | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "7-Zip failed to create the XPI." }
} finally {
  Pop-Location
}
if ((Get-Content -LiteralPath $xpi -AsByteStream -TotalCount 2) -join ',' -ne '80,75') {
  throw "XPI output is not a ZIP archive."
}
Write-Output "Built $xpi"
