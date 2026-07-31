; BidManager Inno Setup installer script
; Build with:
;   ISCC.exe installer\BidManager.iss
; Optional version override:
;   ISCC.exe /DAppVersion=1.2.3 installer\BidManager.iss

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#define AppName "BidManager"
#define AppPublisher "BidManager"
#define AppExeName "BidManager.exe"

[Setup]
AppId={{E6A4BB67-1178-4A95-A956-6F5406B8C644}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoCompany={#AppPublisher}
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppCopyright=Copyright (C) 2026 {#AppPublisher}
AppPublisherURL=
AppSupportURL=
AppUpdatesURL=
DefaultDirName={localappdata}\BidManager
DefaultGroupName=BidManager
OutputDir=dist\installer
OutputBaseFilename=BidManager-Setup-{#AppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}

#ifexist "installer\assets\app.ico"
SetupIconFile=installer\assets\app.ico
#endif

#ifexist "installer\assets\wizard.bmp"
WizardImageFile=installer\assets\wizard.bmp
#endif

#ifexist "installer\assets\wizard_small.bmp"
WizardSmallImageFile=installer\assets\wizard_small.bmp
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "dist\BidManager\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\BidManager"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall BidManager"; Filename: "{uninstallexe}"
Name: "{autodesktop}\BidManager"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch BidManager"; Flags: nowait postinstall skipifsilent
