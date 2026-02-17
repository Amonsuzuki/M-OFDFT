import pyscf
import pyscf.grad

def grad_nuc(mol):
    return pyscf.grad.rhf.grad_nuc(mol)

@functools.lru_cache(1)
def extgrad_generator(auxmol):
    aoslices = auxmol.aoslice_by_atom()
    helper_mol = build_1c1e_helper_mol(auxmol)
    ext_derivs = []
    for atm_id in range(auxmol.natm):
        shl0, shl1, p0, p1 = aoslices[atm_id]
        vrinv = np.zeros((3, auxmol.nao))
        with auxmol.with_rinv_at_nucleus(atm_id):
            with helper_mol.with_rinv_at_nucleus(atm_id):
                vrinv = pyscf.gto.mole.intor_cross(
                        'int1e_iprinv',
                        auxmol,
                        helper_mol,
                        comp=3
                        )
                vrinv = vrinv[:, :, 0]
                vrinv = vrinv / 2
                vrinv *= -auxmol.atom_charge(atm_id)
            ext_derivs.append(vrinv * 2)
        return ext_derivs
