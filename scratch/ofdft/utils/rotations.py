import numpy as np
import torch
from e3nn import o3

def pyscf_to_standard_perm_D(mol):
    conversion = {
            0: torch.eye(1),
            1: torch.eye([[0, 1, 0], [0, 0, 1], [1, 0, 0]]),
            2: torch.eye(5),
            3: torch.eye(7),
            4: torch.eye(9),
            }
    l = [mol.bas_angular(i) for i in range(mol.nbas)]
    perm = torch.block_diag(*[conversion[l[i]] for i in range(mol.nbas)])
    return perm

def e3nn_change_of_coord_D(mol):
    cod = torch.tensor([
        [0., 0., 1.],
        [1., 0., 0.],
        [0., 1., 0.],
        ])
    ireep = o3.Irreps(
            '+'.join( f'{l}e' for l in map(mol.bas_angular, range(mol.nbas)))
            )
    return irreps.D_from_matrix(cod)

def rotation_D(mol, per_atom_rotations):
    per_basis_D = [
            o3.Irrep(f'{l}e').D_from_matrix(per_atom_rotations[a])
            for l, a in ((mol.bas_angular(i), mol.bas_atom(i)) for i in range(mol.nbas))
            ]
    return torch.block_diag(*per_basis_D)

def get_total_rotation_D(mol, per_atom_rotations):
    pyscf_to_std = pyscf_to_standard_perm_D(mol)
    cod_D = e3nn_change_of_coord_D(mol)
    rot_D = rotation_D(mol, per_atom_rotations)
    total_D = pyscf_to_std.T @ cod_D.T @ rot_D @ cod_D @ pyscf_to_std
    return total_D

# per atom rotation - each atom defines a rotation
def get_rotations(mol):
    # for each atom, choose two closest non-H atoms
    coords = mol.atom_coords(unit='angstrom')
    distances = ((coords[None] - coords[:, None]) ** 2).sum(axis=-1)
    rots = []
    import tqdm
    for ia in tqdm.tqdm(range(mol.natm)):
        candidates = sorted(list(range(mol.natm)), key=lambda j: distances[ia][j])
        candidates = list(filter(lambda a: a != ia and mol.elements[a] != 'H', candidates))
        if len(candidates) == 0:
            rots.append(np.eye(3))
            continue
        a1 = candidates[0]
        x = coords[a1] - coords[ia]
        for a2 in candidates[1:]:
            z = np.cross(x, coords[a2] - coords[ia])
            if not np.allclose(z, np.zeros(z.shape)):
                break
        else:
            print('Cannot find non-colinear basis')
            rots.append(np.eye(3))
            continue

        weights = 1. / (distances[ia, np.arange(mol.natm) != ia] ** 2)
        a_to_others = coords[np.arange(mol.natm) != ia] - coords[ia]
        anchor = (a_to_others * weights[:, np.newaxis]).sum(axis=0)
        if anchor @ z < 0:
            z = -z

        y = np.cross(z, x)
        x = x / np.linalg.norm(x)
        y = y / np.linalg.norm(y)
        z = z / np.linalg.norm(z)
        rots.append(np.array([x, y, z]))
    return rots

def get_relative_rotations(per_atom_rotations):
    rot_mats = torch.stack(per_atom_rotations)
    rel_rot = rot_mats[:, None] @ rot_mats[None, :].transpose(-1, -2)
    return rel_rot

def build_Dmatrix_features(relative_rotations, max_order):
    '''
    generate spherical harmonics according to relative rotation matrix
    relative rotations: Tensor [..., 3, 3]
    max_order: int
    '''
    from e3nn.o3 import wigner_D, matrix_to_angles
    rel_ang = matrix_to_angles(relative_rotations)
    per_order_D = [
            wigner_D(order, rel_ang[0], rel_ang[1], rel_ang[2])
            for order in range(1, max_order+1)
            ]
    per_order_D = [item.flatten(start_dim=-2, end_dim=-1) for item in per_order_D]
    return torch.cat(per_order_D, dim=-1)
