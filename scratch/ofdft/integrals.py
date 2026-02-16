from functools import lru_cache
import pyscf

@lru_cache(16)
def int1c1e_int_analytical(auxmol: pyscf.gto.Mole):
    helper_mol = build_1c1e_helper_mol(auxmol)
    intor = pyscf.gto.mole.intor_cross('int1e_ovlp', helper_mol, auxmol)
    intor = intor[0]
    return intor
