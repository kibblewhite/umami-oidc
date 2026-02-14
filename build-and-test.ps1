<#
.SYNOPSIS
    Build the Umami + OIDC Docker image and run all tests.

.DESCRIPTION
    This script builds the Docker image (which runs unit tests during build),
    starts the full stack with docker-compose, runs runtime smoke tests,
    and tears everything down.

.PARAMETER Mode
    full        - Build + unit tests + smoke tests (default)
    BuildOnly   - Just build the image (unit tests run during build)
    SmokeOnly   - Just run smoke tests (image must already exist)

.EXAMPLE
    .\build-and-test.ps1
    .\build-and-test.ps1 -Mode BuildOnly
    .\build-and-test.ps1 -Mode SmokeOnly
#>

[CmdletBinding()]
param(
    [ValidateSet("full", "BuildOnly", "SmokeOnly")]
    [string]$Mode = "full"
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
$ImageName   = "umami-oidc"
$ComposeFile = "docker-compose.yml"

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
function Write-Log  { param([string]$Msg) Write-Host "[build] $Msg" -ForegroundColor Cyan }
function Write-Pass { param([string]$Msg) Write-Host "[pass]  $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$Msg) Write-Host "[fail]  $Msg" -ForegroundColor Red }

# ===========================================================================
# Step 1: Build the image (unit tests run inside the build)
# ===========================================================================
if ($Mode -ne "SmokeOnly") {
    Write-Log "Building Docker image '$ImageName' ..."
    Write-Log "  (Unit tests run during build - build fails if tests fail)"
    Write-Host ""

    docker build -t $ImageName .
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker build FAILED (check output above for test failures)"
        exit 1
    }
    Write-Pass "Docker image built successfully"
    Write-Host ""

    if ($Mode -eq "BuildOnly") {
        Write-Log "Build-only mode - skipping smoke tests"
        Write-Host ""
        Write-Pass "Done. Run smoke tests later with: .\build-and-test.ps1 -Mode SmokeOnly"
        exit 0
    }
}

# ===========================================================================
# Step 2: Start the stack with docker-compose
# ===========================================================================
Write-Log "Starting Umami + PostgreSQL via docker-compose ..."

# Tear down any existing stack (ignore errors if nothing is running)
docker compose -f $ComposeFile down -v 2>$null
docker compose -f $ComposeFile up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker compose up failed"
    exit 1
}

Write-Log "Waiting for Umami to become healthy ..."

$Attempts    = 0
$MaxAttempts = 40
$Healthy     = $false

while ($Attempts -lt $MaxAttempts) {
    try {
        $psOutput = docker compose -f $ComposeFile ps --format json 2>$null
        if ($psOutput -match '"Health"\s*:\s*"healthy"') {
            $Healthy = $true
            break
        }
    } catch {
        # Ignore parse errors from docker compose ps
    }

    $Attempts++
    Write-Host "." -NoNewline
    Start-Sleep -Seconds 3
}
Write-Host ""

if (-not $Healthy) {
    Write-Err "Umami did not become healthy within 120 seconds"
    Write-Log "Container logs:"
    docker compose -f $ComposeFile logs umami --tail=50
    docker compose -f $ComposeFile down -v
    exit 1
}
Write-Pass "Umami is healthy"

# ===========================================================================
# Step 3: Run the runtime smoke tests inside the container
# ===========================================================================
Write-Log "Running runtime smoke tests ..."
Write-Host ""

docker compose -f $ComposeFile exec -T umami /app/tests/smoke-test.sh
if ($LASTEXITCODE -ne 0) {
    Write-Err "Smoke tests FAILED"
    docker compose -f $ComposeFile logs umami --tail=30
    docker compose -f $ComposeFile down -v
    exit 1
}
Write-Pass "All smoke tests passed"

# ===========================================================================
# Step 4: Cleanup
# ===========================================================================
Write-Host ""
Write-Log "Tearing down test stack ..."
docker compose -f $ComposeFile down -v

Write-Host ""
Write-Host "============================================"
Write-Pass "All tests passed!"
Write-Host "============================================"
Write-Host ""
Write-Host "To run in production:"
Write-Host "  docker compose up -d"
Write-Host ""
Write-Host "Remember to set your OIDC environment variables"
Write-Host "in docker-compose.yml before deploying."
