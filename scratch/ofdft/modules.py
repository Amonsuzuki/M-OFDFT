import math
from typing import Callable, Tuple, Dict
from contextlib import contextmanager

import torch
import torch.nn as nn

import pyscf

from scratch.ofdft.functionals import *
from scratch.ofdft.integrals import *

class BasicGridValueProvider(nn.Module):
    def __init__(self, auxmol, grid_coords, grid_weights, slice_size=None):
        super().__init__()
        self.auxmol = auxmol
        self.sliced = slice_size is not None
        auxao_values = pyscf.dft.numint.eval_ao(self.auxmol, grid_coords, deriv=1)
        auxao_values = torch.tensor(auxao_values)
        grid_weights = torch.tensor(grid_weights)
        if self.sliced:
            self.nslice = math.ceil(grid_weights.shape[0] / slice_size)
            self.auxao_values = nn.ParameterList(
                    nn.Parameter(t, requires_grad=False)
                    for t in auxao_values.split(slice_size, dim=1)
                    )
            self.grid_weights = nn.ParameterList(
                    nn.Parameter(t, requires_grad=False)
                    for t in grid_weights.split(slice_size, dim=0)
                    )
            assert len(self.auxao_values) == len(self.grid_weights)
            assert self.nslice == len(self.auxao_values)

        else:
            self.auxao_values = nn.Parameter(auxao_values, requires_grad=False)
            self.grid_weights = nn.Parameter(grid_weights, requires_grad=False)

class BaseOFDFT(nn.Module):
    def __init__(
            self,
            mol: pyscf.gto.Mole,
            auxmol: pyscf.gto.Mole,
            preprocess_fn: Callable[[torch.Tensor], Tuple[Dict, torch.Tensor]],
            tsbase_fn: Callable[[DensityVars, torch.Tensor], torch.Tensor],
            xc_fn: Callable[[DensityVars, torch.Tensor], torch.Tensor],
            correction_fn: Callable[[Dict], torch.Tensor],
            ):
        super().__init__()
        self.correction_fn = correction_fn
        self.tsbase_fn = tsbase_fn
        self.xc_fn = xc_fn

        self.mol = mol
        self.auxmol = auxmol

        self.auxao_2c2e = nn.Parameter(torch.tensor(int2c2e_analytical(auxmol)), requires_grad=False)
        self.auxao_1c1e_nuc = nn.Parameter(torch.tensor(int1c1e_nuc_analytical(auxmol)), requires_grad=False)
        self.preprocess_fn = preprocess_fn

class OFDFT(BaseOFDFT):
    def __init__(self, *args, grid_coords, grid_weights, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.tsbase_fn.is_empty or not self.xc_fn.is_empty:
            self.grid = BasicGridValueProvider(self.auxmol, grid_coords, grid_weights)

    def forward(self, coeffs: torch.Tensor):
        with self.context(coeffs) as ctx:
            return ctx.loss, ctx.terms, ctc.tsxc_terms

    @contextmanager
    def context(self, coeffs: torch.Tensor):
        if not self.tsbase_fn.is_empty or not self.xc_fn.is_empty:
            auxao_value = self.grid.auxao().to(self.auxao_2c2e.device)
            grid_weights = self.grid_weights().to(self.auxao_2c2e.device)
            rho = auxao_value @ coeffs
            d = DensityVars(rho, coeffs)

            tsbase, _ = self.tsbase_fn(d, grid_weights)
            xc, xc_terms = self.xc_fn(d, grid_weights)
        else:
            tsbase = 0.0
            xc = 0.0
            xc_terms = {}

        j = compute_coulomb(coeffs, self.auxao_2c2e)
        vext = compute_vext(coeffs, self.auxao_1c1e_nuc)

        data = self.preprocess_fn(coeffs)
        correction = self.correction_fn(data)

        terms = {'vext': vext, 'j': j, 'tsbase': tsbase, 'xc': xc, 'corr': correction}
        e_tot = vext + j + tsbase + xc + correction

        loss = e_tot

        ctx = SimpleNamespace(**locals())
        try:
            yield ctx
        finally:
            pass

    def all_auxao_values(self):
        return self.grid_all_auxao_values()


class BackwardableOFDFT(BaseOFDFT):
    def __init__(
            self,
            *args,
            grid_coords, grid_weights,
            grid_slice_size=32768, grid_type='basic',
            **kwargs
            ):
        super().__init__(*args, **kwargs)
        if not self.tsbase_fn.is_empty or not self.xc_fn.is_empty:
            assert grid_type in ['basic', 'lazy']
            if grid_type == 'basic':
                self.grid = BasicGridValueProvider(self.auxmol, grid_coords, grid_weights, grid_slice_size)
            elif grid_type == 'lazy':
                self.grid = LazyGridValueProvider(self.auxmol, grid_coords, grid_weights, grid_slice_size)
    def compute_j(self, coeffs: torch.Tensor):
        return compute_coulumb(coeffs, self.auxao_2c2e)

    def compute_vect(self, coeffs: torch.Tensor):
        return compute_vext(coeffs, self.auxao_1c1e_nuc)
