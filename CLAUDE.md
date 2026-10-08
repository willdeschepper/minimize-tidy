# minimize-tidy

Extensão do GNOME Shell 50 (UUID `minimize-tidy@willdeschepper.github.io`). Licença GPL-3.0-only.

## Arquivos
extension.js (lógica, menu, animações), prefs.js (janela de preferências), stylesheet.css. Configurações em `schemas/`, traduções em `po/` (pt_BR).

## Comandos
- `./dev.sh`: instala e abre o GNOME aninhado (devkit), que reinicia a cada arquivo salvo. Erros aparecem no terminal.
- `./install.sh`: instala em ~/.local/share/gnome-shell/extensions (sessão real precisa de logout/login).
- `./build.sh`: gera `dist/minimize-tidy@willdeschepper.github.io.shell-extension.zip` para o extensions.gnome.org.
- `pipx run shexli dist/minimize-tidy@willdeschepper.github.io.shell-extension.zip`: verificador da loja; rodar antes de todo envio.
- Logs da sessão real: `journalctl -f -o cat /usr/bin/gnome-shell`; das preferências: `journalctl -f -o cat /usr/bin/gjs`.

## Remover e reinstalar na sessão real
- Remover: `gnome-extensions disable minimize-tidy@willdeschepper.github.io` e `rm -rf ~/.local/share/gnome-shell/extensions/minimize-tidy@willdeschepper.github.io`
- Apagar também as configurações: `dconf reset -f /org/gnome/shell/extensions/minimize-tidy/`
- Reinstalar: `./install.sh`, logout e login, depois `gnome-extensions enable minimize-tidy@willdeschepper.github.io`
- O GNOME só carrega código novo de extensão no início da sessão; sem logout a versão antiga continua rodando.

## Regras do projeto
- ES Modules do GNOME 45+ (`gi://`, `resource:///org/gnome/shell/...`). Nada de `imports.gi`.
- Tudo que é criado em `enable()` precisa ser desfeito em `disable()`: sinais, timeouts (`GLib.source_remove`), atores, patches em protótipos.
- Nada de `console.log` de depuração na versão publicada (revisores da loja rejeitam). `console.warn` só para erro real.
- Todo texto visível em inglês dentro de `_()` (ou `ngettext`), com a tradução adicionada em `po/pt_BR.po`.
- Chave nova de configuração: adicionar no `.gschema.xml` e validar com `glib-compile-schemas --strict --dry-run schemas`.
- Não dá para ver a interface daqui: depois de mudar algo visual, pedir para o usuário testar no `./dev.sh` e mandar print ou erro.
- Antes de publicar: subir `version-name` no metadata.json, rodar `./build.sh` e o shexli.
