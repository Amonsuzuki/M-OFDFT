#!/bin/sh
set -aeux

MICROMAMBA=/usr/local/bin/micromamba
ROOT_PREFIX=/home/amon/.local/share/mamba
ENV_NAME=mofdft

export PYTHONPATH="$(pwd):${PYTHONPATH:-}"


save_root=scratch/outputs/QM9.MOFDFT
MOLECULE=qm9.pbe.isomer
CKPT_PATH=ckpts/QM9.MOFDFT.pt
REPARAM_SPEC='qm9_pbe:Ts_res[atomref]:v7_diis:ref_v1'
PREDICTION_TYPE=Ts_res

OUTPUT_ROOT=${save_root}
TAG=1e-3
STEPS=1000
LR=1e-3
INIT=minao
EXTRACMD="--use-svd --use-local-frame --grid-level 2 --task-id -1 --task-count -1 --evaluate-force --add-delta-at-init"

# run M-OFDFT
echo ">>> setting micromamba environment"
#bash ./scratch/install.sh

echo ">>> about to run eval_flexible.sh"
$MICROMAMBA run -r $ROOT_PREFIX -n $ENV_NAME bash -x ./scratch/eval_flexible.sh
echo ">>> finished eval_flexbile.sh, exit=$?"

path=$OUTPUT_ROOT/total.csv
# calculate statistics
$MICROMAMBA run -r $ROOT_PREFIX -n $ENV_NAME python statistic.py --mode IID --path $path --molecule $MOLECULE --eval-mode relative
