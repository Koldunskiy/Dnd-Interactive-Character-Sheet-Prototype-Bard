$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$fontDir = Join-Path $projectRoot 'assets\fonts'
New-Item -ItemType Directory -Force -Path $fontDir | Out-Null

function Test-DownloadedFont {
  param([Parameter(Mandatory = $true)][string]$Path)

  $file = Get-Item -LiteralPath $Path
  if ($file.Length -lt 10000) {
    throw "Font download is unexpectedly small: $Path"
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $header = New-Object byte[] 4
    $bytesRead = $stream.Read($header, 0, $header.Length)
  } finally {
    $stream.Dispose()
  }

  if ($bytesRead -ne 4 -or [BitConverter]::ToString($header) -ne '00-01-00-00') {
    throw "Download does not have the expected TrueType signature: $Path"
  }
}

function Test-DownloadedLicense {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$CopyrightNotice
  )

  $text = [System.IO.File]::ReadAllText($Path)

  if ($text -notmatch 'SIL OPEN FONT LICENSE Version 1\.1') {
    throw "License does not identify SIL OFL 1.1: $Path"
  }

  if ($text -notmatch [regex]::Escape($CopyrightNotice)) {
    throw "License is missing the expected copyright notice: $Path"
  }
}

$downloads = @(
  @{
    Uri = 'https://fonts.gstatic.com/s/cormorantgaramond/v21/co3umX5slCNuHLi8bLeY9MK7whWMhyjypVO7abI26QOD_s06GnM.ttf'
    Name = 'CormorantGaramond-500.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://fonts.gstatic.com/s/cormorantgaramond/v21/co3umX5slCNuHLi8bLeY9MK7whWMhyjypVO7abI26QOD_iE9GnM.ttf'
    Name = 'CormorantGaramond-600.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://fonts.gstatic.com/s/cormorantgaramond/v21/co3umX5slCNuHLi8bLeY9MK7whWMhyjypVO7abI26QOD_hg9GnM.ttf'
    Name = 'CormorantGaramond-700.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf'
    Name = 'Inter-400.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
    Name = 'Inter-500.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf'
    Name = 'Inter-600.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf'
    Name = 'Inter-700.ttf'
    Kind = 'font'
  },
  @{
    Uri = 'https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/OFL.txt'
    Name = 'OFL-Cormorant-Garamond.txt'
    Kind = 'license'
    CopyrightNotice = 'Copyright 2015 the Cormorant Project Authors'
  },
  @{
    Uri = 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt'
    Name = 'OFL-Inter.txt'
    Kind = 'license'
    CopyrightNotice = 'Copyright 2020 The Inter Project Authors'
  }
)

foreach ($item in $downloads) {
  $destination = Join-Path $fontDir $item.Name
  $temporary = Join-Path $fontDir (
    ".$($item.Name).$([guid]::NewGuid().ToString('N')).download"
  )

  try {
    Invoke-WebRequest -Uri $item.Uri -OutFile $temporary -UseBasicParsing

    if ($item.Kind -eq 'font') {
      Test-DownloadedFont -Path $temporary
    } elseif ($item.Kind -eq 'license') {
      Test-DownloadedLicense `
        -Path $temporary `
        -CopyrightNotice $item.CopyrightNotice
    } else {
      throw "Unknown download kind '$($item.Kind)' for $($item.Name)."
    }

    if (Test-Path -LiteralPath $destination) {
      [System.IO.File]::Replace($temporary, $destination, $null)
    } else {
      [System.IO.File]::Move($temporary, $destination)
    }

    Write-Output "Validated and installed $($item.Name)"
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}
