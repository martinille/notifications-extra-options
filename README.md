# Cinnamon Notifications Fixer

Small Cinnamon extension for Linux Mint / Cinnamon that enforces predictable notification behavior:

- shows notification popups for a fixed maximum time
- removes notifications after they close, including notification-center entries
- lets you choose the popup corner
- restores Cinnamon's original behavior when the extension is disabled

Tested against Cinnamon 6.6.7 on Linux Mint 22.3.

## Settings

The extension exposes these settings in Cinnamon's extension settings UI:

- `Timeout`: number of seconds before notifications close
- `Delete after timeout`: remove notifications from the notification center after closing
- `Normalize critical urgency`: prevents critical notifications from bypassing normal close behavior
- `Position`: top-right, top-left, bottom-right, or bottom-left

## Install

Run:

```bash
./scripts/install.sh
```

Then enable `Cinnamon Notifications Fixer` in Cinnamon Extensions.

## Disable or revert

Disable the extension in Cinnamon Extensions. The extension restores all patched Cinnamon methods in `disable()`, so disabling it returns notification handling to the original Cinnamon behavior.

To remove the installed files:

```bash
rm -rf ~/.local/share/cinnamon/extensions/cinnamon-notifications-fixer@martinille
```

Restart Cinnamon if the extension UI does not refresh immediately.

## Validation

Run:

```bash
./scripts/test.sh
```

