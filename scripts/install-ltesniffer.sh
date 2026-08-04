#!/usr/bin/env bash
set -euo pipefail

ROOT="${TDS_LTESNIFFER_ROOT:-/opt/tds/ltesniffer}"
REPO_URL="${TDS_LTESNIFFER_REPO:-https://github.com/SysSec-KAIST/LTESniffer.git}"
REF="${TDS_LTESNIFFER_REF:-main}"
JOBS="${TDS_LTESNIFFER_BUILD_JOBS:-4}"
OWNER="${TDS_LTESNIFFER_OWNER:-$(id -un)}"
GROUP="${TDS_LTESNIFFER_GROUP:-$(id -gn)}"

patch_legacy_cmake_minimums() {
  local file
  for file in "$@"; do
    [[ -f "${file}" ]] || continue
    sed -i -E 's/cmake_minimum_required[[:space:]]*\([[:space:]]*VERSION[[:space:]]+[0-9.]+[[:space:]]*\)/cmake_minimum_required(VERSION 3.5)/' "${file}"
  done
}

patch_generated_cmake_minimums() {
  while IFS= read -r file; do
    sed -i -E 's/cmake_minimum_required[[:space:]]*\([[:space:]]*VERSION[[:space:]]+[0-9.]+[[:space:]]*\)/cmake_minimum_required(VERSION 3.5)/' "${file}"
  done < <(find "${ROOT}/build" \( -name CMakeLists.txt -o -name "*.cmake" -o -name "*.cmake.in" \) -type f 2>/dev/null)
}

patch_srsran_gcc15_headers() {
  local fmt_core="${ROOT}/build/srsRAN-src/lib/include/srsran/srslog/bundled/fmt/core.h"
  local channel_mapping="${ROOT}/build/srsRAN-src/lib/include/srsran/radio/channel_mapping.h"
  if [[ -f "${fmt_core}" ]] && ! grep -q "#include <array>" "${fmt_core}"; then
    sed -i '/#include <cstring>/a #include <array>' "${fmt_core}"
  fi
  if [[ -f "${channel_mapping}" ]] && ! grep -q "#include <string>" "${channel_mapping}"; then
    sed -i '/#include <mutex>/a #include <string>' "${channel_mapping}"
  fi
}

patch_srsran_warning_flags() {
  local cmake_file="${ROOT}/build/srsRAN-src/CMakeLists.txt"
  [[ -f "${cmake_file}" ]] || return 0
  sed -i -E 's/[[:space:]]+-Werror"/"/g; s/[[:space:]]+-Werror[[:space:]]+/ /g' "${cmake_file}"
}

patch_ltesniffer_srsran_options() {
  local cmake_file="${ROOT}/src/CMakeLists.txt"
  local marker="TDS disables unused srsRAN app targets"
  [[ -f "${cmake_file}" ]] || return 0
  grep -q "${marker}" "${cmake_file}" && return 0
  sed -i "/# Add srsRAN directly to our build./i\\
  # ${marker}; LTEDSniffer links the libraries for PDSCH/PUSCH decode.\\
  set(ENABLE_SRSUE OFF CACHE BOOL \"Build srsUE application\" FORCE)\\
  set(ENABLE_SRSENB OFF CACHE BOOL \"Build srsENB application\" FORCE)\\
  set(ENABLE_SRSEPC OFF CACHE BOOL \"Build srsEPC application\" FORCE)\\
  set(ENABLE_ALL_TEST OFF CACHE BOOL \"Build srsRAN unit tests\" FORCE)\\
" "${cmake_file}"
}

patch_ltesniffer_c_compat() {
  local falcon_dci="${ROOT}/src/lib/src/phy/falcon_phch/falcon_dci.c"
  local ul_sniffer_pusch="${ROOT}/src/lib/src/phy/falcon_phch/ul_sniffer_pusch.c"
  [[ -f "${falcon_dci}" ]] || return 0
  sed -i 's/for (auto i = 0; i < SRSRAN_MAX_CODEWORDS; i++)/for (uint32_t i = 0; i < SRSRAN_MAX_CODEWORDS; i++)/' "${falcon_dci}"
  [[ -f "${ul_sniffer_pusch}" ]] || return 0
  grep -q 'srsran/phy/utils/debug.h' "${ul_sniffer_pusch}" && return 0
  sed -i '/#include "falcon\/phy\/falcon_phch\/ul_sniffer_pusch.h"/a #include "srsran/phy/utils/debug.h"' "${ul_sniffer_pusch}"
}

sudo -n apt-get update
sudo -n apt-get install -y \
  build-essential \
  cmake \
  git \
  libboost-all-dev \
  libconfig++-dev \
  libcurl4-gnutls-dev \
  libfftw3-dev \
  libglib2.0-dev \
  libmbedtls-dev \
  libsctp-dev \
  libudev-dev \
  libuhd-dev \
  pkg-config \
  qtdeclarative5-dev \
  libqt5charts5-dev \
  uhd-host

sudo -n install -d -o "${OWNER}" -g "${GROUP}" "${ROOT}"

if [[ ! -d "${ROOT}/src/.git" ]]; then
  git clone "${REPO_URL}" "${ROOT}/src"
else
  git -C "${ROOT}/src" fetch --all --tags
fi

git -C "${ROOT}/src" checkout "${REF}"

patch_legacy_cmake_minimums \
  "${ROOT}/src/CMakeLists.txt" \
  "${ROOT}/src/external/cmake/cmnalib.CMakeLists.txt.in" \
  "${ROOT}/src/external/cmake/srsRAN.CMakeLists.txt.in" \
  "${ROOT}/build/cmnalib-src/CMakeLists.txt" \
  "${ROOT}/build/srsRAN-src/CMakeLists.txt"
patch_ltesniffer_srsran_options
patch_ltesniffer_c_compat

configure_ltesniffer() {
  cmake -S "${ROOT}/src" -B "${ROOT}/build" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DENABLE_UHD=ON \
    -DENABLE_BLADERF=OFF \
    -DENABLE_SOAPYSDR=OFF \
    -DENABLE_GUI=OFF
}

configure_ltesniffer
patch_generated_cmake_minimums
patch_srsran_gcc15_headers
patch_srsran_warning_flags
configure_ltesniffer
patch_generated_cmake_minimums
patch_srsran_gcc15_headers
patch_srsran_warning_flags

cmake --build "${ROOT}/build" -j "${JOBS}"

sudo -n chown -R "${OWNER}:${GROUP}" "${ROOT}"

test -x "${ROOT}/build/src/LTESniffer"
"${ROOT}/build/src/LTESniffer" -h >/dev/null || true

echo "LTESniffer installed at ${ROOT}/build/src/LTESniffer"
