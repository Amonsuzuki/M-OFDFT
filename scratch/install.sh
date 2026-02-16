#!/usr/bin/env bash
set -euo pipefail

MICROMAMBA_BIN="${MICROMAMBA_BIN:-/usr/local/bin/micromamba}"
MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:~/home/amon/.local/share/mamba}"
ENV_NAME="${ENV_NAME:-mofdft}"
PY_VER="${PY_VER:-3.9}"

mm() {
	"${MICROMAMBA_BIN}" -r "${MAMBA_ROOT_PREFIX}" "$@"
}

echo "[1/5] Creating micromamba env '${ENV_NAME}' (python=${PY_VER})..."
mm create -y -n "${ENV_NAME}" -c conda-forge "python=${PY_VER}" "pip"

echo "[2/5] Installing conda packages (conda-forge) ..."
mm install -y -n "${ENV_NAME}" -c conda-forge \
	pandas numpy scipy matplotlib seaborn

echo "[3/5] Installing Pytorch ..."
mm run -n "${ENV_NAME}" python -m pip install --upgrade pip
mm run -n "${ENV_NAME}" python -m pip install \
	"torch==1.9.1+cu111" torchaudio \
	-f https://download.pytorch.org/whl/cu111/torch_stable.html

echo "[4/5] Installing remaining python packages ..."
mm run -n "${ENV_NAME}" python -m pip install \
	jupyter pyscf e3nn jupytext jupyter_contrib_nbextensions
mm run -n "${ENV_NAME}" python -m pip install --upgrade "notebook==6.4.12"

echo "[5/5] Installing PyG stack ..."
mm run -n "${ENV_NAME}" python -m pip install \
	"torch-scatter==2.0.9" -f https://pytorch-geometric.com/whl/torch-1.9.1+cu111.html
mm run -n "${ENV_NAME}" python -m pip install \
	"torch-sparse==0.6.12" -f https://pytorch-geometric.com/whl/torch-1.9.1+cu111.html
mm run -n "${ENV_NAME}" python -m pip install \
	"torch-geometric==1.7.2"
mm run -n "${ENV_NAME}" python -m pip install \
	"torch-cluster==1.5.9" -f https://data.pyg.org/whl/torch-1.9.1+cu111.html

echo "Done."
