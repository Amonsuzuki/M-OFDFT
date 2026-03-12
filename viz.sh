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

"$MAMBA" run -n py39_v2 python ./scratch/outputs/viz.py
