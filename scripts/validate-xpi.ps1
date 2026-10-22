$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $PSScriptRoot
$addon = Join-Path $project "addon"
$manifestPath = Join-Path $addon "manifest.json"
$workflowPath = Join-Path $addon "content\workflow.js"
$node = "C:\Users\Xiqing\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (-not (Test-Path -LiteralPath $node)) { throw "Bundled Node.js runtime not found." }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.applications.zotero.id -ne "literatureflow@zotero.local") { throw "Unexpected addon ID." }
if ($manifest.applications.zotero.strict_min_version -ne "7.0") { throw "Unexpected minimum Zotero version." }
& $node --check $workflowPath
if ($LASTEXITCODE -ne 0) { throw "workflow.js syntax validation failed." }
foreach ($required in @("bootstrap.js", "content\workflow.js", "content\vendor\jszip.min.js", "prefs.js")) {
  if (-not (Test-Path -LiteralPath (Join-Path $addon $required))) { throw "Missing required file: $required" }
}
Write-Output "Static XPI validation passed."
