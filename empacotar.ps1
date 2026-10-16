# empacotar.ps1
# Gera a pasta "entrega" com o que pode ser enviado a outra pessoa:
#   - Linha-do-Tempo-Flavio-Bolsonaro.html   (arquivo unico: abre com dois cliques)
#   - Instalar-Linha-do-Tempo.exe             (instalador Windows, compilado com o csc.exe do .NET Framework)
#   - LEIAME.txt
# Rode de novo sempre que alterar index.html, style.css, app.js, explorar.js, plano.js, negacionismo.js,
# dados_investigacoes.json, plano_governo.json ou negacionismo_dados.json:
#   powershell -ExecutionPolicy Bypass -File .\empacotar.ps1
# Use -SemInstalador para gerar apenas o HTML.
param([switch]$SemInstalador)

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$saida = Join-Path $raiz 'entrega'
$nomeHtml = 'Linha-do-Tempo-Flavio-Bolsonaro.html'
$nomeExe = 'Instalar-Linha-do-Tempo.exe'
$utf8 = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force $saida | Out-Null

function Ler([string]$arquivo) { [IO.File]::ReadAllText((Join-Path $raiz $arquivo), [Text.Encoding]::UTF8) }
function ParaCrlf([string]$texto) { ($texto -replace "`r?`n", "`r`n") }
function ProtegeScript([string]$texto) { $texto -replace '</script', '<\/script' }

# ---- 0) Regenera as copias .js (usadas so quando o navegador bloqueia fetch em file://) ----
function GeraJs([string]$json, [string]$js, [string]$variavel) {
  $conteudo = (Ler $json).Trim()
  $null = $conteudo | ConvertFrom-Json   # falha cedo se o JSON estiver invalido
  $cabecalho = "/* Gerado a partir de $json. Usado apenas quando o navegador bloqueia fetch() em file://. Se editar o JSON, regenere este arquivo (empacotar.ps1 faz isso). */"
  [IO.File]::WriteAllText((Join-Path $raiz $js), "$cabecalho`r`nwindow.$variavel = $conteudo;`r`n", $utf8)
}
GeraJs 'dados_investigacoes.json' 'dados_investigacoes.js' 'DADOS_INVESTIGACOES'
GeraJs 'plano_governo.json' 'plano_governo.js' 'DADOS_PLANO'
GeraJs 'negacionismo_dados.json' 'negacionismo_dados.js' 'DADOS_NEGACIONISMO'

# ---- 1) HTML unico: CSS, dados e JS embutidos ---------------------------------------------
$html = Ler 'index.html'
$css  = Ler 'style.css'
$json = ProtegeScript ((Ler 'dados_investigacoes.json').Trim())
$plano = ProtegeScript ((Ler 'plano_governo.json').Trim())
$nega = ProtegeScript ((Ler 'negacionismo_dados.json').Trim())

$trocas = @(
  @('<link rel="stylesheet" href="style.css">', "<style>`n$css`n</style>"),
  @('<script src="dados_investigacoes.js"></script>', "<script>window.LTF_EMBUTIDO = true; window.DADOS_INVESTIGACOES = $json;</script>"),
  @('<script src="plano_governo.js"></script>', "<script>window.DADOS_PLANO = $plano;</script>"),
  @('<script src="negacionismo_dados.js"></script>', "<script>window.DADOS_NEGACIONISMO = $nega;</script>")
)
foreach ($script in 'app.js', 'explorar.js', 'plano.js', 'negacionismo.js') {
  $trocas += , @("<script src=`"$script`"></script>", "<script>`n$(ProtegeScript (Ler $script))`n</script>")
}
foreach ($t in $trocas) {
  if (-not $html.Contains($t[0])) { throw "Trecho nao encontrado no index.html: $($t[0])" }
  $html = $html.Replace($t[0], $t[1])
}
[IO.File]::WriteAllText((Join-Path $saida $nomeHtml), $html, $utf8)
Write-Host ("OK  {0}  ({1:N0} KB)" -f $nomeHtml, ((Get-Item (Join-Path $saida $nomeHtml)).Length / 1KB))

[IO.File]::WriteAllText((Join-Path $saida 'LEIAME.txt'), (ParaCrlf (Get-Content -Raw -Encoding UTF8 (Join-Path $raiz 'instalador\LEIAME.txt'))), $utf8)

if ($SemInstalador) { return }

# ---- 2) Instalador .exe (C# compilado com o csc.exe que ja vem no Windows) ----------------
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { Write-Warning '.NET Framework (csc.exe) nao encontrado; instalador nao gerado.'; return }

# pasta temporaria com caminho ASCII (o compilador nao gosta de acentos em /resource)
$tmp = Join-Path $env:TEMP ('ltf_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  Copy-Item (Join-Path $saida $nomeHtml) (Join-Path $tmp 'app.html')
  [IO.File]::WriteAllText((Join-Path $tmp 'desinstalar.cmd'),
    (ParaCrlf (Get-Content -Raw -Encoding UTF8 (Join-Path $raiz 'instalador\desinstalar.cmd'))), (New-Object System.Text.ASCIIEncoding))
  Copy-Item (Join-Path $raiz 'instalador\Instalador.cs') (Join-Path $tmp 'Instalador.cs')

  $exeTmp = Join-Path $tmp $nomeExe
  $saidaCsc = & $csc /nologo /target:winexe /optimize+ "/out:$exeTmp" /codepage:65001 `
    /r:System.Windows.Forms.dll /r:Microsoft.CSharp.dll `
    "/resource:$(Join-Path $tmp 'app.html'),app.html" "/resource:$(Join-Path $tmp 'desinstalar.cmd'),desinstalar.cmd" `
    (Join-Path $tmp 'Instalador.cs') 2>&1
  if (-not (Test-Path $exeTmp)) { throw "Falha ao compilar o instalador:`n$($saidaCsc -join "`n")" }

  Copy-Item $exeTmp (Join-Path $saida $nomeExe) -Force
  Write-Host ("OK  {0}  ({1:N0} KB)" -f $nomeExe, ((Get-Item (Join-Path $saida $nomeExe)).Length / 1KB))
}
finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
