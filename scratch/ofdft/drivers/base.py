from contextlib import contextmanager

import numpy as np

import torch
import torch.nn as nn

import pyscf
import pyscf.df
import pyscf.dft

from scratch.ofdft.modules import OFDFT, BackwardableOFDFT
from scratch.ofdft.init import get_init_coeff
from scratch.ofdft.integrals import int1c1e_int_analytical

class BaseOFDFTDriver(nn.Module):
    def __init__(self, mol, grid=None, grid_type='basic', grid_slice_size=32768,
                 init_method='initguess_minao',
                 init_normalize=False, normalize_coeff=False,
                 auxbasis='def2-universal-jfit',
                 **kwargs):
        # use parent init method
        super().__init__()

        # set variables
        self.mol = mol
        self.grid = grid
        self.auxmol = pyscf.df.addons.make_auxmol(mol, auxbasis=auxbasis)
        self.should_normalize = normalize_coeff
        self.ofdft = BackwardableOFDFT(
                self.mol,
                self.auxmol,
                self.preprocess_fn,
                self.tsbase_fn,
                self.xc_fn,
                self.correction_fn,
                grid_coords=self.grid.coords if self.grid is not None else None,
                grid_weights=self.grid.weights if self.grid is not None else None,
                grid_type=grid_type,
                grid_slice_size=grid_slice_size,
                )

        # self.auxmol to untrainable pytorch parameter
        make_param = lambda a: nn.Parameter(torch.tensor(a), requires_grad=False)
        self.norm_vec = make_param(int1c1e_int_analytical(self.auxmol))

        # if init_method is str instance
        if isinstance(init_method, str):
            # get initial coefficients
            var_init = torch.tensor(get_init_coeff(init_method, self.mol, self.auxmol, use_dm=self.use_dm))
            # normalize initial coefficients
            if init_normalize:
                # normalize_var is correct
                #var_init = self.normalize_coeff(var_init)
                var_init = self.normalize_var(var_init)
        # init with given initialize method
        else:
            var_init = torch.tensor(init_method(self.mol, self.auxmol))

        # initial coefficients to python variable, trainable
        self.var = nn.Parameter(var_init, requires_grad=True)

    def build_grid(self, mol=None, level=None):
        # generate Arom-centered grid
        grid = pyscf.dft.gen_grid.Grids(mol or self.mol)
        if level is not None:
            grid.level = level
        grid.build()
        return grid

    def normalize_var(self, var):
        # weighted (by auxmol) sum
        int_nelec = (self.norm_vec * var).sum()
        # normalizetion factor
        norm_factor = self.mol.nelectron / int_nelec
        var = var * norm_factor
        return var
    
    # thanks to property decorator, it behaves as if it is attribute. ex) inst.coeff_var
    @property
    def coeff_var(self):
        return self.var

    @property
    def normalized_var(self):
        return self.normalize_var(self.coeff_var)

    @property
    def normalized_coeff(self):
        return self.normalized_var

    @property
    def coeff_for_input(self):
        return self.normalized_coeff if self.should_normalize else self.coeff_var

    # auxiliary rho
    def auxrho(self):
        # auxiliary basis @ coefficients
        return self.ofdft.all_auxao_values() @ self.coeff_for_input.detach().cpu()

    def preprocess_fn(self, coeff):
        pass

    def correction_fn(self, data):
        pass

    # method from ofdft module
    def forward(self):
        return self.ofdft(self.coeff_for_input)

    # with contextmanager, code before yiled is executed when entering, like initial method
    # yield is similar to return value, but it can resume later inside with
    @contextmanager
    def context(self):
        # method from ofdft module
        # ofdft.context is also contextmanager
        with self.ofdft.context(self.coeff_for_input) as ctx:
            yield ctx

    # method from ofdft module
    def forward_and_backward(self, forward_parts=None, backward_parts=None):
        return self.ofdft.forward_and_backward(
                lambda: self.coeff_for_input,
                forward_parts=forward_parts,
                backward_parts=backward_parts
                )

    def evaluate_veff(self):
        assert self.var.grad is None or torch.all(self.var.grad.eq(0))
        coeffs = lambda: self.coeff_for_input
        # backward is true, so computational result is stored to gradients
        self.ofdft.evaluate_energy(coeffs, self.ofdft.compute_j, backward=True)
        self.ofdft.evaluate_energy_grid(coeffs, self.ofdft.compute_xc, backward=True)
        # effective potential
        veff = self.var.grad.detach()
        self.var.grad = None
        return veff

    # effective potential is fixed, forward and backward parts are not designated
    def forward_and_backward_with_fixed_veff(self, veff):
        backward_parts = ['vext', 'corr']
        # return value
        rets = self.ofdft.forward_and_backward(lambda: self.coeff_for_input, backward_parts=backward_parts)
        # add effective potential to grad
        # because Effective potential does NOT include Ts term
        self.var.grad += veff
        return rets

