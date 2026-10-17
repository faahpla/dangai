; ============================================================
;  AnCut HUB - Inno Setup script
; ============================================================
;  Wraps dist\CorteCenas\ (PyInstaller onedir output) into a
;  proper Windows installer: Start Menu / Desktop shortcuts,
;  Add/Remove Programs entry, upgrade-in-place support.
;
;  Build via build_installer.bat (which runs PyInstaller first,
;  then invokes ISCC.exe on this file).
;
;  Requires Inno Setup 6+  ->  https://jrsoftware.org/isdl.php
; ============================================================

#define AppName        "AnCut HUB"
#define AppVersion     "0.4.4"
#define AppPublisher   "Levi Clementino"
#define AppExeName     "CorteCenas.exe"
; AppId PRÓPRIO (diferente do Corte Cenas original). O Inno usa o AppId pra
; decidir o que é "a mesma aplicação": com um id novo, o AnCut HUB instala do
; lado do Corte Cenas em vez de atualizar por cima e apagá-lo.
#define AppId          "{{B9E24D07-5F16-4A83-8C4E-1D7F0A6B39C2}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\AnCut HUB
DefaultGroupName=AnCut HUB
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
DisableProgramGroupPage=yes
OutputDir=releases
OutputBaseFilename=AnCut-HUB-Setup-{#AppVersion}
SetupIconFile=app\assets\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
; Same AppId across versions => "install over" behavior (upgrade in place).
CloseApplications=force
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Copy the entire PyInstaller onedir tree into {app}\
Source: "dist\CorteCenas\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; "(clássico)" no nome: a interface nova em Electron também se chama AnCut HUB,
; e dois atalhos idênticos no Menu Iniciar deixam impossível saber qual é qual.
Name: "{group}\AnCut HUB (clássico)";        Filename: "{app}\{#AppExeName}"
Name: "{group}\Desinstalar AnCut HUB (clássico)"; Filename: "{uninstallexe}"
Name: "{autodesktop}\AnCut HUB (clássico)";  Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; runasoriginaluser: o instalador roda elevado, mas o app deve abrir com os
; privilégios normais do usuário — elevado, o Windows bloqueia drag-and-drop
; vindo do Explorer (UIPI).
Filename: "{app}\{#AppExeName}"; Description: "Abrir AnCut HUB"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
; Nothing beyond what [Files] tracked. The user's cache/output stays in
; %LOCALAPPDATA%\CorteCenas and their Output folder — we don't touch those.
Type: filesandordirs; Name: "{app}\_internal\__pycache__"

; ============================================================
;  FFmpeg is now bundled inside the installer (bin\ffmpeg.exe),
;  so no external check is needed. The app resolves the bundled
;  binary via app/ffmpeg_locate.py.
; ============================================================
