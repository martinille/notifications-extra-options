const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const MessageTray = imports.ui.messageTray;
const Settings = imports.ui.settings;

const UUID = "cinnamon-notifications-fixer@martinille";
const URGENCY_NORMAL = 1;

let fixer = null;

function init(metadata) {
    fixer = new NotificationFixer(metadata.uuid);
}

function enable() {
    fixer.enable();
}

function disable() {
    fixer.disable();
}

class NotificationFixer {
    constructor(uuid) {
        this.uuid = uuid || UUID;
        this.timeoutSeconds = 10;
        this.deleteAfterTimeout = true;
        this.normalizeCritical = true;
        this.position = "top-right";

        this._enabled = false;
        this._settings = new Settings.ExtensionSettings(this, this.uuid);
        this._settings.bind("timeout-seconds", "timeoutSeconds", this._onSettingsChanged);
        this._settings.bind("delete-after-timeout", "deleteAfterTimeout", this._onSettingsChanged);
        this._settings.bind("normalize-critical", "normalizeCritical", this._onSettingsChanged);
        this._settings.bind("position", "position", this._onSettingsChanged);

        this._originals = {};
        this._timers = [];
    }

    enable() {
        if (this._enabled) {
            return;
        }

        this._patchNotificationDaemon();
        this._patchMessageTray();
        this._enabled = true;
    }

    disable() {
        if (!this._enabled) {
            return;
        }

        this._restore();
        this._clearAllTimers();
        this._enabled = false;
    }

    _onSettingsChanged() {
        this._repositionCurrent();
    }

    _patchNotificationDaemon() {
        const daemon = Main.notificationDaemon;

        if (!daemon || !daemon.NotifyAsync || this._originals.notifyAsync) {
            return;
        }

        this._originals.notifyAsync = daemon.NotifyAsync;
        const self = this;

        daemon.NotifyAsync = function(params, invocation) {
            return self._originals.notifyAsync.call(this, self._normalizeParams(params), invocation);
        };
    }

    _patchMessageTray() {
        const tray = Main.messageTray;

        if (!tray || this._originals.trayOnNotify) {
            return;
        }

        this._originals.trayOnNotify = tray._onNotify;
        this._originals.trayShowNotification = tray._showNotification;
        this._originals.trayShowNotificationCompleted = tray._showNotificationCompleted;
        this._originals.trayHideNotification = tray._hideNotification;
        this._originals.trayHideNotificationCompleted = tray._hideNotificationCompleted;

        const self = this;

        tray._onNotify = function(source, notification) {
            self._prepareNotification(notification);
            return self._originals.trayOnNotify.call(this, source, notification);
        };

        tray._showNotification = function() {
            self._originals.trayShowNotification.call(this);
            self._applyPosition(this);
        };

        tray._showNotificationCompleted = function() {
            self._originals.trayShowNotificationCompleted.call(this);

            if (this._notification) {
                this._updateNotificationTimeout(self._timeoutMs());
                self._scheduleDelete(this._notification);
            }
        };

        tray._hideNotification = function() {
            self._disconnectPositionSignal(this);
            self._originals.trayHideNotification.call(this);
        };

        tray._hideNotificationCompleted = function() {
            const notification = this._notification;

            self._originals.trayHideNotificationCompleted.call(this);

            if (self.deleteAfterTimeout && notification && !notification._destroyed) {
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            }
        };
    }

    _normalizeParams(params) {
        if (!params || params.length < 8) {
            return params;
        }

        const next = params.slice();
        const hints = {};

        for (let key in (params[6] || {})) {
            hints[key] = params[6][key];
        }

        hints.resident = GLib.Variant.new_boolean(false);

        if (this.normalizeCritical) {
            hints.urgency = GLib.Variant.new_byte(URGENCY_NORMAL);
        }

        next[6] = hints;
        next[7] = this._timeoutMs();

        return next;
    }

    _prepareNotification(notification) {
        if (!notification) {
            return;
        }

        notification.setResident(false);

        if (this.normalizeCritical && notification.urgency === MessageTray.Urgency.CRITICAL) {
            notification.setUrgency(MessageTray.Urgency.NORMAL);
        }
    }

