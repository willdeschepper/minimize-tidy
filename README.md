# Minimize Tidy

A small GNOME Shell extension for people who use the Activities Overview without a permanent dock. Minimized windows leave the Overview but remain open and accessible from a menu in the top bar.

| Where | Minimized windows |
| --- | --- |
| Activities Overview (`F3` on some setups) | Hidden |
| Alt+Tab | Available |
| Application icon's open windows menu | Available |
| Top bar menu | Listed by window title; click to restore |

This first version targets **GNOME Shell 50**. It does not create a tray icon or change the minimize action. It works by wrapping GNOME Shell's internal `Workspace.prototype._isOverviewWindow` method; future GNOME releases may require adjustments.

## Install locally

Disable **Hide minimized** by danigm first if it is installed. The two extensions change the same internal Overview method and should not run together.

```bash
git clone https://github.com/willdeschepper/minimize-tidy.git
cd minimize-tidy
gnome-extensions pack --force --extra-source=LICENSE
gnome-extensions install --force minimize-tidy@willdeschepper.github.io.shell-extension.zip
```

On **Wayland**, log out and log back in so GNOME Shell discovers a newly installed extension. Then enable it:

```bash
gnome-extensions enable minimize-tidy@willdeschepper.github.io
```

Alternatively, use the **Extensions** app to enable it after logging back in. Test by minimizing one window and opening the Overview; that window should be absent there but still available through Alt+Tab and the menu in the top bar. Open the menu to see the current list of minimized windows, then select one to restore it. The menu includes windows from all workspaces.

To remove it:

```bash
gnome-extensions disable minimize-tidy@willdeschepper.github.io
gnome-extensions uninstall minimize-tidy@willdeschepper.github.io
```

## Development

The extension changes only the Overview window predicate, restores it when disabled, and creates a top bar menu which is rebuilt whenever it opens. For quick static checks:

```bash
node --check extension.js
python3 -m json.tool metadata.json > /dev/null
```

It needs an interactive GNOME Shell 50 session to confirm runtime behavior. Please report the GNOME version and any other extensions that modify the Overview when filing an issue.

## Credits and license

Based on [Hide minimized](https://github.com/danigm/hide-minimized) by Daniel Garcia Moreno. The original implementation also filters Alt+Tab and window cyclers; this variant limits the change to the Overview and uses a separate extension UUID. The upstream project is licensed under GPL-3.0. This modified version is distributed under **GPL-3.0**; see [LICENSE](LICENSE).
