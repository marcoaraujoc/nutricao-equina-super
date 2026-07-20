# Sobe a Evolution API local (dev, Windows sem Docker).
# Instalação: D:\Projetos\evolution-api (clone + build já feitos; .env configurado
# apontando para o PostgreSQL local, banco dbevolution, cache local sem Redis).
# Uso:  .\start-evolution.ps1        (janela própria; feche a janela para parar)
# Na VPS use o docker-compose.yml desta pasta em vez deste script.
$evo = 'D:\Projetos\evolution-api'
if (-not (Test-Path (Join-Path $evo 'dist\main.js'))) {
  Write-Host 'Build não encontrado — rodando npm run build...' -ForegroundColor Yellow
  Push-Location $evo; npm run build; Pop-Location
}
Start-Process -FilePath 'node' -ArgumentList 'dist/main' -WorkingDirectory $evo -WindowStyle Minimized
Write-Host 'Evolution API iniciando em http://localhost:8080 (janela minimizada do node).' -ForegroundColor Green