    _scheduleDelete(notification) {
        if (!this.deleteAfterTimeout || !notification) {
            return;
        }

        this._clearTimer(notification);

        notification._cnfTimerId = Mainloop.timeout_add_seconds(this.timeoutSeconds, () => {
            notification._cnfTimerId = 0;

            if (!notification._destroyed) {
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            }

            return false;
        });

        this._timers.push(notification);
    }

    _clearTimer(notification) {
        if (notification && notification._cnfTimerId) {
            Mainloop.source_remove(notification._cnfTimerId);
            notification._cnfTimerId = 0;
        }
    }

    _clearAllTimers() {
        for (let i = 0; i < this._timers.length; i++) {
            this._clearTimer(this._timers[i]);
        }

        this._timers = [];
    }

    _timeoutMs() {
        return Math.max(1, this.timeoutSeconds) * 1000;
    }

    _applyPosition(tray) {
        if (!tray || !tray._notification || !tray._notificationBin || !tray._monitor) {
            return;
        }

        this._disconnectPositionSignal(tray);

        if (tray.bottomPositionSignal) {
            tray._notificationBin.disconnect(tray.bottomPositionSignal);
            tray.bottomPositionSignal = 0;
        }

        const reposition = () => {
            this._setNotificationPosition(tray);
            return false;
        };

        reposition();
        tray._cnfPositionSignal = tray._notificationBin.connect("queue-redraw", reposition);
    }

    _setNotificationPosition(tray) {
        const monitor = tray._monitor;
        const bin = tray._notificationBin;
        const table = tray._notification._table;
        const pos = this.position || "top-right";

        const topPanel = Main.panelManager.getPanel(monitor.index, 0);
        const bottomPanel = Main.panelManager.getPanel(monitor.index, 1);
        const leftPanel = Main.panelManager.getPanel(monitor.index, 2);
        const rightPanel = Main.panelManager.getPanel(monitor.index, 3);

        const margin = this._notificationMargin(table);
        let topGap = 10;
        let bottomGap = 10;
        let leftGap = 0;
        let rightGap = 0;

        if (topPanel) {
            topGap += topPanel.actor.get_height();
        }

        if (bottomPanel) {
            bottomGap += bottomPanel.actor.get_height();
        }

        if (leftPanel) {
            leftGap += leftPanel.actor.get_width();
        }

        if (rightPanel) {
            rightGap += rightPanel.actor.get_width();
        }

        const width = bin.width || table.width;
        const height = bin.height || table.height;
        const isLeft = pos.indexOf("left") !== -1;
        const isBottom = pos.indexOf("bottom") !== -1;

        bin.x = isLeft
            ? monitor.x + margin + leftGap
            : monitor.x + monitor.width - width - margin - rightGap;

        bin.y = isBottom
            ? monitor.y + monitor.height - height - bottomGap
            : monitor.y + topGap;
    }

    _notificationMargin(table) {
        try {
            return table.get_theme_node().get_length("margin-from-right-edge-of-screen");
        } catch (e) {
            return 10;
        }
    }

    _disconnectPositionSignal(tray) {
        if (tray && tray._cnfPositionSignal) {
            tray._notificationBin.disconnect(tray._cnfPositionSignal);
            tray._cnfPositionSignal = 0;
        }
    }

    _repositionCurrent() {
        if (this._enabled && Main.messageTray) {
            this._applyPosition(Main.messageTray);
        }
    }

    _restore() {
        const daemon = Main.notificationDaemon;
        const tray = Main.messageTray;

        if (daemon && this._originals.notifyAsync) {
            daemon.NotifyAsync = this._originals.notifyAsync;
        }

        if (tray) {
            this._disconnectPositionSignal(tray);

            if (this._originals.trayOnNotify) {
                tray._onNotify = this._originals.trayOnNotify;
            }

            if (this._originals.trayShowNotification) {
                tray._showNotification = this._originals.trayShowNotification;
            }

            if (this._originals.trayShowNotificationCompleted) {
                tray._showNotificationCompleted = this._originals.trayShowNotificationCompleted;
            }

            if (this._originals.trayHideNotification) {
                tray._hideNotification = this._originals.trayHideNotification;
            }

            if (this._originals.trayHideNotificationCompleted) {
                tray._hideNotificationCompleted = this._originals.trayHideNotificationCompleted;
            }
        }

        this._originals = {};
    }
}

