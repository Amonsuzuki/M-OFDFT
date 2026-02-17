#!/bin/bash
#SBATCH --job-name=evaluation
#SBATCH --gres=gpu:4
#SBATCH --time=24:00:00
#SBATCH --partition=gpu-strong
#SBATCH --output=slurm/%j_evaluation.txt
#SBATCH --mem=32G
#SBATCH --chdir=/home/asuzuki/M-OFDFT

set -euo pipefail

MAMBA="$HOME/.local/bin/micromamba"

<<'COMMENT'
if ! "$MAMBA" env list | awk '{print $1}' | grep -qx py39; then
	"$MAMBA" create -y -n py39_v2 python=3.9 pip
fi

"$MAMBA" run -n py39_v2 python -m pip install -U pip
"$MAMBA" run -n py39_v2 python -m pip install torch==1.9.1+cu111 torchaudio -f https://download.pytorch.org/whl/cu111/torch_stable.html
"$MAMBA" run -n py39_v2 python -m pip install pandas scipy matplotlib seaborn
"$MAMBA" run -n py39_v2 python -m pip install "numpy==1.26.4"

"$MAMBA" run -n py39_v2 python -m pip install "e3nn==0.4.4"
"$MAMBA" run -n py39_v2 python -m pip install jupyter pyscf jupytext jupyter_contrib_nbextensions
"$MAMBA" run -n py39_v2 python -m pip install --upgrade notebook==6.4.12
"$MAMBA" run -n py39_v2 python -m pip install torch-scatter==2.0.9 -f https://pytorch-geometric.com/whl/torch-1.9.1+cu111.html
"$MAMBA" run -n py39_v2 python -m pip install torch-sparse==0.6.12 -f https://pytorch-geometric.com/whl/torch-1.9.1+cu111.html
"$MAMBA" run -n py39_v2 python -m pip install torch-geometric==1.7.2
"$MAMBA" run -n py39_v2 python -m pip install torch-cluster==1.5.9 -f https://data.pyg.org/whl/torch-1.9.1+cu111.html

# debug
"$MAMBA" env list
"$MAMBA" run -n py39_v2 which python || echo "python not in py39"
"$MAMBA" run -n py39_v2 python -V || echo "python cannot run in py39"
COMMENT

#"$MAMBA" run -n py39_v2 bash ./scripts/evaluate/examples/Ethanol.MOFDFT.sh
"$MAMBA" run -n py39_v2 bash ./scratch/QM9.MOFDFT_slurm.sh
