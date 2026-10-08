// SPDX-License-Identifier: GPL-3.0-only
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// ComboRow ligado a uma chave de texto com valores fixos
function choiceRow(settings, key, title, subtitle, choices) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });
    const sync = () => {
        const i = choices.findIndex(([value]) => value === settings.get_string(key));
        if (i >= 0 && row.selected !== i)
            row.selected = i;
    };
    sync();
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

export default class MinimizeTidyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage();
        window.add(page);

        /* ----------------------------------------------------- Comportamento */

        const behavior = new Adw.PreferencesGroup({title: _('Behavior')});
        page.add(behavior);

        const hide = new Adw.SwitchRow({
            title: _('Hide minimized windows in the Overview'),
            subtitle: _('Alt+Tab and the dock are not affected'),
        });
        settings.bind('hide-in-overview', hide, 'active', Gio.SettingsBindFlags.DEFAULT);
        behavior.add(hide);

        /* ----------------------------------------------------- Botão na barra */

        const indicator = new Adw.PreferencesGroup({
            title: _('Top bar button'),
            description: _('Lists minimized windows so you can restore them.'),
        });
        page.add(indicator);

        indicator.add(choiceRow(settings, 'indicator-mode', _('Show button'), null, [
            ['always', _('Always')],
            ['when-needed', _('Only when a window is minimized')],
        ]));

        const count = new Adw.SwitchRow({title: _('Show number of minimized windows')});
        settings.bind('show-count', count, 'active', Gio.SettingsBindFlags.DEFAULT);
        indicator.add(count);

        /* ---------------------------------------------------------- Animação */

        const anim = new Adw.PreferencesGroup({
            title: _('Animation'),
            description: _('How windows minimize and come back.'),
        });
        page.add(anim);

        const effect = choiceRow(settings, 'animation-effect', _('Effect'), null, [
            ['scale', _('Shrink')],
            ['fade', _('Fade')],
            ['flip', _('Flip')],
            ['instant', _('None')],
            ['system', _('GNOME default')],
        ]);
        anim.add(effect);

        const direction = choiceRow(settings, 'animation-direction', _('Shrink toward'), null, [
            ['icon', _('App icon in the dock')],
            ['top-left', _('Top left corner')],
            ['top-center', _('Top center')],
            ['top-right', _('Top right corner')],
            ['bottom-left', _('Bottom left corner')],
            ['bottom-center', _('Bottom center')],
            ['bottom-right', _('Bottom right corner')],
            ['center', _('Center of the screen')],
        ]);
        anim.add(direction);

        const duration = new Adw.SpinRow({
            title: _('Duration (ms)'),
            adjustment: new Gtk.Adjustment({lower: 100, upper: 1000, step_increment: 25, page_increment: 100}),
        });
        settings.bind('animation-duration', duration, 'value', Gio.SettingsBindFlags.DEFAULT);
        anim.add(duration);

        const updateSensitivity = () => {
            const value = settings.get_string('animation-effect');
            direction.sensitive = value === 'scale';
            duration.sensitive = !['instant', 'system'].includes(value);
        };
        settings.connect('changed::animation-effect', updateSensitivity);
        updateSensitivity();
    }
}
