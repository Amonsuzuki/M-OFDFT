import numpy as np

import torch
import torch.nn as nn

from scratch.ofdft.functionals import build_tsxc
from scratch.ofdft.drivers.base import BaseOFDFTDriver

def make_param(x, dtype=None):
    if type(x) != torch.Tensor:
        x = torch.tensor(x, dtype=dtype)
    return nn.Parameter(x, requires_grad=False)

class GraphormerOFDFTDriver(BaseOFDFTDriver):
    def __init__(
            self, mol, model, reparam=None, tsbase=None, xc=None,
            use_local_frame=False, use_svd_space=False,
            init_add_delta=False,
            grid=None,
            coeff_dim=477,
            *args, **kwargs
            ):
        # reference function of ts
        self.tsbase_fn = tsbase or build_tsxc({
            'GGA_K_APBE': 1.0,
            }, bias=0.0)

        # xc function
        self.xc_fn = xc or build_tsxc({
            'LDA_X': 1.0,
            'LDA_C_VWN': 1.0,
            }, bias=0.0)
        
        # if no grid and tsbase_fn and xc_fn are alive.
        if grid is None and (not self.tsbase_fn.is_empty or not self.xc_fn.is_empty):
            grid = self.build_grid(mol)

        # parent init
        super().__init__(mol, grid=grid, *args, **kwargs)

        # set model self variable. if it is not a nn.Module, load the model.
        if isinstance(model, nn.Module):
            self.model = model
        else:
            ckpt_path = model
            self.model = GraphormerOFDFTDriver.load_model(ckpt_path)

        # set self variables
        self.coeff_dim = coeff_dim
        # max atom 5!?
        self.max_atom = 5 if self.coeff_dim == 477 else 4
        # atom type array of the molecule and their positions
        # x is elem_idx
        x, pos = self.get_constant_inputs()
        # make it as nn.Parameter, untrainable
        self.x = make_param(x)
        self.pos = make_param(pos)

        # building atom coeff mask range, (N_atom, coeff_dim)
        coeff_mask = self.build_coeff_mask()
        self.coeff_mask = make_param(coeff_mask)
        self.reparam_version = reparam
        if reparam is not None:
            # legacy reparam
            if reparam.startswith('!'):
                raise NotImplementedError()
            # new reparam
            else:
                from .utils import get_reparam, get_grad_mean, get_atomic_linear_coeffs, get_delta_coeff_mean, get_delta_coeff_std
                # what are they?
                reparam_spec, energy_mean, energy_std, coeff_mean, reparam_factors = get_reparam(reparam)
                self.reparam_spec = reparam_spec
                self.energy_mean = energy_mean
                self.energy_std = energy_std
                # should be pytorch parameter
                self.basis_coeff_mean = make_param(coeff_mean)
                self.reparam = make_param(reparam_factors)
                self.use_atomref = reparam_spec.use_atomref
                if self.use_atomref:
                    # what is grad mean's shape?
                    # I guess (coeff_dim)
                    self.grad_mean = make_param((get_grad_mean(reparam_spec) * coeff_mask)[coeff_mask])
                    # count atom type, (how_many_times_index_atom_appeared in x)
                    atom_counts = np.array([np.sum(x == i + 1) for i in range(self.max_atom)])
                    # get linear atom coeff, LCAO approximation gives atomic orbital weights.
                    atom_coeffs = get_atomic_linear_coeffs(reparam_spec)
                    # atom total energy reference, coeffs * num_of_atom, the last value is bias
                    self.atomref_energy_bias = atom_counts @ atom_coeffs[:-1] + atom_coeffs[-1]
                # delta coeff mean and std as parameter
                self.delta_coeff_mean = make_param(get_delta_coeff_mean(reparam_spec))
                self.delta_coeff_std = make_param(get_delta_coeff_std(reparam_spec))
        else:
            self.reparam = None
            # normal distribution
            self.energy_mean = 0.0
            self.energy_std = 1.0

        self.rot_D = None
        self.use_local_frame = use_local_frame
        if use_local_frame:
            import scratch.ofdft.utils.rotations
            # get rotation (local frame) of given molecule
            per_atom_rot = scratch.ofdft.utils.rotations.get_rotations(mol)
            # to pytorch tensor
            rot_tensors = [torch.FloatTensor(t) for t in per_atom_rot]
            # total
            local_frame_D = scratch.ofdft.utils.rotations.get_total_rotation_D(self.auxmol, rot_tensors)
            # to python parameter
            self.rot_D = make_param(local_frame_D.double())
            # relative (global) rotations
            self.relrots = make_param(scratch.ofdft.utils.rotations.get_relative_rotations(rot_tensors))
            # d matric feature?
            self.edge_rot_D = make_param(scratch.ofdft.utils.roations.build_Dmatrix_features(self.relorts, max_order=2)[None, ...])

        # singular value decomposition of overlap matrix
        self.use_svd_space = use_svd_space
        if use_svd_space:
            aux_ovlp = self.auxmol.intor('int1e_ovlp')
            if self.rot_D is not None:
                aux_ovlp = self.rot_D.numpy() @ aux_ovlp @ self.rot_D.T.numpy()
            U, S, Vh = np.linalg.svd(aux_ovlp, hermitian=True)
            # L = U * sqrt(S) * Vh
            # A = U * S * Vh = L @ L.T
            self.svd_L = make_param(np.dot(U * np.sqrt(S), Vh))
            self.svd_L_inv = make_param(np.dot(U / np.sqrt(S), Vh))

        # add delta
        if init_add_delta:
            self.var.data += kwargs['init_delta_ratio'] * self.predict_delta_coeff(project=True)


    def get_constant_inputs(self):
        elem_idx = {'H': 1, 'C': 2, 'N': 3, 'O': 4, 'F': 5}
        # get atom index of given molecule
        x = np.array([elem_idx[atom] for atom in self.mol.elements], dtype=np.int64)
        # get coordinates of molecule, (n_atoms, 3)
        pos = self.mol.atom_coords().astype(float)
        # (n) to (1, n, 1)
        x = x[np,.newaxis, ..., np.newaxis]
        # (n) to (1, n)
        pos = pos[np.newaxis]
        return x, pos

    def build_coeff_mask(self):
        # retb-2.5
        # each atom basis is designed for each atoms, and they are not overlap usually.
        # so coeff vector is a concatenated atom basis of each atoms.
        elem_basis_range = {
                'H': (0, 20),
                'C': (20, 129),
                'N': (129, 245),
                'O': (245, 361),
                'F': (361, 477),
                }
        # mol size
        N = len(self.mol.elements)
        # (N, coefficient dimention)
        mask = np.zeros((N, self.coeff_dim), dtype=np.float32)
        # for all atoms, mask indicated where the atom range is.
        for i in range(N):
            begin, end = elem_basis_range[self.mol.elements[i]]
            mask[i, begin:end] = 1
        return mask.astype(bool)

    # write coeff values to masked place
    def coeff_vec_to_mat(self, coeff, coeff_dim=477):
        shape = (self.mol.natm, coeff_dim)
        return coeff.new_zeros(shape).masked_scatter_(self.coeff_mask, coeff)

    def reparametrize_coeff(self, coeff):
        if self.reparam_version is not None:
            # old reparam version
            if self.reparam_version.startswith('!'):
                modname, version = self.reparam_version[1:].split(':')
                if modname != 'qm9_b3lyp_def2' or version not in ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']:
                    # convert basis_coeff_mean's dtype and device as same as coeff
                    mean = self.basis_coeff_mean.to(coeff)
                    # substract mean
                    coeff = coeff - self.coeff_mask * mean[None, None, :]
                return coeff * self.reparam[None, None, :]
            else:
                mean = self.basis_coeff_mean.to(coeff)
                coeff = coeff - self.coeff_mask * mean[None, None, :]
                return coeff * self.reparam[None, None, :]
        else:
            return coeff


    def preprocess_fn(self, coeff):
        model_input = {'x': self.x, 'pos': self.pos}
        # align type
        if self.rot_D.dtype == torch.float32:
            coeff = coeff.float()
        # when use local frame
        if self.use_local_frame:
            coeff = self.rot_D @ coeff
            # add model input
            model_input['relrot'] = self.relrots
            # add spherical harmonics edge features
            #model_input['rel_rot_sph'] = self.rel_rot_sph
            # change sperical harmonics edge features into wigner-D matric features
            model_input['edge_rot_D'] = self.edge_rot_D

        # using svd space
        if self.use_svd_space:
            coeff = self.svd_L.T @ coeff
        # coeff matrix
        coeff_mat = self.coeff_vec_to_mat(coeff, coeff_dim=self.coeff_dim).unsqueeze(0).float()
        coeff_mat = self.reparametrize_coeff(coeff_mat)
        # all set to True (1, N) boolean
        model_input['padding_mask'] = coeff.new_ones((1, coeff_mat.size(1))).bool()
        # node attribute/feature
        model_input['node_attr'] = coeff_mat
        return model_input, coeff

    def predict_delta_coeff(self, coeff=None, project=True):
        with torch.no_grad():
            # where is coeff_for_input?
            if coeff is None:
                coeff = self.coeff_for_input
            # get model_input and coefficients
            moldel_input, coeff = self.preprocess_fn(coeff)
            # predict delta_coeff
            delta_coeff = self.model(model_input)[2][0]
            delta_coeff = delta_coeff * self.delta_coeff_std + self.delta_coeff_mean
            # select elements where coeff_mask is True
            if self.rot_D.dtype == torch.float32:
                delta_coeff = delta_coeff[self.coeff_mask]
            else:
                delta_coeff = delta_coeff[self.coeff_mask].double()
            # svd
            if self.use_svd_space:
                delta_coeff = self.svd_L_inv.T @ delta_coeff
            # local frame
            if self.use_local_frame:
                delta_coeff = self.rot_D.T @ delta_coeff
            # projection
            if project:
                if self.rot_D.dtype == torch.float32:
                    norm_vec = self.norm_vec.float()
                    delta_coeff = delta_coeff - (delta_coeff @ norm_vec) / (norm_vec @ norm_vec) * norm_vec
                else:
                    delta_coeff = delta_coeff - (delta_coeff @ self.norm_vec) / (self.norm_vec @ self.norm_vec) * self.norm_vec
            return delta_coeff

    def atom_ref_energy(self, coeff):
        if coeff.dtype == torch.float32:
            # atomref_energy_bias is the number of each atom type * concatenated per-atom absolute energy
            # Is this coeff for atom? electron?
            # get_grad_mean's content will revail what the grad_mean is
            return coeff @ -self.grad_mean.float() + float(self.atomref_energy_bias)
        else:
            return coeff @ -self.grad_mean + self.atomref_energy_bias

    # returns kcal/mol base energy from data
    def correction_fn(self, data):
        HARTREE_TO_KCAL = 627.50947406305558
        EV_TO_KCAL = 23.0609
        # get prediction
        model_input, coeff = data
        output = self.model(model_input)

        if isinstance(output, tuple):
            output = output[0] # use only the energy
        energy = output[0] # remove batch dimention

        # add atom energy to total energy
        if self.use_atomref:
            energy += self.atom_ref_energy(coeff)

        # denormalizing
        energy = energy * self.energy_std + self.energy_mean

        # NOTE: recover the energy from [ev|div5] to kcal/mol
        # unit adjustment
        if 'div5' in self.reparam_spec.energy_option:
            energy = energy * 5
        elif '_ev' in self.reparam_spec.energy_option:
            energy = energy * EV_TO_KCAL

        return energy / HARTREE_TO_KCAL

