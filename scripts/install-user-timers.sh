#!/usr/bin/env bash
set -euo pipefail

ROOT="${TDS_ROOT:-${HOME}/TDS}"
UNIT_DIR="${HOME}/.config/systemd/user"
RENDER_DIR="${ROOT}/var/systemd/user"

mkdir -p "${UNIT_DIR}" "${RENDER_DIR}"
for unit in "${ROOT}/deploy/systemd/user/"*.service; do
  rendered="${RENDER_DIR}/$(basename "${unit}")"
  sed "s|@TDS_ROOT@|${ROOT}|g" "${unit}" > "${rendered}"
  install -m 0644 "${rendered}" "${UNIT_DIR}/"
done
install -m 0644 "${ROOT}/deploy/systemd/user/"*.timer "${UNIT_DIR}/"

systemctl --user daemon-reload
systemctl --user enable --now tds-openwrt-collect.timer
systemctl --user enable --now tds-unifi-collect.timer
systemctl --user enable --now tds-kismet-collect.timer
systemctl --user enable --now tds-ble-analyzer-collect.timer
systemctl --user enable --now tds-intercept-collect.timer
systemctl --user enable --now tds-rail-rf-collect.timer
systemctl --user enable --now tds-intercept-mqtt-collect.service
# tds-ltesniffer-collect.timer is installed by the wildcard copy above, but
# stays disabled until Lab CBRS/Open5GS LTE frequencies are configured.
systemctl --user list-timers --all 'tds-*.timer'
