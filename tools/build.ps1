<#
.SYNOPSIS
    Assemble et linke un fichier ASM Win32 généré par Scadassembler.
.DESCRIPTION
    Détecte automatiquement MASM32 (ml.exe) ou GoAsm/GoLink.
    Compile avec les options COFF 32-bit, lie avec kernel32/user32.
.EXAMPLE
    .\build.ps1 -Source "Qw0-win32.asm" -Output "Qw0.exe"
#>

param(
    [string]$Source = "Qw0-win32.asm",
    [string]$Output = "Qw0.exe",
    [switch]$Clean = $false,
    [switch]$Verbose = $true
)

$ErrorActionPreference = "Stop"
$ObjFile = [System.IO.Path]::ChangeExtension($Source, "obj")
$LibPath = "C:\masm32\lib" # Chemin standard MASM32

Write-Host "`n🔨 Scadassembler Build Pipeline" -ForegroundColor Cyan
Write-Host "   Source: $Source" -ForegroundColor Gray
Write-Host "   Target: $Output`n" -ForegroundColor Gray

# 1. Nettoyage
if ($Clean -and (Test-Path $ObjFile)) {
    Remove-Item $ObjFile -Force
    Write-Host "🗑️  Fichier objet supprimé." -ForegroundColor Yellow
}

# 2. Détection de l'assembleur
$ML = Get-Command "ml" -ErrorAction SilentlyContinue
$ML32 = Get-Command "ml32" -ErrorAction SilentlyContinuently
$GoAsm = Get-Command "goasm" -ErrorAction SilentlyContinue

if ($ML) { $Assembler = "ml" }
elseif ($ML32) { $Assembler = "ml32" }
else {
    Write-Error "❌ Assembleur non trouvé. Installez MASM32 ou ajoutez ml.exe au PATH."
    exit 1
}

Write-Host "⚙️  Assembleur: $Assembler" -ForegroundColor Green

# 3. Assemblage
$AsmArgs = @(
    "/c", "/coff", "/Zd", "/Zi",
    "/Fo`"$ObjFile`"",
    "/I`"$LibPath`"",
    $Source
)

Write-Host "📦 Assemblage en cours..." -ForegroundColor Yellow
try {
    & $Assembler @AsmArgs 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Erreur d'assemblage" }
} catch {
    Write-Error "❌ Échec de l'assemblage. Vérifiez la syntaxe MASM."
    exit 1
}
Write-Host "✅ Assemblage réussi ($ObjFile)" -ForegroundColor Green

# 4. Linkage
$LINK = Get-Command "link" -ErrorAction SilentlyContinue
$GoLink = Get-Command "golink" -ErrorAction SilentlyContinue

if ($LINK) {
    $LinkArgs = @(
        "/subsystem:console",
        "/out:`"$Output`"",
        "$ObjFile",
        "kernel32.lib", "user32.lib", "msvcrt.lib"
    )
    Write-Host "🔗 Linkage (link.exe)..." -ForegroundColor Yellow
    & link @LinkArgs 2>&1 | Out-Host
} elseif ($GoLink) {
    $LinkArgs = @("/fo", $Output, $ObjFile, "kernel32.dll", "user32.dll")
    Write-Host "🔗 Linkage (GoLink)..." -ForegroundColor Yellow
    & golink @LinkArgs 2>&1 | Out-Host
} else {
    Write-Error "❌ Linker non trouvé (link.exe ou golink.exe requis)."
    exit 1
}

if ($LASTEXITCODE -ne 0) { throw "Erreur de link" }
Write-Host "✅ Linke réussi ($Output)`n" -ForegroundColor Green

# 5. Vérification
if (Test-Path $Output) {
    $size = (Get-Item $Output).Length
    Write-Host "🎉 Binaire généré: $Output ($size octets)" -ForegroundColor Magenta
} else {
    Write-Error "❌ Le fichier de sortie n'a pas été créé."
    exit 1
}

# Nettoyage post-build
if ($Clean) {
    Remove-Item $ObjFile -Force -ErrorAction SilentlyContinue
}

Write-Host "🚀 Exécution: .\$Output`n" -ForegroundColor White