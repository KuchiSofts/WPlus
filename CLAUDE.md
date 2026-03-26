# WPlus — Claude Code Instructions

## Project
- **Repo:** github.com/KuchiSofts/WPlus
- **Developer:** KuchiSofts (ChenB)
- **Type:** WhatsApp Desktop plugin (CDP injection)

## Commands

### "update github" or "push"
1. `cd /c/Users/ChenB/WPlus`
2. `git add -A`
3. `git status` (review changes)
4. `git commit -m "<smart commit message based on changes>"`
5. `git push`
6. Report the commit URL

### "create a release"
1. Rebuild the exe:
```bash
cd /c/Users/ChenB/WPlus
pyinstaller --noconfirm --onefile --windowed --name WPlus --icon assets/WPlus.ico \
  --add-data "engine.js;." --add-data "ui.js;." \
  --add-data "service/fileserver.py;." --add-data "assets/icon-64.png;assets" \
  service/wplus.py
rm -rf build WPlus.spec
```
2. Create release zip:
```bash
mkdir -p release
cp dist/WPlus.exe release/
cd release && powershell -Command "Compress-Archive -Path WPlus.exe -DestinationPath '../WPlus-vX.Y.Z-Windows.zip' -Force"
```
3. Commit + push
4. Create GitHub release (if gh CLI available, otherwise give instructions)
5. Update CURRENT_VERSION in service/wplus.py

### Key files
- `engine.js` — injected into WhatsApp (hooks)
- `ui.js` — injected into WhatsApp (settings panel)
- `service/wplus.py` — main exe entry point (tray + injector + file server)
- `service/fileserver.py` — media file server
- `src/` — TypeScript source (compile with `npm run build`)
- `assets/` — icons (WPlus.ico for exe)

### Version
Update `CURRENT_VERSION` in `service/wplus.py` when releasing.

### Git config
- user.name: KuchiSofts
- user.email: kuchisofts@users.noreply.github.com
