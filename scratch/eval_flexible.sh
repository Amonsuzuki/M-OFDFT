#!/bin/bash
echo "Molecule: $MOLECULE"
echo "Checkpoint path: $CKPT_PATH"
echo "Reparam spec: $REPARAM_SPEC"
echo "Prediction type: $PREDICTION_TYPE"
echo "Output root: $OUTPUT_ROOT"
echo "Steps: $STEPS"
echo "LR: $LR"
echo "Inits: $INIT"
echo "Extra commandline: $EXTRACMD"

# nworker is 1 for debug
python scratch/evaluate.py \
	--molecule $MOLECULE --prediction-type $PREDICTION_TYPE \
	--ckpt-path $CKPT_PATH --reparam-spec $REPARAM_SPEC \
	--init $INIT --steps $STEPS --lr $LR \
	--output-dir $OUTPUT_ROOT \
	--ngpu 4 --nworker 4 \
	$EXTRACMD
