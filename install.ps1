$ErrorActionPreference = "Stop"

$Version = if ($env:RIL_VERSION) { $env:RIL_VERSION } else { "0.2.1" }
$InstallDir = if ($env:RIL_INSTALL_DIR) { $env:RIL_INSTALL_DIR } else { Join-Path $HOME ".local\bin" }
$Repo = "retvest/ril-laws"
$Archive = "ril-$Version-x86_64-pc-windows-gnu.zip"
$BaseUrl = "https://github.com/$Repo/releases/download/v$Version"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ril-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    $ArchivePath = Join-Path $TempDir $Archive
    $SumsPath = Join-Path $TempDir "SHA256SUMS.txt"

    Write-Host "Downloading RIL Laws v$Version (Windows x86_64)..."
    Invoke-WebRequest -Uri "$BaseUrl/$Archive" -OutFile $ArchivePath
    Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS.txt" -OutFile $SumsPath

    Write-Host "Verifying SHA-256 checksum..."
    $Expected = (Get-Content $SumsPath | Where-Object { $_ -match "\s+$([regex]::Escape($Archive))$" } | Select-Object -First 1) -split "\s+" | Select-Object -First 1
    if (-not $Expected) {
        throw "Checksum entry for $Archive missing from SHA256SUMS.txt."
    }
    $Actual = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected.ToLowerInvariant()) {
        throw "SHA-256 mismatch for $Archive."
    }

    Expand-Archive -Path $ArchivePath -DestinationPath $TempDir -Force
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $Dest = Join-Path $InstallDir "ril.exe"
    Copy-Item -Path (Join-Path $TempDir "ril.exe") -Destination $Dest -Force

    Write-Host ""
    Write-Host "Installed ril.exe to $Dest"
    & $Dest --version

    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not ($UserPath -split ";" | Where-Object { $_ -eq $InstallDir })) {
        Write-Host "Add to your PATH: setx PATH `"$UserPath;$InstallDir`""
    }
} finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
