# Installer Branding Assets

Drop optional branding files in this folder to customize both:
- `BidManager.exe` icon (PyInstaller)
- `Setup.exe` icon and wizard artwork (Inno Setup)

## Files

1. `app.ico`
- Used by `desktop_app.spec` for the app executable icon
- Used by `installer/BidManager.iss` as installer icon
- Recommended: multi-size ICO with at least 16, 32, 48, 256 px

2. `wizard.bmp`
- Large installer wizard image (left side)
- Recommended: 164 x 314 px BMP

3. `wizard_small.bmp`
- Small installer header image
- Recommended: 55 x 55 px BMP

If these files are missing, the build still works and uses default visuals.
