#!/bin/bash
#SBATCH --job-name=evaluation
#SBATCH --gres=gpu:1
#SBATCH --time=24:00:00
#SBATCH --partition=gpu-strong
#SBATCH --output=slurm/%j_evaluation.txt
#SBATCH --mem=32G
#SBATCH --chdir=/home/asuzuki/M-OFDFT-master

python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip setuptools wheel cmake
#pip install torch==1.9.1+cu111 torchaudio -f https://download.pytorch.org/whl/cu111/torch_stable.html
pip install torch==2.2.0 torchaudio torchvision  --index-url https://download.pytorch.org/whl/cu118
pip install pandas numpy scipy matplotlib seaborn
pip install jupyter pyscf e3nn jupytext jupyter_contrib_nbextensions
pip install --upgrade notebook==6.4.12
#pip install torch-scatter==2.0.9 -f https://pytorch-geometric.com/whl/torch-1.9.1+cu111.html
#pip install torch-sparse==0.6.12 -f https://pytorch-geometric.com/whl/torch-1.9.1+cu111.html
pip install torch-geometric==1.7.2
#pip install torch-cluster==1.5.9 -f https://data.pyg.org/whl/torch-1.9.1+cu111.html

pip install pyg_lib torch_scatter torch_sparse torch_cluster torch_spline_conv \
  -f https://data.pyg.org/whl/torch-2.2.0+cu118.html

./scripts/evaluate/examples/Ethanol.MOFDFT.sh
