# Empacota o vst-host (host.py) num .zip para o Dangai baixar no primeiro uso.
#
#   powershell -ExecutionPolicy Bypass -File ferramentas\vst\build.ps1
#
# Sai em ferramentas\vst\dist\vst-host-<versao>.zip. Depois: subir como asset da
# release "ferramentas" do repositorio e por o sha256 em electron/services/vst.ts.
param([string]$Versao = "1")

$ErrorActionPreference = "Stop"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $aqui

if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
.\.venv\Scripts\python.exe -m pip install --quiet "pedalboard==0.9.26" "numpy" "pyinstaller"

# De janela (--noconsole): sem console preto piscando a cada chamada. Por isso
# a conversa com o Dangai e por arquivo, nao pelo stdout.
.\.venv\Scripts\python.exe -m PyInstaller host.py --name vst-host --onedir --noconsole --noconfirm --clean `
  --distpath dist --workpath build --specpath build

Copy-Item LICENSE dist\vst-host\LICENSE.txt -Force
Copy-Item host.py dist\vst-host\host.py -Force

$zip = "dist\vst-host-$Versao.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path dist\vst-host -DestinationPath $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "pronto: $zip ($mb MB)"
Write-Host "sha256: $hash"
