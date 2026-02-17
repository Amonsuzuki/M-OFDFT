#!/bin/bash
#SBATCH --job-name=evaluation
#SBATCH --gres=gpu:4
#SBATCH --time=24:00:00
#SBATCH --partition=gpu-strong
#SBATCH --output=slurm/%j_evaluation.txt
#SBATCH --mem=32G
#SBATCH --chdir=/home/asuzuki/M-OFDFT-master

module avail python

python3 -m venv venv
source venv/bin/activate

module avail python

python - <<'PY'
import numpy as np
print("numpy version:", np.__version__)
import numpy.exceptions
print("numpy.exceptions: OK")
PY

pip install --upgrade pip setuptools wheel cmake
pip install torch==2.2.0 torchaudio torchvision  --index-url https://download.pytorch.org/whl/cu118
pip uninstall -y numpy
pip install "numpy==1.26.4"
pip install pandas scipy matplotlib seaborn
pip install jupyter pyscf e3nn jupytext jupyter_contrib_nbextensions
pip install --upgrade notebook==6.4.12
pip install torch-geometric==1.7.2

pip install pyg_lib torch_scatter torch_sparse torch_cluster torch_spline_conv \
  -f https://data.pyg.org/whl/torch-2.2.0+cu118.html

python -c "import torch; print(torch.__version__, torch.version.cuda)"

python -m pip freeze | egrep 'torch|nvidia-cudnn|nvidia-cuda'

./scripts/evaluate/examples/Ethanol.MOFDFT.sh
